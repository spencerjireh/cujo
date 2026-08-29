"""Tests for detonate.py branches not covered by the slow integration test.

The slow test in test_detonate.py exercises the pypi+ensurepip path end-to-end.
These tests cover:
- detect_source classification for edge cases
- npm command construction
- uv fallback when ensurepip is unavailable
- SystemExit when neither ensurepip nor uv is available
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from cujo_sniff.context import Context
from cujo_sniff.detonate import _pypi_install_cmds, cmd_detonate, detect_source


def test_detect_source_npm_prefixed() -> None:
    assert detect_source("npm:lodash") == "npm"


def test_detect_source_scoped_npm() -> None:
    assert detect_source("@angular/core@16.0.0") == "npm"


def test_detect_source_simple_npm() -> None:
    assert detect_source("left-pad@1.3.0") == "npm"


def test_detect_source_pypi_default() -> None:
    assert detect_source("requests==2.31.0") == "pypi"


def test_detect_source_git_url_is_pypi() -> None:
    assert detect_source("git+https://github.com/x/y@main") == "pypi"


def test_detect_source_bare_name_is_pypi() -> None:
    assert detect_source("humanize") == "pypi"


def test_pypi_install_cmds_uses_venv_when_ensurepip_available(ctx: Context, tmp_path: Path) -> None:
    env_dir = tmp_path / "env"
    env_dir.mkdir()
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0)
        cmds = _pypi_install_cmds(ctx, env_dir, "requests==2.31.0")
    assert len(cmds) == 2
    assert "-m" in cmds[0] and "venv" in cmds[0]
    assert "-m" in cmds[1] and "pip" in cmds[1]
    assert "requests==2.31.0" in cmds[1]


def test_pypi_install_cmds_falls_back_to_uv(ctx: Context, tmp_path: Path) -> None:
    env_dir = tmp_path / "env"
    env_dir.mkdir()
    with (
        patch("subprocess.run") as mock_run,
        patch("shutil.which", return_value="/usr/bin/uv"),
    ):
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=1)
        cmds = _pypi_install_cmds(ctx, env_dir, "requests==2.31.0")
    assert len(cmds) == 2
    assert cmds[0][0] == "/usr/bin/uv"
    assert "venv" in cmds[0]
    assert cmds[1][0] == "/usr/bin/uv"
    assert "pip" in cmds[1]
    assert "requests==2.31.0" in cmds[1]


def test_pypi_install_cmds_raises_when_neither_available(ctx: Context, tmp_path: Path) -> None:
    env_dir = tmp_path / "env"
    env_dir.mkdir()
    with (
        patch("subprocess.run") as mock_run,
        patch("shutil.which", return_value=None),
    ):
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=1)
        with pytest.raises(SystemExit, match="neither ensurepip nor uv"):
            _pypi_install_cmds(ctx, env_dir, "requests==2.31.0")


def test_cmd_detonate_npm_constructs_correct_command(ctx: Context, tmp_path: Path) -> None:
    """npm branch builds the right install command without venv."""
    args = argparse.Namespace(dependency="npm:left-pad", source="auto")

    with patch("cujo_sniff.detonate.run_sensed") as mock_run:
        mock_run.return_value = {
            "exit": 0,
            "argv": ["npm", "install", "--prefix", "/tmp", "left-pad"],
            "duration_s": 1.0,
            "window_exclusive": True,
            "stdout_tail": "",
            "stderr_tail": "",
            "schema_version": 1,
            "egress": [],
            "files_read": [],
            "fs_changes": [],
            "subprocesses": [],
            "secret_probe": {"decoy_read": False, "sensitive_read": False},
            "derived": {},
            "sensors": {},
            "truncated": {},
        }
        result = cmd_detonate(ctx, args)

    assert result["source"] == "npm"
    assert result["dependency"] == "left-pad"
    call_args = mock_run.call_args
    argv = call_args[0][1]
    assert argv[0] == "npm"
    assert "install" in argv
    assert "left-pad" in argv
    assert "--no-audit" in argv
    assert "--no-fund" in argv
