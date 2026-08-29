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

Which leaves a real gap, and it is not this file's to close: a hook that never
armed and a run that did nothing produce the same clean report. The parent can
tell them apart because it knows whether any row arrived at all, so the signal
belongs in the sensor-health block on the report (docs/spec.md Contract 2).
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
"""


def write_pyhook(pyhook_dir: Path) -> None:
    pyhook_dir.mkdir(parents=True, exist_ok=True)
    (pyhook_dir / "sitecustomize.py").write_text(SITECUSTOMIZE.lstrip())
