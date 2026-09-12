# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cujo: an execution-backed pull request reviewer on its own agent harness
(`apps/harness`, built on the pi coding agent SDK; decision 123). A GitHub
webhook starts a harness turn; the agent clones the PR into a disposable
sandbox, runs tests, probes, a smoke boot, and dependency detonation, then
posts one review as `cujo-guard[bot]`. `docs/` is the design of record and changes in the same PR as
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
uv run pytest sandbox/tests/test_cli.py -k name -n0         # ...in one process
```

`pytest` runs under `pytest-xdist` by default (decision 78). Add `-n0` when you
are debugging one test and want its output unbuffered in a single process.

Workspace names: `@cujo/cujo`, `@cujo/github-mcp`, `@cujo/sandbox-mcp`,
`@cujo/harness`, `@cujo/web`, `@cujo/harness-contract`, `@cujo/log`,
`@cujo/review-render`, `@cujo/gh-app-auth`, `@cujo/brand`.

Local stack (`make up-local` = `docker compose -f docker-compose.yml -f
docker-compose.local.yml up --build`): the UI on :3000, the harness API on
:8790, `cujo` on :8080 (dispatches on `Host`: the internal name `cujo` =
the read API, `cujo-ingress.localhost` = webhook and Discord), `github-mcp` on
:8081. Curl the API with `-H 'Host: cujo'`, which is what every production
request carries too; anything outside `/public` is 404 there, and there is no
credential to present (decision 57). Open http://localhost:3000 for the board.
`make clean` drops the database volume. The deploy uses `docker-compose.yml`
alone; never make the base file depend on the overlay or the Makefile.

## Architecture

Two trust zones with one narrow bridge. Trusted: `apps/harness`, `apps/cujo`,
`github-mcp`, `sandbox-mcp`, and every secret. Untrusted and disposable: the
sandbox holding the PR code, `sandbox/`, and the logging proxy. Only PR code, public PR
metadata, dependency names, Cujo's own sensor script, and a public run's own id
go in; only JSON reports come out. No token, key, clone credential, or hostname
may ever reach the sandbox. Treat any change that moves data across this line as
a design change.

Read `docs/architecture.md` for the components, the crossings table, the
approval path and the deployment topology. What follows is only what you need
before you can read anything else: where code goes, and what governs that.

`apps/cujo` (Hono, `node:sqlite`) is the harness's sole client and the only
thing GitHub touches. Its `src/` is grouped by trust plane:

```
src/
  index.ts          composition root      config.ts
  http/
    router.ts       the host split, in one place
    ingress/        INTERNET. A signature is the only gate. Cannot approve.
    public/         INTERNET, no gate. Read-only, public repos, no operator named.
  review/           a PR becomes a run: start, follow, fold, hard rules
  converse/         @cujo-guard: its own session, no write tool, never Runner
  notify/           Discord cards, pings, /cujo commands, the PR reaction
  clients/          the only outbound IO; imports from nothing else here
  store/            SQLite, split into runs and notifications
tests/              mirrors src/ exactly
```

Two hostnames and two planes, one process, and **no authenticated route at
all** (decision 57): the webhook host carries the signature-gated ingress
routes, and the internal compose name carries the ungated `/public` group.
Enforced in `http/router.ts` and not only at the edge. Outside `/public` the
answer is 404 and not 401 — there is no credential to present, so a 401 would
be a route somebody could still reach with the right header. The read plane
answers on the internal name because this process never receives a published
one (decision 34); `http/public/serialize.ts` is an allowlist, and adding a
field to `Projection` or `RunRecord` fails its test until classified.

`apps/harness` is the harness: sessions, turns, the event log, the approval
gate and the `create_sub_agent` tool over pi, with the eight-operation contract
in `packages/harness-contract`. `apps/web` is the UI and holds no secrets and
no state; `apps/github-mcp` is the MCP server whose one destructive tool is
the entire human gate; `agent/SKILL.md` is the rubric; `sandbox/` is the in-sandbox sensor code, with `sniff.py` as the
entry point and `cujo_sniff/` as the package behind it. Report shapes live in
`docs/spec.md` Contract 2.

## Repo rules

- Every change is a PR; no direct commits to `main`. The Standards section of
  `CONTRIBUTING.md` is what a review holds a PR to. There is no review bot
  (decision 119): CI green and every open thread applied, or answered with a
  one-line reason and resolved, is the bar (`gh pr checks`,
  `gh pr view --comments`).
- Pin dependencies; a `git+` or unpinned spec needs a reason in the PR.
- Commit subjects use Conventional Commits (`type(scope): summary`, imperative,
  no trailing period); explain the why in the body. See `CONTRIBUTING.md`.
- Run Python with `uv` everywhere except what runs in the sandbox (`sniff.py`
  and `cujo_sniff/`), which uses the image's own `python3`; `sandbox/tests/`
  runs here under `uv` like any other test. The sandbox image is ours and has an
  install step (decision 117, reversing 46), so `sandbox/` may import a
  third-party module -- but it is stdlib-only by default, because every package in
  that image is something a pull request's code can reach. Adding one needs a
  reason in the PR.
- Never install `evil-package` outside the sandbox; it is an intentional
  malicious sample.
- `*.pem` and `.env` are gitignored; real values live in the Coolify deploy.
