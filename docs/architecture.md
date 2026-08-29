# Architecture

## The idea

A pull request diff shows what changed. It does not show what happens. A
reviewer that only reads the diff cannot see the test that now fails, the
endpoint that now returns 500, or the install-time payload in a new
dependency. It can guess; it cannot know.

Cujo reviews a pull request by running it. It clones the PR into a disposable
sandbox, runs the repo's tests on base and head, writes and runs its own probes
against the changed code, boots the app and hits it, and — when the PR adds a
dependency — installs that dependency in isolation and records what the
install does. The review it posts cites what happened, not what the diff
suggests.

Running a pull request means running a stranger's code. `pip install` alone
runs a package's `setup.py` before any of your own code executes. So all of it
runs where it holds no credentials and has no path back to our server, and the
sandbox is thrown away afterwards.

## Components

| Piece | Role |
|-------|------|
| **TrueForge** | The agent harness — the runtime that turns a model into a working agent. Deployed and live. The centerpiece the hackathon scores. Reached only by `apps/cujo` over the SDK and by `github-mcp` as a tool; its bundled UI is an operator console, not the product. |
| **Cujo agent** | The parent reviewer: a language model, the review rubric as its instructions, a sandbox, subagents, and a GitHub tool. It sets up the sandbox, delegates the checks, merges the findings, and posts. |
| **Check subagents** | One per check — `tests`, `probes`, `smoke`, `detonation`. Each starts with fresh context (its instructions and the sandbox tools, no shared history) and returns only a JSON report to the parent. |
| **Daytona sandbox** | A disposable cloud box where the untrusted PR runs. One per turn, destroyed after it. |
| **`sandbox/`** | The in-sandbox sensor code: `sniff.py` and the `cujo_sniff` package behind it. Installs one dependency behind the logging proxy and prints a forensic JSON report; its sensors (proxy, filesystem diff, decoy, Python audit hook) are shared by every check, and each report says which of them was watching while it was produced (decision 54). |
| **`apps/cujo`** | The Cujo service and TrueForge's only client. Receives the webhook, starts the turn, folds the turn's event stream into a run, serves the JSON API, and resumes a paused turn when a human approves. It has served no HTML since decision 27. Two planes and no credential: signature-gated ingress, and an anonymous read-only `/public` group (decision 34, decision 57). |
| **`apps/web`** | The UI, and the only thing a human opens. A Next.js app holding no secrets and no state; every call goes through its own `/api/*` route handlers to `apps/cujo`. One hostname, one plane: the anonymous read-only board (decision 57). |
| **Cujo GitHub App** | The bot identity. Receives PR events and posts reviews as `cujo-guard[bot]`. |
| **`github-mcp`** | A small MCP server the agent calls to post a review or block a PR. Authenticates as the GitHub App. |
| **Discord notifier** | Part of `apps/cujo`. Watches every run's status and keeps one message per run in the channel bound to that repo, plus one ping when a run blocks on a human. Notifies only; nobody approves from Discord (decision 23). A card links to the board for a public run and nowhere for a private one, which has no page (decision 57). Optional: with no bot token the service runs and says nothing. |
| **`/cujo` command** | The other half, also in `apps/cujo`. A server a repo has named in its `.cujo.yml` picks its own channel and ping role from inside Discord (Contract 8). Slash commands over an HTTP interactions endpoint, not a gateway. It routes notifications and nothing else — a review is confirmed on the pull request. |
| **Demo repos** | `orders-api`, the app we protect, and `evil-package`, a staged malicious dependency for the demo. |

## The trust boundary

Two zones, with a narrow bridge between them.

- **Trusted (our server):** the TrueForge harness, the Cujo agent and its API
  keys, `apps/cujo`, and `github-mcp`. Secrets live here, the Discord bot token
  among them.
- **Untrusted and disposable (the Daytona sandbox):** the PR's code, its
  dependencies, the check subagents' scripts, `sandbox/`, and the logging
  proxy.

