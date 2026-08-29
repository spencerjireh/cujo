"""Where everything lives, decided once and passed down.

`Context` replaces what used to be two module constants read at import time.
Import-time constants meant a test could only change them by patching the
module attribute, which patched the test process and not the subprocesses the
code actually spawns; a value passed down is the same value everywhere.

The sensors under `sensors/` never see a `Context`. They take their paths as
arguments, which is what lets a daemon run without building one.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cujo_sniff.paths import home
from cujo_sniff.policy import DECOY_REL, DEFAULT_PROXY_PORT


@dataclass(frozen=True)
class Context:
    """The directory layout one invocation works in.

    `proxy_port` and `allow_hosts` are deliberately absent: `setup` writes them
    to `config.json` and later commands read them back, so they have a
    different lifetime and live in `load_config` instead. Folding them in here
    would mean no `Context` could exist before `setup` had run.
    """

    state_dir: Path
    envs_dir: Path
    home: Path
    # The directory holding the `cujo_sniff` package, which is what a daemon
    # sets as its working directory so `python3 -m cujo_sniff` can import it.
    code_dir: Path
    python: str

    @classmethod
    def from_env(cls) -> Context:
        # The default is under the code directory, not equal to it. The rubric
        # extracts `sandbox/` into /tmp/cujo and then never writes there again,
        # so a state dir of /tmp/cujo mixed our logs, the decoy backup, and the
        # sensed lock in among the modules being imported. Nested keeps the
        # code directory a listing of code, which is what makes "did anything
        # change in /tmp/cujo?" a question with a meaning.
        state_dir = Path(os.environ.get("CUJO_DIR", "/tmp/cujo/state"))
        return cls(
            state_dir=state_dir,
            # Detonation environments live beside the state dir, not inside it:
            # the snapshot prunes the state dir (our own logs churn on every
            # check) but must see what an install writes into its environment.
            envs_dir=Path(os.environ.get("CUJO_ENVS_DIR", f"{state_dir}-envs")),
            home=home(),
            code_dir=Path(__file__).resolve().parent.parent,
            python=sys.executable,
        )


def state_paths(ctx: Context) -> dict[str, Path]:
    return {
        "proxy_log": ctx.state_dir / "proxy.jsonl",
        "decoy_log": ctx.state_dir / "decoy.jsonl",
        "audit_log": ctx.state_dir / "audit.jsonl",
        # One audit log per sensed command, named for that command. Which file
        # a row landed in is the attribution; nothing in the row has to be
        # trusted for it. The shared `audit_log` above is where a process
        # running outside a sensed window writes, and no report reads it.
        "audit_dir": ctx.state_dir / "audit",
        "pyhook": ctx.state_dir / "pyhook",
        "config": ctx.state_dir / "config.json",
        "proxy_pid": ctx.state_dir / "proxy.pid",
        "watcher_pid": ctx.state_dir / "watcher.pid",
        "decoy_backup": ctx.state_dir / "decoy.backup",
        "sensed_lock": ctx.state_dir / "sensed.lock",
        "envs": ctx.envs_dir,
    }


def decoy_path(ctx: Context) -> Path:
    return ctx.home / DECOY_REL


def load_config(ctx: Context) -> dict[str, Any]:
    path = state_paths(ctx)["config"]
    if not path.exists():
        return {"allow_hosts": [], "proxy_port": DEFAULT_PROXY_PORT}
    return json.loads(path.read_text())
