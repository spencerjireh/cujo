# Demo

> Tentative. The demo shape will firm up as the build lands; treat repo names,
> package choices, and the narrative timing as provisional.

Two pull requests exercise the whole system: a clean dependency that clears
automatically, and a hostile one that Cujo catches and blocks under human
approval.

## The repos

- **`orders-api`** — a small FastAPI service (routes, models, `pyproject.toml`,
  a pinned `requirements.txt`). The app we protect; the Cujo GitHub App is
  installed here.
- **`evil-package`** — a pip-installable package whose `setup.py` runs a
  harmless but observable payload at install time. Its README says plainly that
  it is a demo sample. Never published to PyPI; pulled only through a `git+https`
  line in a PR.

At install time `evil-package` does three things, each enough to leave a trace
in the report: it calls a canary host (logged as egress to a non-index host), it
reads the seeded decoy secret (`secret_probe.decoy_read` becomes true), and it
writes a dropper file to `$HOME` (a change outside the venv).

## PR 1 — clean

1. A PR on `orders-api` adds `humanize` to `requirements.txt`.
2. The webhook fires; ingress starts a Cujo session with the new dependency.
3. The agent runs `sniff.py` against `humanize`. The report shows egress only to
   the package index, no writes outside the venv, and the decoy untouched.
4. Verdict `cleared`. The agent calls `post_advisory_review` with no gate, and
   an approving review posts as `cujo-guard[bot]` on its own.

This establishes that Cujo is a real review bot and that the common case is
fully automatic.

## PR 2 — hostile

1. A PR on `orders-api` adds `git+https://github.com/spencerjireh/evil-package`
   to `requirements.txt`.
2. The webhook fires; ingress starts a Cujo session.
3. The agent runs `sniff.py` against the git URL. The report shows egress to the
   canary host, `decoy_read: true`, and a dropper written outside the venv.
4. Verdict `denied`. The agent calls `post_blocking_review`, which is gated, and
   the turn pauses.
5. In the TrueForge UI the paused session shows the proposed REQUEST_CHANGES
   review alongside the forensic report. A human clicks Allow.
6. The blocking review posts as `cujo-guard[bot]` and gates the merge.

This is the case that shows a real sandbox detonation catching a supply-chain
pattern, with the one consequential action held for a human.

## Narrative for judging (~3 minutes)

1. **The problem** (20s): adding a dependency runs a stranger's code, and the
   diff hides it.
2. **PR 1, clean** (40s): open the PR, show Cujo auto-post a cleared review.
3. **PR 2, hostile** (80s): open the PR, watch the detonation, show the report
   catching the exfiltration attempt, land on the paused session in the UI.
4. **The human gate** (30s): approve the block; the REQUEST_CHANGES review
   appears on the PR as `cujo-guard[bot]`, blocking the merge.
5. **Close** (10s): one flow covering all three requirements — an MCP review
   tool, gated by a human, downstream of a sandbox detonation.

## Requirement coverage

- **Real MCP tools** — the review posts through the `github-mcp` tool.
- **Isolated sandbox execution** — the detonation runs in Daytona.
- **Human approval before an irreversible action** — the pause before a `denied`
  block posts.
