"""Folding raw sensor rows into the block every check report carries.

This is the last place that decides anything inside the sandbox. It classifies,
deduplicates, sets the `derived` booleans the hard rules read, and says which
sensors were watching while it did -- and it is pure, so every one of those
decisions is testable without a sandbox.

Two of the report's blocks exist to stop a `false` from meaning two things at
once. `sensors` says which sensors were armed, so "not observed" and "not
observable" stop looking alike; `truncated` says where a cap cut the evidence
short, so a short list is not read as a quiet one.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from cujo_sniff.paths import display_path
from cujo_sniff.policy import (
    KNOWN_INDEX_HOSTS,
    MAX_FILES_READ,
    decoy_spellings,
    is_decoy,
    is_noise_read,
    is_sensitive,
)
from cujo_sniff.scrub import scrub, scrub_argv

# The sensors a report describes, in the order they are reported.
SENSOR_NAMES = ("proxy", "decoy", "audit", "fs_diff")
# The caps a report says whether it hit.
TRUNCATION_KEYS = (
    "stdout_tail",
    "stderr_tail",
    "files_read",
    "snapshot",
    "hashes",
    "sensor_logs",
    "script_content",
)


def health(armed: bool, detail: str) -> dict[str, Any]:
    """One sensor's line in the health block.

    `detail` is read by a human and by the agent, so it says what was true --
    "inotify", "port 41337", "31 rows" -- rather than restating `armed`. It must
    never name a host, a path, or a repository: a check report is published
    verbatim on the anonymous public plane, with no field-level allowlist
    between here and there.
    """
    return {"armed": armed, "detail": detail}


def build_sensor_block(
    *,
    proxy_rows: list[dict[str, Any]],
    audit_rows: list[dict[str, Any]],
    decoy_rows: list[dict[str, Any]],
    fs_changes: list[dict[str, Any]],
    allow_hosts: list[str],
    check: str,
    sensors: dict[str, dict[str, Any]],
    truncated: dict[str, bool],
    home_dir: Path | None = None,
    cwd: Path | None = None,
) -> dict[str, Any]:
    """Fold the raw sensor logs into the block every check report carries.

    `cwd` is the audited command's working directory: the audit hook records
    paths as the program passed them, so a relative one is resolved here,
    against that directory, before it is classified.

    `sensors` and `truncated` arrive partly filled. The caller owns the facts it
    alone holds -- whether the daemons are still alive, how far the snapshot
    walked, how long the output was before it was tailed -- and this function
    adds the two only it can see: whether the audit hook armed, and whether the
    file-read cap dropped anything.
    """
    base = Path(cwd) if cwd is not None else Path.cwd()
    decoy_paths = decoy_spellings(home_dir)
    egress = merge_egress(proxy_rows)
    files_read: list[dict[str, Any]] = []
    subprocesses: list[dict[str, Any]] = []
    decoy_read = any(r.get("event") in ("open", "access") for r in decoy_rows)
    audit_armed = any(r.get("event") == "armed" for r in audit_rows)
    dropped_reads = 0
    seen_paths: set[str] = set()
    for row in audit_rows:
        if row.get("event") == "open":
            mode = row.get("mode", "r")
            path = str(row.get("path", ""))
            if path and not os.path.isabs(path):
                path = str(base / path)
            if path and is_decoy(path, decoy_paths):
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
                    {
                        # Every string below is the pull request's own: the
                        # filenames it chose, the arguments it ran, the hosts it
                        # asked for. They are quoted into a prompt, so they are
                        # escaped here -- see `scrub`.
                        "path": scrub(display_path(Path(path), home_dir)),
                        "sensitive": sensitive,
                    }
                )
            else:
                dropped_reads += 1
        elif row.get("event") == "subprocess":
            subprocesses.append({"argv": scrub_argv(row.get("argv", []))})
        elif row.get("event") == "connect":
            host = row.get("host", "")
            if host and not host.startswith("127.") and host != "::1":
                egress.append({"host": host, "port": row.get("port", 0), "bytes": 0})
    allowed = KNOWN_INDEX_HOSTS | {h.lower() for h in allow_hosts}
    for e in egress:
        e["known"] = e["host"].lower() in allowed
        e["host"] = scrub(e["host"])
    unknown = any(not e["known"] for e in egress)
    is_install = check == "detonation"
    # Said as what it is. The audited command holds `CUJO_AUDIT_LOG` and can
    # append this row itself, so an armed hook and a command claiming one look
    # identical from here -- as they do for every other sensor, all of which
    # write to files that command can also write to. The lie only goes one way:
    # it hides a gap and cannot invent a finding.
    audit_detail = f"{len(audit_rows)} rows" if audit_armed else "no Python process ran"
    return {
        "egress": egress,
        "files_read": files_read,
        "fs_changes": fs_changes,
        "subprocesses": subprocesses,
        "secret_probe": {
            "decoy_read": decoy_read,
            # Null, not false: the proxy counts bytes and never reads a payload,
            # so nothing in this sandbox can tell whether the decoy's value left
            # the box. Saying `false` claimed an observation nobody made
            # (decisions 54 and 20).
            "decoy_in_egress": None,
        },
        "sensors": {**sensors, "audit": health(audit_armed, audit_detail)},
        "truncated": {**truncated, "files_read": dropped_reads > 0},
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
    known: dict[tuple[str, int], bool] = {}
    errors: dict[tuple[str, int], int] = {}
    for r in rows:
        key = (str(r.get("host", "")), int(r.get("port", 0)))
        totals[key] = totals.get(key, 0) + int(r.get("bytes", 0))
        if r.get("error"):
            errors[key] = errors.get(key, 0) + 1
        # Carried through the merge rather than recomputed: `known` is set from
        # the allowlist the run was configured with, and merging rows from
        # several runs must not quietly drop the verdict. A row that never had
        # one stays without one.
        if isinstance(r.get("known"), bool):
            known[key] = known.get(key, True) and r["known"]
    merged = []
    for (h, p), b in sorted(totals.items()):
        row: dict[str, Any] = {"host": h, "port": p, "bytes": b}
        if (h, p) in known:
            row["known"] = known[(h, p)]
        if (h, p) in errors:
            row["errors"] = errors[(h, p)]
        merged.append(row)
    return merged


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
        "decoy_in_egress": None,
    }
    # A sensor counts as armed only if it was armed for every command: the
    # merged block covers all of them, and one blind stretch makes the whole of
    # it "not observable". The detail comes from the run that reported it
    # unarmed, because that is the one worth reading.
    merged["sensors"] = {}
    for name in SENSOR_NAMES:
        entries = [r["sensors"][name] for r in reports if name in r.get("sensors", {})]
        if not entries:
            continue
        armed = all(e["armed"] for e in entries)
        detail = next((e["detail"] for e in entries if not e["armed"]), entries[-1]["detail"])
        merged["sensors"][name] = health(armed, detail)
    merged["truncated"] = {
        k: any(r.get("truncated", {}).get(k, False) for r in reports) for k in TRUNCATION_KEYS
    }
    merged["derived"] = {k: any(r["derived"][k] for r in reports) for k in reports[0]["derived"]}
    return merged
