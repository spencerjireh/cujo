# Architecture

## The idea

`pip install` runs code from a package's `setup.py` before any of your own code
executes. So a pull request that adds a dependency is asking you to run a
stranger's code, and the diff shows you none of what that code does.

Cujo installs each newly added dependency in a disposable sandbox, records what
the install does, and reports a verdict on the pull request. The install runs
where it holds no credentials and has no path back to our server, so a malicious
package is contained and then thrown away.

## Components

| Piece | Role |
|-------|------|
| **TrueForge** | The agent harness — the runtime that turns a model into a working agent. Deployed and live. The centerpiece the hackathon scores. |
| **Cujo agent** | The configured agent: a language model, the review rubric as its instructions, a sandbox, and a GitHub tool. |
| **Daytona sandbox** | A disposable cloud box where the untrusted install runs. Destroyed after the turn. |
| **`sniff.py`** | The detonation script. Runs inside the sandbox: installs the dependency behind a logging proxy and prints a forensic JSON report. |
| **Ingress** | Turns a GitHub pull-request webhook into one TrueForge agent session. |
| **Cujo GitHub App** | The bot identity. Receives PR events and posts reviews as `cujo-guard[bot]`. |
| **`github-mcp`** | A small MCP server the agent calls to post a review or block a PR. Authenticates as the GitHub App. |
| **Demo repos** | `orders-api`, the app we protect, and `evil-package`, a staged malicious dependency for the demo. |

## The trust boundary

Two zones, with a narrow bridge between them.

- **Trusted (our server):** the TrueForge harness, the Cujo agent and its API
  keys, the ingress service, and `github-mcp`. Secrets live here.
- **Untrusted and disposable (the Daytona sandbox):** the dependency install,
  `sniff.py`, and the logging proxy.

Only two things cross the bridge: a dependency name goes in, and a JSON report
comes out. No secret ever enters the sandbox. This is the property the whole
design protects, so keep it in mind when reading the flow below.

## End-to-end flow

1. **A PR arrives.** Someone opens a pull request on the protected repo that
   adds a PyPI dependency. The Cujo GitHub App fires a `pull_request` webhook.
2. **Ingress wakes the agent.** The ingress service verifies the webhook, works
   out which dependencies are new in this PR, and starts one Cujo session with
   that context: repo, PR number, head SHA, and the new dependencies.
3. **Into the sandbox.** The agent provisions a Daytona sandbox.
4. **Detonate and record.** For each new dependency the agent runs `sniff.py`,
   which installs it behind the logging proxy and records the files it writes,
   the processes it spawns, and the hosts it contacts. The output is a JSON
   report.
5. **Decide.** The agent scores the report against the rubric and reaches one
   verdict — `cleared`, `warn`, or `denied` — then drafts a review.
6. **Post, pausing only to block.** A `cleared` or `warn` review posts
   automatically as `cujo-guard[bot]`. A `denied` verdict blocks the PR, and the
   harness pauses that one action until a human approves it. The exact rule is
   in [spec.md](spec.md).

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
