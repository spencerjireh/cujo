"""What `Context.from_env` decides when the environment says nothing.

These defaults are the only place the layout is written down, and the rubric
never names the state directory, so nothing else would notice them changing.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from cujo_sniff.context import Context, state_paths
from tests.conftest import CODE_DIR


def test_state_lives_under_the_code_directory_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CUJO_DIR", raising=False)
    monkeypatch.delenv("CUJO_ENVS_DIR", raising=False)
    ctx = Context.from_env()
    assert ctx.state_dir == Path("/tmp/cujo/state")
    # Beside the state dir, not inside it: the snapshot prunes the state dir
    # but has to see what an install writes into its environment.
    assert ctx.envs_dir == Path("/tmp/cujo/state-envs")
    # /tmp/cujo itself stays the code directory the rubric extracts into.
    assert ctx.state_dir.parent == Path("/tmp/cujo")


def test_envs_dir_follows_a_moved_state_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUJO_DIR", "/somewhere/else")
    monkeypatch.delenv("CUJO_ENVS_DIR", raising=False)
    ctx = Context.from_env()
    assert ctx.envs_dir == Path("/somewhere/else-envs")


def test_envs_dir_can_be_set_on_its_own(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUJO_DIR", "/somewhere/else")
    monkeypatch.setenv("CUJO_ENVS_DIR", "/third/place")
    assert Context.from_env().envs_dir == Path("/third/place")


def test_code_dir_is_the_directory_holding_the_package() -> None:
    """`sniff.py` and `cujo_sniff/` are siblings; `code_dir` is what holds both."""
    ctx = Context.from_env()
    assert ctx.code_dir == CODE_DIR
    assert (ctx.code_dir / "cujo_sniff" / "__init__.py").exists()
    assert (ctx.code_dir / "sniff.py").exists()


def test_every_state_path_is_inside_the_state_dir_except_envs(ctx: Context) -> None:
    paths = state_paths(ctx)
    # `envs` is the one entry that is deliberately outside: the snapshot prunes
    # the state dir, and an install's writes have to stay visible.
    assert ctx.state_dir not in paths.pop("envs").parents
    for name, path in paths.items():
        assert ctx.state_dir in path.parents, f"{name} escaped the state dir"
