"""The producer against the canonical example in `docs/contracts/`.

The report shape has three consumers -- this package writes it, `apps/cujo`
derives the hard rules from it, and `apps/web` renders it -- and none of them
share a type. There is no schema: `check.report` is `unknown` on both TypeScript
sides, so a field renamed here produces no error anywhere, only quieter findings
and emptier tables.

One example file is what stands in for the schema. Each consumer has a test that
loads it; this is the producer's. It asserts that what `build_sensor_block` and
`run_sensed` actually emit carries the same keys the example promises, so a field
added on one side and forgotten on the other fails here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

from cujo_sniff.policy import SCHEMA_VERSION
from tests.conftest import CODE_DIR, Cli

EXAMPLE = CODE_DIR.parent / "docs" / "contracts" / "report.example.json"


@pytest.fixture
def example() -> dict[str, Any]:
    return json.loads(EXAMPLE.read_text())


def keys_of(value: Any) -> Any:
    """The shape of a value: its keys all the way down, with list order dropped.

    Comparing values would pin the example's numbers; comparing key sets pins
    the contract, which is the thing three codebases have to agree on.
    """
    if isinstance(value, dict):
        return {k: keys_of(v) for k, v in value.items() if not k.startswith("_")}
    if isinstance(value, list):
        # Every element of a list in this report is the same shape, so one
        # stands for all of them; an empty list constrains nothing.
        return keys_of(value[0]) if value else None
    return None


def test_the_example_is_the_version_this_package_writes(example: dict[str, Any]) -> None:
    assert example["schema_version"] == SCHEMA_VERSION
    for run in example["runs"]:
        assert run["schema_version"] == SCHEMA_VERSION


@pytest.mark.harness
def test_a_real_run_report_matches_the_examples_run_shape(cli: Cli, home_dir: Path) -> None:
    """What `sniff.py run` prints, against `runs[0]` of the example.

    The example is hand-written and the report is not, so this is the join
    between them: every key one has, the other has.
    """
    example = json.loads(EXAMPLE.read_text())
    cli(["setup", "--proxy-port", "0"])
    try:
        # Something in every list, so no list in the report is empty and
        # therefore unconstrained: a read, a write, and a spawned process.
        script = (
            "import subprocess, sys;"
            "open('read-me.txt', 'w').write('x');"
            "open('read-me.txt').read();"
            "subprocess.run([sys.executable, '-c', 'pass'])"
        )
        report = cli(
            ["run", "--check", "tests", "--cwd", str(home_dir), "--", sys.executable, "-c", script]
        )
    finally:
        cli(["teardown"])

    assert report["exit"] == 0
    expected = keys_of(example["runs"][0])
    actual = keys_of(report)
    # `check` is the sub-agent's envelope field, added by `cmd_run` on top of
    # the run report; the example carries it one level up.
    actual.pop("check", None)
    # `egress` needs a host the sandbox can be made to dial, which a hermetic
    # test cannot promise; its shape is pinned in test_report.py instead.
    for shapeless in ("egress",):
        expected.pop(shapeless, None)
        actual.pop(shapeless, None)
    assert actual == expected


def test_the_envelope_rolls_up_the_same_blocks_each_run_carries(example: dict[str, Any]) -> None:
    """`apps/cujo` reads the top level and each `runs[]` entry as the same shape.

    `findings.ts` scans both layers, so a roll-up that dropped a block would
    make the top level a different thing from the runs under it and the rules
    would read one of the two wrongly.
    """
    for block in ("derived", "sensors", "truncated"):
        assert keys_of(example[block]) == keys_of(example["runs"][0][block])

    # The roll-up is pessimistic where the runs disagree: a sensor that was
    # armed for one command and not the next leaves the whole report blind.
    assert example["runs"][0]["sensors"]["decoy"]["armed"] is True
    assert example["runs"][1]["sensors"]["decoy"]["armed"] is False
    assert example["sensors"]["decoy"]["armed"] is False
    assert example["truncated"]["files_read"] is True


def test_the_example_exercises_what_reads_it(example: dict[str, Any]) -> None:
    """A fixture where nothing happened tests none of the code that reads it.

    Every hard rule `apps/cujo` derives has something here to fire on, and the
    two blocks this contract added each have a negative case.
    """
    assert example["base_pass_head_fail"]
    assert example["derived"]["wrote_sensitive"] is True
    assert example["derived"]["egress_to_unknown_host"] is True
    assert example["runs"][0]["secret_probe"]["decoy_read"] is True
    # Never observed, on every run: nothing in this sandbox can measure it.
    assert all(r["secret_probe"]["decoy_in_egress"] is None for r in example["runs"])
    assert any(not s["armed"] for s in example["sensors"].values())
    assert any(example["truncated"].values())
    assert any(c["sensitive"] for c in example["runs"][0]["fs_changes"])
    assert any(not e["known"] for e in example["runs"][0]["egress"])