Only two things cross the bridge: the PR (its code and its public metadata) and
dependency names go in, and JSON reports come out. (Cujo's own sensor script and the commands the subagents run
go in too; they are ours, carry no secret, and are the instrument, not the
specimen. So does a public run's own id, which is already public and names no
host — decision 36.) No secret ever enters the sandbox. This is the property the
whole design protects, so keep it in mind when reading the flow below.

## System map

Three zones. TrueForge is one box in the middle zone: it runs the agent, but
nothing outside the server talks to it. `apps/cujo` is the only thing GitHub
touches, and no person reaches it directly: a human reads the evidence on the
board and answers a held review on the pull request. Thick edges are that
answer's path.

```mermaid
flowchart LR
  subgraph outside [Outside]
    GH[GitHub<br/>orders-api PRs]
    Human[Human reviewer<br/>browser]
    LLM[Model provider<br/>LLM API]
    Discord[Discord channel<br/>bound to the repo]
  end

  subgraph server [Our server - compose network - secrets live here]
    Web[apps/web<br/>anonymous board<br/>read-only - no state]
    Cujo[apps/cujo<br/>webhook - run store<br/>event folder - read API<br/>resumes the held turn]
    TF[TrueForge server<br/>agent runtime - internal<br/>parent agent + subagents<br/>approval gate - sessions]
    MCP[github-mcp<br/>holds App private key]
    DB[(Postgres + Redis<br/>TrueForge state)]
  end

  subgraph sandbox [Untrusted - disposable - Daytona]
    SB[Daytona sandbox<br/>PR code at base + head<br/>tests - probes - smoke<br/>detonation - sniff.py<br/>logging proxy - decoy secret]
    Canary[Unknown host<br/>where evil-package phones]
  end

  GH -- "pull_request, issue_comment,<br/>pull_request_review_comment<br/>webhooks - HMAC" --> Cujo
  MCP -- "POST review as cujo-guard[bot]<br/>installation token" --> GH
  Human -- "reads the evidence" --> Web
  Web -- "/api/* to /public" --> Cujo
  Cujo -- "create session / turn" --> TF
  TF -- "events by thread_id" --> Cujo
  Cujo -- "user.tool_approval" --> TF
  TF -- "post_gated_review - paused" --> MCP
  TF -- "model API - key stays on server" --> LLM
  TF --> DB
  TF -- "commands" --> SB
  SB -- "JSON reports" --> TF
  SB -. "egress via proxy - logged" .-> Canary
  %% Appended last on purpose: linkStyle below indexes edges by declaration
  %% order, so inserting one earlier recolours the wrong arrows.
  Cujo -- "card per run + ping<br/>bot token" --> Discord
  Human -- "/cujo confirm on the PR" --> GH

  linkStyle 0,6,7,14 stroke:#b85c0b,stroke-width:2.5px
  style sandbox stroke-dasharray: 6 4
```

Every crossing, with what it carries and what protects it:

