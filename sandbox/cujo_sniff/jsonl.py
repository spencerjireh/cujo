"""The sensors' one storage format: a line of JSON per event.

Every sensor appends; every reader tolerates a torn last line, because a
daemon can be signalled mid-write while a report is being built.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_jsonl(path: Path, offset: int = 0) -> list[dict[str, Any]]:
    """Read the JSON lines written after byte `offset`; skip a torn last line."""
    if not path.exists():
        return []
    with path.open("rb") as fh:
        fh.seek(offset)
        data = fh.read()
    rows: list[dict[str, Any]] = []
    for line in data.splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def file_size(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    with path.open("a") as fh:
        fh.write(json.dumps(row) + "\n")
