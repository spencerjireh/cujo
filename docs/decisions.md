# Decisions

Load-bearing choices and why they were made. Newest context wins. A decision
that is reversed after it was built or shown is noted here rather than deleted
(see 6); a design that was only ever on paper is rewritten in place.

## 1. Build on stock TrueForge — no fork

Use the published `@truefoundry/trueforge` package as-is. The rubric rewards
using the harness well (real MCP tools, sandbox execution, human approvals), not
modifying it; no criterion rewards upstream contributions. A fork adds
maintenance and risk for no score. Everything Cujo needs is reachable through
configuration and the SDK.

## 2. Hosted mode on Hetzner via Coolify, gated by Cloudflare Access

TrueForge runs in hosted mode (Postgres + Redis) on one Hetzner server, deployed
by Coolify. The UI is public at `cujo.spencerjireh.com` but sits behind
Cloudflare Access (email OTP) because TrueForge's own auth is disabled — without
a gate, anyone reaching it would be admin. The Coolify control plane stays on a
separate host that never runs untrusted code.

## 3. In-sandbox logging proxy — not Daytona's `outboundProxyUrl`

Egress is observed by a proxy started *inside* the sandbox, with
`HTTP(S)_PROXY` exported for every process the checks spawn. Stock TrueForge's
Daytona create call passes no network options, so the sandbox's outbound proxy
cannot be set from outside without forking. Given decision 1, the in-sandbox
proxy is the way to see egress without patching the harness. It observes
processes that honour the proxy variables; a direct socket from non-Python
code is a known gap, closed later by a network-namespace or iptables redirect
inside the sandbox.

## 4. Bot identity is a GitHub App — `cujo-guard[bot]`

Cujo posts as a GitHub App, not a human account. The App receives the PR webhooks
and, through its private key, mints short-lived installation tokens the way
Dependabot and Qodo do — the canonical bot auth flow. It needs no second user
account, and it scopes permissions to the app rather than to a person. Bare
`cujo` is an existing GitHub account, so the App is **Cujo Guard** (slug
`cujo-guard`) and reviews post as `cujo-guard[bot]`.

## 5. The agent posts the review via MCP, not the ingress code

The review is posted by the agent calling a `github-mcp` tool, not by the
ingress service calling the GitHub API directly. Two reasons: the rubric scores
real MCP tool use, and the human-approval gate should sit on the *agent's*
action. If plumbing posted the review, the "agent, gated by a human" story would
be hollow. `github-mcp` is a small server we own that authenticates as the App.

## 6. Reviews auto-post; the human gate is on the block

Gating every review post would turn an automation tool into a manual one and
destroy its value. Instead, advisory reviews post automatically, and the
human-approval gate fires only on a blocking review. This keeps the routine
case automatic and gives the human a real decision to make instead of a rubber
stamp. It also fits the rule "ask before a sensitive action" better: blocking a
merge is sensitive, whereas posting a comment is not. (Revised 2026-08-25 after
the first design gated all posts.)

## 7. Ingress is a separate service on a non-Access hostname

GitHub cannot solve a Cloudflare Access OTP challenge, so the webhook endpoint
cannot sit behind Access. Ingress is published at
`ingress.cujo.spencerjireh.com` with no Access policy, protected by the webhook
HMAC signature, and reaches TrueForge over the internal compose network.

## 8. A free-tier model provider for inference; hosted Daytona for the sandbox

Inference runs on a model provider's free tier, chosen at deploy time in the
TrueForge UI (bring-your-own key) and not pinned in code — so the provider can
change without touching the repo. Hosted Daytona ($200 credit) is the sandbox
provider; self-hosted Daytona is a later stretch, not needed for the demo.

## 9. Code senses, the agent judges, hard rules guard the dangerous cases

The sandbox run emits raw signals with no judgment; the agent reasons over
them against the rubric to assign each finding a severity; and deterministic
rules force `critical` whenever a critical signal is present, which the agent
cannot override. The hard rules: a test that passes on base and fails on head;
the decoy secret read or seen leaving; a write to a sensitive path; egress to a
host that is neither a package index nor allowlisted, during an install. The
regression tripwire is the one the demo leans on: a diff can look like a tidy
refactor and still break a test, and the model must not be able to talk itself
out of that. This keeps real reasoning in the agent for the ambiguous majority
while making the genuinely dangerous cases impossible to reason away. Chosen
over a thin agent (code decides everything, weak harness story) and a thick
agent (model decides everything, unreliable on the security call).

