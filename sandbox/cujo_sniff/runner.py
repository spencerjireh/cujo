"""Running one command under the sensors, and holding the sensors while it runs.

The sensors append to logs shared by every check, so a report is the slice of
those logs written while one command ran. `sensed_window` is what makes "while
one command ran" true.

A report also says which sensors were watching. `setup` records what armed;
every `run` re-checks that those daemons are still alive, because a proxy that
died after the first check leaves the three that follow with an empty `egress`
and nothing to distinguish that from a quiet one.
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

from cujo_sniff.context import Context, decoy_path, load_config, state_paths
from cujo_sniff.daemons import daemon_alive
from cujo_sniff.jsonl import file_size, read_jsonl
from cujo_sniff.policy import (
    DEFAULT_PROXY_PORT,
    INTERPRETER_NAMES,
    MAX_SCRIPT_CHARS,
    SCHEMA_VERSION,
    SENSED_LOCK_TIMEOUT_S,
    TAIL_CHARS,
)
from cujo_sniff.report import build_sensor_block, health
from cujo_sniff.scrub import KEEP_IN_TEXT, scrub_argv, scrub_head, scrub_tail
from cujo_sniff.sensors.fsdiff import Snapshot, diff_snapshots, snapshot


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


def daemon_health(ctx: Context, config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The health of the two daemons, as of now rather than as of `setup`.

    Two facts are needed and neither is enough alone. `setup` wrote down what
    armed, which is the only place the watcher's chosen backend is ever known;
    the pid files say whether those processes are still there. A daemon that
    armed and then died is the case worth catching, and it reads as unarmed
    here, because for this command it was.
    """
    paths = state_paths(ctx)
    if not config.get("proxy_armed", False):
        proxy = health(False, "did not start during setup")
    elif not daemon_alive(paths["proxy_pid"]):
        proxy = health(False, "started during setup, no longer running")
    else:
        proxy = health(True, f"port {config.get('proxy_port', DEFAULT_PROXY_PORT)}")

    backend = config.get("decoy_backend")
    if not backend:
        decoy = health(False, "no watcher armed during setup")
    elif not daemon_alive(paths["watcher_pid"]):
        decoy = health(False, f"{backend}, no longer running")
    elif not decoy_intact(ctx, config):
        # A live pid is not proof the watcher can still see anything. inotify
        # follows an inode, so a command that deletes the decoy or renames a
        # file over it moves the watch off the path it was asked about; the
        # daemon re-arms where it can, and this is the case where it could not.
        # Either way the decoy that was seeded is gone, so there is nothing left
        # to read and a quiet `decoy_read` says nothing.
        decoy = health(False, f"{backend}, but the decoy it was seeded on is gone")
    else:
        decoy = health(True, str(backend))
    return {"proxy": proxy, "decoy": decoy}


def decoy_intact(ctx: Context, config: dict[str, Any]) -> bool:
    """Whether the file the watcher armed on is still the file at that path."""
    seeded = config.get("decoy_inode")
    if seeded is None:
        return True
    try:
        return Path(config.get("decoy", decoy_path(ctx))).stat().st_ino == seeded
    except OSError:
        return False


def snapshot_health(before: Snapshot, after: Snapshot) -> dict[str, Any]:
    """The filesystem sensor is never off; what varies is how much it reached."""
    count = len(after.entries)
    if count == 0:
        return health(False, "walked no files")
    notes = []
    if before.truncated or after.truncated:
        notes.append("capped")
    uncompared = max(before.uncompared, after.uncompared)
    if uncompared:
        notes.append(f"{uncompared} not compared by content")
    detail = f"{count} paths" + (f" ({', '.join(notes)})" if notes else "")
    return health(True, detail)


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
    overlap is announced on stderr and carried out on the report as
    `window_exclusive`.
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


_TERMINATES_SCRIPT = frozenset({"-c", "-m", "--module", "-e", "--eval", "--require"})
_CONSUMES_NEXT = frozenset(
    {
        "-c",
        "-m",
        "-W",
        "-X",
        "-Q",
        "-e",
        "--require",
        "--loader",
    }
)


