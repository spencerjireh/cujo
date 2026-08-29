"""Folding raw sensor rows into the block every check report carries.

This is the last place that decides anything inside the sandbox. It classifies,
deduplicates, and sets the `derived` booleans the hard rules read — and it is
pure, so every one of those decisions is testable without a sandbox.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from cujo_sniff.paths import canonical, display_path, home
from cujo_sniff.policy import (
    DECOY_REL,
    KNOWN_INDEX_HOSTS,
    MAX_FILES_READ,
    is_noise_read,
    is_sensitive,
)


def _is_decoy(path: Path, decoy_paths: set[Path]) -> bool:
    return path in decoy_paths or canonical(path) in decoy_paths


def build_sensor_block(
    *,
    proxy_rows: list[dict[str, Any]],
    audit_rows: list[dict[str, Any]],
    decoy_rows: list[dict[str, Any]],
    fs_changes: list[dict[str, Any]],
    allow_hosts: list[str],
    check: str,
    home_dir: Path | None = None,
    cwd: Path | None = None,
) -> dict[str, Any]:
    """Fold the raw sensor logs into the block every check report carries.

    `cwd` is the audited command's working directory: the audit hook records
    paths as the program passed them, so a relative one is resolved here,
    against that directory, before it is classified.
    """
    base = Path(cwd) if cwd is not None else Path.cwd()
    # Both spellings of the decoy, because the audit hook records the path the
    # program passed and that need not be the one `setup` seeded.
    decoy = (home_dir or home()) / DECOY_REL
    decoy_paths = {decoy, canonical(decoy)}
    egress = merge_egress(proxy_rows)
    files_read: list[dict[str, Any]] = []
    subprocesses: list[dict[str, Any]] = []
    decoy_read = any(r.get("event") in ("open", "access") for r in decoy_rows)
    seen_paths: set[str] = set()
    for row in audit_rows:
        if row.get("event") == "open":
            mode = row.get("mode", "r")
            path = str(row.get("path", ""))
            if path and not os.path.isabs(path):
                path = str(base / path)
            if path and _is_decoy(Path(path), decoy_paths):
                decoy_read = True
            if any(ch in mode for ch in "wax+"):
                continue
            if path in seen_paths:
                continue
            seen_paths.add(path)
            sensitive = is_sensitive(path, home_dir)
            if not sensitive and is_noise_read(path):
                continue
            if sensitive or len(files_read) < MAX_FILES_READ:
                files_read.append(
                    {"path": display_path(Path(path), home_dir), "sensitive": sensitive}
                )
        elif row.get("event") == "subprocess":
            subprocesses.append({"argv": row.get("argv", [])})
        elif row.get("event") == "connect":
            host = row.get("host", "")
            if host and not host.startswith("127.") and host != "::1":
                egress.append({"host": host, "port": row.get("port", 0), "bytes": 0})
    allowed = KNOWN_INDEX_HOSTS | {h.lower() for h in allow_hosts}
    for e in egress:
        e["known"] = e["host"].lower() in allowed
    unknown = any(not e["known"] for e in egress)
    is_install = check == "detonation"
    return {
        "egress": egress,
        "files_read": files_read,
        "fs_changes": fs_changes,
        "subprocesses": subprocesses,
        "secret_probe": {"decoy_read": decoy_read, "decoy_in_egress": False},
        "derived": {
            "egress_to_unknown_host": unknown,
            "wrote_outside_workspace": any(not c["in_workspace"] for c in fs_changes),
            "wrote_sensitive": any(c["sensitive"] for c in fs_changes),
            # The install's own pip/npm processes are expected; a nested spawn is not.
            "spawned_subprocess": len(subprocesses) > (1 if is_install else 0),
        },
    }


def merge_egress(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[tuple[str, int], int] = {}
    for r in rows:
        key = (str(r.get("host", "")), int(r.get("port", 0)))
        totals[key] = totals.get(key, 0) + int(r.get("bytes", 0))
    return [{"host": h, "port": p, "bytes": b} for (h, p), b in sorted(totals.items())]


def merge_reports(reports: list[dict[str, Any]]) -> dict[str, Any]:
    """Union the sensor blocks of several sensed commands into one block."""
    keys = ("egress", "files_read", "fs_changes", "subprocesses")
    merged: dict[str, Any] = {k: [] for k in keys}
    for r in reports:
        for k in keys:
            merged[k].extend(r[k])
    merged["egress"] = merge_egress(merged["egress"])
    merged["secret_probe"] = {
        "decoy_read": any(r["secret_probe"]["decoy_read"] for r in reports),
        "decoy_in_egress": False,
    }
    merged["derived"] = {k: any(r["derived"][k] for r in reports) for k in reports[0]["derived"]}
    return merged
