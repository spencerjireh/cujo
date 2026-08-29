"""Cujo in-sandbox sensors and detonation.

Runs inside the Daytona sandbox as the check subagents' one shared tool. Four
commands, each printing exactly one JSON object on stdout:

    python3 sniff.py setup [--allow-host H ...]
        Seed the decoy secret, start the logging proxy and the decoy watcher,
        write the Python audit hook. Prints the env the checks must export.
    python3 sniff.py run --check NAME [--cwd DIR] -- CMD...
        Run one command under the sensors and print its report.
    python3 sniff.py detonate --dependency SPEC [--source pypi|npm|auto]
        Install one dependency in a fresh environment and print its report.
    python3 sniff.py teardown
        Stop the daemons and restore or remove the decoy.

The report shapes and the sensor design are in docs/spec.md, Contract 2.
Standard library only: nothing here may need an install, because the sandbox is
the thing being measured. The package is imported from `sys.path[0]` -- the
directory the rubric extracts it into -- so there is no install step either.
"""

from __future__ import annotations
