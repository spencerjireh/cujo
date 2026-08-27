# Demo

> Tentative. The demo shape will firm up as the build lands; treat repo names,
> the exact regression, and the narrative timing as provisional.

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
2. The webhook fires; ingress starts a turn in the PR's Cujo session.
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
2. The webhook fires; ingress starts a turn.
3. `tests` reports `test_order_total_rounding` in `base_pass_head_fail`.
   `probes` shows a two-line order that totals one cent off. `smoke` still
   returns 200.
4. The hard rule forces a `critical` finding anchored on the changed line. The
   agent calls `post_blocking_review`, which is gated, and the turn pauses.
5. In the TrueForge UI the paused session shows the proposed REQUEST_CHANGES
   review with the failing test output and the probe result. A human clicks
   Allow.
6. The blocking review posts as `cujo-guard[bot]` with an inline comment on the
   rounding line, and gates the merge.

This is the case that shows execution-backed review catching what a diff-only
review cleared.

## PR 3 — hostile dependency

1. A PR on `orders-api` adds `git+https://github.com/spencerjireh/evil-package`
   to `requirements.txt`.
2. The webhook fires; ingress starts a turn.
3. `requirements.txt` changed, so `detonation` runs `sniff.py` against the git
   URL. The report shows egress to the canary host, `decoy_read: true`, and a
   dropper written outside the workspace.
4. The hard rules force `critical`. The agent calls `post_blocking_review`, the
   turn pauses, a human reviews the forensic report in the TrueForge UI and
   clicks Allow.
5. The blocking review posts as `cujo-guard[bot]` and gates the merge.

This is the case that shows a real sandbox detonation catching a supply-chain
pattern, with the one consequential action held for a human.

## Narrative for judging (~3 minutes)

1. **The problem** (20s): a diff shows what changed, not what happens, and a
   reviewer that only reads it cannot know.
2. **PR 1, clean** (30s): open the PR, show the subagents run, show Cujo
   auto-post a review with the execution summary.
3. **PR 2, regression** (60s): open the PR, show Qodo clear it, show Cujo's
   `tests` subagent catch the failure, land on the paused session in the UI,
   approve, see the inline comment block the merge.
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
