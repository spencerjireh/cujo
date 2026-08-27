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
| **`sniff.py`** | The in-sandbox sensor script. Installs one dependency behind the logging proxy and prints a forensic JSON report; its sensors (proxy, filesystem diff, decoy, Python audit hook) are shared by every check. |
| **`apps/cujo`** | The Cujo service and TrueForge's only client. Receives the webhook, starts the turn, folds the turn's event stream into a run, serves the Cujo UI and API, and resumes a paused turn when a human approves. |
| **Cujo GitHub App** | The bot identity. Receives PR events and posts reviews as `cujo-guard[bot]`. |
| **`github-mcp`** | A small MCP server the agent calls to post a review or block a PR. Authenticates as the GitHub App. |
| **Discord notifier** | Part of `apps/cujo`. Watches every run's status and keeps one message per run in the channel bound to that repo, plus one ping when a run blocks on a human. Notifies only; nobody approves from Discord (decision 22). Optional: with no bot token the service runs and says nothing. |
| **Demo repos** | `orders-api`, the app we protect, and `evil-package`, a staged malicious dependency for the demo. |

## The trust boundary

Two zones, with a narrow bridge between them.

- **Trusted (our server):** the TrueForge harness, the Cujo agent and its API
  keys, `apps/cujo`, and `github-mcp`. Secrets live here, the Discord bot token
  among them.
- **Untrusted and disposable (the Daytona sandbox):** the PR's code, its
  dependencies, the check subagents' scripts, `sniff.py`, and the logging
  proxy.

Only two things cross the bridge: the PR (its code and its public metadata) and
dependency names go in, and JSON reports come out. (Cujo's own sensor script and the commands the subagents run
go in too; they are ours, carry no secret, and are the instrument, not the
specimen.) No secret ever enters the sandbox. This is the property the
whole design protects, so keep it in mind when reading the flow below.

## System map

Three zones. TrueForge is one box in the middle zone: it runs the agent, but
nothing outside the server talks to it. `apps/cujo` is the only thing GitHub or
a person touches. Thick edges are the one path a human is on.

```mermaid
flowchart LR
  subgraph outside [Outside]
    GH[GitHub<br/>orders-api PRs]
    Human[Human reviewer<br/>browser]
    LLM[Model provider<br/>LLM API]
    Discord[Discord channel<br/>bound to the repo]
  end

  subgraph server [Our server - compose network - secrets live here]
    Access{{Cloudflare Access<br/>email OTP}}
    Cujo[apps/cujo<br/>webhook - run store<br/>event folder - UI + API<br/>approve endpoint]
    TF[TrueForge server<br/>agent runtime - internal<br/>parent agent + subagents<br/>approval gate - sessions]
    MCP[github-mcp<br/>holds App private key]
    DB[(Postgres + Redis<br/>TrueForge state)]
  end

  subgraph sandbox [Untrusted - disposable - Daytona]
    SB[Daytona sandbox<br/>PR code at base + head<br/>tests - probes - smoke<br/>detonation - sniff.py<br/>logging proxy - decoy secret]
    Canary[Unknown host<br/>where evil-package phones]
  end

  GH -- "pull_request webhook - HMAC" --> Cujo
  MCP -- "POST review as cujo-guard[bot]<br/>installation token" --> GH
  Human -- https --> Access
  Access --> Cujo
  Cujo -- "create session / turn" --> TF
  TF -- "events by thread_id" --> Cujo
  Cujo -- "user.tool_approval" --> TF
  TF -- "post_blocking_review - paused" --> MCP
  TF -- "model API - key stays on server" --> LLM
  TF --> DB
  TF -- "commands" --> SB
  SB -- "JSON reports" --> TF
  SB -. "egress via proxy - logged" .-> Canary
  %% Appended last on purpose: linkStyle below indexes edges by declaration
  %% order, so inserting one earlier recolours the wrong arrows.
  Cujo -- "card per run + ping<br/>bot token" --> Discord

  linkStyle 2,3,6,7 stroke:#b85c0b,stroke-width:2.5px
  style sandbox stroke-dasharray: 6 4
```

Every crossing, with what it carries and what protects it:

