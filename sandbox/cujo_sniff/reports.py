"""Where each check's `runs[]` entries are kept between commands.

A sub-agent runs several wrapped commands and then has to hand back every entry,
in order and whole. It was asked to copy them out of stdout and it paraphrased,
which is what `runs.0.schema_version: Required (+31 more)` was (decision 112).
So each command records its own entry here, and `sniff.py report` reads them back
and assembles the envelope. The model copies one blob instead of thirty-two
fields per entry.

Standard library only, like everything under `sandbox/` (decision 46).
"""

from __future__ import annotations

import json
from typing import Any

from cujo_sniff.context import Context, runs_path


def record_run(ctx: Context, check: str, report: dict[str, Any]) -> None:
    """Append one `runs[]` entry to this check's own file.

    One file per check, so a report is assembled from the commands that check
    actually ran and nothing else. Append-only and one JSON object per line, so
    a command killed mid-write costs its own entry and not the ones before it.
    """
    path = runs_path(ctx, check)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as fh:
        fh.write(json.dumps(report, separators=(",", ":")) + "\n")


def read_runs(ctx: Context, check: str) -> list[dict[str, Any]]:
    """Every entry this check recorded, in the order it ran them."""
    path = runs_path(ctx, check)
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            # A half-written line from a killed command. Skipping it loses that
            # entry and keeps the rest, which is the better of the two.
            continue
        if isinstance(parsed, dict):
            entries.append(parsed)
    return entries
