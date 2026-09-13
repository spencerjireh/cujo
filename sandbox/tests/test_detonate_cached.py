"""`sniff.py detonate --cached` and the `resolved` field (decision 145).

The cache file is what the parent wrote from its brief; an entry matched on
`(source, dependency)` is recorded as this run's without an install, marked
with where it came from. A specifier the file lacks exits non-zero with
nothing recorded, so the caller detonates it the ordinary way. `resolved` is
read best effort after a real install and is `None` on any doubt.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from cujo_sniff.cli import cmd_report
from cujo_sniff.context import Context, state_paths
from cujo_sniff.detonate import _name_of, _resolve, cmd_detonate
from cujo_sniff.run_ledger import read_runs

REPORT: dict[str, Any] = {
    "schema_version": 1,
    "dependency": "humanize==4.9.0",
    "source": "pypi",
    "install_ok": True,
    "duration_s": 3.2,
    "window_exclusive": True,
    "subprocesses": [],
    "stdout_tail": "Successfully installed humanize-4.9.0",
    "stderr_tail": "",
    "resolved": "humanize==4.9.0",
    "egress": [{"host": "pypi.org", "port": 443, "known": True}],
    "files_read": [],
    "fs_changes": [],
    "secret_probe": {"decoy_read": False, "decoy_in_egress": False},
    "derived": {
        "egress_to_unknown_host": False,
        "wrote_outside_workspace": False,
        "wrote_sensitive": False,
        "spawned_subprocess": False,
    },
    "sensors": {},
    "truncated": {},
}


def _cache_file(ctx: Context, entries: list[dict[str, Any]]) -> Path:
    path = state_paths(ctx)["detonation_cache"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries))
    return path


def _args(cached: Path, dependency: str = "humanize==4.9.0") -> argparse.Namespace:
    return argparse.Namespace(dependency=dependency, source="pypi", cached=str(cached))


def test_cached_entry_is_recorded_without_installing(ctx: Context) -> None:
    path = _cache_file(
        ctx,
        [
            {
                "dependency": "humanize==4.9.0",
                "source": "pypi",
                "run_id": "run-earlier",
                "cached_at": "2026-09-10T00:00:00.000Z",
                "report": REPORT,
            }
        ],
    )
    with patch("cujo_sniff.detonate.run_sensed") as run_sensed:
        entry = cmd_detonate(ctx, _args(path))
    run_sensed.assert_not_called()
    assert entry["cached_from_run"] == "run-earlier"
    assert entry["cached_at"] == "2026-09-10T00:00:00.000Z"
    recorded = read_runs(ctx, "detonation")
    assert len(recorded) == 1
    assert recorded[0]["dependency"] == "humanize==4.9.0"
    assert recorded[0]["cached_from_run"] == "run-earlier"


def test_cached_keeps_the_report_verbatim(ctx: Context) -> None:
    path = _cache_file(
        ctx, [{"dependency": "humanize==4.9.0", "source": "pypi", "run_id": None, "report": REPORT}]
    )
    entry = cmd_detonate(ctx, _args(path))
    for key, value in REPORT.items():
        assert entry[key] == value
    assert entry["cached_from_run"] is None


def test_cached_refuses_a_specifier_the_file_lacks(ctx: Context) -> None:
    path = _cache_file(
        ctx, [{"dependency": "rich==13.0.0", "source": "pypi", "run_id": None, "report": REPORT}]
    )
    with patch("cujo_sniff.detonate.run_sensed") as run_sensed:
        with pytest.raises(SystemExit, match="not in"):
            cmd_detonate(ctx, _args(path))
    run_sensed.assert_not_called()
    assert read_runs(ctx, "detonation") == []


def test_cached_matches_on_source_too(ctx: Context) -> None:
    path = _cache_file(
        ctx, [{"dependency": "humanize==4.9.0", "source": "npm", "run_id": None, "report": REPORT}]
    )
    with pytest.raises(SystemExit, match="not in"):
        cmd_detonate(ctx, _args(path))


def test_cached_refuses_a_file_that_is_not_an_array(ctx: Context) -> None:
    path = state_paths(ctx)["detonation_cache"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}")
    with pytest.raises(SystemExit, match="not a JSON array"):
        cmd_detonate(ctx, _args(path))


def test_cached_report_assembles_with_the_envelope(ctx: Context) -> None:
    path = _cache_file(
        ctx,
        [{"dependency": "humanize==4.9.0", "source": "pypi", "run_id": "r", "report": REPORT}],
    )
    cmd_detonate(ctx, _args(path))
    envelope = cmd_report(ctx, argparse.Namespace(check="detonation", extra=None))
    assert envelope["check"] == "detonation"
    assert [r["dependency"] for r in envelope["runs"]] == ["humanize==4.9.0"]
    assert envelope["runs"][0]["cached_from_run"] == "r"


def test_name_of_each_source() -> None:
    assert _name_of("pypi", "Requests-Toolbelt[socks]==1.0.0") == "Requests-Toolbelt"
    assert _name_of("npm", "@scope/pkg@2.0.0") == "@scope/pkg"
    assert _name_of("go", "github.com/pkg/errors@v0.9.1") == "github.com/pkg/errors"
    assert _name_of("gem", "rack:3.0.8") == "rack"


def test_resolved_from_pip_stdout(tmp_path: Path) -> None:
    out = "Collecting humanize\nSuccessfully installed humanize-4.9.0 six-1.16.0"
    assert _resolve("pypi", "humanize", tmp_path, out) == "humanize==4.9.0"


def test_resolved_from_uv_stdout(tmp_path: Path) -> None:
    out = "Resolved 1 package\nInstalled 1 package\n + humanize==4.9.0"
    assert _resolve("pypi", "humanize==4.9.0", tmp_path, out) == "humanize==4.9.0"


def test_resolved_falls_back_to_pip_show(tmp_path: Path) -> None:
    def fake_run(argv: list[str], **_kw: Any) -> subprocess.CompletedProcess[str]:
        assert argv[-2:] == ["show", "humanize"]
        return subprocess.CompletedProcess(
            argv, 0, stdout="Name: humanize\nVersion: 4.9.0\n", stderr=""
        )

    with patch("cujo_sniff.detonate.subprocess.run", side_effect=fake_run):
        assert _resolve("pypi", "humanize", tmp_path, "") == "humanize==4.9.0"


def test_resolved_from_npm_ls_json(tmp_path: Path) -> None:
    def fake_run(argv: list[str], **_kw: Any) -> subprocess.CompletedProcess[str]:
        assert argv[:2] == ["npm", "ls"]
        body = json.dumps({"dependencies": {"left-pad": {"version": "1.3.0"}}})
        return subprocess.CompletedProcess(argv, 0, stdout=body, stderr="")

    with patch("cujo_sniff.detonate.subprocess.run", side_effect=fake_run):
        assert _resolve("npm", "left-pad@^1", tmp_path, "") == "left-pad@1.3.0"


def test_resolved_from_gem_stdout(tmp_path: Path) -> None:
    out = "Fetching rack-3.0.8.gem\nSuccessfully installed rack-3.0.8\n1 gem installed"
    assert _resolve("gem", "rack", tmp_path, out) == "rack:3.0.8"


def test_resolved_from_throwaway_go_mod(tmp_path: Path) -> None:
    mod = tmp_path / "mod"
    mod.mkdir()
    (mod / "go.mod").write_text(
        "module cujo_detonate\n\ngo 1.21\n\nrequire github.com/pkg/errors v0.9.1 // indirect\n"
    )
    assert _resolve("go", "github.com/pkg/errors", tmp_path, "") == "github.com/pkg/errors@v0.9.1"


def test_resolved_is_none_when_the_query_errors(tmp_path: Path) -> None:
    with patch("cujo_sniff.detonate.subprocess.run", side_effect=OSError("no npm")):
        assert _resolve("npm", "left-pad@1.3.0", tmp_path, "") is None
    assert _resolve("go", "github.com/pkg/errors", tmp_path, "") is None


def test_resolved_is_none_when_install_failed(ctx: Context) -> None:
    args = argparse.Namespace(dependency="gem:nokogiri", source="auto", cached=None)
    with patch("cujo_sniff.detonate.run_sensed") as run_sensed:
        run_sensed.return_value = {
            "exit": 1,
            "argv": ["gem", "install", "nokogiri"],
            "duration_s": 1.0,
            "window_exclusive": True,
            "stdout_tail": "Successfully installed nokogiri-1.0.0",
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
        entry = cmd_detonate(ctx, args)
    assert entry["install_ok"] is False
    assert entry["resolved"] is None
