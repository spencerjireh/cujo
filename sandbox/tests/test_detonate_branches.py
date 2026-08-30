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
from typing import Any
from unittest.mock import patch

import pytest

from cujo_sniff.context import Context
from cujo_sniff.detonate import (
    _gem_install_cmds,
    _go_download_cmds,
    _pypi_install_cmds,
    cmd_detonate,
    detect_source,
)


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


def test_detect_source_go_prefixed() -> None:
    assert detect_source("go:github.com/go-chi/chi/v5") == "go"


def test_detect_source_go_prefixed_with_version() -> None:
    assert detect_source("go:golang.org/x/text@v0.16.0") == "go"


def test_detect_source_gem_prefixed() -> None:
    assert detect_source("gem:nokogiri") == "gem"


def test_detect_source_slash_without_prefix_is_pypi() -> None:
    """A path with a slash but no go: prefix falls through to pypi."""
    assert detect_source("github.com/x/y") == "pypi"


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


def test_go_download_cmds_creates_throwaway_module(tmp_path: Path) -> None:
    env_dir = tmp_path / "env"
    env_dir.mkdir()
    cmds = _go_download_cmds(env_dir, "github.com/go-chi/chi/v5")
    assert len(cmds) == 2
    assert cmds[0] == ["go", "get", "github.com/go-chi/chi/v5@latest"]
    assert cmds[1] == ["go", "mod", "download"]
    assert (env_dir / "mod" / "go.mod").exists()


def test_go_download_cmds_preserves_explicit_version(tmp_path: Path) -> None:
    env_dir = tmp_path / "env"
    env_dir.mkdir()
    cmds = _go_download_cmds(env_dir, "golang.org/x/text@v0.16.0")
    assert cmds[0][-1] == "golang.org/x/text@v0.16.0"


def test_gem_install_cmds_isolates_directory(tmp_path: Path) -> None:
    env_dir = tmp_path / "env"
    env_dir.mkdir()
    cmds = _gem_install_cmds(env_dir, "nokogiri")
    assert len(cmds) == 1
    assert cmds[0][0] == "gem"
    assert "install" in cmds[0]
    assert "nokogiri" in cmds[0]
    assert "--install-dir" in cmds[0]
    assert str(env_dir) in cmds[0]
    assert "--no-document" in cmds[0]


def test_cmd_detonate_go_uses_get_and_download(ctx: Context, tmp_path: Path) -> None:
    """Go detonation uses go get + go mod download in a throwaway module."""
    args = argparse.Namespace(dependency="go:github.com/go-chi/chi/v5", source="auto")

    calls: list[list[str]] = []

    def fake_run_sensed(_ctx: Any, argv: list[str], **_kw: Any) -> dict[str, Any]:
        calls.append(argv)
        return {
            "exit": 0,
            "argv": argv,
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

    with patch("cujo_sniff.detonate.run_sensed", side_effect=fake_run_sensed):
        result = cmd_detonate(ctx, args)

    assert result["source"] == "go"
    assert result["dependency"] == "github.com/go-chi/chi/v5"
    assert len(calls) == 2
    assert calls[0][0] == "go" and "get" in calls[0]
    assert calls[1] == ["go", "mod", "download"]


def test_cmd_detonate_gem_constructs_correct_command(ctx: Context) -> None:
    """Gem branch builds the right install command."""
    args = argparse.Namespace(dependency="gem:nokogiri", source="auto")

    with patch("cujo_sniff.detonate.run_sensed") as mock_run:
        mock_run.return_value = {
            "exit": 0,
            "argv": ["gem", "install", "nokogiri", "--install-dir", "/tmp", "--no-document"],
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

    assert result["source"] == "gem"
    assert result["dependency"] == "nokogiri"
    call_args = mock_run.call_args
    argv = call_args[0][1]
    assert argv[0] == "gem"
    assert "install" in argv
    assert "nokogiri" in argv


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
