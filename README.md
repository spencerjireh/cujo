<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/readme/banner-dark.svg">
  <img alt="cujo" src="brand/readme/banner-light.svg" width="480">
</picture>

Cujo reviews pull requests by running them. It clones a PR into a throwaway
sandbox, runs the tests on base and head, probes the changed code, boots the
app, installs any new dependency in isolation, and posts a review that cites
what happened — blocking a merge only after a human approves.

## Why

A diff shows what changed. It does not show what happens. A reviewer that only
reads the diff cannot see the test that now fails, the endpoint that now
errors, or the install-time payload in a new dependency. Cujo runs the PR
first, somewhere it can do no harm, and tells you what it saw.

## How it works

1. A PR is opened or updated. The Cujo GitHub App receives the `pull_request`
   webhook.
2. Cujo verifies the webhook and starts one agent turn with the PR context:
   repo, PR number, base and head SHAs, changed files.
3. The agent provisions a Daytona sandbox, clones both SHAs, seeds a decoy
   secret, and starts a logging proxy. Then it spawns one subagent per check:
   `tests` (suite on base and head), `probes` (agent-written scripts against
   the changed code), `smoke` (boot the app, hit it), and `detonation` (only
   when a dependency manifest changed: install each new dependency through
   `sniff.py` and record the hosts it contacts, the files it touches, and the
   processes it spawns).
4. Each subagent returns a JSON report. The agent turns them into findings with
   a severity: `info`, `warn`, or `critical`. Hard rules force `critical` on a
   regression, a decoy-secret read, a sensitive write, or unknown egress during
   an install; the agent cannot downgrade those.
5. With no `critical` finding, the review posts automatically as
   `cujo-guard[bot]`: a summary of what ran plus inline comments. With one, the
   review requests changes — and that one action pauses until a human approves
   it in the Cujo UI.

No secret ever enters the sandbox. PR code and dependency names go in; JSON
reports come out. That single narrow crossing is the property the whole design
protects.

## Built on TrueForge

