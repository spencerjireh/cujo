"""Sensor: the filesystem snapshot, taken either side of a sensed command.

Two walks of HOME, the workspace, and /etc, compared. This is the one sensor
that needs nothing of the process under test — it sees a write however it was
made, including from a language runtime with no audit hook at all.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from cujo_sniff.paths import canonical, display_path, home, in_any
from cujo_sniff.policy import MAX_SNAPSHOT_FILES, is_sensitive


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


def snapshot(
    workspace_roots: list[Path],
    *,
    state_dir: Path,
    home_dir: Path | None = None,
) -> dict[str, tuple[int, int]]:
    """Map path -> (mtime_ns, size) for HOME, the workspace, and /etc.

    Skips our own state dir and .git internals; stops at a file cap so a huge
    tree cannot turn a check into a snapshot benchmark.
    """
    seen: dict[str, tuple[int, int]] = {}
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
                seen[str(p)] = (st.st_mtime_ns, st.st_size)
                if len(seen) >= MAX_SNAPSHOT_FILES:
                    return seen
    return seen


def diff_snapshots(
    before: dict[str, tuple[int, int]],
    after: dict[str, tuple[int, int]],
    workspace_roots: list[Path],
    home_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Rows for every path that differs between the snapshots, deletions included.

    A deletion is a write too: removing a credential or a shell rc is at least
    as interesting as creating one, so before-only paths get a `deleted` row
    with the same workspace and sensitivity classification.

    The workspace roots are canonicalised once, here, rather than per row: the
    snapshot walks canonical roots, so a caller that passes an unresolved root
    would otherwise see every one of its own files as outside the workspace.
    """
    roots = [canonical(r) for r in workspace_roots]
    changes: list[dict[str, Any]] = []
    for path in sorted(before.keys() | after.keys()):
        if path in before and path in after and before[path] == after[path]:
            continue
        if path not in after:
            kind = "deleted"
        elif path in before:
            kind = "modified"
        else:
            kind = "created"
        p = Path(path)
        changes.append(
            {
                "path": display_path(p, home_dir),
                "type": kind,
                "in_workspace": in_any(p, roots),
                "sensitive": is_sensitive(path, home_dir),
            }
        )
    return changes
