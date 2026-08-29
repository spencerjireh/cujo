"""Folding sensor rows into the block, and the `derived` booleans it sets."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from cujo_sniff.policy import DECOY_KEY
from cujo_sniff.report import build_sensor_block, health, merge_egress, merge_reports

ARMED = {"proxy": health(True, "port 8899"), "decoy": health(True, "inotify")}
NOT_TRUNCATED = {"stdout_tail": False, "stderr_tail": False, "snapshot": False}


def _block(home_dir: Path, **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "proxy_rows": [],
        "audit_rows": [],
        "decoy_rows": [],
        "fs_changes": [],
        "allow_hosts": [],
        "check": "tests",
        "sensors": dict(ARMED),
        "truncated": dict(NOT_TRUNCATED),
        "home_dir": home_dir,
    }
    base.update(overrides)
    return build_sensor_block(**base)


def test_clean_block_has_no_derived_signal(home_dir: Path) -> None:
    block = _block(home_dir)
    assert block["secret_probe"] == {"decoy_read": False, "decoy_in_egress": None}
    assert block["derived"] == {
        "egress_to_unknown_host": False,
        "wrote_outside_workspace": False,
        "wrote_sensitive": False,
        "spawned_subprocess": False,
    }


def test_egress_merges_and_classifies_unknown_hosts(home_dir: Path) -> None:
    rows = [
        {"host": "pypi.org", "port": 443, "bytes": 100},
        {"host": "pypi.org", "port": 443, "bytes": 50},
        {"host": "evil.example", "port": 443, "bytes": 9},
    ]
    assert merge_egress(rows) == [
        {"host": "evil.example", "port": 443, "bytes": 9},
        {"host": "pypi.org", "port": 443, "bytes": 150},
    ]
    block = _block(home_dir, proxy_rows=rows, check="detonation")
    assert {"host": "pypi.org", "port": 443, "bytes": 150, "known": True} in block["egress"]
    assert {"host": "evil.example", "port": 443, "bytes": 9, "known": False} in block["egress"]
    assert block["derived"]["egress_to_unknown_host"] is True
    allowed = _block(home_dir, proxy_rows=rows, allow_hosts=["evil.example"])
    assert allowed["derived"]["egress_to_unknown_host"] is False


def test_loopback_connects_are_not_egress(home_dir: Path) -> None:
    # A connect to the proxy itself is the sensor working, not a signal.
    block = _block(
        home_dir,
        audit_rows=[
            {"event": "connect", "host": "127.0.0.1", "port": 8899},
            {"event": "connect", "host": "::1", "port": 8899},
            {"event": "connect", "host": "evil.example", "port": 443},
        ],
    )
    assert [e["host"] for e in block["egress"]] == ["evil.example"]


def test_noise_reads_are_dropped_from_files_read(home_dir: Path) -> None:
    decoy = str(home_dir / ".aws" / "credentials")
    block = _block(
        home_dir,
        audit_rows=[
            {"event": "open", "path": "/usr/lib/python3/os.py", "mode": "r"},
            {"event": "open", "path": decoy, "mode": "r"},
            {"event": "open", "path": str(home_dir / "work" / "app.py"), "mode": "r"},
        ],
    )
    assert [f["path"] for f in block["files_read"]] == ["~/.aws/credentials", "~/work/app.py"]


def test_a_relative_read_is_resolved_against_the_commands_cwd(home_dir: Path) -> None:
    relative = _block(
        home_dir,
        cwd=home_dir,
        audit_rows=[{"event": "open", "path": ".ssh/plugin.so", "mode": "r"}],
    )
    assert relative["files_read"] == [{"path": "~/.ssh/plugin.so", "sensitive": True}]


def test_writes_and_duplicates_never_reach_files_read(home_dir: Path) -> None:
    app = str(home_dir / "work" / "app.py")
    block = _block(
        home_dir,
        audit_rows=[
            {"event": "open", "path": str(home_dir / "out.txt"), "mode": "w"},
            {"event": "open", "path": app, "mode": "r"},
            {"event": "open", "path": app, "mode": "rb"},
        ],
    )
    assert block["files_read"] == [{"path": "~/work/app.py", "sensitive": False}]


def test_decoy_read_from_watcher_or_audit(home_dir: Path) -> None:
    decoy = str(home_dir / ".aws" / "credentials")
    via_watcher = _block(home_dir, decoy_rows=[{"event": "open"}])
    assert via_watcher["secret_probe"]["decoy_read"] is True
    via_audit = _block(home_dir, audit_rows=[{"event": "open", "path": decoy, "mode": "r"}])
    assert via_audit["secret_probe"]["decoy_read"] is True
    assert via_audit["files_read"] == [{"path": "~/.aws/credentials", "sensitive": True}]
    only_watching = _block(home_dir, decoy_rows=[{"event": "watching"}])
    assert only_watching["secret_probe"]["decoy_read"] is False


def test_decoy_is_recognised_by_either_spelling(tmp_path: Path, home_dir: Path) -> None:
    # setup seeds the decoy under one name; the audit hook reports whichever
    # name the program opened.
    alias = tmp_path / "home-link"
    alias.symlink_to(home_dir)
    (home_dir / ".aws").mkdir()
    (home_dir / ".aws" / "credentials").write_text(DECOY_KEY)
    for spelling in (alias / ".aws" / "credentials", home_dir / ".aws" / "credentials"):
        block = _block(
            alias,
            audit_rows=[{"event": "open", "path": str(spelling), "mode": "r"}],
        )
        assert block["secret_probe"]["decoy_read"] is True, spelling


def test_wrote_sensitive_and_subprocesses(home_dir: Path) -> None:
    changes = [
        {
            "path": "~/.ssh/authorized_keys",
            "type": "created",
            "in_workspace": False,
            "sensitive": True,
        }
    ]
    block = _block(
        home_dir,
        fs_changes=changes,
        audit_rows=[{"event": "subprocess", "argv": ["curl", "x"]}],
    )
    assert block["derived"]["wrote_sensitive"] is True
    assert block["derived"]["wrote_outside_workspace"] is True
    assert block["derived"]["spawned_subprocess"] is True
    assert block["subprocesses"] == [{"argv": ["curl", "x"]}]
    # An install's own pip process is expected; only a second spawn counts.
    install = _block(
        home_dir, check="detonation", audit_rows=[{"event": "subprocess", "argv": ["pip"]}]
    )
    assert install["derived"]["spawned_subprocess"] is False


def test_merge_reports_unions_the_blocks_and_ors_the_signals(home_dir: Path) -> None:
    quiet = _block(home_dir, audit_rows=[{"event": "open", "path": "/etc/hosts", "mode": "r"}])
    loud = _block(
        home_dir,
        proxy_rows=[{"host": "evil.example", "port": 443, "bytes": 9}],
        decoy_rows=[{"event": "access"}],
    )
    merged = merge_reports([quiet, loud])
    assert [f["path"] for f in merged["files_read"]] == ["/etc/hosts"]
    assert [e["host"] for e in merged["egress"]] == ["evil.example"]
    assert merged["secret_probe"] == {"decoy_read": True, "decoy_in_egress": None}
    assert merged["derived"]["egress_to_unknown_host"] is True
    assert merged["derived"]["wrote_sensitive"] is False
