"""The detonation check, from source detection to a real install."""

from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

import pytest

from cujo_sniff.detonate import detect_source
from tests.conftest import Cli


def test_detect_source() -> None:
    assert detect_source("humanize==4.9.0") == "pypi"
    assert detect_source("git+https://github.com/x/y") == "pypi"
    assert detect_source("left-pad@1.3.0") == "npm"
    assert detect_source("@scope/pkg@2.0.0") == "npm"
    assert detect_source("npm:lodash") == "npm"


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
    return importlib.util.find_spec("ensurepip") is not None or shutil.which("uv") is not None


@pytest.mark.slow
@pytest.mark.skipif(not _can_detonate(), reason="detonate needs venv+pip or uv")
def test_detonate_local_package_sees_the_payload(tmp_path: Path, cli: Cli, home_dir: Path) -> None:
    """The demo path: an install-time payload that reads the decoy and drops a file."""
    pkg = tmp_path / "sample"
    pkg.mkdir()
    (pkg / "setup.py").write_text(SETUP_PY)
    (pkg / "cujo_demo_sample.py").write_text("VALUE = 1\n")
    cli(["setup", "--proxy-port", "0"])
    try:
        proc = cli.raw(
            ["detonate", "--dependency", str(pkg), "--source", "pypi"],
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
        cli(["teardown"])
