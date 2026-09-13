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

from cujo_sniff.cli import main
from cujo_sniff.context import Context, state_paths
from cujo_sniff.daemons import pid_alive
from cujo_sniff.policy import DECOY_KEY, MAX_SCRIPT_CHARS, SCHEMA_VERSION, TAIL_CHARS
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


def test_a_sensed_command_refuses_to_open_a_second_window(cli: Cli, home_dir: Path) -> None:
    """`run -- sniff.py detonate` (or `run -- sniff.py run`) would wait on its own lock.

    The first detonation on the pi harness did exactly that and sat until the
    wrapper's timeout killed it, and the report that came back described the
    timeout rather than the install. The inner command refuses at once, on
    stderr, so the respawn gets it right (decision 108).
    """
    cli(["setup", "--proxy-port", "0"])
    try:
        sniff = str(CODE_DIR / "sniff.py")
        inner = [sys.executable, sniff, "detonate", "--dependency", "x", "--source", "pypi"]
        report = cli(["run", "--check", "detonation", "--cwd", str(home_dir), "--", *inner])
        assert report["exit"] != 0
        assert "already inside a sensed window" in report["stderr_tail"]
        assert "call it directly" in report["stderr_tail"]
        assert report["duration_s"] < 30
        nested_run = [sys.executable, sniff, "run", "--check", "tests", "--", "true"]
        report = cli(["run", "--check", "tests", "--cwd", str(home_dir), "--", *nested_run])
        assert report["exit"] != 0
        assert "already inside a sensed window" in report["stderr_tail"]
        # Outside a window the same command is still accepted (it fails on the
        # dependency, which is the point where it used to hang).
        proc = cli.raw(["detonate", "--dependency", "x", "--source", "pypi"])
        assert "already inside a sensed window" not in proc.stderr
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


def test_run_narrows_cwd_without_narrowing_the_workspace(cli: Cli, home_dir: Path) -> None:
    """Decision 111: `--cwd` says where the command runs, `--workspace-root` what
    the sensors count as inside the workspace.

    The repository that forced this holds six services under `services/<name>/`
    and no manifest at the root, so the install has to run inside one service.
    Narrowing the workspace along with it would reclassify every write elsewhere
    in the tree as outside the workspace, and `wrote_sensitive` is a rule that
    accuses code of acting against the person running it.
    """
    tree = home_dir / "tree"
    service = tree / "services" / "orders-py"
    service.mkdir(parents=True)
    # A write one directory up from where the command runs, which is what an
    # install does when it writes a lock file or a build directory at the root.
    script = "open('../../built.txt', 'w').write('x')"

    setup = cli(["setup", "--proxy-port", "0"])
    try:
        assert setup["ok"] is True

        # Without it, the default is today's behaviour and the write is outside.
        narrow = cli(
            ["run", "--check", "setup", "--cwd", str(service), "--", sys.executable, "-c", script]
        )
        assert narrow["exit"] == 0
        outside = [c for c in narrow["fs_changes"] if c["path"].endswith("built.txt")]
        assert outside and outside[0]["in_workspace"] is False

        (tree / "built.txt").unlink()

        # With the tree as the workspace root, the same write is inside it.
        wide = cli(
            [
                "run",
                "--check",
                "setup",
                "--cwd",
                str(service),
                "--workspace-root",
                str(tree),
                "--",
                sys.executable,
                "-c",
                script,
            ]
        )
        assert wide["exit"] == 0
        inside = [c for c in wide["fs_changes"] if c["path"].endswith("built.txt")]
        assert inside and inside[0]["in_workspace"] is True
        # And the accusing rule stays quiet either way: the file is not sensitive.
        assert wide["derived"]["wrote_sensitive"] is False
    finally:
        cli(["teardown"])


def test_run_accepts_more_than_one_workspace_root(cli: Cli, home_dir: Path) -> None:
    """Repeatable, because a monorepo install can legitimately touch two trees."""
    one = home_dir / "one"
    two = home_dir / "two"
    one.mkdir()
    two.mkdir()
    cli(["setup", "--proxy-port", "0"])
    try:
        report = cli(
            [
                "run",
                "--check",
                "setup",
                "--cwd",
                str(one),
                "--workspace-root",
                str(one),
                "--workspace-root",
                str(two),
                "--",
                sys.executable,
                "-c",
                f"open({str(two / 'x.txt')!r}, 'w').write('x')",
            ]
        )
        assert report["exit"] == 0
        written = [c for c in report["fs_changes"] if c["path"].endswith("x.txt")]
        assert written and written[0]["in_workspace"] is True
    finally:
        cli(["teardown"])