| From → To | Transport | What crosses | Auth |
|-----------|-----------|--------------|------|
| GitHub → `apps/cujo` | HTTPS webhook on `cujo-ingress.spencerjireh.com` | PR opened or synchronized: repo, PR number, base and head SHA | HMAC signature |
| `apps/cujo` → TrueForge | HTTP on the compose network | `sessions.create` with the inline agent spec; `createTurn` with the PR context, then `subscribeToTurn`; `listEvents` on restart | None needed; TrueForge has no public API route |
| TrueForge → `apps/cujo` | The same stream, reverse direction | Events tagged by `thread_id`: `thread.created`, `tool.response`, `thread.done` (the JSON report), `tool.approval_required` | Same connection |
| TrueForge → sandbox | Daytona API, then commands inside the box | The PR's code: a public, tokenless `git clone` of the repo checked out at base and head. The PR's public metadata (number, SHAs, changed files, title, description). The dependency names from the manifest diff. Cujo's own `sniff.py` and the commands the subagents run. | Daytona key on the server; nothing in the box. Private repos are a non-goal, so no clone credential exists to leak |
| Sandbox → TrueForge | Command stdout | One JSON report per check with the sensor block | None; treated as untrusted data |
| Sandbox → internet | Through the in-sandbox proxy | Whatever the PR or a dependency tries to reach; logged, becomes evidence | None; the decoy secret is the only "secret" it can find |
| TrueForge → model provider | HTTPS | Prompts, reports, tool calls | Provider key, registered once on the server |
| TrueForge → `github-mcp` | MCP on the compose network | `post_advisory_review` (free) or `post_blocking_review` (paused until a human allows) | Internal |
| `github-mcp` → GitHub | REST API | The review: summary body plus inline comments, as `cujo-guard[bot]` | Installation token minted from the App private key |
| Human → `apps/cujo` | HTTPS through Cloudflare Access on `cujo.spencerjireh.com` | Reads runs, check cards, findings, the drafted review. Writes one thing: approve or reject | Email OTP; the approve route checks the Access JWT and records the approver |
| `apps/cujo` → TrueForge | HTTP on the compose network | `createTurn` with `user.tool_approval {allow \| deny}`, then `subscribeToTurn`; the turn resumes | Internal |
| `apps/cujo` → Discord | HTTPS to `discord.com/api/v10` | One card per run, edited in place: repo, PR number, status, check names, finding titles and evidence, and the run's Cujo link. Every derived string escaped, stripped of bidi, truncated, and mention-suppressed (Contract 7) | `Authorization: Bot`; `DISCORD_BOT_TOKEN`, held only by `apps/cujo` and never near the sandbox |

## The approval path

The mechanism the design hinges on: the pause happens inside TrueForge, the
button lives in Cujo, and the resume goes over the SDK.

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
  Note over TF: hard rules force critical
  TF->>M: post_blocking_review(body, comments)
  Note over TF,M: tool is gated - turn pauses
  TF-->>C: tool.approval_required (thread main, tool_call id)
  C->>C: run status = blocked_pending
  H->>C: opens run, reads drafted review
  H->>C: Approve
  C->>TF: createTurn(user.tool_approval allow) + subscribeToTurn
  TF->>M: post_blocking_review proceeds
  M->>GH: REQUEST_CHANGES review as cujo-guard[bot]
  TF-->>C: tool.response, turn.done
  C->>C: run status = blocked_posted
```

On Reject, step 14 sends `deny`; the agent posts nothing and the run ends
`denied`. With no `critical` finding the agent calls `post_advisory_review`
instead, which is not gated, and steps 8 to 14 do not happen. If a new head
is pushed while a run is still going, that run ends `superseded` and the new
head gets its own run on the same session; only the newest head is reviewed.

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
4. **Run the checks.** The agent spawns one subagent per check. `tests` runs
   the suite on base and head. `probes` writes and runs scripts against the
   changed functions. `smoke` boots the app and hits it. `detonation` runs
   only when a dependency manifest changed, installing each new or bumped
   dependency through `sniff.py`. Each subagent returns a JSON report with a
   shared sensor block: egress, file reads, writes, subprocesses.
5. **Decide.** The parent turns the reports into findings. Hard rules force
   `critical` on a regression, a decoy read, a sensitive write, or unknown
   egress during an install. The agent assigns `info`, `warn`, or `critical`
   to everything else against the rubric, then drafts one review: a summary of
   what ran plus an inline comment per anchored finding.
6. **Post, pausing only to block.** With no `critical` finding the review
   posts automatically as `cujo-guard[bot]`. With one, the review blocks the PR,
   and the harness pauses that one action until a human approves it in the
   Cujo UI, which shows the drafted review and resumes the turn over the SDK.
   The exact rule is in [spec.md](spec.md).

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
- **`cujo`** — the `apps/cujo` service on two hostnames.
  `https://cujo-ingress.spencerjireh.com` carries only the webhook route, with
  no Access policy, since GitHub cannot solve an OTP challenge; the HMAC
  signature protects it. `https://cujo.spencerjireh.com` carries the Cujo UI
  and API behind Access; this is where a human sees a paused run and approves
  a block. A volume holds its SQLite run store. It needs outbound HTTPS to
  `api.github.com` and, when Discord is configured, to `discord.com`; with no
  `DISCORD_BOT_TOKEN` set it boots normally and notifies nobody.
- **`github-mcp`** — internal only, reachable by `server` over the compose
  network. Holds the GitHub App private key.

The DNS records and the two Access apps exist, and Coolify routes
`cujo-harness.spencerjireh.com` to `server`. The `cujo` service's two hostnames
are attached in Coolify once this compose file is on `main`, because Coolify
only offers domains for services it has parsed from the deployed file.
Configuration reaches the services as environment variables set in Coolify;
`.env.example` lists every name.

The Coolify control plane runs on a separate host (netcup) that never executes
untrusted code.
