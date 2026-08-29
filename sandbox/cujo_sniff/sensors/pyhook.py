"""Sensor: the Python audit hook.

Installed on PYTHONPATH so every Python process a check spawns (pip running a
setup.py included) reports opens, connects, and subprocesses. Guarded against
re-entry because writing the log is itself an `open` event.

Both `except Exception` blocks below are deliberate and load-bearing. This code
runs inside the process being measured, so an exception that escapes it does
not fail the sensor -- it fails the command under test, and the check then
reports a crash caused by Cujo as evidence against the pull request. A false
`critical` is a worse outcome than a missing row. The two channels a diagnostic
could use are both closed for the same reason: stdout and stderr belong to the
audited program, and the log is the thing that just failed.

That used to leave a real gap: a hook that never armed and a run that did
nothing produced the same empty log, and the report could not tell them apart.
The hook now writes one `armed` row as it installs itself, so an empty log means
no Python process ran and a log with only that row means one ran and did
nothing. Which of the two it is reaches the report as `sensors.audit`
(docs/spec.md Contract 2).

An unarmed hook is not by itself a fault. A check that runs `npm test` has no
Python process to hook, and reporting that as a broken sensor would cry wolf on
every JavaScript repository -- so the state is reported and the agent weighs it,
rather than becoming a finding on its own.
"""

from __future__ import annotations

from pathlib import Path

SITECUSTOMIZE = r"""
import json, os, sys, threading

_LOG = os.environ.get("CUJO_AUDIT_LOG")
_local = threading.local()


def _write(row):
    if not _LOG or getattr(_local, "busy", False):
        return
    _local.busy = True
    try:
        row["pid"] = os.getpid()
        with open(_LOG, "a") as fh:
            fh.write(json.dumps(row) + "\n")
    except Exception:
        # The log is unwritable. Nowhere to report that from inside the
        # audited process: stdout and stderr are its own, and the log is what
        # failed. The parent notices a hook that produced no rows.
        pass
    finally:
        _local.busy = False


def _hook(event, args):
    try:
        if event == "open":
            path, mode = args[0], args[1]
            if isinstance(path, (str, bytes)) and mode is not None:
                _write({"event": "open", "path": os.fsdecode(path), "mode": str(mode)})
        elif event == "socket.connect":
            addr = args[1]
            if isinstance(addr, tuple) and len(addr) >= 2:
                _write({"event": "connect", "host": str(addr[0]), "port": int(addr[1])})
        elif event == "subprocess.Popen":
            argv = args[1]
            if isinstance(argv, (list, tuple)):
                _write({"event": "subprocess", "argv": [os.fsdecode(a) for a in argv]})
            elif argv is not None:
                _write({"event": "subprocess", "argv": [os.fsdecode(argv)]})
        elif event in ("os.exec", "os.posix_spawn"):
            argv = args[1]
            if isinstance(argv, (list, tuple)):
                _write({"event": "subprocess", "argv": [os.fsdecode(a) for a in argv]})
    except Exception:
        # An audit hook that raises kills the process it is watching, and the
        # check would report that crash as evidence against the pull request.
        # Losing one row is the lesser wrong; see this module's docstring.
        pass


if _LOG:
    sys.addaudithook(_hook)
    # Proof of life, and the only row this hook writes about itself. Without it
    # "the hook never loaded" and "the command did nothing" are the same empty
    # file, and the report has to guess which.
    _write({"event": "armed"})
"""


def write_pyhook(pyhook_dir: Path) -> None:
    pyhook_dir.mkdir(parents=True, exist_ok=True)
    (pyhook_dir / "sitecustomize.py").write_text(SITECUSTOMIZE.lstrip())
