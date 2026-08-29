"""The commands end to end, run the way the rubric runs them.

Every test here goes through `python3 -m cujo_sniff` from the directory that
holds the package, with a bare interpreter and no PYTHONPATH — the same shape
the sandbox uses after the rubric extracts the tarball.
"""

from __future__ import annotations

import json
import socket
import sys
from pathlib import Path

import pytest

from cujo_sniff.context import Context
from cujo_sniff.daemons import pid_alive
from cujo_sniff.policy import DECOY_KEY
from tests.conftest import CODE_DIR, Cli

pytestmark = pytest.mark.harness


def test_setup_then_run_sees_decoy_read(cli: Cli, home_dir: Path) -> None:
    setup = cli(["setup", "--proxy-port", "0", "--allow-host", "api.example"])
    try:
        assert setup["ok"] is True
        decoy = Path(setup["decoy"])
        assert decoy.read_text().startswith("[default]")
        assert setup["env"]["HTTPS_PROXY"].startswith("http://127.0.0.1:")
        assert setup["env"]["PYTHONPATH"].endswith("pyhook")

        script = f"open({str(decoy)!r}).read(); open('touched.txt', 'w').write('x')"
        report = cli(
            ["run", "--check", "tests", "--cwd", str(home_dir), "--", sys.executable, "-c", script]
        )
        assert report["check"] == "tests"
        assert report["exit"] == 0
        # The audit hook path works on any OS; inotify only on Linux.
        assert report["secret_probe"]["decoy_read"] is True
        assert {"path": "~/.aws/credentials", "sensitive": True} in report["files_read"]
        assert {
            "path": "~/touched.txt",
            "type": "created",
            "in_workspace": True,
            "sensitive": False,
        } in report["fs_changes"]
        assert report["derived"]["wrote_sensitive"] is False
        assert report["derived"]["egress_to_unknown_host"] is False
    finally:
        cli(["teardown"])


def test_run_reads_only_its_own_audit_log(cli: Cli, ctx: Context, home_dir: Path) -> None:
    cli(["setup", "--proxy-port", "0"])
    try:
        # A process an earlier check left running still holds the log it was
        # given, and a command run outside a wrapper holds the shared one.
        # Neither is this command's log, so neither reaches this report.
        shared = ctx.state_dir / "audit.jsonl"
        stray = json.dumps({"event": "open", "path": str(home_dir / "stray.txt"), "mode": "r"})
        script = (
            "import os\n"
            f"assert os.environ['CUJO_AUDIT_LOG'] != {str(shared)!r}\n"
            f"open({str(shared)!r}, 'a').write({stray!r} + '\\n')\n"
            f"open({str(home_dir / 'mine.txt')!r}, 'w').write('x')\n"
            f"open({str(home_dir / 'mine.txt')!r}).read()\n"
        )
        report = cli(
            ["run", "--check", "probes", "--cwd", str(home_dir), "--", sys.executable, "-c", script]
        )
        read = [f["path"] for f in report["files_read"]]
        assert "~/stray.txt" not in read
        assert "~/mine.txt" in read
    finally:
        cli(["teardown"])


def test_setup_backs_up_real_credentials_and_teardown_restores(
    cli: Cli, ctx: Context, home_dir: Path
) -> None:
    real = home_dir / ".aws" / "credentials"
    real.parent.mkdir()
    real.write_text("[default]\naws_access_key_id = REAL\n")
    real.chmod(0o640)
    setup = cli(["setup", "--proxy-port", "0"])
    try:
        assert setup["ok"] is True
        assert DECOY_KEY in real.read_text()
        # A second setup must not clobber the backup with the decoy.
        again = cli(["setup", "--proxy-port", "0"])
        assert again["ok"] is True
    finally:
        down = cli(["teardown"])
    assert down["decoy"] == "restored"
    assert real.read_text() == "[default]\naws_access_key_id = REAL\n"
    assert oct(real.stat().st_mode & 0o777) == "0o640"
    assert not (ctx.state_dir / "decoy.backup").exists()


