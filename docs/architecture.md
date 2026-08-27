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
| **TrueForge** | The agent harness — the runtime that turns a model into a working agent. Deployed and live. The centerpiece the hackathon scores. |
| **Cujo agent** | The parent reviewer: a language model, the review rubric as its instructions, a sandbox, subagents, and a GitHub tool. It sets up the sandbox, delegates the checks, merges the findings, and posts. |
| **Check subagents** | One per check — `tests`, `probes`, `smoke`, `detonation`. Each starts with fresh context (its instructions and the sandbox tools, no shared history) and returns only a JSON report to the parent. |
| **Daytona sandbox** | A disposable cloud box where the untrusted PR runs. One per turn, destroyed after it. |
| **`sniff.py`** | The in-sandbox sensor script. Installs one dependency behind the logging proxy and prints a forensic JSON report; its sensors (proxy, filesystem diff, decoy, Python audit hook) are shared by every check. |
| **Ingress** | Turns a GitHub pull-request webhook into one TrueForge agent turn. |
| **Cujo GitHub App** | The bot identity. Receives PR events and posts reviews as `cujo-guard[bot]`. |
| **`github-mcp`** | A small MCP server the agent calls to post a review or block a PR. Authenticates as the GitHub App. |
| **Demo repos** | `orders-api`, the app we protect, and `evil-package`, a staged malicious dependency for the demo. |

## The trust boundary

Two zones, with a narrow bridge between them.

- **Trusted (our server):** the TrueForge harness, the Cujo agent and its API
  keys, the ingress service, and `github-mcp`. Secrets live here.
- **Untrusted and disposable (the Daytona sandbox):** the PR's code, its
  dependencies, the check subagents' scripts, `sniff.py`, and the logging
  proxy.

Only two things cross the bridge: PR code and dependency names go in, and JSON
reports come out. No secret ever enters the sandbox. This is the property the
whole design protects, so keep it in mind when reading the flow below.

## End-to-end flow

1. **A PR arrives.** Someone opens or updates a pull request on the protected
   repo. The Cujo GitHub App fires a `pull_request` webhook.
2. **Ingress wakes the agent.** The ingress service verifies the webhook,
   reads the PR metadata and changed-file list, and starts one turn in the
   PR's Cujo session with that context: repo, PR number, base SHA, head SHA,
   changed files.
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
   and the harness pauses that one action until a human approves it. The exact
   rule is in [spec.md](spec.md).

## Deployment topology

Everything runs on one Hetzner server (`hetzner-server-1`, Helsinki), deployed by
Coolify in a single `docker-compose` project so the services share a network.

- **`server`** — TrueForge (API + UI) on port 8790. Public at
  `https://cujo.spencerjireh.com` behind Cloudflare Access (email OTP), because
  TrueForge's own auth is off and anyone reaching it would otherwise be admin.
  This is where a human sees a paused session and approves a block.
- **`postgres` + `redis`** — TrueForge hosted-mode state.
- **`ingress`** — public at `https://ingress.cujo.spencerjireh.com` with no
  Access policy, since GitHub cannot solve an OTP challenge. It is protected by
  the webhook HMAC signature and reaches TrueForge over the internal network at
  `http://server:8790`.
- **`github-mcp`** — internal only, reachable by `server` over the compose
  network. Holds the GitHub App private key.

The Coolify control plane runs on a separate host (netcup) that never executes
untrusted code.
