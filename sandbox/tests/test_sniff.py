import importlib.util
import json
import os
import socket
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


def test_noise_reads_are_dropped_but_sensitive_reads_never(home_dir: Path) -> None:
    assert sniff.is_noise_read("/usr/local/lib/python3.13/site-packages/pytest/__init__.py")
    assert sniff.is_noise_read("/usr/local/lib/python3.13/__pycache__/ast.cpython-313.pyc")
    assert sniff.is_noise_read(f"{sys.prefix}/lib/python3.12/os.py")
    assert sniff.is_noise_read("/work/head/node_modules/left-pad/index.js")
    assert not sniff.is_noise_read(str(home_dir / "work" / "app" / "orders.py"))
    assert not sniff.is_noise_read("/etc/passwd")
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
    # A shared object outside the interpreter tree is a real read, and
    # /usr/libexec is not /usr/lib.
    assert not sniff.is_noise_read(str(home_dir / "work" / "native.so"))
    assert not sniff.is_noise_read("/usr/libexec/git-core/git")
    # A relative path is resolved against the audited command's cwd, so a
    # sensitive read from $HOME keeps its flag and is never dropped.
    relative = _block(
        home_dir,
        cwd=home_dir,
        audit_rows=[{"event": "open", "path": ".ssh/plugin.so", "mode": "r"}],
    )
    assert relative["files_read"] == [{"path": "~/.ssh/plugin.so", "sensitive": True}]


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
    assert {"host": "pypi.org", "port": 443, "bytes": 150, "known": True} in block["egress"]
    assert {"host": "evil.example", "port": 443, "bytes": 9, "known": False} in block["egress"]
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


def test_diff_snapshots_reports_deletions(home_dir: Path) -> None:
    ws = home_dir / "work"
    before = {
        str(ws / "gone.py"): (1, 1),
        str(home_dir / ".ssh" / "id_rsa"): (1, 1),
        str(home_dir / "keep"): (1, 1),
    }
    after = {str(home_dir / "keep"): (1, 1)}
    changes = {c["path"]: c for c in sniff.diff_snapshots(before, after, [ws], home_dir)}
    assert changes["~/work/gone.py"] == {
        "path": "~/work/gone.py",
        "type": "deleted",
        "in_workspace": True,
        "sensitive": False,
    }
    assert changes["~/.ssh/id_rsa"]["type"] == "deleted"
    assert changes["~/.ssh/id_rsa"]["sensitive"] is True
    block = sniff.build_sensor_block(
        proxy_rows=[],
        audit_rows=[],
        decoy_rows=[],
        fs_changes=list(changes.values()),
        allow_hosts=[],
        check="tests",
        home_dir=home_dir,
    )
    assert block["derived"]["wrote_sensitive"] is True
    assert block["derived"]["wrote_outside_workspace"] is True


