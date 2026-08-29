"""The detonation check: install one dependency in a fresh environment.

Unlike `run`, this is several sensed commands — create the environment, then
install into it — whose sensor blocks are unioned into one report.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from cujo_sniff.context import Context, state_paths
from cujo_sniff.policy import tail
from cujo_sniff.report import merge_reports
from cujo_sniff.runner import run_sensed


def detect_source(spec: str) -> str:
    if spec.startswith("npm:"):
        return "npm"
    if re.match(r"^(@[\w.-]+/)?[\w.-]+@[^=]", spec):
        return "npm"
    return "pypi"


def _pypi_install_cmds(ctx: Context, env_dir: Path, spec: str) -> list[list[str]]:
    """Prefer venv+pip; use uv when the interpreter ships without pip."""
    python = env_dir / "bin" / "python"
    pip_ok = subprocess.run([ctx.python, "-c", "import ensurepip"], capture_output=True).returncode
    if pip_ok == 0:
        return [
            [ctx.python, "-m", "venv", str(env_dir)],
            [str(python), "-m", "pip", "install", "--no-input", spec],
        ]
    uv = shutil.which("uv")
    if uv is None:
        raise SystemExit("detonate: neither ensurepip nor uv is available")
    return [
        [uv, "venv", str(env_dir)],
        [uv, "pip", "install", "--python", str(python), spec],
    ]


def cmd_detonate(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    spec = args.dependency
    source = args.source if args.source != "auto" else detect_source(spec)
    spec_clean = spec.removeprefix("npm:")
    env_dir = state_paths(ctx)["envs"] / hashlib.sha1(spec.encode()).hexdigest()[:12]
    shutil.rmtree(env_dir, ignore_errors=True)
    env_dir.mkdir(parents=True)
    if source == "npm":
        cmds = [["npm", "install", "--prefix", str(env_dir), "--no-audit", "--no-fund", spec_clean]]
    else:
        cmds = _pypi_install_cmds(ctx, env_dir, spec_clean)
    started = time.monotonic()
    reports: list[dict[str, Any]] = []
    for cmd in cmds:
        r = run_sensed(ctx, cmd, check="detonation", workspace_roots=[env_dir], cwd=env_dir)
        reports.append(r)
        if r["exit"] != 0:
            break
    last = reports[-1]
    sensors = merge_reports(reports)
    return {
        "dependency": spec_clean,
        "source": source,
        "install_ok": all(r["exit"] == 0 for r in reports),
        "duration_s": round(time.monotonic() - started, 2),
        "subprocesses": [{"argv": r["argv"], "exit": r["exit"]} for r in reports]
        + [{"argv": s["argv"], "exit": None} for s in sensors.pop("subprocesses")],
        "stdout_tail": tail(last["stdout_tail"]),
        "stderr_tail": tail(last["stderr_tail"]),
        **sensors,
    }
