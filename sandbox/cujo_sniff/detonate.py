"""The detonation check: install one dependency in a fresh environment.

Unlike `run`, this is several sensed commands — create the environment, then
install into it — whose sensor blocks are unioned into one report.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from cujo_sniff.context import Context, state_paths
from cujo_sniff.policy import SCHEMA_VERSION
from cujo_sniff.report import merge_reports
from cujo_sniff.runner import run_sensed
from cujo_sniff.scrub import scrub


def detect_source(spec: str) -> str:
    if spec.startswith("npm:"):
        return "npm"
    if re.match(r"^(@[\w.-]+/)?[\w.-]+@[^=]", spec):
        return "npm"
    if spec.startswith("gem:"):
        return "gem"
    if spec.startswith("go:"):
        return "go"
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


def _go_download_cmds(env_dir: Path, spec: str) -> list[list[str]]:
    """Download a Go module into an isolated cache via a throwaway module."""
    mod_dir = env_dir / "mod"
    mod_dir.mkdir(parents=True, exist_ok=True)
    at_version = spec if "@" in spec else f"{spec}@latest"
    (mod_dir / "go.mod").write_text("module cujo_detonate\n\ngo 1.21\n")
    return [
        ["go", "get", at_version],
        ["go", "mod", "download"],
    ]


def _gem_install_cmds(env_dir: Path, spec: str) -> list[list[str]]:
    """Install a gem into an isolated directory."""
    return [["gem", "install", spec, "--install-dir", str(env_dir), "--no-document"]]


def cmd_detonate(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    spec = args.dependency
    source = args.source if args.source != "auto" else detect_source(spec)
    spec_clean = spec.removeprefix("npm:").removeprefix("gem:").removeprefix("go:")
    env_dir = state_paths(ctx)["envs"] / hashlib.sha1(spec.encode()).hexdigest()[:12]
    shutil.rmtree(env_dir, ignore_errors=True)
    env_dir.mkdir(parents=True)
    if source == "npm":
        cmds = [["npm", "install", "--prefix", str(env_dir), "--no-audit", "--no-fund", spec_clean]]
        det_cwd = env_dir
    elif source == "go":
        cmds = _go_download_cmds(env_dir, spec_clean)
        os.environ["GOPATH"] = str(env_dir / "go")
        os.environ["GOMODCACHE"] = str(env_dir / "go" / "pkg" / "mod")
        det_cwd = env_dir / "mod"
    elif source == "gem":
        cmds = _gem_install_cmds(env_dir, spec_clean)
        det_cwd = env_dir
    else:
        cmds = _pypi_install_cmds(ctx, env_dir, spec_clean)
        det_cwd = env_dir
    started = time.monotonic()
    reports: list[dict[str, Any]] = []
    for cmd in cmds:
        r = run_sensed(ctx, cmd, check="detonation", workspace_roots=[env_dir], cwd=det_cwd)
        reports.append(r)
        if r["exit"] != 0:
            break
    last = reports[-1]
    sensors = merge_reports(reports)
    return {
        "schema_version": SCHEMA_VERSION,
        # The specifier comes out of the pull request's own manifest, so it is
        # as much the author's text as anything the install printed.
        "dependency": scrub(spec_clean),
        "source": source,
        "install_ok": all(r["exit"] == 0 for r in reports),
        "duration_s": round(time.monotonic() - started, 2),
        "window_exclusive": all(r["window_exclusive"] for r in reports),
        "subprocesses": [{"argv": r["argv"], "exit": r["exit"]} for r in reports]
        + [{"argv": s["argv"], "exit": None} for s in sensors.pop("subprocesses")],
        # Already tailed and escaped by `run_sensed`; only the last command's
        # output is kept, because a failed install is what the tail is for.
        "stdout_tail": last["stdout_tail"],
        "stderr_tail": last["stderr_tail"],
        **sensors,
    }