| From → To | Transport | What crosses | Auth |
|-----------|-----------|--------------|------|
| GitHub → `apps/cujo` | HTTPS webhook on `cujo-ingress.spencerjireh.com` | PR opened or synchronized: repo, PR number, base and head SHA | HMAC signature |
| `apps/cujo` → TrueForge | HTTP on the compose network | `sessions.create` with the inline agent spec; `createTurn` with the PR context, then `subscribeToTurn`; `listEvents` on restart | None needed; TrueForge has no public API route |
| TrueForge → `apps/cujo` | The same stream, reverse direction | Events tagged by `thread_id`: `thread.created`, `tool.response`, `thread.done` (the JSON report), `tool.approval_required` | Same connection |
| TrueForge → sandbox | Daytona API, then commands inside the box | The PR's code: a public, tokenless `git clone` of the repo checked out at base and head. The PR's public metadata (number, SHAs, changed files, title, description). The dependency names from the manifest diff. Cujo's own `sandbox/` sensor code and the commands the subagents run. The run's own id, when the repo is public, so the review can name its evidence page — an id and never a URL, so no hostname crosses (decision 36). | Daytona key on the server; nothing in the box. Private repos are a non-goal, so no clone credential exists to leak |
| Sandbox → TrueForge | Command stdout | One JSON report per check with the sensor block, the sensor-health block, and every string in it escaped | None; treated as untrusted data, which is what the escaping is for |
| Sandbox → anyone, through TrueForge | The turn download endpoint | **Nothing.** Both specs set `sandbox.fileDownloads: false`, so a file the agent wrote inside the box cannot be fetched back out through the harness. A check report reaching the parent as text on a thread event is the only way anything leaves | Closed by configuration, rather than by nobody having asked |
| Sandbox → internet | Through the in-sandbox proxy | Whatever the PR or a dependency tries to reach; logged, becomes evidence | None; the decoy secret is the only "secret" it can find |
| TrueForge → model provider | HTTPS | Prompts, reports, tool calls | Provider key, registered once on the server |
| TrueForge → `github-mcp` | MCP on the compose network | `post_advisory_review` and `post_blocking_review` (free) or `post_gated_review` (paused until a human confirms) | Internal |
| `github-mcp` → GitHub | REST API | The review: summary body plus inline comments, as `cujo-guard[bot]` | Installation token minted from the App private key |
| `apps/cujo` → GitHub | REST API | One reaction on the pull request description, tracking the run's status (Contract 9). No text, no finding, no decision — the closed set of eight emoji is the whole payload | Installation token minted from the App private key; `pull_requests: write`, which the App already holds (decision 38) |
| `apps/cujo` → GitHub | REST API | A reply on the pull request, and a reaction on the comment it answers (decision 43). Text, but only ever in answer to a person who addressed Cujo directly — never an unprompted finding | Installation token minted from the App private key; the same `pull_requests: write` |
| `apps/cujo` → TrueForge | HTTP on the compose network | A **second** session per pull request, for conversation only (Contract 10): `sessions.create` with a spec carrying `mcpServers: []`, then one turn per question. Never the review's session, which a second turn would cancel, be refused on, or corrupt | Internal |
| Human → `apps/web` | HTTPS on `cujo.spencerjireh.com` | Reads runs, check cards, findings and the posted review for a **public** repo, redacted by the allowlist in `http/public/serialize.ts`. The board opens on the run history drawn as specimens in a chamber — one per run, four arms sized by how long each check watched, a core sized by the worst thing it found, and a mark on its drop line per finding (decisions 65, 66) — then a rack of summary strips, then the record, then the key to the drawing. Nothing in the chamber is drawn that is not a measurement, down to the scan plane, which is the board re-reading this API. Clicking a specimen scrolls the record to its row rather than leaving the board. It writes nothing and decides nothing: a held finding is answered with `/cujo confirm` on the pull request (decision 49), and a Discord channel is bound with `/cujo watch` (decision 57) | None. There is no credential and no authenticated route left |
| `apps/cujo` → TrueForge | HTTP on the compose network | `createTurn` with `user.tool_approval {allow \| deny}`, then `subscribeToTurn`; the turn resumes | Internal |
| Discord → `apps/cujo` | HTTPS to `cujo-ingress.spencerjireh.com` | A `/cujo` interaction: the server, the invoking member and their permissions, and the chosen repo, channel and role (Contract 8) | Ed25519 over `timestamp + rawBody`, verified against `DISCORD_PUBLIC_KEY`; an invalid signature is 401 |
| `apps/cujo` → Discord | HTTPS to `discord.com/api/v10` | One card per run, edited in place: repo, PR number, status, check names, finding titles and evidence, and the run's Cujo link. Every derived string escaped, stripped of bidi, truncated, and mention-suppressed (Contract 7) | `Authorization: Bot`; `DISCORD_BOT_TOKEN`, held only by `apps/cujo` and never near the sandbox |

