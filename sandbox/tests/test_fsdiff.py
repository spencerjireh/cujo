"""The filesystem sensor: which directories are walked, and what a diff says."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from cujo_sniff.context import Context, state_paths
from cujo_sniff.policy import DECOY_REL
from cujo_sniff.report import build_sensor_block
from cujo_sniff.sensors.decoy import seed_decoy
from cujo_sniff.sensors.fsdiff import (
    UNHASHED,
    UNREADABLE,
    UNVERIFIED,
    Snapshot,
    _digest,
    _snapshot_roots,
    diff_snapshots,
    snapshot,
)
from tests.test_report import ARMED, NOT_TRUNCATED

# A sensitive path that is not the seeded decoy. Every test below about what
# the walk *hashes* has to use one: `should_hash` excludes the decoy, because
# opening it is what the watcher armed on it is there to report. Anything else
# under a credentials location behaves the way it always did.
SENSITIVE = Path(".ssh") / "id_rsa"


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
    secret = home_dir / SENSITIVE
    secret.parent.mkdir()
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
    assert f"~/{SENSITIVE}" in changed
    assert "~/notes.txt" not in changed


def test_a_repointed_symlink_is_a_change(home_dir: Path, ctx: Context) -> None:
    # lstat describes the link, so a link that now aims at a different file has
    # the same metadata as before. The digest is taken over the target string.
    link = home_dir / SENSITIVE
    link.parent.mkdir()
    link.symlink_to(home_dir / "one")
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}
    before = snapshot([home_dir], **walk)
    stamp = link.lstat()
    link.unlink()
    link.symlink_to(home_dir / "two")
    os.utime(link, ns=(stamp.st_atime_ns, stamp.st_mtime_ns), follow_symlinks=False)
    after = snapshot([home_dir], **walk)
    changed = {c["path"] for c in diff_snapshots(before, after, [], home_dir)}
    assert f"~/{SENSITIVE}" in changed


def test_which_walk_was_cut_decides_which_absences_can_be_believed(home_dir: Path) -> None:
    """A capped walk cannot prove a file was not there, and that cuts both ways.

    `created` reads the *before* walk's silence, so it needs that walk to be
    complete; `deleted` reads the *after* walk's, so it needs the other one.
    Suppressing both whenever either was cut loses real deletions from a command
    that shrinks a tree past the cap; suppressing neither invents `created` rows
    for files the first walk merely never reached. Either mistake ends up in
    `wrote_sensitive`, which is a `critical` the agent may not lower.
    """
    gone, made = str(home_dir / "gone"), str(home_dir / "made")
    entries = lambda names: {n: (1, 1, None) for n in names}  # noqa: E731

    def kinds(before: Snapshot, after: Snapshot) -> dict[str, str]:
        return {c["path"]: c["type"] for c in diff_snapshots(before, after, [], home_dir)}

    complete = kinds(walked(entries([gone])), walked(entries([made])))
    assert complete == {"~/gone": "deleted", "~/made": "created"}

    # Before was cut: `made` may be a file that walk never reached. `gone` is
    # still a deletion, because the complete after walk would have found it.
    cut_before = kinds(Snapshot(entries([gone]), True), walked(entries([made])))
    assert cut_before == {"~/gone": "deleted"}

    # After was cut, and the argument runs the other way.
    cut_after = kinds(walked(entries([gone])), Snapshot(entries([made]), True))
    assert cut_after == {"~/made": "created"}

    assert kinds(Snapshot(entries([gone]), True), Snapshot(entries([made]), True)) == {}


def test_a_change_is_reported_however_short_the_walks_were(home_dir: Path) -> None:
    # Truncation only makes an *absence* unreadable. A path both walks hold was
    # measured twice, so the comparison stands whatever the cap did elsewhere.
    path = str(home_dir / ".ssh" / "id_rsa")
    before = Snapshot({path: (1, 1, "aaa")}, truncated=True)
    after = Snapshot({path: (1, 1, "bbb")}, truncated=True)
    changes = diff_snapshots(before, after, [], home_dir)
    assert [c["type"] for c in changes] == ["modified"]
    assert changes[0]["sensitive"] is True


def test_a_digest_that_could_not_be_taken_is_not_a_digest_nobody_wanted(home_dir: Path) -> None:
    """`chmod 000` after a same-length edit must not read as unchanged.

    Both cases put something other than a hash in the entry, and conflating them
    hands back the exact evasion the digest was added to close: overwrite the
    key, restore the timestamp, then make the file unreadable.
    """
    creds = str(home_dir / ".aws" / "credentials")
    hashed = Snapshot({creds: (1, 1, "aaa")}, truncated=False)
    unreadable = Snapshot({creds: (1, 1, UNREADABLE)}, truncated=False)
    assert [c["type"] for c in diff_snapshots(hashed, unreadable, [], home_dir)] == ["modified"]

    # Out of scope on both sides is the other thing entirely: nothing was ever
    # hashed, so metadata is the whole answer, as it was before digests existed.
    out_of_scope = Snapshot({str(home_dir / "app.py"): (1, 1, None)}, truncated=False)
    assert diff_snapshots(out_of_scope, out_of_scope, [], home_dir) == []


def test_the_walk_leaves_the_decoy_unopened(home_dir: Path, ctx: Context) -> None:
    """The one sensitive file the snapshot must not read, seeded the real way.

    `seed_decoy` and `should_hash` have to agree on which path that is, so the
    decoy here is written by the same function `setup` calls rather than by a
    literal repeated in a test.
    """
    decoy = seed_decoy(home_dir / DECOY_REL, ctx.state_dir / "decoy.backup")
    other = home_dir / SENSITIVE
    other.parent.mkdir()
    other.write_text("AKIAREALKEY000000001")
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}

    entries = snapshot([home_dir], **walk).entries
    # Walked and recorded -- a write to it is still a change -- but not hashed.
    assert entries[str(decoy)][2] is None
    assert entries[str(other)][2] not in (None, UNHASHED, UNREADABLE)


def test_a_link_aimed_at_the_decoy_is_hashed_by_its_target(home_dir: Path, ctx: Context) -> None:
    """The exclusion is the watched file, not everything that resolves to it.

    A link is digested by `os.readlink`, which never opens what it points at, so
    it trips nothing. Skipping it because it resolves to the decoy would hand
    back the retargeted link: aim it somewhere else of the same length, put the
    timestamp back, and `lstat` sees no change.
    """
    decoy = seed_decoy(home_dir / DECOY_REL, ctx.state_dir / "decoy.backup")
    link = home_dir / SENSITIVE
    link.parent.mkdir()
    link.symlink_to(decoy)
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}

    before = snapshot([home_dir], **walk)
    assert before.entries[str(link)][2] not in (None, UNHASHED, UNREADABLE)

    # A target of the same length, so `st_size` -- which for a link is the
    # length of that string -- agrees too, and only the digest can tell.
    stamp = link.lstat()
    link.unlink()
    link.symlink_to(str(decoy)[:-1] + "X")
    os.utime(link, ns=(stamp.st_atime_ns, stamp.st_mtime_ns), follow_symlinks=False)
    after = snapshot([home_dir], **walk)
    assert f"~/{SENSITIVE}" in {c["path"] for c in diff_snapshots(before, after, [], home_dir)}


def test_a_fifo_swapped_in_after_the_stat_does_not_hang_the_snapshot(
    home_dir: Path, ctx: Context
) -> None:
    """The walk `lstat`s a name and then opens it, and the command owns the tree.

    A FIFO with no writer blocks a plain open forever, which would hang the
    sensed command and with it the check. Nothing here can force the race, so
    what is pinned is the property that makes it survivable: a FIFO sitting in a
    hashed location is walked without blocking, and is not called a regular file.
    """
    aws = home_dir / ".aws"
    aws.mkdir()
    os.mkfifo(aws / "credentials")
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}
    # The assertion is that this returns at all.
    entry = snapshot([home_dir], **walk).entries[str(aws / "credentials")]
    assert entry[2] is None


def test_a_filename_cannot_smuggle_control_characters(home_dir: Path) -> None:
    # The author chooses the filenames, and the report is read by a language
    # model. An escape sequence in one reaches the prompt as text about a file.
    after = walked({str(home_dir / "a\x1b[31mred"): (1, 1, None)})
    path = diff_snapshots(walked({}), after, [], home_dir)[0]["path"]
    assert "\x1b" not in path
    assert path == "~/a\\x1b[31mred"


def test_a_file_too_large_to_hash_says_so_rather_than_reading_as_checked(
    home_dir: Path, ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A cap that silently turns the comparison off hands the evasion back.

    Over the limit there is no digest on either side, so the comparison is
    metadata again and a restored mtime wins -- which is fine, and is only fine
    because the walk counts those files and the report carries
    `truncated.hashes`. A verdict nobody reached must not read like one that
    came back clean.
    """
    monkeypatch.setattr("cujo_sniff.sensors.fsdiff.HASH_MAX_BYTES", 8)
    big = home_dir / SENSITIVE
    big.parent.mkdir()
    big.write_text("x" * 64)
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}

    snap = snapshot([home_dir], **walk)
    assert snap.entries[str(big)][2] == UNHASHED
    assert snap.uncompared >= 1

    # Distinct from out-of-scope, which is what lets the walk count it at all.
    small = home_dir / "notes.txt"
    small.write_text("x" * 64)
    assert snapshot([home_dir], **walk).entries[str(small)][2] is None

    # And under the cap the digest is taken, so the count goes back to zero.
    monkeypatch.setattr("cujo_sniff.sensors.fsdiff.HASH_MAX_BYTES", 1024)
    hashed = snapshot([home_dir], **walk)
    assert hashed.entries[str(big)][2] not in (None, UNHASHED, UNREADABLE)


