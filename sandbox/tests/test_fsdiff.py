"""The filesystem sensor: which directories are walked, and what a diff says."""

from __future__ import annotations

import os
from pathlib import Path

from cujo_sniff.context import Context, state_paths
from cujo_sniff.report import build_sensor_block
from cujo_sniff.sensors.fsdiff import Snapshot, _snapshot_roots, diff_snapshots, snapshot
from tests.test_report import ARMED, NOT_TRUNCATED


def walked(entries: dict[str, tuple[int, int, str | None]]) -> Snapshot:
    """A complete walk. Truncation is its own case, tested on its own below."""
    return Snapshot(entries, truncated=False)


def test_diff_snapshots_flags_workspace_and_sensitive(home_dir: Path) -> None:
    ws = home_dir / "work"
    before = walked({str(ws / "a.py"): (1, 1, None), str(home_dir / "keep"): (1, 1, None)})
    after = walked(
        {
            str(ws / "a.py"): (2, 1, None),
            str(ws / "b.py"): (1, 1, None),
            str(home_dir / "keep"): (1, 1, None),
            str(home_dir / ".ssh" / "authorized_keys"): (1, 1, None),
            str(home_dir / ".cache" / "pip" / "wheel"): (1, 1, None),
        }
    )
    changes = {c["path"]: c for c in diff_snapshots(before, after, [ws], home_dir)}
    assert changes["~/work/a.py"]["type"] == "modified"
    assert changes["~/work/b.py"]["type"] == "created"
    assert changes["~/work/b.py"]["in_workspace"] is True
    assert changes["~/.ssh/authorized_keys"]["sensitive"] is True
    assert changes["~/.ssh/authorized_keys"]["in_workspace"] is False
    assert changes["~/.cache/pip/wheel"]["sensitive"] is False
    assert "~/keep" not in changes


def test_diff_snapshots_reports_deletions(home_dir: Path) -> None:
    ws = home_dir / "work"
    before = walked(
        {
            str(ws / "gone.py"): (1, 1, None),
            str(home_dir / ".ssh" / "id_rsa"): (1, 1, None),
            str(home_dir / "keep"): (1, 1, None),
        }
    )
    after = walked({str(home_dir / "keep"): (1, 1, None)})
    changes = {c["path"]: c for c in diff_snapshots(before, after, [ws], home_dir)}
    assert changes["~/work/gone.py"] == {
        "path": "~/work/gone.py",
        "type": "deleted",
        "in_workspace": True,
        "sensitive": False,
    }
    assert changes["~/.ssh/id_rsa"]["type"] == "deleted"
    assert changes["~/.ssh/id_rsa"]["sensitive"] is True
    block = build_sensor_block(
        proxy_rows=[],
        audit_rows=[],
        decoy_rows=[],
        fs_changes=list(changes.values()),
        allow_hosts=[],
        check="tests",
        sensors=dict(ARMED),
        truncated=dict(NOT_TRUNCATED),
        home_dir=home_dir,
    )
    assert block["derived"]["wrote_sensitive"] is True
    assert block["derived"]["wrote_outside_workspace"] is True


def test_snapshot_sees_detonation_env_but_not_state_dir(ctx: Context, home_dir: Path) -> None:
    env_dir = ctx.envs_dir / "abc"
    env_dir.mkdir(parents=True)
    ctx.state_dir.mkdir()
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}
    before = snapshot([env_dir], **walk)
    (env_dir / "site-packages.txt").write_text("installed")
    (ctx.state_dir / "proxy.jsonl").write_text("noise")
    after = snapshot([env_dir], **walk)
    changes = diff_snapshots(before, after, [env_dir], home_dir)
    # The environments directory sits beside the state dir, not inside it, so
    # what an install writes there is visible while our own logs are not.
    assert state_paths(ctx)["envs"] == ctx.envs_dir
    assert [c for c in changes if c["path"].endswith("site-packages.txt")][0]["in_workspace"]
    assert not any("proxy.jsonl" in c["path"] for c in changes)