Cujo runs on [TrueForge](https://trueforge.dev), an open-source agent harness,
used as published — no fork. The harness supplies the model runtime, the Daytona
sandbox, the subagents, the MCP tool the agent calls to post a review, and the
human-approval gate that holds the blocking review. Cujo is the agent, the
review rubric, the in-sandbox sensor script, and the service built on top:
webhook in, an anonymous board that shows each run's evidence, and the SDK calls
that drive the harness. A held review is confirmed on the pull request itself,
with `/cujo confirm` (decision 49). Cujo's UI is a client of the harness API;
the bundled TrueForge UI is used only as an operator console.

## Layout

| Path | What |
|------|------|
| `docs/` | Canonical spec. The code follows these docs; a design change lands here first. |
| `apps/web/` | The board: the run list, and the run page with its check timeline and forensic reports. Read-only and anonymous. Proxies `/api/*` to `apps/cujo`. |
| `apps/cujo/` | The Cujo service: webhook receiver, run store, TrueForge event folder, and the read API. |
| `apps/github-mcp/` | MCP server the agent calls to post a review as the GitHub App. |
| `packages/gh-app-auth/` | Shared GitHub App installation-token auth. |
| `agent/SKILL.md` | The rubric: the parent agent's instructions, sent as the agent spec on every session. |
| `sandbox/` | Everything that runs inside the disposable box. `sniff.py` is the in-sandbox sensor script: dependency detonation plus the egress, filesystem, and decoy-secret sensors every check shares. |
| `docker-compose.yml` | The whole stack: TrueForge `server`, Postgres, Redis, `cujo`, `github-mcp`. The file the deploy uses. |
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
cp .env.example .env   # fill in the required values below
make up-local          # docker compose up with the local overlay
```

Required before the stack comes up: `POSTGRES_*`, `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `CUJO_MODEL`. Without
them `cujo` and `github-mcp` exit at start and restart until they are set.
`PUBLIC_BASE_URL` is overridden locally.

`make up-local` is shorthand for:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

That publishes the TrueForge operator console + API on `http://localhost:8790`,
plus `cujo` (8080), `github-mcp` (8081), Postgres (5432), and Redis (6379) for
inspection. `cujo` dispatches on the `Host` header: `-H 'Host: cujo'` reaches
the read API under `/public`, and `http://cujo-ingress.localhost:8080/webhook`
is the webhook receiver. Nothing is behind a credential — there is none
(decision 52) — and anything outside `/public` on the read host is 404. All
ports bind to `127.0.0.1` (loopback) only. Other targets: `make down`,
`make logs`, `make ps`, `make clean` (drops the database volume). Run
`make help` for the full list.

> On Linux, loopback isolation of published ports relies on Docker Engine
> `>= 28.0`; older engines can route `127.0.0.1`-published ports from the LAN.
> Docker Desktop (macOS/Windows) runs the engine in a VM and is unaffected.

On start, `cujo` registers `github-mcp` on the harness and, when the
`MODEL_PROVIDER_*` and `DAYTONA_API_KEY` variables are set, the model and
sandbox providers too. Without them, open the operator console at
http://localhost:8790 and add them under Settings. Then point a GitHub App
webhook at `/webhook` (a tunnel such as `cloudflared tunnel --url
http://localhost:8080` works locally; set the `Host` to the webhook hostname)
and open a PR on a repo where the App is installed. Watch it land on the board
at http://localhost:3000, or read it directly:

```bash
curl -s -H 'Host: cujo' http://localhost:8080/public/runs
```

Discord notifications are optional (see [docs/spec.md](docs/spec.md) Contract
7). Set `DISCORD_BOT_TOKEN` to the bot token of a Discord application, and
invite the bot with the `bot` scope and the View Channel, Send Messages and
Embed Links permissions. A repo with no binding is never notified, and with no
token set the service runs as before.

Bindings are made from inside Discord and nowhere else — the HTTP admin routes
went with the operator plane (decision 52). Each repo and each server sort it
out between themselves (Contract 8). Once, for the deploy: set
`DISCORD_PUBLIC_KEY` to the
application's public key, point its **Interactions Endpoint URL** at
`https://$CUJO_WEBHOOK_HOST/discord/interactions`, and invite the bot with the
`applications.commands` scope alongside `bot`.

After that there is nothing to run by hand. The repo names the server it trusts:

```yaml
# .cujo.yml on the default branch
discord_guild: "222222222222222222"
```

and anyone in that server with Manage Server runs `/cujo watch`, picking the
channel and ping role from Discord's own dropdowns. `/cujo status` shows where
each repo goes, and `/cujo test` posts a sample card to prove the path works.

Both halves are required: merging the declaration is what proves you control
the repo, and running the command is what proves the server wants it. A deploy
serving a single Discord server can answer the declaration half once with
`CUJO_DEFAULT_DISCORD_GUILD` instead of once per repo. The rules — what the
override route is for, what an unset variable changes, and why the file is read
from the default branch only — are [spec.md](docs/spec.md) Contract 8.

The deploy uses the base `docker-compose.yml` alone — the overlay and `Makefile`
are for local runs only and never touch how it deploys.

The services under `apps/` build and test with pnpm; the sensor tests run with
`uv` (`sniff.py` itself runs on the sandbox's own `python3`, decision 46):

```bash
corepack enable && pnpm install
pnpm lint && pnpm typecheck && pnpm test
uv sync && uv run pytest
```

Those are unit tests; every external boundary is faked. The harness contract
tests run `apps/cujo` against a real TrueForge server and github-mcp from the
compose file, with a stub model provider in the test process:

```bash
make test-int        # starts the stack under project cujo-int, then runs them
make test-int-down   # stops it
```

They check what the unit tests assume (turn ids, replay, chaining, cancel,
the approval gate, resume, and the fold of real events) and run in CI.

## Status

The pipeline is in: webhook to session, the four checks, the sensors, the hard
rules (applied by the agent and re-derived in `apps/cujo`), the gated review
answered with `/cujo confirm` on the pull request, conversation with
`@cujo-guard`, Discord notification, and both UI planes — the token-gated
operator view and the public read-only board.

## License

MIT. See [LICENSE](LICENSE).
