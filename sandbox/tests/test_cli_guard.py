"""The top-level exception guard in cli.main().

A crash in any operator command must produce valid JSON on stdout so the
trusted side can parse the failure rather than reading an empty stream or
a Python traceback as "no report", and must exit non-zero so callers
using check=True see a failure.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from cujo_sniff.cli import main
from cujo_sniff.policy import SCHEMA_VERSION


def test_unhandled_exception_produces_json_error_and_exits_nonzero(capsys) -> None:
    with patch("cujo_sniff.cli.cmd_setup", side_effect=RuntimeError("disk full")):
        with pytest.raises(SystemExit) as exc_info:
            main(["setup", "--proxy-port", "0"])
    assert exc_info.value.code == 1
    out = capsys.readouterr().out
    result = json.loads(out)
    assert result["ok"] is False
    assert "RuntimeError" in result["error"]
    assert "disk full" in result["error"]
    assert result["schema_version"] == SCHEMA_VERSION
    assert "traceback" in result


def test_crash_output_is_scrubbed_and_bounded(capsys) -> None:
    evil = "bad\x1b[2J" + "A" * 5000
    with patch("cujo_sniff.cli.cmd_setup", side_effect=ValueError(evil)):
        with pytest.raises(SystemExit):
            main(["setup", "--proxy-port", "0"])
    out = capsys.readouterr().out
    result = json.loads(out)
    assert "\x1b" not in result["error"]
    assert "\\x1b" in result["error"]
    assert len(result["error"]) <= 2000
    assert len(result["traceback"]) <= 4000


def test_keyboard_interrupt_is_not_caught() -> None:
    """KeyboardInterrupt is not an Exception; it should propagate."""
    with patch("cujo_sniff.cli.cmd_setup", side_effect=KeyboardInterrupt):
        with pytest.raises(KeyboardInterrupt):
            main(["setup", "--proxy-port", "0"])
