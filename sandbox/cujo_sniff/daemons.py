"""Starting and stopping the two sensor daemons.

The proxy and the decoy watcher outlive the command that started them, so they
are spawned detached, tracked by a pid file, and re-executed as
`python3 -m cujo_sniff` rather than by file path.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from cujo_sniff.context import Context, state_paths


def daemon_env() -> dict[str, str]:
    """The environment a sensor daemon runs in: never a sensed one.

    A daemon inherits whatever the operator exported, and the rubric tells the
    operator to export the sensor env for every later command. That put the
    audit hook inside the proxy, so each upstream connection the proxy opened
    on a check's behalf was logged as a `connect` and appended to `egress` a
    second time, with a phantom `bytes: 0`. Dropping `CUJO_AUDIT_LOG` disarms
    the hook; the proxy variables go with it so a daemon can never be routed
    through the proxy it is.
    """
    strip = {
        "CUJO_AUDIT_LOG",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "NO_PROXY",
    }
    return {k: v for k, v in os.environ.items() if k not in strip}


def spawn_daemon(ctx: Context, args: list[str], pid_file: Path, log_name: str) -> int:
    """Re-execute this package as a detached daemon running `args`.

    `-m cujo_sniff` with the working directory set to the directory holding the
    package is what makes the import work: `-m` prepends the working directory
    to `sys.path`, so no install and no PYTHONPATH is needed. Re-executing a
    file path instead would break the moment the package became a directory.
    """
    log = (ctx.state_dir / log_name).open("ab")
    proc = subprocess.Popen(
        [ctx.python, "-m", "cujo_sniff", *args],
        cwd=str(ctx.code_dir),
        stdout=log,
        stderr=log,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        env=daemon_env(),
    )
    pid_file.write_text(str(proc.pid))
    return proc.pid


def wait_port(port: int, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def daemon_alive(pid_file: Path) -> bool:
    """Whether the daemon a pid file names is still running, and is one of ours.

    `setup` proving a daemon started says nothing about the fourth check half an
    hour later: a proxy that died in between leaves every later report with an
    empty `egress` and no way to tell that from a quiet one. This is what the
    health block re-checks per command.

    The command being measured runs as this user and can write the pid file, so
    it could kill a sensor and leave any live pid behind -- its own, or the
    runner's. Checking the command line raises that from "write four digits" to
    "keep a process alive whose argv says `cujo_sniff`", which is worth the six
    lines and is not a proof. Nothing inside a sandbox the author controls can
    be: the same code can rewrite `proxy.jsonl` directly. What bounds the damage
    is the direction of the lie -- forging health hides a gap, and cannot
    manufacture a finding against anyone. See docs/spec.md Contract 2.
    """
    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        return False
    if not pid_alive(pid):
        return False
    try:
        argv = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        # No procfs (macOS, and any sandbox without /proc mounted). The pid
        # answered, which is all this platform will say.
        return True
    return b"cujo_sniff" in argv


def stop_daemons(ctx: Context) -> list[int]:
    """SIGTERM the daemons named by the pid files; forget the files.

    Returns the pids this call signalled. A daemon that was already gone is
    not in that list — teardown wants it gone and it is, but it was not
    stopped here. A pid file that does not hold a pid is a different thing
    and says so on stderr: nothing can find that daemon now, and a teardown
    that reported success would be claiming otherwise. Never on stdout, which
    carries the command's one JSON object.
    """
    stopped: list[int] = []
    for key in ("proxy_pid", "watcher_pid"):
        pid_file = state_paths(ctx)[key]
        if not pid_file.exists():
            continue
        raw = pid_file.read_text().strip()
        pid_file.unlink(missing_ok=True)
        try:
            pid = int(raw)
        except ValueError:
            print(f"sniff: {pid_file} held {raw!r}, not a pid", file=sys.stderr)
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        stopped.append(pid)
    for pid in stopped:
        deadline = time.monotonic() + 2.0
        while pid_alive(pid) and time.monotonic() < deadline:
            time.sleep(0.05)
    return stopped


def port_free(port: int) -> bool:
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True
