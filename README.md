# Cujo

Cujo reviews the dependencies a pull request adds. It installs each new PyPI
package in a throwaway sandbox, records what the install does, and posts a
verdict on the PR — blocking a merge only after a human approves.

> "Cujo" is a working name and may change. It appears throughout as a
> find-replaceable string.

## Why

`pip install` runs a package's `setup.py` before any of your own code executes.
A pull request that adds a dependency is asking you to run a stranger's code,
and the diff shows none of what that code does. Cujo runs it first, somewhere it
can do no harm, and tells you what happened.

## How it works

1. A PR adds or bumps a dependency in `requirements.txt`. The Cujo GitHub App
   receives the `pull_request` webhook.
2. Ingress verifies the webhook, diffs out the changed specifiers, and starts one
   agent session with the PR context.
3. The agent provisions a Daytona sandbox and runs `sniff.py`, which installs the
   dependency behind a logging proxy and records the hosts it contacts, the files
   it touches, and the processes it spawns.
4. The agent scores that report against a rubric and reaches one verdict:
   `cleared`, `warn`, or `denied`.
5. A `cleared` or `warn` review posts automatically as `cujo-guard[bot]`. A
   `denied` verdict requests changes — and that one action pauses until a human
   approves it in the TrueForge UI.

No secret ever enters the sandbox. A dependency name goes in; a JSON report comes
out. That single narrow crossing is the property the whole design protects.

## Built on TrueForge

Cujo runs on [TrueForge](https://trueforge.dev), an open-source agent harness,
used as published — no fork. The harness supplies the model runtime, the Daytona
sandbox, the MCP tool the agent calls to post a review, and the human-approval
gate that holds the blocking review. Cujo is the agent, the review rubric, the
sandbox detonation script, and the webhook ingress built on top.

## Layout

| Path | What |
|------|------|
| `docs/` | Canonical spec. The code follows these docs; a design change lands here first. |
| `apps/ingress/` | Webhook receiver that turns a PR event into an agent session. *(skeleton)* |
| `apps/github-mcp/` | MCP server the agent calls to post a review as the GitHub App. *(skeleton)* |
| `packages/gh-app-auth/` | Shared GitHub App installation-token auth. *(skeleton)* |
| `sniff.py` | The in-sandbox detonation script. *(skeleton)* |
| `docker-compose.yml` | The TrueForge harness stack: `server`, Postgres, Redis. The file the deploy uses. |
| `docker-compose.local.yml` | Local overlay: publishes service ports and points `PUBLIC_BASE_URL` at `localhost`. Never used by the deploy. |
| `Makefile` | Local run helpers (`make up-local`, `down`, `logs`, `clean`). |

Start with [docs/architecture.md](docs/architecture.md) for the mental model, then
[docs/spec.md](docs/spec.md) for the contracts the code follows.

## Run it

The TrueForge harness runs as a Docker Compose stack. Locally, run it with the
`docker-compose.local.yml` overlay, which publishes the service ports to your
host and points `PUBLIC_BASE_URL` at `localhost` (the base `docker-compose.yml`
publishes no ports, because in the deploy a reverse proxy terminates TLS and
routes to the services on the internal network):

```bash
cp .env.example .env   # set POSTGRES_*; PUBLIC_BASE_URL is overridden locally
make up-local          # docker compose up with the local overlay
```

`make up-local` is shorthand for:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

That publishes the TrueForge UI + API on `http://localhost:8790`, plus
`ingress` (8080), `github-mcp` (8081), Postgres (5432), and Redis (6379) for
inspection. All ports bind to `127.0.0.1` (loopback) only. Other targets:
`make down`, `make logs`, `make ps`, `make clean` (drops the database volume).
Run `make help` for the full list.

> On Linux, loopback isolation of published ports relies on Docker Engine
> `>= 28.0`; older engines can route `127.0.0.1`-published ports from the LAN.
> Docker Desktop (macOS/Windows) runs the engine in a VM and is unaffected.

Open the UI at http://localhost:8790, then in Settings add a model provider key
and a Daytona sandbox key. Send a chat turn that runs a command in a sandbox to
confirm it is wired.

The deploy uses the base `docker-compose.yml` alone — the overlay and `Makefile`
are for local runs only and never touch how it deploys.

The service skeletons under `apps/` build and test with pnpm; `sniff.py` runs with
`uv`:

```bash
corepack enable && pnpm install
pnpm lint && pnpm typecheck && pnpm test
uv sync && uv run pytest
```

## Status

Early. The harness is deployed and live, the docs are the design of record, and
the repo scaffolding — workspace, tooling, CI — is in place. The service code
under `apps/` and `sniff.py` is still skeleton; the detonation and review logic
land next.

## License

MIT. See [LICENSE](LICENSE).
