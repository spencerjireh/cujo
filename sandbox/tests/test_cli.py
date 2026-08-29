"""The commands end to end, run the way the rubric runs them.

Every test here goes through `python3 -m cujo_sniff` from the directory that
holds the package, with a bare interpreter and no PYTHONPATH — the same shape
the sandbox uses after the rubric extracts the tarball.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import sys
import time
from pathlib import Path

import pytest

from cujo_sniff.context import Context, state_paths
from cujo_sniff.daemons import pid_alive
from cujo_sniff.policy import DECOY_KEY, SCHEMA_VERSION
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


def test_setup_then_run_leaves_a_quiet_command_quiet(cli: Cli, home_dir: Path) -> None:
    """The negative case, which is every clean pull request, and it was missing.

    Its positive twin above is the one everybody wrote. Nothing asserted that a
    command touching nothing reports nothing, and the sensors stopped being
    silent: the filesystem snapshot hashes sensitive paths, the decoy is one, so
    every sensed window opened it twice and the watch armed on that inode logged
    it. `decoy_read` is a hard rule, so Cujo called every pull request a
    supply-chain attack -- including on the unmodified base commit, which cannot
    have read anything.

    The armed assertions are load-bearing: a report from sensors that never
    started is quiet for the wrong reason and would pass this on its own.
    """
    setup = cli(["setup", "--proxy-port", "0"])
    try:
        assert setup["ok"] is True
        report = cli(
            ["run", "--check", "tests", "--cwd", str(home_dir), "--", sys.executable, "-c", "pass"]
        )
        assert report["exit"] == 0
        assert report["sensors"]["decoy"]["armed"] is True
        assert report["sensors"]["audit"]["armed"] is True
        assert report["secret_probe"]["decoy_read"] is False
        assert report["derived"]["wrote_sensitive"] is False
        assert [f for f in report["files_read"] if f["sensitive"]] == []
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


def test_setup_reports_which_sensors_armed(cli: Cli) -> None:
    setup = cli(["setup", "--proxy-port", "0"])
    try:
        assert setup["schema_version"] == SCHEMA_VERSION
        assert setup["sensors"]["proxy"] == {
            "armed": True,
            "detail": f"port {setup['proxy_port']}",
        }
        # inotify on Linux, the atime poll everywhere else. Which one it is
        # changes what a quiet decoy is worth, so the report says.
        decoy = setup["sensors"]["decoy"]
        assert decoy["armed"] is True
        assert decoy["detail"] in ("inotify", "atime")
    finally:
        cli(["teardown"])


def test_a_report_says_the_sensors_were_watching(cli: Cli, home_dir: Path) -> None:
    cli(["setup", "--proxy-port", "0"])
    try:
        report = cli(["run", "--check", "tests", "--cwd", str(home_dir), "--", "true"])
        assert report["schema_version"] == SCHEMA_VERSION
        assert report["window_exclusive"] is True
        assert report["sensors"]["proxy"]["armed"] is True
        assert report["sensors"]["decoy"]["armed"] is True
        assert report["sensors"]["fs_diff"]["armed"] is True
        # The four this command decides. `hashes` is deliberately not among
        # them: the walk covers `/etc`, so whether some file on *this* machine
        # was too large to hash or changed identity under the walk is a fact
        # about the machine, not about `true`. Pinning it made the suite pass on
        # a developer's laptop and fail on a Linux runner, which is the test
        # being wrong rather than the sensor.
        assert report["truncated"]["stdout_tail"] is False
        assert report["truncated"]["stderr_tail"] is False
        assert report["truncated"]["files_read"] is False
        assert report["truncated"]["snapshot"] is False
        assert isinstance(report["truncated"]["hashes"], bool)
        # `true` is not a Python process, so there is no hook to arm and that
        # is not a fault -- it is the difference the block exists to record.
        assert report["sensors"]["audit"]["armed"] is False
    finally:
        cli(["teardown"])


def test_a_proxy_that_dies_after_setup_is_not_a_clean_bill_of_health(
    cli: Cli, ctx: Context, home_dir: Path
) -> None:
    """The failure the health block was written for.

    Nothing re-checked the daemons after `setup`, so a proxy that died during
    the first check left the three that followed with an empty `egress` and a
    `derived.egress_to_unknown_host` of false -- a clean report from a blind
    sensor. Now the report says it was blind, and apps/cujo turns that into a
    warn the review has to carry.
    """
    setup = cli(["setup", "--proxy-port", "0"])
    try:
        assert setup["sensors"]["proxy"]["armed"] is True
        proxy_pid = int(state_paths(ctx)["proxy_pid"].read_text())
        os.kill(proxy_pid, signal.SIGKILL)
        deadline = time.monotonic() + 5
        while pid_alive(proxy_pid) and time.monotonic() < deadline:
            time.sleep(0.05)

        report = cli(["run", "--check", "probes", "--cwd", str(home_dir), "--", "true"])
        assert report["egress"] == []
        assert report["derived"]["egress_to_unknown_host"] is False
        assert report["sensors"]["proxy"]["armed"] is False
        assert "no longer running" in report["sensors"]["proxy"]["detail"]
        # The other sensors are untouched by the one that died.
        assert report["sensors"]["decoy"]["armed"] is True
    finally:
        cli(["teardown"])


def test_output_reaches_the_report_escaped(cli: Cli, home_dir: Path) -> None:
    # The parent agent reads `stdout_tail` as text about the pull request, so a
    # command that prints an escape sequence is writing into that prompt. The
    # newline is kept: it is structure the reviewer wants.
    cli(["setup", "--proxy-port", "0"])
    try:
        script = r"import sys; sys.stdout.write('\x1b[2Jcleared\nsecond line')"
        report = cli(
            ["run", "--check", "tests", "--cwd", str(home_dir), "--", sys.executable, "-c", script]
        )
        assert report["exit"] == 0
        assert report["stdout_tail"] == "\\x1b[2Jcleared\nsecond line"
        # The Python that printed it did arm the hook.
        assert report["sensors"]["audit"]["armed"] is True
    finally:
        cli(["teardown"])
