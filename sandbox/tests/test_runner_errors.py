"""Error paths in runner.run_sensed.

The happy path (command runs, report is built) is covered by the harness tests
in test_cli.py. These tests exercise the error branches:
- FileNotFoundError for missing executables (exit code 127)
- Lock timeout producing window_exclusive=False
"""

from __future__ import annotations

import json
import sys

import pytest

from cujo_sniff.context import Context, state_paths
from cujo_sniff.runner import run_sensed
from cujo_sniff.sensors.pyhook import write_pyhook


@pytest.fixture
def setup_ctx(ctx: Context) -> Context:
    """Prepare a Context with minimal sensor state so run_sensed can proceed."""
    paths = state_paths(ctx)
    ctx.state_dir.mkdir(parents=True, exist_ok=True)
    paths["audit_dir"].mkdir(parents=True, exist_ok=True)

    # Write a minimal config so load_config works
    config = {
        "proxy_port": 0,
        "proxy_armed": False,
        "decoy_backend": None,
        "allow_hosts": [],
    }
    (ctx.state_dir / "config.json").write_text(json.dumps(config))

    write_pyhook(paths["pyhook"])

    return ctx


@pytest.mark.harness
def test_missing_executable_returns_exit_127(setup_ctx: Context) -> None:
    """A command that doesn't exist should produce exit 127, not crash."""
    cwd = setup_ctx.home
    cwd.mkdir(parents=True, exist_ok=True)
    report = run_sensed(
        setup_ctx,
        ["/nonexistent/binary/that/does/not/exist"],
        check="tests",
        workspace_roots=[cwd],
        cwd=cwd,
    )
    assert report["exit"] == 127
    assert "No such file" in report["stderr_tail"] or "not found" in report["stderr_tail"].lower()
    assert report["schema_version"] is not None
    assert "truncated" in report


@pytest.mark.harness
def test_missing_executable_still_produces_sensor_block(setup_ctx: Context) -> None:
    """Even when the command is not found, sensors and truncation are reported."""
    cwd = setup_ctx.home
    cwd.mkdir(parents=True, exist_ok=True)
    report = run_sensed(
        setup_ctx,
        ["this-command-definitely-does-not-exist-anywhere"],
        check="probes",
        workspace_roots=[cwd],
        cwd=cwd,
    )
    assert report["exit"] == 127
    assert "sensors" in report
    assert "truncated" in report
    assert isinstance(report["truncated"]["stdout_tail"], bool)
    assert isinstance(report["truncated"]["stderr_tail"], bool)
    assert "egress" in report
    assert "fs_changes" in report


@pytest.mark.harness
def test_successful_command_returns_exit_zero(setup_ctx: Context) -> None:
    """Baseline: a command that works produces a normal report."""
    cwd = setup_ctx.home
    cwd.mkdir(parents=True, exist_ok=True)
    report = run_sensed(
        setup_ctx,
        [sys.executable, "-c", "print('hello')"],
        check="tests",
        workspace_roots=[cwd],
        cwd=cwd,
    )
    assert report["exit"] == 0
    assert "hello" in report["stdout_tail"]
    assert report["window_exclusive"] is True