def test_report_assembles_the_envelope_from_the_runs_it_recorded(cli: Cli, home_dir: Path) -> None:
    """Decision 112: the model copies one blob, not thirty-odd fields per entry.

    `runs.0.schema_version: Required (+31 more)` was a sub-agent rebuilding each
    entry out of the fields it judged interesting, against a rubric that already
    said never to trim one. Assembling it here removes the asking.
    """
    cli(["setup", "--proxy-port", "0"])
    try:
        for i in range(2):
            cli(
                [
                    "run",
                    "--check",
                    "tests",
                    "--cwd",
                    str(home_dir),
                    "--",
                    sys.executable,
                    "-c",
                    f"print({i})",
                ]
            )
        envelope = cli(
            [
                "report",
                "--check",
                "tests",
                "--extra",
                json.dumps({"base": "abc", "head": "def", "base_pass_head_fail": []}),
            ]
        )

        assert envelope["schema_version"] == SCHEMA_VERSION
        assert envelope["check"] == "tests"
        # Both runs, in the order they ran, and each one whole.
        assert len(envelope["runs"]) == 2
        assert [json.loads(r["stdout_tail"].strip()) for r in envelope["runs"]] == [0, 1]
        for entry in envelope["runs"]:
            # The fields the validator requires of every entry, none of which a
            # model now has to remember.
            for key in (
                "schema_version",
                "argv",
                "exit",
                "duration_s",
                "window_exclusive",
                "stdout_tail",
                "stderr_tail",
                "egress",
                "files_read",
                "fs_changes",
                "subprocesses",
                "secret_probe",
                "sensors",
                "truncated",
                "derived",
            ):
                assert key in entry, key
            assert entry["schema_version"] == SCHEMA_VERSION

        # The roll-up, computed rather than asked for.
        assert set(envelope["derived"]) == {
            "egress_to_unknown_host",
            "wrote_outside_workspace",
            "wrote_sensitive",
            "spawned_subprocess",
        }
        assert envelope["sensors"]["proxy"]["armed"] is True
        # And the per-check fields the sensors know nothing about.
        assert envelope["base"] == "abc"
        assert envelope["base_pass_head_fail"] == []
    finally:
        cli(["teardown"])


def test_report_refuses_to_let_extra_overwrite_the_envelope(cli: Cli, home_dir: Path) -> None:
    """`--extra` is the model's half and it may not reach the sensors' half."""
    cli(["setup", "--proxy-port", "0"])
    try:
        cli(
            ["run", "--check", "probes", "--cwd", str(home_dir), "--", sys.executable, "-c", "pass"]
        )
        envelope = cli(
            [
                "report",
                "--check",
                "probes",
                "--extra",
                json.dumps(
                    {
                        "check": "tests",
                        "runs": [],
                        "derived": {"wrote_sensitive": True},
                        "schema_version": 999,
                    }
                ),
            ]
        )
        assert envelope["check"] == "probes"
        assert len(envelope["runs"]) == 1
        assert envelope["derived"]["wrote_sensitive"] is False
        assert envelope["schema_version"] == SCHEMA_VERSION
    finally:
        cli(["teardown"])


def test_report_without_any_run_says_so(cli: Cli) -> None:
    """Silence here would be a report claiming a check that never ran anything."""
    proc = cli.raw(["report", "--check", "smoke"])
    assert proc.returncode != 0
    assert "no runs recorded" in proc.stderr


def test_report_keeps_each_check_to_its_own_runs(cli: Cli, home_dir: Path) -> None:
    cli(["setup", "--proxy-port", "0"])
    try:
        for check in ("tests", "smoke"):
            cli(
                [
                    "run",
                    "--check",
                    check,
                    "--cwd",
                    str(home_dir),
                    "--",
                    sys.executable,
                    "-c",
                    f"print({check!r})",
                ]
            )
        tests = cli(["report", "--check", "tests"])
        smoke = cli(["report", "--check", "smoke"])
        assert len(tests["runs"]) == 1
        assert len(smoke["runs"]) == 1
        assert "tests" in tests["runs"][0]["stdout_tail"]
        assert "smoke" in smoke["runs"][0]["stdout_tail"]
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