def test_snapshot_sees_detonation_env_but_not_state_dir(
    tmp_path: Path, home_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state = tmp_path / "cujo"
    envs = tmp_path / "cujo-envs"
    monkeypatch.setattr(sniff, "CUJO_DIR", state)
    monkeypatch.setattr(sniff, "ENVS_DIR", envs)
    monkeypatch.setenv("HOME", str(home_dir))
    env_dir = envs / "abc"
    env_dir.mkdir(parents=True)
    state.mkdir()
    before = sniff.snapshot([env_dir])
    (env_dir / "site-packages.txt").write_text("installed")
    (state / "proxy.jsonl").write_text("noise")
    after = sniff.snapshot([env_dir])
    changes = sniff.diff_snapshots(before, after, [env_dir], home_dir)
    assert sniff.state_paths()["envs"] == envs
    assert [c for c in changes if c["path"].endswith("site-packages.txt")][0]["in_workspace"]
    assert not any("proxy.jsonl" in c["path"] for c in changes)


def test_setup_backs_up_real_credentials_and_teardown_restores(
    tmp_path: Path, home_dir: Path
) -> None:
    env = {**os.environ, "HOME": str(home_dir), "CUJO_DIR": str(tmp_path / "cujo")}
    env.pop("PYTHONPATH", None)
    real = home_dir / ".aws" / "credentials"
    real.parent.mkdir()
    real.write_text("[default]\naws_access_key_id = REAL\n")
    real.chmod(0o640)
    setup = _run(["setup", "--proxy-port", "0"], env)
    try:
        assert setup["ok"] is True
        assert sniff.DECOY_KEY in real.read_text()
        # A second setup must not clobber the backup with the decoy.
        again = _run(["setup", "--proxy-port", "0"], env)
        assert again["ok"] is True
    finally:
        down = _run(["teardown"], env)
    assert down["decoy"] == "restored"
    assert real.read_text() == "[default]\naws_access_key_id = REAL\n"
    assert oct(real.stat().st_mode & 0o777) == "0o640"
    assert not (tmp_path / "cujo" / "decoy.backup").exists()


def test_teardown_removes_decoy_when_nothing_was_there(tmp_path: Path, home_dir: Path) -> None:
    env = {**os.environ, "HOME": str(home_dir), "CUJO_DIR": str(tmp_path / "cujo")}
    _run(["setup", "--proxy-port", "0"], env)
    down = _run(["teardown"], env)
    assert down["decoy"] == "removed"
    assert not (home_dir / ".aws" / "credentials").exists()


def test_setup_twice_stops_the_first_daemons(tmp_path: Path, home_dir: Path) -> None:
    env = {**os.environ, "HOME": str(home_dir), "CUJO_DIR": str(tmp_path / "cujo")}
    pid_file = tmp_path / "cujo" / "proxy.pid"
    first = _run(["setup", "--proxy-port", "0"], env)
    first_pid = int(pid_file.read_text())
    try:
        second = _run(["setup", "--proxy-port", "0"], env)
        second_pid = int(pid_file.read_text())
        assert first["ok"] and second["ok"]
        assert second_pid != first_pid
        assert not sniff._pid_alive(first_pid)
        assert sniff._pid_alive(second_pid)
        # A port held by someone else is reported, not silently reused.
        with socket.socket() as taken:
            taken.bind(("127.0.0.1", 0))
            taken.listen()
            held = _run(["setup", "--proxy-port", str(taken.getsockname()[1])], env)
        assert held["ok"] is False
        assert "held" in held["error"]
    finally:
        _run(["teardown"], env)


SETUP_PY = """
import os
from setuptools import setup

if os.environ.get("CUJO_SANDBOX"):
    try:
        with open(os.path.expanduser("~/.aws/credentials"), "rb") as fh:
            fh.read()
    except OSError:
        pass
    with open(os.path.expanduser("~/.cujo-demo-dropper.txt"), "w") as fh:
        fh.write("demo\\n")

setup(name="cujo-demo-sample", version="0.0.1", py_modules=["cujo_demo_sample"])
"""


def _can_detonate() -> bool:
    return importlib.util.find_spec("ensurepip") is not None or sniff.shutil.which("uv") is not None


@pytest.mark.skipif(not _can_detonate(), reason="detonate needs venv+pip or uv")
def test_detonate_local_package_sees_the_payload(tmp_path: Path, home_dir: Path) -> None:
    """The demo path: an install-time payload that reads the decoy and drops a file."""
    pkg = tmp_path / "sample"
    pkg.mkdir()
    (pkg / "setup.py").write_text(SETUP_PY)
    (pkg / "cujo_demo_sample.py").write_text("VALUE = 1\n")
    env = {
        **os.environ,
        "HOME": str(home_dir),
        "CUJO_DIR": str(tmp_path / "cujo"),
        "CUJO_ENVS_DIR": str(tmp_path / "cujo-envs"),
    }
    env.pop("PYTHONPATH", None)
    _run(["setup", "--proxy-port", "0"], env)
    try:
        proc = subprocess.run(
            [sys.executable, str(SNIFF), "detonate", "--dependency", str(pkg), "--source", "pypi"],
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        report = json.loads(proc.stdout)
        assert report["dependency"] == str(pkg)
        assert report["install_ok"] is True, report["stderr_tail"]
        assert report["secret_probe"]["decoy_read"] is True
        assert report["derived"]["wrote_outside_workspace"] is True
        dropper = [c for c in report["fs_changes"] if c["path"] == "~/.cujo-demo-dropper.txt"]
        assert dropper and dropper[0]["in_workspace"] is False
        assert report["derived"]["wrote_sensitive"] is False
        assert (home_dir / ".cujo-demo-dropper.txt").exists()
    finally:
        _run(["teardown"], env)


def test_sensitive_survives_traversal_and_symlink(tmp_path: Path, home_dir: Path) -> None:
    # The audit hook records a path as the program passed it, so a `..` segment
    # reached ~/.ssh while reading as an ordinary path under /tmp.
    detour = f"/tmp/..{home_dir}/.ssh/id_rsa"
    assert sniff.is_sensitive(detour, home_dir)
    assert sniff.is_sensitive(f"{home_dir}/../{home_dir.name}/.ssh/id_rsa", home_dir)
    assert sniff.is_sensitive(f"{home_dir}/./.aws/credentials", home_dir)
    assert sniff.is_sensitive(f"{home_dir}/project/../.bashrc", home_dir)
    # A link planted inside a sensitive directory is sensitive even though it
    # resolves somewhere dull, which is why both readings are checked.
    (home_dir / ".ssh").mkdir()
    dull = tmp_path / "dull"
    dull.write_text("x")
    link = home_dir / ".ssh" / "authorized_keys"
    link.symlink_to(dull)
    assert sniff.is_sensitive(str(link), home_dir)
    # Traversal that lands somewhere ordinary is still ordinary.
    assert not sniff.is_sensitive(f"{home_dir}/.ssh/../project/app.py", home_dir)


def test_our_own_state_dir_is_noise(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    state = tmp_path / "cujo"
    monkeypatch.setattr(sniff, "CUJO_DIR", state)
    # run_sensed reads these three to build the report, with the audit hook
    # installed in its own process.
    assert sniff.is_noise_read(str(state / "proxy.jsonl"))
    assert sniff.is_noise_read(str(state / "audit.jsonl"))
    assert sniff.is_noise_read(str(state / "pyhook" / "sitecustomize.py"))
    # The detonation environments live beside the state dir, not inside it,
    # and what an install reads there is evidence.
    assert not sniff.is_noise_read(str(tmp_path / "cujo-envs" / "lib" / "payload.py"))


def test_daemon_env_disarms_the_hook_and_the_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUJO_AUDIT_LOG", "/tmp/cujo/audit.jsonl")
    monkeypatch.setenv("CUJO_RUN_ID", "deadbeef")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:8899")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:8899")
    monkeypatch.setenv("PATH", os.environ["PATH"])
    env = sniff._daemon_env()
    for gone in ("CUJO_AUDIT_LOG", "CUJO_RUN_ID", "HTTPS_PROXY", "http_proxy"):
        assert gone not in env
    assert env["PATH"] == os.environ["PATH"]


def test_sensor_env_carries_a_run_id_only_when_sensed() -> None:
    config = {"proxy_port": 8899, "allow_hosts": []}
    assert "CUJO_RUN_ID" not in sniff.sensor_env(config)
    assert sniff.sensor_env(config, "abc123")["CUJO_RUN_ID"] == "abc123"


def test_sensed_window_is_exclusive(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    state = tmp_path / "cujo"
    monkeypatch.setattr(sniff, "CUJO_DIR", state)
    holder = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import fcntl,sys,time;"
            "fh=open(sys.argv[1],'a+');"
            "fcntl.flock(fh, fcntl.LOCK_EX);"
            "print('held', flush=True);"
            "time.sleep(30)",
            str(state / "sensed.lock"),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        state.mkdir(parents=True, exist_ok=True)
        assert holder.stdout is not None
        assert holder.stdout.readline().strip() == "held"
        with sniff.sensed_window(timeout=0.3) as held:
            assert held is False
    finally:
        holder.kill()
        holder.wait()
    # Nothing holds it now, so the next command gets it.
    with sniff.sensed_window(timeout=0.3) as held:
        assert held is True


def test_run_ignores_audit_rows_from_another_window(tmp_path: Path, home_dir: Path) -> None:
    env = {**os.environ, "HOME": str(home_dir), "CUJO_DIR": str(tmp_path / "cujo")}
    env.pop("PYTHONPATH", None)
    _run(["setup", "--proxy-port", "0"], env)
    try:
        # A process the previous check left running keeps appending to the
        # shared audit log. The offsets put those rows inside this window; only
        # the run id says they are not this command's.
        stray = json.dumps(
            {"event": "open", "path": str(home_dir / "stray.txt"), "mode": "r", "run": "not-ours"}
        )
        script = (
            "import os\n"
            f"open(os.environ['CUJO_AUDIT_LOG'], 'a').write({stray!r} + '\\n')\n"
            f"open({str(home_dir / 'mine.txt')!r}, 'w').write('x')\n"
            f"open({str(home_dir / 'mine.txt')!r}).read()\n"
        )
        report = _run(
            [
                "run",
                "--check",
                "probes",
                "--cwd",
                str(home_dir),
                "--",
                sys.executable,
                "-c",
                script,
            ],
            env,
        )
        read = [f["path"] for f in report["files_read"]]
        assert "~/stray.txt" not in read
        assert "~/mine.txt" in read
    finally:
        _run(["teardown"], env)


def test_an_aliased_home_is_still_one_directory(
    tmp_path: Path, home_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # `--cwd` reaches the snapshot resolved and $HOME does not, so a HOME
    # behind a symlink was walked as two directories. Every file got two rows,
    # and because only one of them matched the workspace root, a write inside
    # the workspace set wrote_outside_workspace.
    alias = tmp_path / "home-link"
    alias.symlink_to(home_dir)
    monkeypatch.setenv("HOME", str(alias))
    assert sniff._snapshot_roots([home_dir]) == sniff._snapshot_roots([alias])
    assert sniff._snapshot_roots([home_dir]).count(home_dir) == 1

    after = {str(home_dir / "x.txt"): (1, 1)}
    changes = sniff.diff_snapshots({}, after, [home_dir])
    assert changes == [
        {"path": "~/x.txt", "type": "created", "in_workspace": True, "sensitive": False}
    ]


def test_decoy_is_recognised_by_either_spelling(
    tmp_path: Path, home_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    alias = tmp_path / "home-link"
    alias.symlink_to(home_dir)
    monkeypatch.setenv("HOME", str(alias))
    (home_dir / ".aws").mkdir()
    (home_dir / ".aws" / "credentials").write_text(sniff.DECOY_KEY)
    # setup seeds the decoy under one name; the audit hook reports whichever
    # name the program opened.
    for spelling in (alias / ".aws" / "credentials", home_dir / ".aws" / "credentials"):
        block = sniff.build_sensor_block(
            proxy_rows=[],
            audit_rows=[{"event": "open", "path": str(spelling), "mode": "r"}],
            decoy_rows=[],
            fs_changes=[],
            allow_hosts=[],
            check="tests",
        )
        assert block["secret_probe"]["decoy_read"] is True, spelling
