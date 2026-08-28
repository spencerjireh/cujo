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
pnpm --filter @cujo/cujo test -- tests/review/fold.test.ts  # one vitest file
pnpm --filter @cujo/cujo exec vitest run -t "name pattern"  # one test by name
uv run pytest sandbox/tests/test_sniff.py -k name           # one Python test
```

Workspace names: `@cujo/cujo`, `@cujo/github-mcp`, `@cujo/web`, `@cujo/gh-app-auth`,
`@cujo/brand`.

Local stack (`make up-local` = `docker compose -f docker-compose.yml -f
docker-compose.local.yml up --build`): the UI on :3000, TrueForge console/API
on :8790, `cujo` on :8080 (dispatches on `Host`: `cujo-admin.localhost` and the
internal name `cujo` = API, `cujo-ingress.localhost` = webhook), `github-mcp`
on :8081. The UI serves two planes off one port, told apart by `Host`: open
http://cujo.localhost:3000 for the public read-only board and
http://cujo-admin.localhost:3000 for the operator view (decision 34). Plain
http://localhost:3000 matches neither, so it falls back to the operator plane,
which is the safe direction and is open locally anyway because
`CUJO_DEV_NO_ACCESS=1`. `make clean` drops the database volume. The deploy uses
`docker-compose.yml` alone; never make the base file depend on the overlay or
the Makefile.

## Architecture

Two trust zones with one narrow bridge. Trusted: TrueForge, `apps/cujo`,
`github-mcp`, and every secret. Untrusted and disposable: the Daytona sandbox
holding the PR code, `sandbox/sniff.py`, and the logging proxy. Only PR code, public PR
metadata, dependency names, Cujo's own sensor script, and a public run's own id
go in; only JSON reports come out. No token, key, clone credential, or hostname
may ever reach the sandbox. Treat any change that moves data across this line as
a design change.

`apps/web` (Next.js App Router, TanStack Query, Tailwind on `brand/tokens.css`)
is the UI and the only thing a human opens. It holds no secrets and no state:
every call goes through its `/api/*` route handlers to `apps/cujo`, same-origin
so the Cloudflare Access assertion and the `EventSource` run stream both work
from a browser (decision 27). One container answers two hostnames — the public
read-only board and the Access-gated operator view — decided per request from
its own `Host` in `lib/api/mode.ts`, where public requires an exact match and
everything else falls back to the gated plane (decision 34). Storybook covers
the components and is not part of CI.

`apps/cujo` (Hono, `node:sqlite`) is the sole TrueForge client and the only
thing GitHub touches. Its `src/` is grouped by trust plane:

```
src/
  index.ts          composition root      config.ts
  http/
    router.ts       the host split, in one place
    ingress/        INTERNET. A signature is the only gate. Cannot approve.
    operator/       Cloudflare Access. Where a human decides.
    public/         INTERNET, no gate. Read-only, public repos, names nobody.
  review/           a PR becomes a run: start, follow, fold, hard rules
  notify/           Discord cards, pings, and the /cujo commands
  clients/          the only outbound IO; imports from nothing else here
  store/            SQLite, split into runs and notifications
tests/              mirrors src/ exactly
```

Two hostnames and two planes, one process: the webhook host carries the
signature-gated ingress routes, and the UI host carries both the Access-gated
API and the ungated `/public` group. Enforced in `http/router.ts` and not only
at the edge — the gated plane is a separate Hono instance the UI host delegates
to, so its `app.use("*")` gate cannot compose with the public handlers. The
public split is a path and not a third hostname because this process never
receives the public name (decision 34); `http/public/serialize.ts` is an
allowlist, and adding a field to `Projection` fails its test until classified.

The flow: `http/ingress/github-webhook.ts` verifies the HMAC and claims the
run; `review/start-run.ts` reads the PR through `clients/github.ts` and starts
a turn on a session created with the spec from `review/agent-spec.ts`, which is
`agent/SKILL.md` with `{{CUJO_SNIFF_URL}}` substituted.
`review/runner.service.ts` drives the turn and `review/fold.ts` folds its event
stream (tagged by `thread_id`) into a projection. Unfinished runs rehydrate on
restart. `clients/trueforge.ts` wraps the SDK so nothing else sees SDK shapes;
`bootstrapUntilReady()` registers `github-mcp` and the webhook answers 503
until it succeeds.

`apps/github-mcp` is a stateless Streamable HTTP MCP server with two tools:
`post_advisory_review` and `post_blocking_review`. Only the blocking one is
marked destructive, which is what TrueForge's `@destructive` approval selector
keys on; that is the entire mechanism behind the human gate. `diff.ts` validates
every inline comment anchor against the PR hunks because one bad anchor fails
the whole GitHub review. `packages/gh-app-auth` mints installation tokens from
the App private key for both apps.

`agent/SKILL.md` is the rubric: parent-agent setup, the four check subagents
(`tests`, `probes`, `smoke`, `detonation`, each returning one JSON report), the
hard rules that force `critical`, and the review format. `sandbox/sniff.py` is the
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
- Run Python with `uv` everywhere except `sandbox/sniff.py`, which runs inside
  the sandbox with its `python3`.
- Never install `evil-package` outside the Daytona sandbox; it is an intentional
  malicious sample.
- `*.pem` and `.env` are gitignored; real values live in the Coolify deploy.
