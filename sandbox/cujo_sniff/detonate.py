"""The detonation check: install one dependency in a fresh environment.

Unlike `run`, this is several sensed commands — create the environment, then
install into it — whose sensor blocks are unioned into one report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
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
from cujo_sniff.run_ledger import record_run
from cujo_sniff.runner import refuse_nested_window, run_sensed
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


# How long the best-effort resolution after an install may take. Outside any
# sensed window and never load-bearing: every failure is `resolved: null`.
RESOLVE_TIMEOUT_S = 30.0


def _name_of(source: str, spec: str) -> str:
    """The package name a specifier asks for, as the installer would see it."""
    if source == "npm":
        at = spec.rfind("@")
        return spec if at <= 0 else spec[:at]
    if source == "go":
        return spec.split("@", 1)[0]
    if source == "gem":
        return spec.split(":", 1)[0]
    return re.split(r"[\[<>=!~;@ ]", spec, maxsplit=1)[0].strip()


def _resolve(source: str, spec: str, env_dir: Path, stdout_tail: str) -> str | None:
    """What the install resolved to, best effort (decision 145).

    Read off the installer's own output first, then off the environment it
    wrote; `None` on any doubt. Recorded for the reader and the ledger, and
    not a cache key: the key is the exact specifier, which needs no
    resolution to be exact.
    """
    name = _name_of(source, spec)
    try:
        if source == "pypi":
            found = re.search(
                r"Successfully installed .*?\b"
                + re.escape(name).replace("-", "[-_.]")
                + r"-([0-9][^\s]*)",
                stdout_tail,
                re.IGNORECASE,
            ) or re.search(r"\+\s*" + re.escape(name) + r"==([^\s]+)", stdout_tail, re.IGNORECASE)
            if found:
                return f"{name}=={found.group(1)}"
            python = env_dir / "bin" / "python"
            out = subprocess.run(
                [str(python), "-m", "pip", "show", name],
                capture_output=True,
                text=True,
                timeout=RESOLVE_TIMEOUT_S,
            )
            version = re.search(r"^Version:\s*(\S+)", out.stdout, re.MULTILINE)
            return f"{name}=={version.group(1)}" if out.returncode == 0 and version else None
        if source == "npm":
            out = subprocess.run(
                ["npm", "ls", "--prefix", str(env_dir), "--json", "--depth=0"],
                capture_output=True,
                text=True,
                timeout=RESOLVE_TIMEOUT_S,
            )
            deps = json.loads(out.stdout or "{}").get("dependencies") or {}
            version = (deps.get(name) or {}).get("version")
            return f"{name}@{version}" if version else None
        if source == "gem":
            found = re.search(
                r"Successfully installed " + re.escape(name) + r"-([0-9][^\s]*)", stdout_tail
            )
            if found:
                return f"{name}:{found.group(1)}"
            out = subprocess.run(
                ["gem", "list", "--local", "--install-dir", str(env_dir), f"^{name}$"],
                capture_output=True,
                text=True,
                timeout=RESOLVE_TIMEOUT_S,
            )
            found = re.search(re.escape(name) + r" \(([^)]+)\)", out.stdout)
            return f"{name}:{found.group(1).split(',')[0].strip()}" if found else None
        if source == "go":
            go_mod = (env_dir / "mod" / "go.mod").read_text()
            found = re.search(
                r"^\s*(?:require\s+)?" + re.escape(name) + r"\s+(v\S+)", go_mod, re.MULTILINE
            )
            return f"{name}@{found.group(1)}" if found else None
    except Exception:  # noqa: BLE001 - best effort by design; the field is null on any failure
        return None
    return None


def _cached_entry(
    ctx: Context, args: argparse.Namespace, source: str, spec_clean: str
) -> dict[str, Any]:
    """An earlier run's entry for this specifier, recorded as this run's (decision 145).

    Nothing is installed and no window opens. The file is what the parent
    wrote from its brief, verbatim; the entry is matched on `(source,
    dependency)` and copied through with two marks saying where it came from.
    A specifier the file does not hold is a non-zero exit with nothing
    recorded, so the caller detonates it the ordinary way.
    """
    try:
        cached = json.loads(Path(args.cached).read_text())
    except (OSError, ValueError) as error:
        raise SystemExit(f"detonate: cannot read {args.cached}: {error}") from error
    if not isinstance(cached, list):
        raise SystemExit(f"detonate: {args.cached} is not a JSON array")
    for item in cached:
        if not isinstance(item, dict) or not isinstance(item.get("report"), dict):
            continue
        if item.get("source") == source and item.get("dependency") == spec_clean:
            entry = dict(item["report"])
            entry["cached_from_run"] = item.get("run_id")
            entry["cached_at"] = item.get("cached_at")
            record_run(ctx, "detonation", entry)
            return entry
    raise SystemExit(f"detonate: {spec_clean} is not in {args.cached}; detonate it")


def _resolved_text(
    source: str, spec: str, env_dir: Path, stdout_tail: str, reports: list[dict[str, Any]]
) -> str | None:
    """`resolved` as the entry carries it: scrubbed, and only for an install that succeeded."""
    if not all(r["exit"] == 0 for r in reports):
        return None
    resolved = _resolve(source, spec, env_dir, stdout_tail)
    return None if resolved is None else scrub(resolved)


def cmd_detonate(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    refuse_nested_window("detonate")
    spec = args.dependency
    source = args.source if args.source != "auto" else detect_source(spec)
    spec_clean = spec.removeprefix("npm:").removeprefix("gem:").removeprefix("go:")
    if getattr(args, "cached", None):
        return _cached_entry(ctx, args, source, spec_clean)
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
    entry: dict[str, Any] = {
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
        # What the specifier became, when the install said. Read after the
        # windows closed, so the query is never sensed as the install's.
        "resolved": _resolved_text(source, spec_clean, env_dir, last["stdout_tail"], reports),
        **sensors,
    }
    # Recorded so `sniff.py report --check detonation` assembles the envelope
    # from every dependency that was detonated, instead of a model retyping one
    # entry per specifier (decision 112). The unit here is the dependency: the
    # install commands behind it are already rolled into `subprocesses` above,
    # and `run_sensed` records nothing of its own -- only `cmd_run` does.
    record_run(ctx, "detonation", entry)
    return entry