def test_an_aliased_home_is_still_one_directory(tmp_path: Path, home_dir: Path) -> None:
    # `--cwd` reaches the snapshot resolved and $HOME does not, so a HOME
    # behind a symlink was walked as two directories. Every file got two rows,
    # and because only one of them matched the workspace root, a write inside
    # the workspace set wrote_outside_workspace.
    alias = tmp_path / "home-link"
    alias.symlink_to(home_dir)
    assert _snapshot_roots([home_dir], alias) == _snapshot_roots([alias], alias)
    assert _snapshot_roots([home_dir], alias).count(home_dir) == 1

    after = walked({str(home_dir / "x.txt"): (1, 1, None)})
    changes = diff_snapshots(walked({}), after, [home_dir], alias)
    assert changes == [
        {"path": "~/x.txt", "type": "created", "in_workspace": True, "sensitive": False}
    ]


def test_a_restored_mtime_does_not_hide_a_credential_edit(home_dir: Path, ctx: Context) -> None:
    """`os.utime` after a same-length overwrite defeats (mtime, size) alone.

    The digest is what closes it, and it is spent only where it has to be: this
    same edit to an ordinary file in the workspace still reads as unchanged,
    which is the trade that keeps a snapshot from being a full read of HOME.
    """
    aws = home_dir / ".aws"
    aws.mkdir()
    secret = aws / "credentials"
    secret.write_text("AKIAREALKEY000000001")
    dull = home_dir / "notes.txt"
    dull.write_text("AKIAREALKEY000000001")
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}
    before = snapshot([home_dir], **walk)

    for path in (secret, dull):
        stamp = path.stat()
        path.write_text("AKIASTOLENKEY0000002")
        os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))

    after = snapshot([home_dir], **walk)
    changed = {c["path"] for c in diff_snapshots(before, after, [], home_dir)}
    assert "~/.aws/credentials" in changed
    assert "~/notes.txt" not in changed


def test_a_repointed_symlink_is_a_change(home_dir: Path, ctx: Context) -> None:
    # lstat describes the link, so a link that now aims at a different file has
    # the same metadata as before. The digest is taken over the target string.
    aws = home_dir / ".aws"
    aws.mkdir()
    link = aws / "credentials"
    link.symlink_to(home_dir / "one")
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}
    before = snapshot([home_dir], **walk)
    stamp = link.lstat()
    link.unlink()
    link.symlink_to(home_dir / "two")
    os.utime(link, ns=(stamp.st_atime_ns, stamp.st_mtime_ns), follow_symlinks=False)
    after = snapshot([home_dir], **walk)
    changed = {c["path"] for c in diff_snapshots(before, after, [], home_dir)}
    assert "~/.aws/credentials" in changed


def test_a_truncated_walk_reports_no_deletions(home_dir: Path) -> None:
    """Two capped walks stop in different places, and the gap is not a deletion.

    Reporting it as one invented evidence: the file was never looked at, which
    is what the `snapshot` truncation flag on the report says instead.
    """
    before = Snapshot({str(home_dir / "a"): (1, 1, None)}, truncated=True)
    after = Snapshot({str(home_dir / "b"): (1, 1, None)}, truncated=True)
    kinds = {c["type"] for c in diff_snapshots(before, after, [], home_dir)}
    assert kinds == {"created"}
    # The same pair of walks, complete, does report the deletion.
    complete = diff_snapshots(walked(before.entries), walked(after.entries), [], home_dir)
    assert {c["type"] for c in complete} == {"created", "deleted"}


def test_a_filename_cannot_smuggle_control_characters(home_dir: Path) -> None:
    # The author chooses the filenames, and the report is read by a language
    # model. An escape sequence in one reaches the prompt as text about a file.
    after = walked({str(home_dir / "a\x1b[31mred"): (1, 1, None)})
    path = diff_snapshots(walked({}), after, [], home_dir)[0]["path"]
    assert "\x1b" not in path
    assert path == "~/a\\x1b[31mred"
