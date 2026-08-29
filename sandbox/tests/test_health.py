"""What the report says about the sensors that produced it.

`false` used to mean two things at once: nothing happened, or nothing was
watching. These are the tests that keep them apart.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from cujo_sniff.context import Context, state_paths
from cujo_sniff.daemons import daemon_alive
from cujo_sniff.report import build_sensor_block, health, merge_reports
from cujo_sniff.runner import daemon_health, snapshot_health
from cujo_sniff.sensors.fsdiff import Snapshot
from tests.test_report import ARMED, NOT_TRUNCATED, _block


@pytest.fixture
def stand_in() -> Iterator[int]:
    """A live process whose command line names the package, as a daemon's does.

    `daemon_alive` reads `/proc/<pid>/cmdline` and requires `cujo_sniff` in it,
    so this test process is deliberately *not* a stand-in for a sensor: writing
    its own pid into a pid file is exactly the forgery that check exists to
    refuse. Anything asserting the healthy path has to look like the real thing.
    """
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)", "cujo_sniff"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        yield proc.pid
    finally:
        proc.kill()
        proc.wait()


def _pids(ctx: Context, proxy: int | None = None, watcher: int | None = None) -> None:
    paths = state_paths(ctx)
    ctx.state_dir.mkdir(parents=True, exist_ok=True)
    for key, pid in (("proxy_pid", proxy), ("watcher_pid", watcher)):
        if pid is None:
            paths[key].unlink(missing_ok=True)
        else:
            paths[key].write_text(str(pid))


def test_a_daemon_that_armed_and_then_died_reads_as_unarmed(ctx: Context, stand_in: int) -> None:
    """The case the whole block exists for.

    `setup` proving the proxy came up says nothing about the fourth check. A
    proxy that died in between leaves `egress: []` on every later report, which
    is indistinguishable from a command that talked to nobody.
    """
    config = {"proxy_armed": True, "proxy_port": 8899, "decoy_backend": "inotify"}
    _pids(ctx, proxy=stand_in, watcher=stand_in)
    alive = daemon_health(ctx, config)
    assert alive["proxy"] == health(True, "port 8899")
    assert alive["decoy"] == health(True, "inotify")

    # A pid nothing answers to. 2**22 is above every default pid_max.
    _pids(ctx, proxy=4194303, watcher=4194303)
    dead = daemon_health(ctx, config)
    assert dead["proxy"]["armed"] is False
    assert "no longer running" in dead["proxy"]["detail"]
    assert dead["decoy"]["armed"] is False
    assert dead["decoy"]["detail"].startswith("inotify")


def test_a_daemon_that_never_armed_says_so_differently(ctx: Context, stand_in: int) -> None:
    _pids(ctx, proxy=stand_in, watcher=stand_in)
    never = daemon_health(ctx, {"proxy_armed": False, "decoy_backend": None})
    assert never["proxy"] == health(False, "did not start during setup")
    assert never["decoy"] == health(False, "no watcher armed during setup")


def test_the_watcher_backend_reaches_the_report(ctx: Context, stand_in: int) -> None:
    # inotify sees a read; the atime fallback is close to useless under
    # relatime, so which one armed changes what a quiet decoy is worth.
    _pids(ctx, proxy=stand_in, watcher=stand_in)
    for backend in ("inotify", "atime"):
        got = daemon_health(ctx, {"proxy_armed": True, "decoy_backend": backend})
        assert got["decoy"] == health(True, backend)


def test_an_empty_audit_log_and_a_silent_one_are_different(home_dir: Path) -> None:
    """A hook that never loaded, and a command that did nothing.

    Both used to produce the same empty log. The hook now announces itself, so
    the report can say which -- and neither is a fault: a check running
    `npm test` has no Python process to hook at all.
    """
    no_python = _block(home_dir)
    assert no_python["sensors"]["audit"] == health(False, "no Python process ran")

    armed_and_quiet = _block(home_dir, audit_rows=[{"event": "armed"}])
    assert armed_and_quiet["sensors"]["audit"]["armed"] is True
    assert armed_and_quiet["files_read"] == []


def test_the_filesystem_sensor_reports_how_far_it_walked() -> None:
    empty = Snapshot({}, False)
    assert snapshot_health(empty, empty) == health(False, "walked no files")
    reached = snapshot_health(Snapshot({}, False), Snapshot({"a": (1, 1, None)}, False))
    assert reached == health(True, "1 paths")
    capped = snapshot_health(Snapshot({}, True), Snapshot({"a": (1, 1, None)}, False))
    assert capped["armed"] is True
    assert "capped" in capped["detail"]
    # Walked and recorded, but not compared: a different loss, said separately.
    big = snapshot_health(Snapshot({}, False, 2), Snapshot({"a": (1, 1, None)}, False, 2))
    assert big["armed"] is True
    assert "2 not compared by content" in big["detail"]


def test_the_caps_say_when_they_cut(home_dir: Path) -> None:
    """A short list and a quiet one are the same list without this.

    `files_read` drops benign reads past the cap but never a sensitive one, so
    the flag is the only thing that says the list is partial.
    """
    reads = [
        {"event": "open", "path": str(home_dir / f"f{i}.txt"), "mode": "r"} for i in range(400)
    ]
    block = _block(home_dir, audit_rows=reads)
    assert block["truncated"]["files_read"] is True
    assert len(block["files_read"]) == 200

    under = _block(home_dir, audit_rows=reads[:5])
    assert under["truncated"]["files_read"] is False

    # The caller owns the ones it alone can see; they pass through untouched.
    passed = _block(home_dir, truncated={**NOT_TRUNCATED, "stdout_tail": True})
    assert passed["truncated"]["stdout_tail"] is True
    assert passed["truncated"]["snapshot"] is False


def test_the_decoy_payload_sensor_says_not_observable_rather_than_false(home_dir: Path) -> None:
    """`decoy_in_egress` was a `false` nobody had ever measured.

    The proxy counts bytes and never reads a payload, so no run of this sandbox
    can tell whether the decoy's value left the box. Null says that; false
    claimed an observation.
    """
    assert _block(home_dir)["secret_probe"]["decoy_in_egress"] is None


def test_a_blind_stretch_makes_the_merged_block_blind(home_dir: Path) -> None:
    """Detonation is several commands folded into one report.

    A sensor armed for the install but not for the environment build covers the
    merged block in a gap, so the roll-up takes the pessimistic reading and the
    detail comes from the run that lost it.
    """
    watching = _block(home_dir)
    blind = _block(
        home_dir,
        sensors={**ARMED, "proxy": health(False, "started during setup, no longer running")},
    )
    merged = merge_reports([watching, blind])
    assert merged["sensors"]["proxy"]["armed"] is False
    assert "no longer running" in merged["sensors"]["proxy"]["detail"]
    assert merged["sensors"]["decoy"]["armed"] is True


def test_truncation_survives_the_merge(home_dir: Path) -> None:
    clean = _block(home_dir)
    cut = _block(home_dir, truncated={**NOT_TRUNCATED, "snapshot": True})
    merged = merge_reports([clean, cut])
    assert merged["truncated"]["snapshot"] is True
    assert merged["truncated"]["stdout_tail"] is False


def test_the_known_verdict_survives_the_merge(home_dir: Path) -> None:
    # merge_egress used to rebuild every row and drop `known` with it, which
    # left the detonation report -- the one check `egress_to_unknown_host` fires
    # on -- with no verdict for the hard rule to read.
    quiet = _block(home_dir, proxy_rows=[{"host": "pypi.org", "port": 443, "bytes": 1}])
    loud = _block(home_dir, proxy_rows=[{"host": "evil.example", "port": 443, "bytes": 2}])
    merged = merge_reports([quiet, loud])
    verdicts = {e["host"]: e["known"] for e in merged["egress"]}
    assert verdicts == {"pypi.org": True, "evil.example": False}


def test_the_health_block_names_nothing_a_public_page_may_not_show(home_dir: Path) -> None:
    """A check report is published verbatim on the anonymous public plane.

    `http/public/serialize.ts` passes `report` through with no field-level
    allowlist, so a `detail` that named a path or a host would publish it. A
    loopback port is the most specific thing this block may say.
    """
    block = build_sensor_block(
        proxy_rows=[],
        audit_rows=[],
        decoy_rows=[],
        fs_changes=[],
        allow_hosts=[],
        check="tests",
        sensors=dict(ARMED),
        truncated=dict(NOT_TRUNCATED),
        home_dir=home_dir,
    )
    rendered = json.dumps(block["sensors"])
    assert str(home_dir) not in rendered
    assert "/" not in rendered


def test_a_live_watcher_on_a_replaced_decoy_is_not_armed(
    ctx: Context, home_dir: Path, stand_in: int
) -> None:
    """inotify follows an inode, not a name.

    A command that deletes `~/.aws/credentials`, or writes it through a rename,
    moves the file out from under the watch. The daemon re-arms where it can;
    where it cannot it stays alive and blocked, and a pid check alone would call
    that armed while no decoy read could ever be seen again.
    """
    _pids(ctx, proxy=stand_in, watcher=stand_in)
    decoy = home_dir / ".aws" / "credentials"
    decoy.parent.mkdir(parents=True)
    decoy.write_text("seeded")
    config = {
        "proxy_armed": True,
        "decoy_backend": "inotify",
        "decoy": str(decoy),
        "decoy_inode": decoy.stat().st_ino,
    }
    assert daemon_health(ctx, config)["decoy"]["armed"] is True

    # Replaced, not edited: a new inode at the same path.
    replacement = home_dir / ".aws" / "theirs"
    replacement.write_text("mine now")
    replacement.replace(decoy)
    replaced = daemon_health(ctx, config)["decoy"]
    assert replaced["armed"] is False
    assert "gone" in replaced["detail"]

    # Deleted outright is the same answer.
    decoy.unlink()
    assert daemon_health(ctx, config)["decoy"]["armed"] is False


def test_a_report_from_before_the_inode_was_recorded_is_not_called_blind(
    ctx: Context, home_dir: Path, stand_in: int
) -> None:
    # `decoy_inode` is absent from a config an earlier `setup` wrote. Absent is
    # unknown, and unknown must not read as a fault -- the same rule the trusted
    # side applies to a report with no health block at all.
    _pids(ctx, proxy=stand_in, watcher=stand_in)
    assert daemon_health(ctx, {"proxy_armed": True, "decoy_backend": "atime"})["decoy"] == health(
        True, "atime"
    )


def test_a_pid_file_pointing_at_something_that_is_not_ours_is_not_a_daemon(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The audited command can write the pid file and leave a live pid behind.

    Its own, or the runner's. Checking the command line raises that from
    "write four digits" to "keep a process alive whose argv says cujo_sniff".
    Not a proof -- the same code can rewrite `proxy.jsonl` directly -- but the
    accidental case and the lazy one both stop here. On a platform with no
    procfs the pid answering is all there is to go on, and that is the answer.
    """
    paths = state_paths(ctx)
    ctx.state_dir.mkdir(parents=True, exist_ok=True)
    paths["proxy_pid"].write_text(str(os.getpid()))
    # This test process is alive and is not a sensor daemon. Where there is a
    # procfs to ask, that is caught; where there is not, the pid answering is
    # all the platform will say and the check says it.
    assert daemon_alive(paths["proxy_pid"]) == (not Path("/proc").is_dir())

    paths["proxy_pid"].write_text("4194303")
    assert daemon_alive(paths["proxy_pid"]) is False
    paths["proxy_pid"].write_text("not a pid")
    assert daemon_alive(paths["proxy_pid"]) is False


def test_an_armed_row_the_command_could_have_written_is_still_reported(
    home_dir: Path,
) -> None:
    """The audit hook's proof of life is only as good as the log it writes to.

    The command holds `CUJO_AUDIT_LOG`, so it can append the row itself -- as it
    can append to every other sensor log. What bounds it is the direction: a
    forged `armed` hides that the hook never loaded, and cannot invent a
    finding. `apps/cujo` warns on `armed: false` and never on true.
    """
    forged = _block(home_dir, audit_rows=[{"event": "armed"}])
    assert forged["sensors"]["audit"]["armed"] is True
    # The report says what it saw. Nothing here is a `critical`, and the two
    # sensors the trusted side rules on are the daemons, not this one.
    assert forged["derived"] == {
        "egress_to_unknown_host": False,
        "wrote_outside_workspace": False,
        "wrote_sensitive": False,
        "spawned_subprocess": False,
    }
