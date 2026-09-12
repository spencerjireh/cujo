"""The five operator commands, and the two hidden daemon commands.

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
from cujo_sniff.jsonl import file_size
from cujo_sniff.policy import DEFAULT_PROXY_PORT, SCHEMA_VERSION
from cujo_sniff.prepare import cmd_prepare
from cujo_sniff.report import health, rollup
from cujo_sniff.reports import read_runs, record_run
from cujo_sniff.runner import run_sensed, sensor_env
from cujo_sniff.sensors.decoy import restore_decoy, seed_decoy, watch_decoy, watched_backend
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
        return {
            "schema_version": SCHEMA_VERSION,
            "ok": False,
            "error": f"port {port} is held by another process",
        }
    config: dict[str, Any] = {
        "allow_hosts": args.allow_host,
        "proxy_port": port,
        "decoy": str(decoy),
    }
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
    decoy_log_end = file_size(paths["decoy_log"])
    spawn_daemon(
        ctx,
        ["_watch", "--decoy", str(decoy), "--log", str(paths["decoy_log"])],
        paths["watcher_pid"],
        "watcher.log",
    )
    # What armed, written down while it is still knowable. The watcher says
    # which backend it chose exactly once, in a row it writes before it blocks;
    # `run` reads this back rather than re-deriving anything.
    config["proxy_armed"] = wait_port(port) and pid_alive(proxy_pid)
    config["decoy_backend"] = watched_backend(paths["decoy_log"], decoy_log_end)
    # Which file the watcher armed on, not just which path. inotify follows an
    # inode: replace the file at that path and the watch goes with the old one.
    config["decoy_inode"] = decoy.stat().st_ino
    paths["config"].write_text(json.dumps(config))
    return {
        "schema_version": SCHEMA_VERSION,
        # Setup succeeded if the proxy is up. A watcher that failed to arm does
        # not stop the checks -- it makes them say so, on every report.
        "ok": config["proxy_armed"],
        "proxy_port": port,
        "decoy": str(decoy),
        "sensors": {
            "proxy": health(config["proxy_armed"], f"port {port}"),
            "decoy": health(
                config["decoy_backend"] is not None,
                str(config["decoy_backend"] or "no watcher armed during setup"),
            ),
        },
        "env": sensor_env(ctx, config),
    }


def cmd_run(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    if not args.cmd:
        raise SystemExit("run: give the command after `--`")
    cwd = Path(args.cwd or os.getcwd()).resolve()
    # Where the command runs and what the sensors call the workspace are two
    # questions, and they stopped having one answer when the install had to
    # reach a service directory (decision 111). A repository of services under
    # `services/<name>/` needs `--cwd` narrowed to one of them, and narrowing
    # the workspace with it would reclassify every write elsewhere under
    # `/work/head` as outside the workspace -- which feeds `fs_changes` and
    # `derived.wrote_sensitive`, a rule that accuses code of acting against the
    # person running it. A false accusation is the worst thing this file could
    # produce, so the two are separate and the default is what it always was.
    roots = [Path(root).resolve() for root in args.workspace_root] or [cwd]
    report = run_sensed(ctx, args.cmd, check=args.check, workspace_roots=roots, cwd=cwd)
    # Recorded before it is printed, so `sniff.py report` can assemble the
    # envelope from what actually ran instead of asking a model to retype it
    # (decision 112). Still printed in full: a sub-agent reads stdout to decide
    # what to do next, and the report command is for the handing back.
    record_run(ctx, args.check, report)
    return {"check": args.check, **report}


def cmd_report(ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    """Print this check's whole envelope, assembled from the runs it recorded.

    One command whose entire output a sub-agent copies verbatim, in place of the
    thirty-odd fields per entry it was asked to copy by hand and did not
    (decision 112). `runs.0.schema_version: Required (+31 more)` was a model
    rebuilding each entry out of the fields it judged interesting.

    `--extra` carries the per-check fields the rubric adds and the sensors know
    nothing about: `base`, `head` and `base_pass_head_fail` for `tests`,
    `probes[]` for `probes`, `endpoints[]` and `log_tail` for `smoke`. It is
    spread *under* the envelope's own keys, so nothing passed there can overwrite
    `check`, `runs`, `derived`, `sensors` or `truncated` -- the point of this
    command is that those are no longer the model's to write.
    """
    entries = read_runs(ctx, args.check)
    if not entries:
        raise SystemExit(
            f"report: no runs recorded for check {args.check!r}; "
            "every command has to go through `sniff.py run` or `sniff.py detonate`"
        )
    extra: dict[str, Any] = {}
    if args.extra:
        try:
            parsed = json.loads(args.extra)
        except ValueError as err:
            raise SystemExit(f"report: --extra is not JSON: {err}") from err
        if not isinstance(parsed, dict):
            raise SystemExit("report: --extra has to be a JSON object")
        extra = parsed
    return {
        **extra,
        "schema_version": SCHEMA_VERSION,
        "check": args.check,
        "runs": entries,
        **rollup(entries),
    }


def cmd_teardown(ctx: Context, _args: argparse.Namespace) -> dict[str, Any]:
    stopped = stop_daemons(ctx)
    decoy = restore_decoy(decoy_path(ctx), state_paths(ctx)["decoy_backup"])
    return {"schema_version": SCHEMA_VERSION, "ok": True, "stopped": stopped, "decoy": decoy}


def build_parser() -> argparse.ArgumentParser:
    summary = (cujo_sniff.__doc__ or "").split("\n\n")[0]
    parser = argparse.ArgumentParser(prog="sniff.py", description=summary)
    sub = parser.add_subparsers(dest="command", required=True)

    prep = sub.add_parser("prepare", help="clone head and base, and read the build files")
    prep.add_argument("--clone-url", required=True)
    prep.add_argument("--head-sha", required=True)
    prep.add_argument("--base-sha", required=True)
    # The head commit is fetched as `refs/pull/<n>/head`, which is the only way
    # to reach it for a pull request opened from a fork. The number is public
    # metadata and already crosses into the sandbox in the turn message.
    prep.add_argument("--pr-number", required=True, type=int)
    # The clone URL is checked against this, so that a URL the model was talked
    # into cannot point the sandbox at a different repository on the same host.
    prep.add_argument("--repo", required=True, metavar="OWNER/NAME")
    prep.add_argument("--head", default="/work/head")
    prep.add_argument("--base", default="/work/base")
    prep.set_defaults(func=cmd_prepare)

    setup = sub.add_parser("setup", help="seed the decoy, start the sensors")
    setup.add_argument("--allow-host", action="append", default=[], metavar="HOST")
    setup.add_argument("--proxy-port", type=int, default=DEFAULT_PROXY_PORT)
    setup.set_defaults(func=cmd_setup)

    run = sub.add_parser("run", help="run one command under the sensors")
    run.add_argument("--check", required=True)
    run.add_argument("--cwd")
    # Repeatable, and separate from `--cwd` on purpose. See `cmd_run`.
    run.add_argument(
        "--workspace-root",
        action="append",
        default=[],
        metavar="DIR",
        help="what the sensors treat as inside the workspace; defaults to --cwd",
    )
    run.add_argument("cmd", nargs=argparse.REMAINDER)
    run.set_defaults(func=cmd_run)

    det = sub.add_parser("detonate", help="install one dependency under the sensors")
    det.add_argument("--dependency", required=True)
    det.add_argument("--source", choices=["pypi", "npm", "go", "gem", "auto"], default="auto")
    det.set_defaults(func=cmd_detonate)

    rep = sub.add_parser("report", help="print this check's assembled envelope")
    rep.add_argument("--check", required=True)
    # The per-check fields the sensors know nothing about. Merged under the
    # envelope's own keys, never over them.
    rep.add_argument("--extra", metavar="JSON", help="per-check fields, as a JSON object")
    rep.set_defaults(func=cmd_report)

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
    try:
        result = args.func(Context.from_env(), args)
    except Exception as exc:
        import sys
        import traceback

        from cujo_sniff.scrub import scrub_head

        MAX_ERROR = 2000
        MAX_TRACEBACK = 4000
        # Slicing the escaped text would have cut an escape in half -- `\u20`
        # is not what anything raised. `scrub_head` spends the budget one whole
        # character at a time; head and not tail, because that is which end
        # these two kept before and this is a cap fix, not a change of subject.
        error = scrub_head(f"{type(exc).__name__}: {exc}", MAX_ERROR)[0]
        tb = scrub_head(traceback.format_exc(), MAX_TRACEBACK)[0]
        result = {
            "schema_version": SCHEMA_VERSION,
            "ok": False,
            "error": error,
            "traceback": tb,
        }
        print(json.dumps(result))
        sys.exit(1)
    print(json.dumps(result))