## The approval path

The mechanism the design hinges on: the pause happens inside TrueForge, the
answer is given on the pull request, and the resume goes over the SDK.

```mermaid
sequenceDiagram
  autonumber
  participant GH as GitHub
  participant C as apps/cujo
  participant TF as TrueForge
  participant Sub as Check subagents
  participant H as Human
  participant M as github-mcp

  GH->>C: pull_request webhook (HMAC)
  C->>TF: sessions.create / createTurn(PR context) + subscribeToTurn
  TF->>Sub: spawn tests, probes, smoke, detonation
  TF-->>C: thread.created (title = check name)
  Sub-->>TF: JSON report
  TF-->>C: thread.done (state.output = report)
  Note over TF: a malice hard rule forces critical
  TF->>M: post_advisory_review(the observation)
  M->>GH: COMMENT review as cujo-guard[bot]
  TF->>M: post_gated_review(the accusation)
  Note over TF,M: tool is gated - turn pauses
  TF-->>C: tool.approval_required (thread main, tool_call id)
  C->>C: run status = blocked_pending
  H->>C: reads the observation on the pull request
  H->>C: /cujo confirm
  C->>TF: createTurn(user.tool_approval allow) + subscribeToTurn
  TF->>M: post_gated_review proceeds
  M->>GH: REQUEST_CHANGES review as cujo-guard[bot]
  TF-->>C: tool.response, turn.done
  C->>C: run status = blocked_posted
```

On `/cujo dismiss`, the resume sends `deny`; the agent posts nothing further and
the run ends `denied` — the advisory observation posted before the pause and
stands, so a denial leaves the evidence on the pull request and drops only the
claim about a person.

**A held approval has no deadline.** The thirty-minute watchdog bounds a turn
that is still streaming and is cleared the moment `turn.done` arrives, which is
exactly what the pause produces, so nothing expires an unanswered accusation. It
waits on `blocked_pending` until a new head supersedes it or a `/cujo` command
decides it, and it stays in the set that rehydrates on restart. The direction is
the safe one — the merge is not blocked and the observation is already
public — but it is a wait, not an expiry, and no code says otherwise.

With no `critical` finding the agent calls `post_advisory_review` alone; with a
`critical` that says the pull request is broken rather than malicious it calls
`post_blocking_review` alone, which is not gated and ends the run
`blocked_unattended`. Neither pauses (decision 42). If a new head is pushed
while a run is still going, that run ends `superseded` and the new head gets its
own run on the same session; only the newest head is reviewed.
Superseding a run that was waiting on a human also answers its approval, since
the session refuses the new head's turn while one is pending (decision 39).

## End-to-end flow

1. **A PR arrives.** Someone opens or updates a pull request on the protected
   repo. The Cujo GitHub App fires a `pull_request` webhook.
2. **Cujo wakes the agent.** `apps/cujo` verifies the webhook, reads the PR
   metadata and changed-file list, and starts one turn in the PR's Cujo
   session with that context: repo, PR number, base SHA, head SHA, changed
   files. It stays subscribed to the turn's event stream and folds what it
   sees into a run the UI can show while the checks are still going.
3. **Into the sandbox.** The agent provisions a Daytona sandbox, clones head,
   adds a worktree at base, seeds the decoy secret, starts the logging proxy
   and the decoy watcher, and reads `.cujo.yml` from base if the repo has one
   (policy comes from the target branch, never from the PR).
4. **Run the checks.** The agent spawns one subagent per check, all at once —
   nothing a check needs comes from another, and the sensors serialise
   themselves (decision 41). `tests` runs
   the suite on base and head. `probes` writes and runs scripts against the
   changed functions. `smoke` boots the app and hits it. `detonation` runs
   only when a dependency manifest changed, installing each new or bumped
   dependency through `sniff.py`. Each subagent returns a JSON report with a
   shared sensor block: egress, file reads, writes, subprocesses, plus which
   sensors were watching and where a cap cut the evidence short. The shape is
   `docs/contracts/report.example.json`.
