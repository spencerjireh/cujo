"""Sensor: the filesystem snapshot, taken either side of a sensed command.

Two walks of HOME, the workspace, and /etc, compared. This is the one sensor
that needs nothing of the process under test -- it sees a write however it was
made, including from a language runtime with no audit hook at all.

A file is identified by `(mtime_ns, size)`, plus a content digest where a silent
edit is the point of the exercise (`policy.should_hash`). Metadata alone is
defeated by `os.utime`: overwrite a key with another key of the same length,
put the timestamp back, and the file is unchanged as far as two `lstat` calls
are concerned. Hashing everything would make each snapshot a full read of HOME,
so the digest is spent on credentials and `/etc` and nowhere else.
"""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cujo_sniff.paths import canonical, display_path, home, in_any
from cujo_sniff.policy import HASH_MAX_BYTES, MAX_SNAPSHOT_FILES, is_sensitive, should_hash
from cujo_sniff.scrub import scrub

# (mtime_ns, size, digest). The digest is None where the file was not in scope
# for hashing, was too large, or could not be read.
Entry = tuple[int, int, str | None]


@dataclass(frozen=True)
class Snapshot:
    """One walk, and whether the file cap cut it short.

    `truncated` travels with the map because a truncated walk cannot be
    compared like a complete one: two walks that stop at different points
    disagree about files neither of them reached, and the difference looks
    exactly like a deletion. `diff_snapshots` needs to know; so does the report.
    """

    entries: dict[str, Entry]
    truncated: bool


def _snapshot_roots(workspace_roots: list[Path], home_dir: Path | None = None) -> list[Path]:
    """HOME, the workspace, and /etc, each by one name and each walked once.

    Canonical, because HOME and the workspace are routinely the same directory
    reached two ways: `--cwd` arrives resolved and `$HOME` does not. Walking
    both spellings put every file in the report twice, and the two rows
    disagreed about `in_workspace`, which turned one write inside the
    workspace into `wrote_outside_workspace`.
    """
    h = home_dir or home()
    roots = [canonical(r) for r in (h, *workspace_roots, Path("/etc"))]
    unique: list[Path] = []
    for r in roots:
        if r.exists() and r not in unique and not in_any(r, unique):
            unique.append(r)
    return unique


def _digest(path: Path, st: os.stat_result) -> str | None:
    """A content digest, or None when there is not one worth having.

    A symlink is digested by its target rather than by the file it points at:
    `lstat` already describes the link itself, and repointing a link somewhere
    new is a change the snapshot should see. Following it would instead hash
    whatever it aims at, which the walk records separately anyway.
    """
    try:
        if stat.S_ISLNK(st.st_mode):
            return hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()
        if not stat.S_ISREG(st.st_mode) or st.st_size > HASH_MAX_BYTES:
            return None
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        # Unreadable is not evidence of anything; the entry falls back to
        # metadata, which is what it had before there were digests at all.
        return None


def snapshot(
    workspace_roots: list[Path],
    *,
    state_dir: Path,
    home_dir: Path | None = None,
) -> Snapshot:
    """Walk HOME, the workspace, and /etc, recording an `Entry` per file.

    Skips our own state dir and .git internals; stops at a file cap so a huge
    tree cannot turn a check into a snapshot benchmark.
    """
    seen: dict[str, Entry] = {}
    for root in _snapshot_roots(workspace_roots, home_dir):
        for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
            d = Path(dirpath)
            if d == state_dir or state_dir in d.parents or d.name == ".git":
                dirnames[:] = []
                continue
            for name in filenames:
                p = d / name
                try:
                    st = p.lstat()
                except OSError:
                    continue
                digest = _digest(p, st) if should_hash(str(p), home_dir) else None
                seen[str(p)] = (st.st_mtime_ns, st.st_size, digest)
                if len(seen) >= MAX_SNAPSHOT_FILES:
                    return Snapshot(seen, truncated=True)
    return Snapshot(seen, truncated=False)


def _unchanged(before: Entry, after: Entry) -> bool:
    """Same metadata, and the same content wherever both sides have a digest."""
    if before[:2] != after[:2]:
        return False
    if before[2] is None or after[2] is None:
        return True
    return before[2] == after[2]


def diff_snapshots(
    before: Snapshot,
    after: Snapshot,
    workspace_roots: list[Path],
    home_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Rows for every path that differs between the snapshots, deletions included.

    A deletion is a write too: removing a credential or a shell rc is at least
    as interesting as creating one, so before-only paths get a `deleted` row
    with the same workspace and sensitivity classification.

    Unless a walk was truncated. The cap stops mid-tree, and two walks of a tree
    that is being written to do not stop in the same place, so a path the second
    walk never reached is absent for a reason that has nothing to do with the
    command. Reporting those as deletions invented evidence; the truncation flag
    on the report is what says why the deletions are missing instead.

    The workspace roots are canonicalised once, here, rather than per row: the
    snapshot walks canonical roots, so a caller that passes an unresolved root
    would otherwise see every one of its own files as outside the workspace.
    """
    roots = [canonical(r) for r in workspace_roots]
    trust_deletions = not (before.truncated or after.truncated)
    changes: list[dict[str, Any]] = []
    for path in sorted(before.entries.keys() | after.entries.keys()):
        in_before, in_after = path in before.entries, path in after.entries
        if in_before and in_after and _unchanged(before.entries[path], after.entries[path]):
            continue
        if not in_after:
            if not trust_deletions:
                continue
            kind = "deleted"
        elif in_before:
            kind = "modified"
        else:
            kind = "created"
        p = Path(path)
        changes.append(
            {
                # The filename is the pull request's own choice of words.
                "path": scrub(display_path(p, home_dir)),
                "type": kind,
                "in_workspace": in_any(p, roots),
                "sensitive": is_sensitive(path, home_dir),
            }
        )
    return changes
