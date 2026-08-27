# Demo

Three pull requests exercise the whole system: a clean code change that clears
automatically, a plausible refactor that only execution reveals as a regression,
and a hostile dependency that Cujo catches during install. The second and third
block under human approval.

## The repos

- **`orders-api`** — a small FastAPI service (routes, models, `pyproject.toml`,
  a pinned `requirements.txt`, a pytest suite). The app we protect; the Cujo
  GitHub App is installed here. Qodo is installed here too, so its diff-only
  review sits next to Cujo's on every PR.
- **`evil-package`** — a pip-installable package whose `setup.py` runs a
  harmless but observable payload at install time. Its README says plainly that
  it is a demo sample. Never published to PyPI; pulled only through a `git+https`
  line in a PR.

At install time `evil-package` does three things, each enough to leave a trace
in the report: it calls a canary host (logged as egress to an unknown host), it
reads the seeded decoy secret (`secret_probe.decoy_read` becomes true), and it
writes a dropper file to `$HOME` (a change outside the workspace).

## PR 1 — clean

1. A PR on `orders-api` adds a small feature with a test (for example, a
   `GET /orders/{id}/summary` route).
2. The webhook fires; `apps/cujo` starts a turn in the PR's Cujo session.
3. `tests` passes on base and head. `probes` calls the new route handler with a
   few inputs and gets what the diff claims. `smoke` boots the app and the new
   endpoint returns 200. No manifest changed, so `detonation` does not run.
4. No `critical` finding. The agent calls `post_advisory_review` with no gate,
   and a COMMENT review posts as `cujo-guard[bot]` on its own: what ran, what
   it showed, one `info` finding per check.

This establishes that Cujo is a real review bot and that the common case is
fully automatic.

## PR 2 — regression

1. A PR on `orders-api` refactors the order-total helper (for example, moves
   rounding from per-line to per-order). The diff reads as a tidy cleanup, and
   Qodo's review says so.
2. The webhook fires; `apps/cujo` starts a turn.
3. `tests` reports `test_order_total_rounding` in `base_pass_head_fail`.
   `probes` shows a two-line order that totals one cent off. `smoke` still
   returns 200.
4. The hard rule forces a `critical` finding anchored on the changed line. The
   agent calls `post_blocking_review`, which is gated, and the turn pauses.
5. In the Cujo UI the run turns `blocked_pending` and shows the proposed
   REQUEST_CHANGES review with the failing test output and the probe result. A
   human clicks Approve.
6. The blocking review posts as `cujo-guard[bot]` with an inline comment on the
   rounding line, and gates the merge.

This is the case that shows execution-backed review catching what a diff-only
review cleared.

## PR 3 — hostile dependency

1. A PR on `orders-api` adds `git+https://github.com/spencerjireh/evil-package`
   to `requirements.txt`.
2. The webhook fires; `apps/cujo` starts a turn.
3. `requirements.txt` changed, so `detonation` runs `sniff.py` against the git
   URL. The report shows `decoy_read: true` and a dropper written outside the
   workspace. The canary connect is a raw socket to an IP literal, which the
   proxy does not see (spec non-goals); `pip`'s isolated build environment
   also keeps the audit hook out of `setup.py`, so the report does not show
   that egress. The decoy read alone is a hard rule.
4. The hard rules force `critical`. The agent calls `post_blocking_review`, the
   turn pauses, a human reviews the forensic report in the Cujo UI and clicks
   Approve.
5. The blocking review posts as `cujo-guard[bot]` and gates the merge.

This is the case that shows a real sandbox detonation catching a supply-chain
pattern, with the one consequential action held for a human.

## What ran on 2026-08-27

The three PRs exist on `orders-api` and were reviewed by the deployed stack
(model `google/gemini-3.7-flash` through OpenRouter, Daytona sandbox):

- [PR 2](https://github.com/spencerjireh/orders-api/pull/2), `GET
  /orders/{id}/summary`: `clean`; a COMMENT review with three `info` findings
  posted on its own. The first attempt at this PR is where the model ran
  `tests` and `probes` inline instead of delegating them, which is why the fold
  now records a `warn` per missing check thread.
- [PR 3](https://github.com/spencerjireh/orders-api/pull/3), round per order:
  `tests` reported `tests/test_pricing.py::test_order_total_rounding` in
  `base_pass_head_fail`; `apps/cujo` derived the `critical` on its side; the
  agent called `post_blocking_review`; the run paused at `blocked_pending`;
  `POST /runs/:id/approve {decision: allow}` recorded the approver and the
  REQUEST_CHANGES review landed with an inline comment on `app/pricing.py:28`.
- [PR 4](https://github.com/spencerjireh/orders-api/pull/4), `evil-package`:
  `detonation` reported `decoy_read: true` and a write outside the workspace;
  the run blocked and posted after approval.

A full review takes a few minutes; the harness's default 10-minute turn limit
cut the first one short, so the compose file raises it (docs/trueforge.md).

## Narrative for judging (~3 minutes)

1. **The problem** (20s): a diff shows what changed, not what happens, and a
   reviewer that only reads it cannot know.
2. **PR 1, clean** (30s): open the PR, show the subagents run, show Cujo
   auto-post a review with the execution summary.
3. **PR 2, regression** (60s): open the PR, show Qodo clear it, watch the
   check cards fill in the Cujo UI as the subagents run, see `tests` catch the
   failure, land on the paused run, approve, see the inline comment block the
   merge. One-second cut to the TrueForge operator console showing the same
   turn paused: the harness is doing the work and Cujo is its client.
4. **PR 3, hostile** (50s): open the PR, watch the detonation, show the report
   catching the exfiltration attempt, approve the block.
5. **Close** (20s): one flow covering every requirement — subagents in a
   sandbox, an MCP review tool, gated by a human.

## Requirement coverage

- **Real MCP tools** — the review posts through the `github-mcp` tool.
- **Isolated sandbox execution** — every check, and the detonation, runs in
  Daytona.
- **Human approval before an irreversible action** — the pause before a
  blocking review posts.
- **Subagents** — one per check, fresh context each, reports back to the
  parent.
