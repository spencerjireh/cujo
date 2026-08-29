"""The environment a sensed command gets, and the lock that makes it one command."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from cujo_sniff.context import Context, state_paths
from cujo_sniff.daemons import daemon_env
from cujo_sniff.runner import sensed_window, sensor_env


def test_daemon_env_disarms_the_hook_and_the_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUJO_AUDIT_LOG", "/tmp/cujo/audit.jsonl")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:8899")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:8899")
    monkeypatch.setenv("PATH", os.environ["PATH"])
    env = daemon_env()
    for gone in ("CUJO_AUDIT_LOG", "HTTPS_PROXY", "http_proxy"):
        assert gone not in env
    assert env["PATH"] == os.environ["PATH"]


def test_sensor_env_points_the_hook_at_the_log_the_report_reads(
    ctx: Context, tmp_path: Path
) -> None:
    config = {"proxy_port": 8899, "allow_hosts": []}
    # The env setup prints names the shared log, which no report reads.
    assert sensor_env(ctx, config)["CUJO_AUDIT_LOG"] == str(state_paths(ctx)["audit_log"])
    per_run = tmp_path / "audit" / "abc123.jsonl"
    assert sensor_env(ctx, config, per_run)["CUJO_AUDIT_LOG"] == str(per_run)


def test_sensor_env_prepends_the_hook_to_an_existing_pythonpath(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PYTHONPATH", "/existing")
    pythonpath = sensor_env(ctx, {"proxy_port": 1})["PYTHONPATH"]
    assert pythonpath == f"{state_paths(ctx)['pyhook']}{os.pathsep}/existing"


@pytest.mark.harness
def test_sensed_window_is_exclusive(ctx: Context) -> None:
    ctx.state_dir.mkdir(parents=True, exist_ok=True)
    lock = state_paths(ctx)["sensed_lock"]
    holder = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import fcntl,sys,time;"
            "fh=open(sys.argv[1],'a+');"
            "fcntl.flock(fh, fcntl.LOCK_EX);"
            "print('held', flush=True);"
            "time.sleep(30)",
            str(lock),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert holder.stdout is not None
        assert holder.stdout.readline().strip() == "held"
        with sensed_window(ctx, timeout=0.3) as held:
            assert held is False
    finally:
        holder.kill()
        holder.wait()
    # Nothing holds it now, so the next command gets it.
    with sensed_window(ctx, timeout=0.3) as held:
        assert held is True
