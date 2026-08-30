"""The CI concurrency group, stated as behaviour rather than as a string.

Asserting the group expression literally would only restate the workflow in a
second place, and a literal written alongside a change is written from the same
understanding that produced it. Both keys this file exists because of looked
correct when written:

  ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
      -- a workflow_dispatch run has no pull request, so it fell through to a
         different expression, landed in its own group, and did not collapse
         against the pull_request run it duplicates.

  ${{ github.workflow }}-${{ github.head_ref || github.ref_name }}
      -- a branch name is not an identity, so two forks offering `patch-1`
         shared a group and cancelled each other.

So the tests below evaluate the real expression from the real workflow file
against the event shapes that matter, and assert the two properties. Each one
fails on the key that got it wrong.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "ci.yml"

# `${{ ... }}`, and inside it operands separated by `||`.
_INTERPOLATION = re.compile(r"\$\{\{(.+?)\}\}")


def _concurrency_block() -> dict[str, str]:
    """The top-level `concurrency:` mapping, read without a YAML dependency.

    Nothing under `sandbox/` may import a third-party module (decision 46) and
    the dependency set has no YAML parser; the block is two flat keys, so it is
    read directly rather than adding one for this.
    """
    text = WORKFLOW.read_text()
    block = re.search(r"^concurrency:\n((?:[ \t]+\S.*\n)+)", text, re.MULTILINE)
    assert block, "ci.yml has no top-level concurrency block"
    out: dict[str, str] = {}
    for line in block.group(1).splitlines():
        key, _, value = line.strip().partition(":")
        out[key.strip()] = value.strip()
    return out


def _lookup(context: dict[str, Any], path: str) -> Any:
    """Resolve a dotted context path, treating a missing branch as null."""
    node: Any = context
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _evaluate(expression: str, context: dict[str, Any]) -> str:
    """Evaluate the `${{ a || b }}` subset GitHub uses in a concurrency group.

    `||` yields the first truthy operand, and null or empty string is falsy --
    which is the whole mechanism both broken keys turned on.
    """

    def one(match: re.Match[str]) -> str:
        for operand in match.group(1).split("||"):
            value = _lookup(context, operand.strip())
            if value:
                return str(value)
        return ""

    return _INTERPOLATION.sub(one, expression)


def _context(
    *,
    head_repo: str | None,
    head_ref: str,
    ref: str,
    ref_name: str,
    number: int | None,
    repository: str = "spencerjireh/cujo",
) -> dict[str, Any]:
    """A GitHub context with every field a plausible key might reach for.

    `number` and `ref` are populated even though the current key uses neither,
    so that a key which reaches for them is evaluated against what GitHub would
    really supply rather than against a missing field that reads as empty on
    both sides and compares equal by accident.
    """
    pull_request = (
        {"number": number, "head": {"repo": {"full_name": head_repo}}} if head_repo else None
    )
    return {
        "github": {
            "workflow": "CI",
            "repository": repository,
            "head_ref": head_ref,
            "ref": ref,
            "ref_name": ref_name,
            "event": {"pull_request": pull_request},
        }
    }


def _pull_request(branch: str, *, fork: str | None = None, number: int = 97) -> dict[str, Any]:
    return _context(
        head_repo=fork or "spencerjireh/cujo",
        head_ref=branch,
        ref=f"refs/pull/{number}/merge",
        ref_name=f"{number}/merge",
        number=number,
    )


def _dispatch(branch: str) -> dict[str, Any]:
    """A hand-started run: no pull request, and `head_ref` is empty."""
    return _context(
        head_repo=None,
        head_ref="",
        ref=f"refs/heads/{branch}",
        ref_name=branch,
        number=None,
    )


@pytest.fixture
def group() -> str:
    return _concurrency_block()["group"]


def test_cancellation_is_on(group: str) -> None:
    assert _concurrency_block()["cancel-in-progress"] == "true"


def test_a_dispatch_run_shares_the_group_with_the_pull_request_run(group: str) -> None:
    """The duplication this group exists to collapse.

    Fails on a `pull_request.number` key, which sends the hand-started run to
    its own group while looking like it had been fixed.
    """
    branch = "feat/whatever"
    assert _evaluate(group, _pull_request(branch, number=97)) == _evaluate(group, _dispatch(branch))


def test_two_forks_offering_the_same_branch_name_stay_apart(group: str) -> None:
    """Fails on a branch-only key, where one stranger cancels another's run.

    Two pull requests, so two numbers -- the collision has to come from the
    branch name alone, which is the thing being guarded against.
    """
    ours = _evaluate(group, _pull_request("patch-1", number=97))
    theirs = _evaluate(group, _pull_request("patch-1", fork="alice/cujo", number=98))
    assert ours != theirs


def test_two_branches_here_stay_apart(group: str) -> None:
    assert _evaluate(group, _pull_request("feat/one", number=97)) != _evaluate(
        group, _pull_request("feat/two", number=98)
    )


def test_the_same_pull_request_collapses_across_pushes(group: str) -> None:
    """The plain case: two runs for one branch are one group, so the first is cancelled."""
    assert _evaluate(group, _pull_request("feat/one", number=97)) == _evaluate(
        group, _pull_request("feat/one", number=97)
    )


def test_the_group_is_not_a_constant(group: str) -> None:
    """A key that evaluates to one string everywhere would pass everything above."""
    assert _evaluate(group, _pull_request("feat/one", number=97)) != _evaluate(
        group, _pull_request("feat/two", fork="alice/cujo", number=98)
    )
