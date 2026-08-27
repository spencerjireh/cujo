"""Cujo in-sandbox sensor and detonation script.

Runs inside a Daytona sandbox. Installs one dependency behind a logging proxy
and prints a single JSON report to stdout; its sensors (proxy, filesystem
diff, decoy access time, Python audit hook) are shared by every check. The
report schema and the sensor design are defined in docs/spec.md (Contract 2).
This is a skeleton; the sensor and detonation logic land in the next
milestone.
"""

from __future__ import annotations


def main() -> None:
    """Entry point. Not yet implemented; see docs/spec.md Contract 2."""
    raise NotImplementedError("sniff.py detonation is not implemented yet")


if __name__ == "__main__":
    main()
