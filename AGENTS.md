# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cujo: an execution-backed pull request reviewer built on stock TrueForge (an
open-source agent harness, used unforked). A GitHub webhook starts a TrueForge
turn; the agent clones the PR into a disposable Daytona sandbox, runs tests,
probes, a smoke boot, and dependency detonation, then posts one review as
`cujo-guard[bot]`. `docs/` is the design of record and changes in the same PR as
the code (or before it). Read `docs/architecture.md` then `docs/spec.md` before
changing behavior; add an entry to `docs/decisions.md` for any load-bearing
choice (reverse, do not delete, when one changes).

## Commands

pnpm workspace (Node >= 24, `corepack enable && pnpm install`) for `apps/*` and
`packages/*`; `uv` for Python. CI (`.github/workflows/ci.yml`) runs exactly these:

```bash
pnpm lint          # biome check .
pnpm format        # biome format --write .
pnpm typecheck     # tsc --noEmit in every workspace
pnpm test          # vitest run in every workspace
pnpm build         # tsup in apps/cujo and apps/github-mcp, next build in apps/web

uv sync && uv run ruff check . && uv run ruff format --check . && uv run pytest
```

Single tests:

```bash
pnpm --filter @cujo/cujo test -- src/folder.test.ts        # one vitest file
pnpm --filter @cujo/cujo exec vitest run -t "name pattern"  # one test by name
uv run pytest sandbox/tests/test_sniff.py -k name           # one Python test
```

Workspace names: `@cujo/cujo`, `@cujo/github-mcp`, `@cujo/web`, `@cujo/gh-app-auth`,
`@cujo/brand`.

Local stack (`make up-local` = `docker compose -f docker-compose.yml -f
docker-compose.local.yml up --build`): the operator UI on :3000, TrueForge
console/API on :8790, `cujo` on :8080 (dispatches on `Host`: `cujo.localhost`
and the internal name `cujo` = API, `cujo-ingress.localhost` = webhook),
`github-mcp` on :8081. Open http://localhost:3000. `make clean` drops the
database volume. The deploy uses `docker-compose.yml` alone; never make the
base file depend on the overlay or the Makefile.

## Architecture

Two trust zones with one narrow bridge. Trusted: TrueForge, `apps/cujo`,
`github-mcp`, and every secret. Untrusted and disposable: the Daytona sandbox
holding the PR code, `sniff.py`, and the logging proxy. Only PR code, public PR
metadata, dependency names, and Cujo's own sensor script go in; only JSON
reports come out. No token, key, or clone credential may ever reach the
sandbox. Treat any change that moves data across this line as a design change.

`apps/web` (Next.js App Router, TanStack Query, Tailwind on `brand/tokens.css`)
is the operator UI and the only thing a human opens. It holds no secrets and no
state: every call goes through its `/api/*` route handlers to `apps/cujo`,
same-origin so the Cloudflare Access assertion and the `EventSource` run stream
both work from a browser (decision 27). Storybook covers the components and is
not part of CI.

`apps/cujo` (Hono, `node:sqlite`) is the sole TrueForge client and the only
thing GitHub touches:

- `webhook.ts` verifies the HMAC, `github.ts` reads public PR metadata, and a
  new session is created with the inline agent spec from `agent.ts`, which is
  `agent/SKILL.md` with `{{CUJO_SNIFF_URL}}` substituted.
- `trueforge.ts` wraps the SDK (`@truefoundry/trueforge-sdk`) so nothing else
  sees SDK shapes; `bootstrapUntilReady()` registers `github-mcp` on the harness
  and the webhook answers 503 until it succeeds.
- `runner.ts` drives a turn and `folder.ts` folds the event stream (tagged by
  `thread_id`: `thread.created`, `thread.done`, `tool.approval_required`) into
  a run record in `store.ts`. Unfinished runs are rehydrated on restart.
- `api.ts` serves `/runs` and the approve endpoint (consumed by `apps/web`); `access.ts` checks the
  Cloudflare Access JWT as the second gate (`CUJO_DEV_NO_ACCESS=1` disables it
  locally). Approve resumes the paused turn with `user.tool_approval`.
- `store.ts` loads `node:sqlite` at runtime, not by import, so vitest leaves it
  alone. Its schema is one `CREATE TABLE IF NOT EXISTS` block plus an ordered
  `MIGRATIONS` list applied by `PRAGMA user_version` (decision 30). Prefer a
  new table; use a migration only to alter one that already exists in the
  deployed database.
- `interactions.ts` serves the `/cujo` slash command on the **webhook** host,
  Ed25519-verified (spec Contract 8); `discord-commands.ts` is the command
  definition. `authorization.ts` answers whether a server may watch a repo: the
  repo names it in `.cujo.yml` on the default branch, read trusted-side through
  the App and never from the sandbox, with the operator API as an override
  (decision 31). Nothing here approves a review, and it must not grow that
  (decision 28).
- `notifier.ts` keeps one Discord card per run and pings when a run blocks
  (spec Contract 7). `discord.ts` is the REST client and `discord-card.ts` the
  pure payload builder, where every derived string is escaped, stripped and
  truncated. Optional: no `DISCORD_BOT_TOKEN`, no notifications. The agent has
  no Discord tool, and the token never leaves `apps/cujo`.

`apps/github-mcp` is a stateless Streamable HTTP MCP server with two tools:
`post_advisory_review` and `post_blocking_review`. Only the blocking one is
marked destructive, which is what TrueForge's `@destructive` approval selector
keys on; that is the entire mechanism behind the human gate. `diff.ts` validates
every inline comment anchor against the PR hunks because one bad anchor fails
the whole GitHub review. `packages/gh-app-auth` mints installation tokens from
the App private key for both apps.

`agent/SKILL.md` is the rubric: parent-agent setup, the four check subagents
(`tests`, `probes`, `smoke`, `detonation`, each returning one JSON report), the
hard rules that force `critical`, and the review format. `sniff.py` is the
in-sandbox sensor script (`setup`, `run`, `detonate`, `teardown`); it is fetched
by URL into the sandbox, so it must stay standard-library only and runs with the
sandbox's `python3`, not `uv`. Report shapes live in `docs/spec.md` Contract 2.

## Repo rules

- Every change is a PR; no direct commits to `main`. Qodo reviews PRs here and
  reads `best_practices.md`, which mirrors the Standards section of
  `CONTRIBUTING.md`; keep the two in sync.
- Before merging, wait for Qodo's review to finish and check that every Qodo
  comment is applied, or answered with a one-line reason and resolved
  (`gh pr view --comments`, `gh pr checks`). Never merge with an open Qodo
  thread.
- Pin dependencies; a `git+` or unpinned spec needs a reason in the PR.
- Commit subjects use Conventional Commits (`type(scope): summary`, imperative,
  no trailing period); explain the why in the body. See `CONTRIBUTING.md`.
- Run Python with `uv` everywhere except `sniff.py` inside the sandbox.
- Never install `evil-package` outside the Daytona sandbox; it is an intentional
  malicious sample.
- `*.pem` and `.env` are gitignored; real values live in the Coolify deploy.
