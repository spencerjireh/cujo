"""Sensor: the Python audit hook.

Installed on PYTHONPATH so every Python process a check spawns (pip running a
setup.py included) reports opens, connects, and subprocesses. Guarded against
re-entry because writing the log is itself an `open` event.
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
        pass


if _LOG:
    sys.addaudithook(_hook)
"""


def write_pyhook(pyhook_dir: Path) -> None:
    pyhook_dir.mkdir(parents=True, exist_ok=True)
    (pyhook_dir / "sitecustomize.py").write_text(SITECUSTOMIZE.lstrip())
