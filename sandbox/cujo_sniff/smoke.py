"""`sniff.py smoke`: boot the app under the sensors, hit its endpoints, stop it.

The smoke check used to be a sub-agent writing a script that started the
server in the background, waited, made the requests and killed it, because
`sniff.py run` waits for its one command to exit and a server never does.
This command is that script, once, with no model (decision 162): the boot
line runs as one sensed command in its own process group, the requests are
made from this process while it runs, and the group is stopped inside the
same window so the shutdown's writes and egress belong to this check.

What it records is one `runs[]` entry per tree: the boot's own report from
`run_sensed` (argv, exit, output tails, the sensor block) plus `tree`, `port`
and where the port came from, whether the app answered, and every request
with its status and a scrubbed body tail. `sniff.py report --check smoke`
then assembles the envelope, and the trusted side lifts `endpoints[]` and
`log_tail` from the two entries.

Standard library only, like everything under `sandbox/` (decision 46).
"""

from __future__ import annotations

import argparse
import http.client
import os
import re
import signal
import socket
import subprocess
import time
from pathlib import Path
from typing import Any

from cujo_sniff.context import Context
from cujo_sniff.policy import (
    SCHEMA_VERSION,
    SMOKE_BODY_TAIL_CHARS,
    SMOKE_MAX_REQUESTS,
    SMOKE_READY_TIMEOUT_S,
    SMOKE_REQUEST_TIMEOUT_S,
    SMOKE_STOP_GRACE_S,
)
from cujo_sniff.run_ledger import record_run
from cujo_sniff.runner import refuse_nested_window, run_sensed
from cujo_sniff.scrub import KEEP_IN_TEXT, scrub, scrub_tail

#: `METHOD /path`, the one shape a `smoke:` entry has (spec Contract 2).
_REQUEST = re.compile(r"^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+(/\S*)$")

#: Where a boot line says its port, in the order a reader would look.
_PORT_PATTERNS = (
    re.compile(r"(?:^|\s)--port[= ](\d{2,5})(?:\s|$)"),
    re.compile(r"(?:^|\s)-p[= ]?(\d{2,5})(?:\s|$)"),
    re.compile(r"(?:^|\s)PORT=(\d{2,5})(?:\s|$)"),
    re.compile(r":(\d{2,5})(?:\s|$)"),
)


def parse_request(text: str) -> tuple[str, str] | None:
    found = _REQUEST.match(text.strip())
    return (found.group(1), found.group(2)) if found else None


def port_from_boot(line: str) -> int | None:
    """The port a boot line names, or None when it names none."""
    for pattern in _PORT_PATTERNS:
        found = pattern.search(line)
        if found:
            port = int(found.group(1))
            if 1 <= port <= 65535:
                return port
    return None


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def _request(method: str, path: str, port: int) -> dict[str, Any]:
    """One request on loopback. `http.client`, so no proxy variable diverts it."""
    started = time.monotonic()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=SMOKE_REQUEST_TIMEOUT_S)
        try:
            conn.request(method, path)
            response = conn.getresponse()
            body = response.read(SMOKE_BODY_TAIL_CHARS * 4).decode("utf-8", errors="replace")
            tail, _ = scrub_tail(body, SMOKE_BODY_TAIL_CHARS, KEEP_IN_TEXT)
            return {
                "request": f"{method} {path}",
                "status": response.status,
                "tail": tail,
                "duration_s": round(time.monotonic() - started, 3),
            }
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 - the failure is the observation
        return {
            "request": f"{method} {path}",
            "status": None,
            "tail": "",
            "error": scrub(f"{type(exc).__name__}: {exc}")[:300],
            "duration_s": round(time.monotonic() - started, 3),
        }


def _stop_group(proc: subprocess.Popen[str]) -> None:
    """SIGTERM the boot's process group, then SIGKILL what survives the grace."""
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + SMOKE_STOP_GRACE_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.1)
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def cmd_smoke(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    refuse_nested_window("smoke")
    cwd = Path(args.cwd or os.getcwd()).resolve()
    roots = [Path(root).resolve() for root in args.workspace_root] or [cwd]
    requests: list[tuple[str, str]] = []
    for text in args.request[:SMOKE_MAX_REQUESTS]:
        parsed = parse_request(text)
        if parsed is None:
            raise SystemExit(f"smoke: a request is `METHOD /path`, not {scrub(text)!r}")
        requests.append(parsed)
    if not requests:
        raise SystemExit("smoke: give at least one --request")
    port = args.port
    port_source = "argument"
    if port is None:
        port = port_from_boot(args.boot)
        port_source = "boot line"
    if port is None:
        raise SystemExit("smoke: no --port, and the boot line names none")

    outcome: dict[str, Any] = {"ready": False, "ready_after_s": None, "requests": []}

    def during(proc: subprocess.Popen[str]) -> None:
        # Wait for the port, then for the first request to answer, while the
        # boot is still alive: a boot that died is reported at once with its
        # log, not after the whole deadline.
        started = time.monotonic()
        deadline = started + SMOKE_READY_TIMEOUT_S
        while time.monotonic() < deadline and proc.poll() is None:
            if _port_open(port):
                outcome["ready"] = True
                outcome["ready_after_s"] = round(time.monotonic() - started, 2)
                break
            time.sleep(0.2)
        if outcome["ready"]:
            outcome["requests"] = [_request(method, path, port) for method, path in requests]
        else:
            outcome["requests"] = [
                {"request": f"{m} {p}", "status": None, "tail": "", "error": "app never listened"}
                for m, p in requests
            ]
        _stop_group(proc)

    report = run_sensed(
        ctx,
        ["sh", "-c", args.boot],
        check="smoke",
        workspace_roots=roots,
        cwd=cwd,
        during=during,
    )
    entry: dict[str, Any] = {
        **report,
        "schema_version": SCHEMA_VERSION,
        "tree": args.tree or str(cwd),
        "port": port,
        "port_source": port_source,
        **outcome,
    }
    record_run(ctx, "smoke", entry)
    return entry