5. **Decide.** The parent turns the reports into findings. Hard rules force
   `critical` on a regression, a decoy read, a sensitive write, or unknown
   egress during an install, and `warn` when a sensor was not watching. The agent assigns `info`, `warn`, or `critical`
   to everything else against the rubric, then drafts one review: a summary of
   what ran plus an inline comment per anchored finding.
6. **Post, pausing only to accuse.** With no `critical` finding the review
   posts automatically as `cujo-guard[bot]`. A `critical` that says the pull
   request is broken posts too, as REQUEST_CHANGES, with no human asked. Only a
   `critical` that names the change as malicious pauses: the observation posts
   first, and the harness holds the accusation until a maintainer answers
   `/cujo confirm` or `/cujo dismiss` on the pull request, which resumes the
   turn over the SDK. The exact rule is in [spec.md](spec.md).

## User flows

The six shapes a pull request actually takes, end to end.

**A. Nothing is wrong (the common case).** PR opens, Cujo reacts on it within a
second of the delivery, the sandbox runs the four checks, one COMMENT review
lands with inline comments, and the reaction settles on the `clean` state
(Contract 9). No human. **This flow has to stay boring** — it is the argument
that Cujo is automation and not a form to fill in.

**B. The pull request breaks something.** `tests.base_pass_head_fail` comes back
non-empty, so a hard rule forces `critical`, the agent calls
`post_blocking_review`, and REQUEST_CHANGES posts unattended. The author pushes
a fix, the new run supersedes the old one, and the advisory posts. Still no
human. This flow is what makes the gate in D credible: Cujo blocks on its own
authority when the claim is about code.

**C. "Prove it."** An inline comment says a smoke endpoint returned 500 on head
and 200 on base. The maintainer replies in that thread asking for a seeded
database. That is a `pull_request_review_comment` and not an `issue_comment`,
which is why conversation subscribes to both. Cujo answers in the same thread
from a separate session that holds no write tool (Contract 10, decision 47).

**D. The accusation.** Detonation sees egress to an unknown host during an
install. The advisory posts with the observation as a `warn`, plus the line
saying what to do about it. Then `/cujo confirm` from someone with repo write,
on the current head, resumes `allow` and the gated REQUEST_CHANGES review posts;
the author may confirm, because acting against your own interest needs no guard.
Or `/cujo dismiss` resumes `deny` and the warn stands — and that verb the author
may **not** use, since it is the direction that buries an accusation against
one's own change (decision 44). Or nobody answers: the warn stands, the merge is
not blocked, and there is no deadline.