def test_a_file_that_grows_after_the_stat_cannot_run_the_hash_forever(
    home_dir: Path, ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The size that let a file past the cap was measured before the open.

    A background process is free to have grown it since, and reading to EOF on
    that promise is an unbounded read of a file the command controls -- the
    snapshot never finishing, and the check with it. The cap is enforced on
    what was actually read.
    """
    monkeypatch.setattr("cujo_sniff.sensors.fsdiff.HASH_MAX_BYTES", 32)
    aws = home_dir / ".aws"
    aws.mkdir()
    grown = aws / "credentials"
    grown.write_text("x" * 1024)
    # lstat would reject this one outright, so force the path where the open
    # succeeds and the read is what discovers the size.
    monkeypatch.setattr("cujo_sniff.sensors.fsdiff.HASH_MAX_BYTES", 32)
    st = grown.lstat()

    class Grown:
        st_mode = st.st_mode
        st_ino = st.st_ino
        st_dev = st.st_dev
        st_size = 8  # what the stale lstat claimed

    assert _digest(grown, Grown()) == UNHASHED


def test_a_walk_that_ends_exactly_on_the_cap_is_a_complete_walk(
    home_dir: Path, ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Returning `truncated` for a tree of exactly the cap made `diff_snapshots`
    # disbelieve creations and deletions it could in fact prove.
    for i in range(3):
        (home_dir / f"f{i}").write_text("x")
    walk = {"state_dir": ctx.state_dir, "home_dir": home_dir}

    # The walk also covers /etc, so the boundary is measured rather than
    # assumed: whatever a complete walk finds is the number the cap is set to.
    complete = snapshot([home_dir], **walk)
    assert complete.truncated is False
    total = len(complete.entries)

    monkeypatch.setattr("cujo_sniff.sensors.fsdiff.MAX_SNAPSHOT_FILES", total)
    exact = snapshot([home_dir], **walk)
    assert len(exact.entries) == total
    assert exact.truncated is False

    monkeypatch.setattr("cujo_sniff.sensors.fsdiff.MAX_SNAPSHOT_FILES", total - 1)
    over = snapshot([home_dir], **walk)
    assert len(over.entries) == total - 1
    assert over.truncated is True


def test_the_digest_must_be_of_the_file_that_was_measured(
    home_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`lstat` and `open` are two lookups, and the command owns what is between.

    Put the innocent file back just long enough to be hashed, restore your own
    afterwards, and the entry pairs a clean digest with the metadata of the file
    that replaced it. Comparing the descriptor's identity against what was
    measured is what closes it; an identity that does not match is not a digest
    to trust, so it is recorded as one that could not be taken.
    """
    aws = home_dir / ".aws"
    aws.mkdir()
    real = aws / "credentials"
    real.write_text("AKIAREALKEY000000001")
    decoy_stat = aws / "other"
    decoy_stat.write_text("AKIASTOLENKEY0000002")

    # A measurement of a *different* file, handed to _digest for this path.
    # UNVERIFIED, not UNREADABLE: the file opened fine, it just was not the one
    # that had been measured, and the two are counted differently.
    other = decoy_stat.lstat()
    assert _digest(real, other) == UNVERIFIED
    # Its own measurement still hashes.
    assert _digest(real, real.lstat()) not in (None, UNHASHED, UNREADABLE)


def test_two_files_nobody_could_read_are_not_two_files_that_agree(
    home_dir: Path,
) -> None:
    """Neither side has a digest, so nothing was compared -- and saying so is the
    only honest answer available.

    Reporting it as changed instead would be a `wrote_sensitive` critical on
    `/etc/shadow` on every check of every repository, since plenty of `/etc` is
    root-owned and unreadable from one run to the next. Reporting it as verified
    would be the lie. It falls back to metadata, and the walk counts the file so
    `truncated.hashes` says the comparison was partial.
    """
    creds = str(home_dir / ".aws" / "credentials")
    unreadable_before = Snapshot({creds: (1, 1, UNREADABLE)}, truncated=False, uncompared=1)
    unreadable_after = Snapshot({creds: (1, 1, UNREADABLE)}, truncated=False, uncompared=1)
    assert diff_snapshots(unreadable_before, unreadable_after, [], home_dir) == []

    # One-sided is the case that *is* observable, and it is a change: readable
    # before and not now, or hashed before and swapped since.
    hashed = Snapshot({creds: (1, 1, "aaa")}, truncated=False)
    assert [c["type"] for c in diff_snapshots(hashed, unreadable_after, [], home_dir)] == [
        "modified"
    ]
    assert [c["type"] for c in diff_snapshots(unreadable_before, hashed, [], home_dir)] == [
        "modified"
    ]
    # And a size cap on one side against a real digest on the other, likewise.
    capped = Snapshot({creds: (1, 1, UNHASHED)}, truncated=False, uncompared=1)
    assert [c["type"] for c in diff_snapshots(hashed, capped, [], home_dir)] == ["modified"]
    # But the two no-digest reasons do not disagree with each other.
    assert diff_snapshots(capped, unreadable_after, [], home_dir) == []