## 10. Sensors: language-agnostic base, Python audit hook on top, TLS later

Three sensors work for any language: the in-sandbox proxy (egress hosts and
byte counts), a filesystem diff (writes outside the workspace and to sensitive
paths), and an inotify watcher on the decoy file (reads; chosen over
access-time comparison because `relatime` and `noatime` make `atime`
unreliable). When a check runs Python, a
`sys.addaudithook` hook injected via `sitecustomize.py` on `PYTHONPATH` is
layered on and gives richer file, socket, and subprocess detail; it rides into
every Python subprocess, including pip running `setup.py`. No `strace`, no
special capability, no traffic decryption. TLS interception (mitmproxy with a
trusted CA) is a later upgrade that turns "we saw the secret read" into "we saw
the secret leave" — not required for the first working demo.

## 11. Cujo reviews the whole PR by running it; detonation is one check

The argument for the sandbox — the PR asks you to run a stranger's code —
applies to every line of a PR, not only a dependency's `setup.py`, and a review
that cites execution evidence (a test that fails on head, a probe that
contradicts the diff, an endpoint that errors) is what a diff-only reviewer
such as Qodo cannot produce. So every PR gets a run: `tests`, `probes`,
`smoke`, and `detonation` when a dependency manifest changed. The hostile demo
sample is never published to a public index; it arrives as a `git+https://`
line in a PR, so the payload stays under our control.

## 12. Findings with severity, not a single verdict

A code review is multi-dimensional; one word cannot carry a failing test and a
suspicious host at once. Each finding gets a severity (`info`, `warn`,
`critical`) and an optional line anchor. The block decision stays binary: any
`critical` finding routes to the gated `post_blocking_review`
(REQUEST_CHANGES); otherwise `post_advisory_review` posts a COMMENT with the
summary and inline comments. The bot never posts a formal APPROVE, so it can
never satisfy branch protection and wave a bad merge through.

## 13. Agent infers repo commands; `.cujo.yml` overrides

No setup burden on the target repo: the agent reads `pyproject.toml`,
`package.json`, `Makefile`, and CI workflows to pick install, test, boot, and
smoke commands. A `.cujo.yml` (`install`, `test`, `boot`, `smoke`,
`allow_hosts`) pins any of them when a repo owner wants determinism. The file
is read from the base SHA, never from the PR: policy comes from the branch the
PR targets, so a PR cannot allowlist its own exfiltration host, and a PR that
edits `.cujo.yml` gets a `warn` finding instead of having the edit applied.
Chosen over a required config file (a repo without it would get no
execution-backed review) and over parsing CI workflows alone (tight coupling
to CI shape).

## 14. One subagent per check

Each check (`tests`, `probes`, `smoke`, `detonation`) runs in a TrueForge
dynamic subagent with fresh context; only its JSON report returns to the
parent. This keeps each check's context small and focused, keeps a noisy test
log from crowding out the detonation report, and exercises the subagent
feature the Double-O track names. The parent owns setup, the hard rules,
synthesis, and the post.

## 15. No tests means one `warn` and stop

If the repo has no test suite and `.cujo.yml` names none, the parent posts a
single `warn` finding ("no test suite found") and runs nothing else. Without a
suite the regression tripwire cannot fire, so execution evidence would be
thin, and the missing suite is itself the most useful thing to say. Chosen
over falling back to probes and smoke (execution without a baseline) and over
a diff-only review (which Qodo already provides).

## 16. One session per PR; ingress owns idempotency

A PR maps to one TrueForge session keyed by repo and PR number; a
`synchronize` event runs a new turn in it, so the agent can see what it said
before. Ingress checks the PR's existing reviews before starting a turn and
skips it if `cujo-guard[bot]` already reviewed the current head SHA. That keeps
a retried webhook from double-posting and keeps `github-mcp` write-only.
