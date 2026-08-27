import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import sniff

SNIFF = Path(sniff.__file__).resolve()


@pytest.fixture
def home_dir(tmp_path: Path) -> Path:
    h = tmp_path / "home"
    h.mkdir()
    return h


def test_sensitive_paths(home_dir: Path) -> None:
    assert sniff.is_sensitive(str(home_dir / ".ssh" / "id_rsa"), home_dir)
    assert sniff.is_sensitive(str(home_dir / ".aws" / "credentials"), home_dir)
    assert sniff.is_sensitive(str(home_dir / ".bashrc"), home_dir)
    assert sniff.is_sensitive(str(home_dir / ".config" / "gcloud" / "x"), home_dir)
    assert sniff.is_sensitive("/etc/cron.d/job", home_dir)
    assert not sniff.is_sensitive(str(home_dir / "project" / "app.py"), home_dir)
    assert not sniff.is_sensitive(str(home_dir / ".cache" / "pip" / "x"), home_dir)


def test_diff_snapshots_flags_workspace_and_sensitive(home_dir: Path) -> None:
    ws = home_dir / "work"
    before = {str(ws / "a.py"): (1, 1), str(home_dir / "keep"): (1, 1)}
    after = {
        str(ws / "a.py"): (2, 1),
        str(ws / "b.py"): (1, 1),
        str(home_dir / "keep"): (1, 1),
        str(home_dir / ".ssh" / "authorized_keys"): (1, 1),
        str(home_dir / ".cache" / "pip" / "wheel"): (1, 1),
    }
    changes = {c["path"]: c for c in sniff.diff_snapshots(before, after, [ws], home_dir)}
    assert changes["~/work/a.py"]["type"] == "modified"
    assert changes["~/work/b.py"]["type"] == "created"
    assert changes["~/work/b.py"]["in_workspace"] is True
    assert changes["~/.ssh/authorized_keys"]["sensitive"] is True
    assert changes["~/.ssh/authorized_keys"]["in_workspace"] is False
    assert changes["~/.cache/pip/wheel"]["sensitive"] is False
    assert "~/keep" not in changes


def _block(home_dir: Path, **overrides):
    base = {
        "proxy_rows": [],
        "audit_rows": [],
        "decoy_rows": [],
        "fs_changes": [],
        "allow_hosts": [],
        "check": "tests",
        "home_dir": home_dir,
    }
    base.update(overrides)
    return sniff.build_sensor_block(**base)


def test_clean_block_has_no_derived_signal(home_dir: Path) -> None:
    block = _block(home_dir)
    assert block["secret_probe"] == {"decoy_read": False, "decoy_in_egress": False}
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
    block = _block(home_dir, proxy_rows=rows, check="detonation")
    assert {"host": "pypi.org", "port": 443, "bytes": 150} in block["egress"]
    assert block["derived"]["egress_to_unknown_host"] is True
    allowed = _block(home_dir, proxy_rows=rows, allow_hosts=["evil.example"])
    assert allowed["derived"]["egress_to_unknown_host"] is False


def test_decoy_read_from_watcher_or_audit(home_dir: Path) -> None:
    decoy = str(home_dir / ".aws" / "credentials")
    via_watcher = _block(home_dir, decoy_rows=[{"event": "open"}])
    assert via_watcher["secret_probe"]["decoy_read"] is True
    via_audit = _block(home_dir, audit_rows=[{"event": "open", "path": decoy, "mode": "r"}])
    assert via_audit["secret_probe"]["decoy_read"] is True
    assert via_audit["files_read"] == [{"path": "~/.aws/credentials", "sensitive": True}]
    only_watching = _block(home_dir, decoy_rows=[{"event": "watching"}])
    assert only_watching["secret_probe"]["decoy_read"] is False


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


def test_detect_source() -> None:
    assert sniff.detect_source("humanize==4.9.0") == "pypi"
    assert sniff.detect_source("git+https://github.com/x/y") == "pypi"
    assert sniff.detect_source("left-pad@1.3.0") == "npm"
    assert sniff.detect_source("@scope/pkg@2.0.0") == "npm"
    assert sniff.detect_source("npm:lodash") == "npm"


def _run(args: list[str], env: dict[str, str]) -> dict:
    proc = subprocess.run(
        [sys.executable, str(SNIFF), *args], env=env, capture_output=True, text=True, check=True
    )
    return json.loads(proc.stdout)


def test_setup_then_run_sees_decoy_read(tmp_path: Path, home_dir: Path) -> None:
    env = {**os.environ, "HOME": str(home_dir), "CUJO_DIR": str(tmp_path / "cujo")}
    env.pop("PYTHONPATH", None)
    setup = _run(["setup", "--proxy-port", "0", "--allow-host", "api.example"], env)
    try:
        assert setup["ok"] is True
        decoy = Path(setup["decoy"])
        assert decoy.read_text().startswith("[default]")
        assert setup["env"]["HTTPS_PROXY"].startswith("http://127.0.0.1:")
        assert setup["env"]["PYTHONPATH"].endswith("pyhook")

        script = f"open({str(decoy)!r}).read(); open('touched.txt', 'w').write('x')"
        report = _run(
            ["run", "--check", "tests", "--cwd", str(home_dir), "--", sys.executable, "-c", script],
            env,
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
        _run(["teardown"], env)
