"""Running one command under the sensors, and holding the sensors while it runs.

The sensors append to logs shared by every check, so a report is the slice of
those logs written while one command ran. `sensed_window` is what makes "while
one command ran" true.
"""

from __future__ import annotations

import contextlib
import fcntl
import os
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from cujo_sniff.context import Context, load_config, state_paths
from cujo_sniff.jsonl import file_size, read_jsonl
from cujo_sniff.policy import DEFAULT_PROXY_PORT, SENSED_LOCK_TIMEOUT_S, tail
from cujo_sniff.report import build_sensor_block
from cujo_sniff.sensors.fsdiff import diff_snapshots, snapshot


def sensor_env(
    ctx: Context, config: dict[str, Any], audit_log: Path | None = None
) -> dict[str, str]:
    """The environment a sensed command runs under.

    `audit_log` is the log this command's audit rows go to. `run_sensed`
    passes the one it is about to read; the env `setup` prints carries the
    shared default, so a process started outside a sensed window still records
    what it did, into a log no report claims.
    """
    paths = state_paths(ctx)
    proxy = f"http://127.0.0.1:{config.get('proxy_port', DEFAULT_PROXY_PORT)}"
    pyhook = str(paths["pyhook"])
    existing = os.environ.get("PYTHONPATH")
    pythonpath = pyhook if not existing else f"{pyhook}{os.pathsep}{existing}"
    return {
        "HTTP_PROXY": proxy,
        "HTTPS_PROXY": proxy,
        "http_proxy": proxy,
        "https_proxy": proxy,
        "NO_PROXY": "",
        "PYTHONPATH": pythonpath,
        "CUJO_AUDIT_LOG": str(audit_log or paths["audit_log"]),
        # Marks a sensed process as running inside Cujo's sandbox. The demo
        # sample (evil-package) keeps its payload inert unless this is set.
        "CUJO_SANDBOX": "1",
    }


@contextlib.contextmanager
def sensed_window(ctx: Context, timeout: float = SENSED_LOCK_TIMEOUT_S) -> Iterator[bool]:
    """Hold the sensors for one command. Yields False when the wait timed out.

    The proxy, the watcher, and the audit hook append to three logs shared by
    every check, and a report is the slice of those logs written while one
    command ran. Two commands sensed at once therefore read each other's rows:
    `probes` reports `smoke`'s egress, and both snapshot each other's writes.
    Nothing in the rubric serialises the checks, so this does.

    A wait that times out proceeds anyway. A review that returns evidence from
    an overlapping window is worse than one that blocks forever only in the
    sense that it is wrong; a review that never finishes is wrong too, and the
    overlap is announced on stderr.
    """
    lock_path = state_paths(ctx)["sensed_lock"]
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = lock_path.open("a+")
    deadline = time.monotonic() + timeout
    held = False
    try:
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                held = True
                break
            except OSError:
                if time.monotonic() >= deadline:
                    print(
                        f"sniff: sensors busy after {timeout:.0f}s; this report may "
                        "carry another command's rows",
                        file=sys.stderr,
                    )
                    break
                time.sleep(0.1)
        yield held
    finally:
        if held:
            fcntl.flock(fh, fcntl.LOCK_UN)
        fh.close()


def run_sensed(
    ctx: Context, argv: list[str], *, check: str, workspace_roots: list[Path], cwd: Path
) -> dict[str, Any]:
    """Run `argv` with the sensor env and return the report minus the header."""
    paths = state_paths(ctx)
    config = load_config(ctx)
    # This command's own audit log. Attribution is which file a row landed in,
    # so a child that strips the variable records nothing rather than
    # laundering its rows into another command's report, and a process an
    # earlier check left running keeps writing to that check's log.
    audit_log = paths["audit_dir"] / f"{os.urandom(6).hex()}.jsonl"
    audit_log.parent.mkdir(parents=True, exist_ok=True)
    walk = {"state_dir": ctx.state_dir, "home_dir": ctx.home}
    with sensed_window(ctx):
        offsets = {k: file_size(paths[k]) for k in ("proxy_log", "decoy_log")}
        before = snapshot(workspace_roots, **walk)
        env = {**os.environ, **sensor_env(ctx, config, audit_log)}
        started = time.monotonic()
        try:
            proc = subprocess.run(
                argv, cwd=str(cwd), env=env, capture_output=True, text=True, errors="replace"
            )
            exit_code, out, err = proc.returncode, proc.stdout, proc.stderr
        except FileNotFoundError as exc:
            exit_code, out, err = 127, "", str(exc)
        duration = round(time.monotonic() - started, 2)
        time.sleep(0.3)  # let the daemons flush the last events
        after = snapshot(workspace_roots, **walk)
        proxy_rows = read_jsonl(paths["proxy_log"], offsets["proxy_log"])
        audit_rows = read_jsonl(audit_log)
        decoy_rows = read_jsonl(paths["decoy_log"], offsets["decoy_log"])
    sensors = build_sensor_block(
        proxy_rows=proxy_rows,
        audit_rows=audit_rows,
        decoy_rows=decoy_rows,
        fs_changes=diff_snapshots(before, after, workspace_roots, ctx.home),
        allow_hosts=config.get("allow_hosts", []),
        check=check,
        home_dir=ctx.home,
        cwd=cwd,
    )
    return {
        "argv": argv,
        "exit": exit_code,
        "duration_s": duration,
        "stdout_tail": tail(out),
        "stderr_tail": tail(err),
        **sensors,
    }
