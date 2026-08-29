"""Fixtures shared by the `cujo_sniff` tests.

The CLI is invoked the way production invokes it: `python3 -m cujo_sniff` with
the working directory set to the directory that holds the package, so `-m`
puts that directory on `sys.path` and the import needs no install and no
PYTHONPATH. If that arrangement ever breaks, every harness test breaks with
it, which is the point.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from cujo_sniff.context import Context

# sandbox/, which holds both cujo_sniff/ and sniff.py.
CODE_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture
def home_dir(tmp_path: Path) -> Path:
    h = tmp_path / "home"
    h.mkdir()
    return h


@pytest.fixture
def make_ctx(tmp_path: Path, home_dir: Path) -> Callable[..., Context]:
    """Build a `Context` rooted in this test's tmp_path."""

    def build(**overrides: Any) -> Context:
        fields: dict[str, Any] = {
            "state_dir": tmp_path / "cujo",
            "envs_dir": tmp_path / "cujo-envs",
            "home": home_dir,
            "code_dir": CODE_DIR,
            "python": sys.executable,
        }
        fields.update(overrides)
        return Context(**fields)

    return build


@pytest.fixture
def ctx(make_ctx: Callable[..., Context]) -> Context:
    return make_ctx()


@dataclass
class Cli:
    """Run the package's CLI in a subprocess, in one `Context`'s directories."""

    env: dict[str, str]

    def raw(self, args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-m", "cujo_sniff", *args],
            cwd=str(CODE_DIR),
            env=self.env,
            capture_output=True,
            text=True,
            **kwargs,
        )

    def script(self, args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        """The same commands through `sniff.py`, which is what the rubric runs.

        Deliberately not `cwd=CODE_DIR`: the only thing that may put the
        package on the path here is `sys.path[0]`, the directory holding the
        script. Running from somewhere else is what proves that.
        """
        return subprocess.run(
            [sys.executable, str(CODE_DIR / "sniff.py"), *args],
            cwd=str(Path(self.env["HOME"])),
            env=self.env,
            capture_output=True,
            text=True,
            **kwargs,
        )

    def __call__(self, args: list[str]) -> dict[str, Any]:
        proc = self.raw(args, check=True)
        return json.loads(proc.stdout)


@pytest.fixture
def cli(ctx: Context) -> Cli:
    env = {
        **os.environ,
        "HOME": str(ctx.home),
        "CUJO_DIR": str(ctx.state_dir),
        "CUJO_ENVS_DIR": str(ctx.envs_dir),
    }
    # The sensor env exports PYTHONPATH; a test process that inherited one
    # would put the audit hook inside the CLI itself.
    env.pop("PYTHONPATH", None)
    return Cli(env)