def capture_script(argv: list[str], cwd: Path) -> tuple[str | None, bool]:
    """Read the script file when argv looks like an interpreter invocation.

    Returns (content_or_none, was_truncated). The content is scrubbed and
    capped at MAX_SCRIPT_CHARS so a large generated file cannot inflate the
    report. Returns (None, False) when the command is not a script invocation
    or the file cannot be read.
    """
    if len(argv) < 2:
        return None, False
    interpreter = Path(argv[0]).name
    if interpreter not in INTERPRETER_NAMES:
        return None, False
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            i += 1
            break
        if arg in _TERMINATES_SCRIPT:
            return None, False
        if arg in _CONSUMES_NEXT:
            i += 2
            continue
        if not arg.startswith("-"):
            break
        i += 1
    else:
        return None, False
    if i >= len(argv):
        return None, False
    script_path = Path(argv[i])
    if not script_path.is_absolute():
        script_path = cwd / script_path
    if not script_path.is_file():
        return None, False
    try:
        with script_path.open(errors="replace") as fh:
            raw = fh.read(MAX_SCRIPT_CHARS + 1)
    except OSError:
        return None, False
    # `scrub_head` rather than a cap and a `scrub()` in either order. Capping
    # first bounds the wrong quantity, because escaping expands; escaping first
    # and slicing the result bounds the right one and cuts `\u202e` into
    # `\u20`, which is text the script did not contain. The budget is spent one
    # whole character at a time, and `truncated` is true when the read stopped
    # at the byte budget or the escape overflowed the character one.
    content, escaped_over = scrub_head(raw, MAX_SCRIPT_CHARS, KEEP_IN_TEXT)
    return content, len(raw) > MAX_SCRIPT_CHARS or escaped_over


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
    script_content, script_truncated = capture_script(argv, cwd)
    walk = {"state_dir": ctx.state_dir, "home_dir": ctx.home}
    with sensed_window(ctx) as exclusive:
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
        torn_lines = proxy_rows.dropped + audit_rows.dropped + decoy_rows.dropped
        # Inside the window: a daemon that dies while the command runs is the
        # thing being looked for, so it is checked before the lock is released.
        sensors = {**daemon_health(ctx, config), "fs_diff": snapshot_health(before, after)}
    # Escaping expands -- four characters for a control byte, six for a
    # bidirectional override -- so the cap has to be spent on the escaped text.
    # Capping first and escaping afterwards bounded the wrong quantity: a check
    # that printed 4000 right-to-left overrides returned 24,000 characters
    # against a 4000-character budget, and the output is written by the code
    # under review. The flag is now true when either the raw output or its
    # escaped form was cut, because both are the same fact to a reader.
    stdout_tail, stdout_cut = scrub_tail(out, TAIL_CHARS, KEEP_IN_TEXT)
    stderr_tail, stderr_cut = scrub_tail(err, TAIL_CHARS, KEEP_IN_TEXT)
    block = build_sensor_block(
        proxy_rows=proxy_rows,
        audit_rows=audit_rows,
        decoy_rows=decoy_rows,
        fs_changes=diff_snapshots(before, after, workspace_roots, ctx.home),
        allow_hosts=config.get("allow_hosts", []),
        check=check,
        sensors=sensors,
        truncated={
            "stdout_tail": stdout_cut,
            "stderr_tail": stderr_cut,
            "snapshot": before.truncated or after.truncated,
            # A file too large to hash falls back to metadata, which is exactly
            # what a restored mtime defeats. Saying so is the difference between
            # a comparison that was not made and one that came back clean.
            "hashes": bool(before.uncompared or after.uncompared),
            "sensor_logs": torn_lines > 0,
            "script_content": script_truncated,
        },
        home_dir=ctx.home,
        cwd=cwd,
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "argv": scrub_argv(argv),
        "exit": exit_code,
        "duration_s": duration,
        # False means another sensed command overlapped this one, so rows in
        # this report may belong to it.
        "window_exclusive": exclusive,
        "stdout_tail": stdout_tail,
        "stderr_tail": stderr_tail,
        "script_content": script_content,
        **block,
    }
