"""Tests for script content capture in run_sensed.

Exercises capture_script() directly and through run_sensed() integration.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from cujo_sniff.context import Context, state_paths
from cujo_sniff.policy import MAX_SCRIPT_CHARS
from cujo_sniff.runner import capture_script, run_sensed
from cujo_sniff.sensors.pyhook import write_pyhook

# ── Unit tests for capture_script ────────────────────────────────────────────


def test_capture_python_script(tmp_path: Path) -> None:
    """A python3 invocation with a readable script file is captured."""
    script = tmp_path / "probe.py"
    script.write_text("print('hello world')")
    content, truncated = capture_script(["python3", str(script)], tmp_path)
    assert content is not None
    assert "hello world" in content
    assert truncated is False


def test_capture_bash_script(tmp_path: Path) -> None:
    """A bash invocation with a script file is captured."""
    script = tmp_path / "run.sh"
    script.write_text("#!/bin/bash\necho ok")
    content, truncated = capture_script(["bash", str(script)], tmp_path)
    assert content is not None
    assert "echo ok" in content
    assert truncated is False


def test_capture_node_script(tmp_path: Path) -> None:
    """A node invocation with a script file is captured."""
    script = tmp_path / "app.js"
    script.write_text("console.log('hi')")
    content, truncated = capture_script(["node", str(script)], tmp_path)
    assert content is not None
    assert "console.log" in content
    assert truncated is False


def test_capture_skips_flags(tmp_path: Path) -> None:
    """Flags before the script path are correctly skipped."""
    script = tmp_path / "test.py"
    script.write_text("assert True")
    content, truncated = capture_script(["python3", "-u", str(script)], tmp_path)
    assert content is not None
    assert "assert True" in content


def test_capture_returns_none_for_non_interpreter(tmp_path: Path) -> None:
    """Non-interpreter commands return (None, False)."""
    content, truncated = capture_script(["npm", "test"], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_returns_none_for_module_invocation(tmp_path: Path) -> None:
    """python3 -m pytest has no file argument to capture."""
    content, truncated = capture_script(["python3", "-m", "pytest"], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_returns_none_for_short_argv(tmp_path: Path) -> None:
    """A bare interpreter with no args returns (None, False)."""
    content, truncated = capture_script(["python3"], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_returns_none_for_empty_argv(tmp_path: Path) -> None:
    """An empty argv returns (None, False)."""
    content, truncated = capture_script([], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_returns_none_for_missing_file(tmp_path: Path) -> None:
    """A script path that doesn't exist returns (None, False)."""
    content, truncated = capture_script(["python3", str(tmp_path / "nope.py")], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_truncates_large_script(tmp_path: Path) -> None:
    """Scripts larger than MAX_SCRIPT_CHARS are truncated."""
    script = tmp_path / "big.py"
    script.write_text("x" * (MAX_SCRIPT_CHARS + 500))
    content, truncated = capture_script(["python3", str(script)], tmp_path)
    assert content is not None
    assert len(content) <= MAX_SCRIPT_CHARS
    assert truncated is True


def test_capture_scrubs_content(tmp_path: Path) -> None:
    """Content is passed through scrub() to strip control characters."""
    script = tmp_path / "dirty.py"
    script.write_text("print('ok')\x00\x01\x02")
    content, truncated = capture_script(["python3", str(script)], tmp_path)
    assert content is not None
    assert "\x00" not in content


def test_capture_versioned_python(tmp_path: Path) -> None:
    """Versioned Python interpreters (python3.12, etc.) are recognized."""
    script = tmp_path / "probe.py"
    script.write_text("pass")
    content, _ = capture_script(["python3.12", str(script)], tmp_path)
    assert content is not None


def test_capture_sh_interpreter(tmp_path: Path) -> None:
    """sh (not just bash) is a recognized interpreter."""
    script = tmp_path / "run.sh"
    script.write_text("echo hi")
    content, _ = capture_script(["sh", str(script)], tmp_path)
    assert content is not None


def test_capture_ruby_script(tmp_path: Path) -> None:
    """A ruby invocation with a script file is captured."""
    script = tmp_path / "probe.rb"
    script.write_text("puts 'hello'")
    content, truncated = capture_script(["ruby", str(script)], tmp_path)
    assert content is not None
    assert "hello" in content
    assert truncated is False


def test_capture_perl_script(tmp_path: Path) -> None:
    """A perl invocation with a script file is captured."""
    script = tmp_path / "check.pl"
    script.write_text("print 'ok\\n';")
    content, truncated = capture_script(["perl", str(script)], tmp_path)
    assert content is not None
    assert "ok" in content
    assert truncated is False


def test_capture_deno_run_script(tmp_path: Path) -> None:
    """A deno invocation with a script file is captured."""
    script = tmp_path / "app.ts"
    script.write_text("console.log('deno')")
    content, truncated = capture_script(["deno", str(script)], tmp_path)
    assert content is not None
    assert "deno" in content
    assert truncated is False


def test_capture_deno_run_subcommand(tmp_path: Path) -> None:
    """deno run app.ts correctly skips the 'run' subcommand."""
    script = tmp_path / "app.ts"
    script.write_text("console.log('deno-run')")
    content, truncated = capture_script(["deno", "run", str(script)], tmp_path)
    assert content is not None
    assert "deno-run" in content
    assert truncated is False


def test_capture_bun_script(tmp_path: Path) -> None:
    """A bun invocation with a script file is captured."""
    script = tmp_path / "index.ts"
    script.write_text("console.log('bun')")
    content, truncated = capture_script(["bun", str(script)], tmp_path)
    assert content is not None
    assert "bun" in content
    assert truncated is False


def test_capture_bun_run_subcommand(tmp_path: Path) -> None:
    """bun run app.ts correctly skips the 'run' subcommand."""
    script = tmp_path / "index.ts"
    script.write_text("console.log('bun-run')")
    content, truncated = capture_script(["bun", "run", str(script)], tmp_path)
    assert content is not None
    assert "bun-run" in content
    assert truncated is False


def test_capture_tsx_script(tmp_path: Path) -> None:
    """A tsx invocation with a script file is captured."""
    script = tmp_path / "app.tsx"
    script.write_text("console.log('tsx')")
    content, truncated = capture_script(["tsx", str(script)], tmp_path)
    assert content is not None
    assert "tsx" in content
    assert truncated is False


def test_capture_full_path_interpreter(tmp_path: Path) -> None:
    """An interpreter specified with a full path is recognized."""
    script = tmp_path / "test.py"
    script.write_text("pass")
    content, _ = capture_script(["/usr/bin/python3", str(script)], tmp_path)
    assert content is not None


def test_capture_only_flags_no_positional(tmp_path: Path) -> None:
    """python3 -u -B (all flags, no positional) returns (None, False)."""
    content, truncated = capture_script(["python3", "-u", "-B"], tmp_path)
    assert content is None
    assert truncated is False


# ── Option-handling edge cases (Qodo finding #4) ────────────────────────────


def test_capture_returns_none_for_dash_c(tmp_path: Path) -> None:
    """python3 -c 'code' terminates script detection."""
    content, truncated = capture_script(["python3", "-c", "print('hi')"], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_returns_none_for_bash_dash_c(tmp_path: Path) -> None:
    """bash -c 'echo hi' terminates script detection."""
    content, truncated = capture_script(["bash", "-c", "echo hi"], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_returns_none_for_node_dash_e(tmp_path: Path) -> None:
    """node -e 'code' terminates script detection."""
    content, truncated = capture_script(["node", "-e", "console.log(1)"], tmp_path)
    assert content is None
    assert truncated is False


def test_capture_skips_W_option_value(tmp_path: Path) -> None:
    """-W consumes the next arg; the script follows it."""
    script = tmp_path / "test.py"
    script.write_text("pass")
    content, _ = capture_script(["python3", "-W", "default", str(script)], tmp_path)
    assert content is not None


def test_capture_W_value_not_mistaken_for_script(tmp_path: Path) -> None:
    """-W's value is not captured even if it names a readable file."""
    decoy = tmp_path / "default"
    decoy.write_text("not a script")
    content, _ = capture_script(["python3", "-W", "default"], tmp_path)
    assert content is None


def test_capture_double_dash_terminates_flags(tmp_path: Path) -> None:
    """-- terminates flag parsing; the next arg is the script."""
    script = tmp_path / "test.py"
    script.write_text("pass")
    content, _ = capture_script(["python3", "--", str(script)], tmp_path)
    assert content is not None


def test_capture_ruby_r_consumes_next(tmp_path: Path) -> None:
    """-r consumes the next arg (Ruby require); script follows."""
    script = tmp_path / "app.rb"
    script.write_text("puts 'ok'")
    content, _ = capture_script(["ruby", "-r", "json", str(script)], tmp_path)
    assert content is not None
    assert "ok" in content


def test_capture_perl_M_consumes_next(tmp_path: Path) -> None:
    """-M consumes the next arg (Perl module); script follows."""
    script = tmp_path / "check.pl"
    script.write_text("print 1;")
    content, _ = capture_script(["perl", "-M", "strict", str(script)], tmp_path)
    assert content is not None


def test_capture_perl_I_consumes_next(tmp_path: Path) -> None:
    """-I consumes the next arg (Perl include path); script follows."""
    script = tmp_path / "check.pl"
    script.write_text("print 1;")
    content, _ = capture_script(["perl", "-I", "/opt/lib", str(script)], tmp_path)
    assert content is not None


def test_capture_python_I_is_standalone(tmp_path: Path) -> None:
    """Python's -I is isolated mode (standalone); the script is not skipped."""
    script = tmp_path / "test.py"
    script.write_text("pass")
    content, _ = capture_script(["python3", "-I", str(script)], tmp_path)
    assert content is not None


# ── Relative path resolution (Qodo finding #3) ──────────────────────────────


def test_capture_resolves_relative_against_cwd(tmp_path: Path) -> None:
    """A relative script path is resolved against the provided cwd."""
    subdir = tmp_path / "work"
    subdir.mkdir()
    script = subdir / "probe.py"
    script.write_text("pass")
    content, _ = capture_script(["python3", "probe.py"], subdir)
    assert content is not None


def test_capture_relative_wrong_cwd_returns_none(tmp_path: Path) -> None:
    """A relative path that doesn't exist in cwd returns None."""
    subdir = tmp_path / "work"
    subdir.mkdir()
    (subdir / "probe.py").write_text("pass")
    content, _ = capture_script(["python3", "probe.py"], tmp_path)
    assert content is None


# ── Bounded read (Qodo finding #6) ──────────────────────────────────────────


def test_capture_does_not_read_entire_large_file(tmp_path: Path) -> None:
    """Only MAX_SCRIPT_CHARS + 1 bytes are read, not the whole file."""
    script = tmp_path / "huge.py"
    script.write_text("A" * (MAX_SCRIPT_CHARS * 10))
    content, truncated = capture_script(["python3", str(script)], tmp_path)
    assert content is not None
    assert len(content) <= MAX_SCRIPT_CHARS
    assert truncated is True


# ── Post-scrub cap (Qodo finding #7) ────────────────────────────────────────


def test_scrub_expansion_does_not_exceed_cap(tmp_path: Path) -> None:
    """Scrub-expanded content is capped at MAX_SCRIPT_CHARS."""
    script = tmp_path / "bidi.py"
    script.write_text("\u202e" * MAX_SCRIPT_CHARS)
    content, truncated = capture_script(["python3", str(script)], tmp_path)
    assert content is not None
    assert len(content) <= MAX_SCRIPT_CHARS
    assert truncated is True


# ── Integration tests via run_sensed ─────────────────────────────────────────


@pytest.fixture
def setup_ctx(ctx: Context) -> Context:
    """Prepare a Context with minimal sensor state so run_sensed can proceed."""
    paths = state_paths(ctx)
    ctx.state_dir.mkdir(parents=True, exist_ok=True)
    paths["audit_dir"].mkdir(parents=True, exist_ok=True)
    config = {
        "proxy_port": 0,
        "proxy_armed": False,
        "decoy_backend": None,
        "allow_hosts": [],
    }
    (ctx.state_dir / "config.json").write_text(json.dumps(config))
    write_pyhook(paths["pyhook"])
    return ctx


@pytest.mark.harness
def test_run_sensed_captures_script(setup_ctx: Context) -> None:
    """run_sensed includes script_content for a Python script invocation."""
    cwd = setup_ctx.home
    cwd.mkdir(parents=True, exist_ok=True)
    script = cwd / "probe.py"
    script.write_text("print('captured')")
    report = run_sensed(
        setup_ctx,
        [sys.executable, str(script)],
        check="probes",
        workspace_roots=[cwd],
        cwd=cwd,
    )
    assert report["exit"] == 0
    assert report["script_content"] is not None
    assert "captured" in report["script_content"]
    assert report["truncated"]["script_content"] is False


@pytest.mark.harness
def test_run_sensed_null_for_non_script(setup_ctx: Context) -> None:
    """run_sensed returns script_content=null for non-interpreter commands."""
    cwd = setup_ctx.home
    cwd.mkdir(parents=True, exist_ok=True)
    report = run_sensed(
        setup_ctx,
        [sys.executable, "-c", "print('inline')"],
        check="probes",
        workspace_roots=[cwd],
        cwd=cwd,
    )
    assert report["exit"] == 0
    assert report["script_content"] is None
    assert report["truncated"]["script_content"] is False


@pytest.mark.harness
def test_run_sensed_truncates_large_script(setup_ctx: Context) -> None:
    """run_sensed flags truncation when the script exceeds the cap."""
    cwd = setup_ctx.home
    cwd.mkdir(parents=True, exist_ok=True)
    script = cwd / "huge.py"
    script.write_text("x = 1\n" * (MAX_SCRIPT_CHARS // 2))
    report = run_sensed(
        setup_ctx,
        [sys.executable, str(script)],
        check="probes",
        workspace_roots=[cwd],
        cwd=cwd,
    )
    assert report["exit"] == 0
    assert report["script_content"] is not None
    assert len(report["script_content"]) <= MAX_SCRIPT_CHARS
    assert report["truncated"]["script_content"] is True
