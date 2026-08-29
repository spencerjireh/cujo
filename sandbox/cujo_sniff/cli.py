"""The four operator commands, and the two hidden daemon commands.

`main` is the only place that builds a `Context`, and the daemon commands are
handled before it does: `_proxy` and `_watch` take every path they need on
argv, so a daemon depends on nothing in the environment.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
from pathlib import Path
from typing import Any

import cujo_sniff
from cujo_sniff.context import Context, decoy_path, state_paths
from cujo_sniff.daemons import pid_alive, port_free, spawn_daemon, stop_daemons, wait_port
from cujo_sniff.detonate import cmd_detonate
from cujo_sniff.policy import DEFAULT_PROXY_PORT
from cujo_sniff.runner import run_sensed, sensor_env
from cujo_sniff.sensors.decoy import restore_decoy, seed_decoy, watch_decoy
from cujo_sniff.sensors.proxy import serve_proxy
from cujo_sniff.sensors.pyhook import write_pyhook


def cmd_setup(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    paths = state_paths(ctx)
    ctx.state_dir.mkdir(parents=True, exist_ok=True)
    for key in ("proxy_log", "audit_log", "decoy_log"):
        paths[key].touch()
    # Setup is idempotent: an earlier setup's daemons are stopped first so
    # their pid files never go stale and the port is ours to bind.
    stop_daemons(ctx)
    decoy = seed_decoy(decoy_path(ctx), paths["decoy_backup"])
    write_pyhook(paths["pyhook"])
    port = args.proxy_port
    if port == 0:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    elif not port_free(port):
        return {"ok": False, "error": f"port {port} is held by another process"}
    config = {"allow_hosts": args.allow_host, "proxy_port": port, "decoy": str(decoy)}
    paths["config"].write_text(json.dumps(config))
    # The daemons are given their paths here, not left to re-derive them: the
    # watcher used to rebuild the decoy path from $HOME, which agreed with the
    # path setup seeded only by accident.
    proxy_pid = spawn_daemon(
        ctx,
        ["_proxy", "--port", str(port), "--log", str(paths["proxy_log"])],
        paths["proxy_pid"],
        "proxy.log",
    )
    spawn_daemon(
        ctx,
        ["_watch", "--decoy", str(decoy), "--log", str(paths["decoy_log"])],
        paths["watcher_pid"],
        "watcher.log",
    )
    ready = wait_port(port) and pid_alive(proxy_pid)
    return {"ok": ready, "proxy_port": port, "decoy": str(decoy), "env": sensor_env(ctx, config)}


def cmd_run(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    if not args.cmd:
        raise SystemExit("run: give the command after `--`")
    cwd = Path(args.cwd or os.getcwd()).resolve()
    report = run_sensed(ctx, args.cmd, check=args.check, workspace_roots=[cwd], cwd=cwd)
    return {"check": args.check, **report}


def cmd_teardown(ctx: Context, _args: argparse.Namespace) -> dict[str, Any]:
    stopped = stop_daemons(ctx)
    decoy = restore_decoy(decoy_path(ctx), state_paths(ctx)["decoy_backup"])
    return {"ok": True, "stopped": stopped, "decoy": decoy}


def build_parser() -> argparse.ArgumentParser:
    summary = (cujo_sniff.__doc__ or "").split("\n\n")[0]
    parser = argparse.ArgumentParser(prog="sniff.py", description=summary)
    sub = parser.add_subparsers(dest="command", required=True)

    setup = sub.add_parser("setup", help="seed the decoy, start the sensors")
    setup.add_argument("--allow-host", action="append", default=[], metavar="HOST")
    setup.add_argument("--proxy-port", type=int, default=DEFAULT_PROXY_PORT)
    setup.set_defaults(func=cmd_setup)

    run = sub.add_parser("run", help="run one command under the sensors")
    run.add_argument("--check", required=True)
    run.add_argument("--cwd")
    run.add_argument("cmd", nargs=argparse.REMAINDER)
    run.set_defaults(func=cmd_run)

    det = sub.add_parser("detonate", help="install one dependency under the sensors")
    det.add_argument("--dependency", required=True)
    det.add_argument("--source", choices=["pypi", "npm", "auto"], default="auto")
    det.set_defaults(func=cmd_detonate)

    down = sub.add_parser("teardown", help="stop the sensor daemons")
    down.set_defaults(func=cmd_teardown)

    # The daemon commands. Every path is on argv so a daemon needs no Context
    # and reads nothing from the environment.
    proxy = sub.add_parser("_proxy")
    proxy.add_argument("--port", type=int, required=True)
    proxy.add_argument("--log", required=True)
    proxy.set_defaults(func=None)

    watch = sub.add_parser("_watch")
    watch.add_argument("--decoy", required=True)
    watch.add_argument("--log", required=True)
    watch.set_defaults(func=None)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.command == "_proxy":
        serve_proxy(args.port, Path(args.log))
        return
    if args.command == "_watch":
        watch_decoy(Path(args.decoy), Path(args.log))
        return
    if args.command == "run" and args.cmd[:1] == ["--"]:
        args.cmd = args.cmd[1:]
    print(json.dumps(args.func(Context.from_env(), args)))