**E. Teaching.** Three pull requests in a row flag the same host, a maintainer
says `@cujo-guard that host is ours`, and Cujo opens a `.cujo.yml` pull request
adding it to `allow_hosts`; merging it is the authorization. **Not built** —
designed and tracked in [issue #56](https://github.com/spencerjireh/cujo/issues/56).

**F. Outside contributor.** A fork pull request from someone with no write
access. They read every finding and may reply to humans, and Cujo refuses both
their `/cujo` commands and their `@cujo-guard` messages, out loud. This is the
security boundary made visible: reading is public, deciding is not.

## Deployment topology

Everything runs on one Hetzner server (`hetzner-server-1`, Helsinki), deployed by
Coolify in a single `docker-compose` project so the services share a network.

- **`server`** — TrueForge (API + bundled UI) on port 8790, reached by
  `apps/cujo` at `http://server:8790` on the compose network. Its UI is also
  published at `https://cujo-harness.spencerjireh.com` behind Cloudflare Access
  (email OTP) as an operator console: read transcripts, register the model key
  and the `github-mcp` connector, debug. Nobody approves a block there
  (decision 17).
- **`postgres` + `redis`** — TrueForge hosted-mode state.
- **`cujo`** — the `apps/cujo` service, API-only since decision 27, on one
  published hostname. `https://cujo-ingress.spencerjireh.com` carries the two
  signature-gated ingress routes, with no Access policy, since neither GitHub
  nor Discord can solve an OTP challenge: `/webhook`, protected by the HMAC
  signature, and `/discord/interactions`, protected by Ed25519 (Contract 8).
  That URL is what the Discord application's Interactions Endpoint is set to.
  Its JSON API is not published; `web` reaches it at `http://cujo:8080` on the
  compose network. A volume holds its SQLite run store. It needs outbound HTTPS
  to `api.github.com` and, when Discord is configured, to `discord.com`; with
  no `DISCORD_BOT_TOKEN` set it boots normally and notifies nobody.
  `GET /healthz` is its container healthcheck and reads nothing; `GET /readyz`
  reports whether the harness has bootstrapped, which is the flag the webhook
  gates on. Both answer on each hostname this process serves — the ingress
  host and the internal name — and neither is gated (decision 37).
- **`web`** — the `apps/web` UI, on one hostname.
  `https://cujo.spencerjireh.com` is the anonymous read-only board, which lists
  public repos only and names no approver. There is no second plane and no
  credential: the operator one was deleted with its hostname (decision 57), and
  a held finding is answered with `/cujo confirm` on the pull request
  (decision 49). It proxies the JSON API at `/api/cujo/*` — forwarding only
  `/public/*`, and `GET` only, since the board has no write route — and the run
  stream at `/api/public/runs/:id/events` to `cujo` server-side, so the UI and
  the API stay same-origin (decision 27). `/api/health` is this container's
  healthcheck and never calls `cujo`.
- **`github-mcp`** — internal only, reachable by `server` over the compose
  network. Holds the GitHub App private key.

The DNS records and the Access apps exist. Coolify routes
`cujo-harness.spencerjireh.com` to `server`, `cujo-ingress.spencerjireh.com` to
`cujo`, and `cujo.spencerjireh.com` to `web`; a hostname is attachable only once
Coolify has parsed the service from the compose file on `main`, which `web`
already satisfies.
Configuration reaches the services as environment variables set in Coolify;
`.env.example` lists every name.

Every service logs structured JSON to stdout through `@cujo/log`, one event per
line, which is where Coolify reads it. There is no log collector and no tracing
backend: the per-run detail is already durable in the projection the UI renders,
so what stdout has to answer is service-level (decision 37). `CUJO_LOG_LEVEL`
selects the level and defaults to `info` when unset, so no Coolify variable has
to change for a deploy to be correct.

Merging to `main` is the deploy. Coolify watches the repository over a GitHub
webhook and rebuilds on every push to `main`, so there is no separate release
step. A variable edited in Coolify applies at the next deploy, not when it is
saved, and the running container keeps serving until the new one replaces it. So
between the merge and the swap the live service runs the pre-merge configuration
against post-merge `main`, and anything that spans the two — a `main`-relative
URL held in a variable, most of all — has to stay valid on both sides of it
(decision 35).

The Coolify control plane runs on a separate host (netcup) that never executes
untrusted code.

Cloudflare proxies all three hostnames, and a Hetzner Cloud firewall accepts
ports 80 and 443 only from Cloudflare's published ranges, so the origin's own
address is not a way past a gate; port 22 stays open for the control plane.
One Access application is left, over `cujo-harness`: that console has its own
authentication disabled, so an OTP is exactly what it is for. It is also the
only gate anywhere in this system that a person passes — `cujo` is anonymous
and `cujo-ingress` takes signatures (decision 57). A second
application scoped to `/.well-known/acme-challenge` holds a bypass policy for
each name Access fronts, without which Traefik's HTTP-01 renewal is answered by
the login page (decision 33). A Cloudflare rate-limiting rule bounds requests per address to
the public board's stream route; the process caps concurrent public streams as
well, and the two answer 429 and 503 respectively so a log says which bound bit
(decision 34).
