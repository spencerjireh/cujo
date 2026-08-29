"""One spelling of every path, so two sensors never disagree about a directory.

Nothing here imports the rest of the package: these are the primitives the
policy tables, the sensors, and the report builder all compare with.
"""

from __future__ import annotations

import os
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def canonical(path: Path) -> Path:
    """The one spelling of `path` every comparison uses: symlinks resolved.

    A directory reachable by two names — `/tmp` and `/private/tmp`, a HOME
    behind a symlink — is one directory, and a sensor that walks it under both
    names reports each file twice and classifies the two rows differently.
    """
    return Path(os.path.realpath(path))


def under(path: Path, target: Path) -> bool:
    return path == target or target in path.parents


def display_path(path: Path, home_dir: Path | None = None) -> str:
    """Render a path with `~` for HOME so reports read the same on any box."""
    h = home_dir or home()
    for root in (h, canonical(h)):
        try:
            return "~/" + str(path.relative_to(root))
        except ValueError:
            continue
    return str(path)


def in_any(path: Path, roots: list[Path]) -> bool:
    """True when `path` is one of `roots` or under one.

    Both sides must already be canonical. Comparing a resolved path against an
    unresolved root is how a write inside the workspace came to be reported as
    `wrote_outside_workspace`: one spelling of the directory matched and the
    other did not.
    """
    return any(under(path, r) for r in roots)
