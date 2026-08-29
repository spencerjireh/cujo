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
uv run pytest sandbox/tests/test_cli.py -k name             # one Python test
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
holding the PR code, `sandbox/`, and the logging proxy. Only PR code, public PR
metadata, dependency names, Cujo's own sensor script, and a public run's own id
go in; only JSON reports come out. No token, key, clone credential, or hostname
may ever reach the sandbox. Treat any change that moves data across this line as
a design change.

Read `docs/architecture.md` for the components, the crossings table, the
approval path and the deployment topology. What follows is only what you need
before you can read anything else: where code goes, and what governs that.

`apps/cujo` (Hono, `node:sqlite`) is the sole TrueForge client and the only
thing GitHub touches. Its `src/` is grouped by trust plane:

```
src/
  index.ts          composition root      config.ts
  http/
    router.ts       the host split, in one place
    ingress/        INTERNET. A signature is the only gate. Cannot approve.
    operator/       a bearer token. Reads and Discord bindings; decides no review.
    public/         INTERNET, no gate. Read-only, public repos, names nobody.
  review/           a PR becomes a run: start, follow, fold, hard rules
  converse/         @cujo-guard: its own session, no write tool, never Runner
  notify/           Discord cards, pings, /cujo commands, the PR reaction
  clients/          the only outbound IO; imports from nothing else here
  store/            SQLite, split into runs and notifications
tests/              mirrors src/ exactly
```

Two hostnames and two planes, one process: the webhook host carries the
signature-gated ingress routes, and the UI host carries both the token-gated
API and the ungated `/public` group. Enforced in `http/router.ts` and not only
at the edge — the gated plane is a separate Hono instance the UI host delegates
to, so its `app.use("*")` gate cannot compose with the public handlers. The
public split is a path and not a third hostname because this process never
receives the public name (decision 34); `http/public/serialize.ts` is an
allowlist, and adding a field to `Projection` fails its test until classified.

`apps/web` is the UI and holds no secrets and no state; `apps/github-mcp` is the
MCP server whose one destructive tool is the entire human gate; `agent/SKILL.md`
is the rubric; `sandbox/` is the in-sandbox sensor code, with `sniff.py` as the
entry point and `cujo_sniff/` as the package behind it. Report shapes live in
`docs/spec.md` Contract 2.

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
- Run Python with `uv` everywhere except what runs in the sandbox (`sniff.py`
  and `cujo_sniff/`), which uses the sandbox's own `python3`; `sandbox/tests/`
  runs here under `uv` like any other test. There is no install step in the
  sandbox, so nothing under `sandbox/` may import a third-party module
  (decision 46).
- Never install `evil-package` outside the Daytona sandbox; it is an intentional
  malicious sample.
- `*.pem` and `.env` are gitignored; real values live in the Coolify deploy.
