"""Direct tests for the pyhook sensor (sitecustomize.py).

The hook is a multi-line string constant written to disk by `write_pyhook`,
then loaded by every Python process spawned under the sensor env. These tests
exercise the hook code directly -- re-entrancy guard, exception swallowing,
event dispatch for open/connect/subprocess/exec -- rather than through the
full CLI harness which only exercises the happy path indirectly.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from cujo_sniff.sensors.pyhook import write_pyhook


def _run_hook_script(tmp_path: Path, script: str, *, timeout: int = 10) -> list[dict]:
    """Install the hook and run `script` in a subprocess, return logged rows."""
    hook_dir = tmp_path / "pyhook"
    write_pyhook(hook_dir)
    log = tmp_path / "audit.jsonl"
    proc = subprocess.run(
        [sys.executable, "-c", script],
        env={**os.environ, "PYTHONPATH": str(hook_dir), "CUJO_AUDIT_LOG": str(log)},
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    assert proc.returncode == 0, proc.stderr
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text().splitlines() if line.strip()]


def test_hook_writes_armed_row(tmp_path: Path) -> None:
    """The hook announces itself so an empty log means 'no Python ran'."""
    rows = _run_hook_script(tmp_path, "pass")
    armed = [r for r in rows if r.get("event") == "armed"]
    assert len(armed) == 1


def test_hook_logs_file_open(tmp_path: Path) -> None:
    target = tmp_path / "target.txt"
    target.write_text("hello")
    script = f"open({str(target)!r}).read()"
    rows = _run_hook_script(tmp_path, script)
    opens = [r for r in rows if r.get("event") == "open" and r.get("path") == str(target)]
    assert len(opens) >= 1
    assert opens[0]["mode"] is not None


def test_hook_logs_subprocess(tmp_path: Path) -> None:
    script = "import subprocess; subprocess.run(['echo', 'hi'], capture_output=True)"
    rows = _run_hook_script(tmp_path, script)
    subs = [r for r in rows if r.get("event") == "subprocess"]
    assert any(s["argv"][0].endswith("echo") or s["argv"] == ["echo", "hi"] for s in subs)


def test_hook_swallows_exceptions_in_write(tmp_path: Path) -> None:
    """A broken log must not crash the audited process."""
    hook_dir = tmp_path / "pyhook"
    write_pyhook(hook_dir)
    # Point the log at a directory (unwritable as a file) to force an error
    bad_log = tmp_path / "bad_log_dir"
    bad_log.mkdir()
    proc = subprocess.run(
        [sys.executable, "-c", "print('alive')"],
        env={**os.environ, "PYTHONPATH": str(hook_dir), "CUJO_AUDIT_LOG": str(bad_log)},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert proc.returncode == 0
    assert "alive" in proc.stdout


def test_hook_reentrancy_guard(tmp_path: Path) -> None:
    """Writing a log row triggers an 'open' event; the guard prevents recursion."""
    target = tmp_path / "probe.txt"
    target.write_text("x")
    log_path = tmp_path / "audit.jsonl"
    script = f"""
import sys
for i in range(20):
    open({str(target)!r}).read()
print('ok')
"""
    rows = _run_hook_script(tmp_path, script)
    # The process should complete normally (no recursion crash)
    opens = [r for r in rows if r.get("event") == "open"]
    assert len(opens) >= 1
    # The guard should prevent the hook from logging opens of its own log file.
    # Without the guard, writing a row opens the log, which triggers another
    # audit event, which tries to write another row -- infinite recursion.
    log_opens = [r for r in opens if r.get("path") == str(log_path)]
    assert len(log_opens) == 0, f"audit log opens leaked through guard: {log_opens}"
    # Every logged row has a pid, proving _write completed
    assert all("pid" in r for r in rows if r.get("event") != "armed")


def test_hook_does_not_arm_without_env_var(tmp_path: Path) -> None:
    """Without CUJO_AUDIT_LOG, the hook is inert."""
    hook_dir = tmp_path / "pyhook"
    write_pyhook(hook_dir)
    log = tmp_path / "audit.jsonl"
    env = {k: v for k, v in os.environ.items() if k != "CUJO_AUDIT_LOG"}
    env["PYTHONPATH"] = str(hook_dir)
    proc = subprocess.run(
        [sys.executable, "-c", "pass"],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert proc.returncode == 0
    assert not log.exists()


def test_hook_handles_non_tuple_socket_address(tmp_path: Path) -> None:
    """socket.connect with a non-tuple addr is silently skipped."""
    script = """
import sys
# Trigger the hook with a string address (Unix domain socket path)
# The hook should skip it because addr is not a tuple
import socket
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    s.connect('/tmp/nonexistent.sock')
except (OSError, FileNotFoundError):
    pass
s.close()
print('ok')
"""
    rows = _run_hook_script(tmp_path, script)
    # No connect event should be logged for a Unix socket path
    connects = [r for r in rows if r.get("event") == "connect"]
    assert len(connects) == 0


def test_write_pyhook_creates_sitecustomize(tmp_path: Path) -> None:
    hook_dir = tmp_path / "hook"
    write_pyhook(hook_dir)
    sc = hook_dir / "sitecustomize.py"
    assert sc.exists()
    content = sc.read_text()
    assert "sys.addaudithook" in content
    assert "armed" in content