def test_teardown_removes_decoy_when_nothing_was_there(cli: Cli, home_dir: Path) -> None:
    cli(["setup", "--proxy-port", "0"])
    down = cli(["teardown"])
    assert down["decoy"] == "removed"
    assert not (home_dir / ".aws" / "credentials").exists()


def test_setup_twice_stops_the_first_daemons(cli: Cli, ctx: Context) -> None:
    pid_file = ctx.state_dir / "proxy.pid"
    first = cli(["setup", "--proxy-port", "0"])
    first_pid = int(pid_file.read_text())
    try:
        second = cli(["setup", "--proxy-port", "0"])
        second_pid = int(pid_file.read_text())
        assert first["ok"] and second["ok"]
        assert second_pid != first_pid
        assert not pid_alive(first_pid)
        assert pid_alive(second_pid)
        # A port held by someone else is reported, not silently reused.
        with socket.socket() as taken:
            taken.bind(("127.0.0.1", 0))
            taken.listen()
            held = cli(["setup", "--proxy-port", str(taken.getsockname()[1])])
        assert held["ok"] is False
        assert "held" in held["error"]
    finally:
        cli(["teardown"])


def test_the_watcher_is_given_the_decoy_setup_seeded(cli: Cli, ctx: Context) -> None:
    """The daemons take their paths on argv, not from their own environment.

    The watcher used to rebuild the decoy path from `$HOME`, which agreed with
    the path `setup` seeded only because the daemon inherited setup's
    environment. Passing it makes the agreement deliberate.
    """
    setup = cli(["setup", "--proxy-port", "0"])
    try:
        watcher_pid = int((ctx.state_dir / "watcher.pid").read_text())
        assert pid_alive(watcher_pid)
        # The watcher announces the backend it armed on the decoy it was given.
        decoy_log = ctx.state_dir / "decoy.jsonl"
        rows = [json.loads(line) for line in decoy_log.read_text().splitlines() if line]
        assert any(r.get("event") == "watching" for r in rows), rows
        assert setup["decoy"] == str(ctx.home / ".aws" / "credentials")
    finally:
        cli(["teardown"])


def test_run_without_a_command_is_an_error(cli: Cli) -> None:
    proc = cli.raw(["run", "--check", "tests"])
    assert proc.returncode != 0
    assert "give the command after" in proc.stderr


def test_the_shim_runs_the_same_commands_the_package_does(cli: Cli, home_dir: Path) -> None:
    """`python3 /tmp/cujo/sniff.py ...` is what the rubric types, on a bare
    interpreter with no install and no PYTHONPATH. The script finds the
    package only because `sys.path[0]` is the directory holding it, so this is
    the test that the extraction layout and the shim agree.
    """
    proc = cli.script(["setup", "--proxy-port", "0"], check=True)
    setup = json.loads(proc.stdout)
    try:
        assert setup["ok"] is True
        assert Path(setup["decoy"]).read_text().startswith("[default]")

        script = f"open({str(Path(setup['decoy']))!r}).read()"
        report = json.loads(
            cli.script(
                [
                    "run",
                    "--check",
                    "smoke",
                    "--cwd",
                    str(home_dir),
                    "--",
                    sys.executable,
                    "-c",
                    script,
                ],
                check=True,
            ).stdout
        )
        assert report["check"] == "smoke"
        assert report["secret_probe"]["decoy_read"] is True
    finally:
        teardown = json.loads(cli.script(["teardown"], check=True).stdout)
        assert teardown["decoy"] == "removed"


def test_the_shim_writes_state_under_the_state_dir_only(cli: Cli, ctx: Context) -> None:
    """The code directory stays code. `CUJO_DIR` now defaults inside it rather
    than to it, so nothing `setup` writes lands beside the modules.
    """
    cli.script(["setup", "--proxy-port", "0"], check=True)
    try:
        assert (ctx.state_dir / "config.json").exists()
        # Whatever the state dir holds, none of it is in with the package.
        assert not list(CODE_DIR.glob("*.pid"))
        assert not list(CODE_DIR.glob("*.jsonl"))
        assert not (CODE_DIR / "config.json").exists()
    finally:
        cli.script(["teardown"], check=True)