def test_a_hostile_output_cannot_spend_more_than_the_tail_budget(cli: Cli, home_dir: Path) -> None:
    """The cap is on what reaches the prompt, and escaping is where size is set.

    `\\u202e` is six characters out for one in, so capping the raw output and
    escaping afterwards returned six times `TAIL_CHARS` -- and the output is
    written by the code under review, which is what makes the gap a lever.
    """
    cli(["setup", "--proxy-port", "0"])
    try:
        script = rf"import sys; sys.stdout.write('\u202e' * {TAIL_CHARS * 2})"
        report = cli(
            ["run", "--check", "tests", "--cwd", str(home_dir), "--", sys.executable, "-c", script]
        )
        assert report["exit"] == 0
        assert len(report["stdout_tail"]) <= TAIL_CHARS
        assert report["truncated"]["stdout_tail"] is True
        # Whole escapes only: a half-written `\\u20` is text nothing printed.
        assert set(report["stdout_tail"].split("\\u202e")) <= {""}
    finally:
        cli(["teardown"])


def test_the_error_envelope_spends_its_budget_after_escaping(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The envelope is the last thing a failed command says.

    It used to escape and then slice, which bounds the size and cuts an escape
    wherever the budget happens to land -- leaving a bare `\\u` that nothing
    raised, in the field a reader trusts most because it is all that is left.

    In process and not through `cli.raw`: an exception raised by a *path* is
    reported by Python with Python's own `\\u` escaping already in it, so a
    partial sequence at the cut could belong to either escaper and the test
    would decide nothing. Raising the characters directly makes the escaping
    ours alone.

    And at every alignment, because one offset decides nothing either. Six
    characters out per character in means one message in six is cut cleanly by
    accident -- the first version of this test picked exactly that one and
    passed against the bug it was written for.
    """
    for pad in range(6):
        boom = "." * pad + "\u202e" * 2000

        def explode(*_args: object, message: str = boom, **_kwargs: object) -> dict[str, object]:
            raise RuntimeError(message)

        monkeypatch.setattr("cujo_sniff.cli.cmd_teardown", explode)
        with pytest.raises(SystemExit):
            main(["teardown"])

        payload = json.loads(capsys.readouterr().out)
        assert payload["ok"] is False
        assert len(payload["error"]) <= 2000
        # Whole escapes only. A `\\u` or `\\u2` left at the boundary survives
        # this split and fails here, which is what the old slice produced.
        body = payload["error"].removeprefix("RuntimeError: ").lstrip(".")
        assert set(body.split("\\u202e")) <= {""}, (pad, body[-24:])


def test_a_hostile_script_cannot_be_cut_mid_escape(cli: Cli, home_dir: Path) -> None:
    """`script_content` is the probe's own file, captured by the sensor.

    It landed on main escaping first and slicing the result, which bounds the
    size and cuts `\\u202e` into `\\u20` -- text the script does not contain, in
    a field whose entire purpose is to let a reader diff what the agent claimed
    against what the sensor saw. Every alignment, because six characters out per
    character in means one script in six is cut cleanly by accident.
    """
    cli(["setup", "--proxy-port", "0"])
    try:
        for pad in range(6):
            script = home_dir / f"probe_{pad}.py"
            script.write_text("#" + "." * pad + "\u202e" * 8000 + "\npass\n")
            report = cli(
                [
                    "run",
                    "--check",
                    "probes",
                    "--cwd",
                    str(home_dir),
                    "--",
                    sys.executable,
                    str(script),
                ]
            )
            content = report["script_content"]
            assert content is not None
            assert len(content) <= MAX_SCRIPT_CHARS, pad
            assert report["truncated"]["script_content"] is True, pad
            # Whole escapes only.
            for fragment in content.split("\\u202e"):
                assert "\\u" not in fragment, (pad, fragment[-20:])
    finally:
        cli(["teardown"])
