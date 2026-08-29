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

# A file that is in scope for hashing but could not be read. Distinct from
# `None`, which means the file was never in scope, because the two must not
# compare equal: overwrite a credential with something the same length, restore
# the timestamp, then `chmod 000` it, and treating the failed digest as
# out-of-scope would let the metadata comparison call it unchanged.
UNREADABLE = "unreadable"
# In scope, and past HASH_MAX_BYTES. This one *does* fall back to metadata --
# there is no digest on either side to compare -- which is why it may not be
# silent: `snapshot` counts these and the report carries `truncated.hashes`, so
# a file too large to check says so instead of reading as checked and clean.
UNHASHED = "unhashed"

# (mtime_ns, size, digest). The digest is None where the file was not in scope
# for hashing, UNREADABLE where it was but could not be read, and UNHASHED where
# it was in scope but too large.
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
    # In-scope files the size cap left uncompared. Not the same kind of loss as
    # `truncated` -- those paths were walked and recorded, just not hashed --
    # but it is a loss, and the report says so rather than presenting a
    # metadata-only verdict as a content one.
    unhashed: int = 0


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
    """A content digest, UNREADABLE if it could not be taken, None if unwanted.

    A symlink is digested by its target rather than by the file it points at:
    `lstat` already describes the link itself, and repointing a link somewhere
    new is a change the snapshot should see. Following it would instead hash
    whatever it aims at, which the walk records separately anyway.

    The open is deliberately awkward. `lstat` said this was a regular file, but
    the command under test owns this tree and can swap the name for a FIFO
    before the open happens -- and a FIFO with no writer blocks forever, which
    would hang the snapshot and with it the whole check. `O_NOFOLLOW` refuses a
    symlink put in the way, `O_NONBLOCK` makes the FIFO case return instead of
    wait, and the `fstat` afterwards is on the descriptor actually opened, so
    what is hashed is what was checked.
    """
    try:
        if stat.S_ISLNK(st.st_mode):
            return hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()
        if not stat.S_ISREG(st.st_mode):
            return None
        if st.st_size > HASH_MAX_BYTES:
            return UNHASHED
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                return UNREADABLE
            h = hashlib.sha256()
            read = 0
            while chunk := os.read(fd, 65536):
                read += len(chunk)
                # The size that let this file through the cap came from an
                # `lstat` taken before the open, and a background process is
                # free to have grown the file since. Reading to EOF on that
                # promise is an unbounded read of a file the command controls,
                # which is the snapshot never finishing. The cap is enforced
                # here, on what was actually read, and the file falls back to
                # the metadata it would have had a size ago.
                if read > HASH_MAX_BYTES:
                    return UNHASHED
                h.update(chunk)
            return h.hexdigest()
        finally:
            os.close(fd)
    except OSError:
        # In scope and not readable, which is its own fact: a file that hashed
        # before and does not now has changed, whatever its metadata says.
        return UNREADABLE


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
    unhashed = 0
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
                if digest == UNHASHED:
                    unhashed += 1
                seen[str(p)] = (st.st_mtime_ns, st.st_size, digest)
                # One past the cap, not at it. A tree holding exactly
                # MAX_SNAPSHOT_FILES files was walked to the end, and calling
                # that truncated made `diff_snapshots` disbelieve creations and
                # deletions it could in fact prove. Finding an extra file is
                # what proves there was more; that file is then dropped, so the
                # cap still bounds what a snapshot costs.
                if len(seen) > MAX_SNAPSHOT_FILES:
                    del seen[str(p)]
                    return Snapshot(seen, truncated=True, unhashed=unhashed)
    return Snapshot(seen, truncated=False, unhashed=unhashed)


def _unchanged(before: Entry, after: Entry) -> bool:
    """Same metadata, and the same content wherever both sides have a digest.

    `None` on either side means the path was never in hashing scope, so there is
    nothing to compare and metadata is the whole answer -- which is what it was
    before there were digests at all. UNHASHED behaves the same way and for the
    same reason, and is a distinct value only so the walk can count it and the
    report can admit the gap. UNREADABLE is neither: it is a digest that was
    wanted and failed, so it compares unequal to a real one. A file that hashed
    before and cannot be read now has changed.
    """
    if before[:2] != after[:2]:
        return False
    if before[2] in (None, UNHASHED) or after[2] in (None, UNHASHED):
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

    Which of the two walks was truncated decides which absences can be believed,
    and they are not interchangeable. A path only the *after* walk holds is
    `created` if the before walk was complete -- a complete walk would have seen
    it already, so its absence is real -- and says nothing if the before walk
    stopped early, because it may simply be a path that walk never reached.
    A path only the *before* walk holds is `deleted` on the same argument, run
    the other way round, so it needs the after walk to be the complete one.
    Getting this wrong in either direction invents evidence, and `wrote_sensitive`
    is a `critical` the agent may not lower.

    A change to a path both walks hold is always reported: no absence is being
    read, only two readings of the same file.

    The workspace roots are canonicalised once, here, rather than per row: the
    snapshot walks canonical roots, so a caller that passes an unresolved root
    would otherwise see every one of its own files as outside the workspace.
    """
    roots = [canonical(r) for r in workspace_roots]
    trust_creations = not before.truncated
    trust_deletions = not after.truncated
    changes: list[dict[str, Any]] = []
    for path in sorted(before.entries.keys() | after.entries.keys()):
        in_before, in_after = path in before.entries, path in after.entries
        if in_before and in_after:
            if _unchanged(before.entries[path], after.entries[path]):
                continue
            kind = "modified"
        elif in_after:
            if not trust_creations:
                continue
            kind = "created"
        else:
            if not trust_deletions:
                continue
            kind = "deleted"
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
