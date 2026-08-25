# Decisions

Load-bearing choices and why they were made. Newest context wins; if a decision
is reversed, note it here rather than deleting the history.

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

Egress is observed by a proxy started *inside* the sandbox by `sniff.py`, with
`HTTP(S)_PROXY` set for the install. Stock TrueForge's Daytona create call passes
no network options, so the sandbox's outbound proxy cannot be set from outside
without forking. Given decision 1, the in-sandbox proxy is the way to see egress
without patching the harness.

## 4. Bot identity is a GitHub App — `cujo-guard[bot]`

Cujo posts as a GitHub App, not a human account. The App receives the PR webhooks
and, through its private key, mints short-lived installation tokens the way
Dependabot and Qodo do — the canonical bot auth flow. It needs no second user
account, and it scopes permissions to the app rather than to a person.

The App is named **Cujo Guard** (slug `cujo-guard`), so reviews post as
`cujo-guard[bot]`. Bare "cujo" and "kevinson" are both existing GitHub user
accounts, so neither is available as an App name; the product is still called
Cujo, and the bot is the `cujo-guard` variant.

## 5. The agent posts the review via MCP, not the ingress code

The review is posted by the agent calling a `github-mcp` tool, not by the
ingress service calling the GitHub API directly. Two reasons: the rubric scores
real MCP tool use, and the human-approval gate should sit on the *agent's*
action. If plumbing posted the review, the "agent, gated by a human" story would
be hollow. `github-mcp` is a small server we own that authenticates as the App.

## 6. Reviews auto-post; the human gate is on the block

Gating every review post would turn an automation tool into a manual one and
destroy its value. Instead, advisory reviews (`cleared`, `warn`) post
automatically, and the human-approval gate fires only on a `denied` verdict that
blocks the PR. This keeps the routine case automatic and gives the human a real
decision to make instead of a rubber stamp. It also fits the rule "ask before a
sensitive action" better: blocking a merge is sensitive, whereas posting a
comment is not. (Revised 2026-08-25 after the first design gated all posts.)

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

## 9. PyPI only; the hostile sample arrives as a git URL

Scope is PyPI dependencies. The malicious demo package is never published to
PyPI — it is referenced as a `git+https://…/evil-package` line in a PR, so the
payload is under our control and never reaches the public index.

## 10. Code senses, the agent judges, a hard rule guards the dangerous case

`sniff.py` emits raw signals with no judgment; the agent reasons over them
against the rubric to pick a verdict; and a deterministic rule forces `denied`
whenever a critical signal is present (decoy secret read or leaked, or a write to
a sensitive path), which the agent cannot override. This keeps real reasoning in
the agent for the ambiguous majority while making the genuinely dangerous case
impossible to reason away. Chosen over a thin agent (code decides everything,
weak harness story) and a thick agent (model decides everything, unreliable on
the security call).

## 11. Egress sensing: Python audit hook now, TLS interception later

The primary sensor is a `sys.addaudithook` hook injected via `sitecustomize.py`
on `PYTHONPATH`, capturing file opens, socket connects, and subprocess spawns in
the install's Python processes. It gives the decoy-read and process signals with
no `strace`, no special capability, and no traffic decryption. The in-sandbox
proxy adds hostnames and byte counts; a filesystem diff backstops writes. TLS
interception (mitmproxy with a trusted CA) is a later upgrade that turns "we saw
the secret read" into "we saw the secret leave" — not required for the first
working demo.

## 12. Detonate added or version-changed deps; advisory posts as COMMENT

Ingress detonates a specifier that is added or whose pin changed, because a
compromised release shipped as a version bump is a real supply-chain attack.
Advisory verdicts (`cleared`, `warn`) post as a COMMENT review so the bot never
formally approves and can never satisfy branch protection; only `denied` uses a
gated REQUEST_CHANGES. A formal APPROVE on `cleared` is a later UX option.
