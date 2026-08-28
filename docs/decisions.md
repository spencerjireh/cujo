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
by Coolify. Its bundled UI is reachable at `cujo-harness.spencerjireh.com` as an
operator console, behind Cloudflare Access (email OTP) because TrueForge's own
auth is disabled — without a gate, anyone reaching it would be admin. The
product surface, `cujo.spencerjireh.com`, is Cujo's own UI (see 17); it sits
behind the same Access policy. The Coolify control plane stays on a separate
host that never runs untrusted code. (Revised 2026-08-27: the first design put
the TrueForge UI on `cujo.spencerjireh.com` as the surface where a human
approved a block.)

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

## 5. The agent posts the review via MCP, not the `apps/cujo` code

The review is posted by the agent calling a `github-mcp` tool, not by
`apps/cujo` calling the GitHub API directly. Two reasons: the rubric scores
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

## 7. The webhook route is on a non-Access hostname

GitHub cannot solve a Cloudflare Access OTP challenge, so the webhook endpoint
cannot sit behind Access. `apps/cujo` (see 17) serves two hostnames: its
webhook route is published at `cujo-ingress.spencerjireh.com` with no Access
policy, protected only by the webhook HMAC signature, and its UI and API at
`cujo.spencerjireh.com` behind Access. Both reach TrueForge over the internal
compose network. Hostnames are one level deep (`cujo-ingress`, not
`ingress.cujo`) because the zone's Universal SSL covers only
`*.spencerjireh.com`; a proxied two-level name needs Advanced Certificate
Manager, a paid add-on the zone does not have.

## 8. A free-tier model provider for inference; hosted Daytona for the sandbox

Inference runs on a model provider's free tier. The key is registered once on
the TrueForge server (through the operator console or a bootstrap call), and the
agent spec references the model by name, so the provider can change without
touching the repo. Hosted Daytona ($200 credit) is the sandbox
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

## 16. One session per PR; `apps/cujo` owns idempotency

A PR maps to one TrueForge session keyed by repo and PR number; a
`synchronize` event runs a new turn in it, so the agent can see what it said
before. `apps/cujo` checks the PR's existing reviews before starting a turn and
skips it if `cujo-guard[bot]` already reviewed the current head SHA. That keeps
a retried webhook from double-posting and keeps `github-mcp` write-only.

## 17. Cujo owns the operator UI; TrueForge is a dependency, not a destination

The human who approves a block does it in Cujo's own UI, not in TrueForge's
bundled chat. `apps/ingress` grows into `apps/cujo`: one service that receives
the webhook, starts the turn, consumes the turn's event stream, renders the
run, and resumes the paused turn when a human approves. It is TrueForge's only
client. TrueForge keeps every runtime job it had — the model loop, the Daytona
sandbox, the subagents, sessions, and the approval pause — and gives up one
thing: being the surface a person looks at.

Why: a customer of a PR review bot wants to see which PRs ran, what the checks
found, and one button to approve or reject the block, not an agent transcript.
The Savile Row track (best UI) cannot be won with a UI we did not build. And
the Double-O track is not hurt: the harness does the same work, the write-up
says plainly that Cujo's UI is a client of the harness API, and driving the
approval gate over the SDK demonstrates the harness as infrastructure rather
than as a chat window. Decision 1 (stock TrueForge, no fork) holds; the SDK and
HTTP API are a published interface.

What was verified against the TrueForge source (SDK 0.1.3, read 2026-08-27):

- The pause is an event. `tool.approval_required` carries `thread_id` and
  `tool_calls[{id, source_event_id}]`; the turn ends with `turn.done` and
  `required_actions` (`packages/trueforge-core/src/core/events/schema.ts`).
- Resume is an SDK call. `sessions.createTurnStream(sessionId, {input:
  [{type: 'user.tool_approval', threadId, toolCallId, approval: {status:
  'allow' | 'deny'}}]})`. One send must answer every pending approval, and a
  second answer for the same call is rejected
  (`packages/trueforge-core/src/core/runtime/AgentThread.ts:350`).
- Subagent work is visible. Every event carries `thread_id`; `thread.created`
  has `parent.{thread_id, tool_call_id}` and a `title`; `thread.done` carries
  `state.output`, the subagent's final message. Child-thread `tool.response`
  events arrive in the same turn stream.
- A run can be rebuilt. `sessions.listEvents`, `listTurnEvents`, and
  `subscribeToTurn` exist, so `apps/cujo` keeps no event log of its own.
- The agent can be defined per session. `sessions.create({agent: {spec:
  {model, instructions, mcpServers, config, skills}}})`, so the rubric and
  hard rules live in the repo as code. MCP servers are referenced by the name
  they were registered under on the server.
- Auth is OIDC or nothing. With `OIDC_*` unset the server runs as a fixed local
  admin (`packages/trueforge/src/config.ts:242`). There is no API-key mode, so
  `apps/cujo` talks to TrueForge on the compose network and Cloudflare Access
  is what keeps strangers out of both UIs.
- The subagent spawn tool is not approval-gated
  (`packages/trueforge-core/src/core/capabilities/builtins/DynamicSubAgents.ts:142`),
  so checks run without pausing; only `post_blocking_review` pauses, on the
  `main` thread.

The operator-console rule: TrueForge's UI stays reachable behind Access for
reading transcripts, registering the model key and the `github-mcp` connector,
and debugging. Humans read there; they never click Allow or send a message
into a Cujo session there. Stock TrueForge cannot disable those controls
without a fork (decision 1), so the rule is a convention, and the design does
not depend on it holding: `apps/cujo` stays subscribed to the session after a
pause, so a resume started from the console is seen, the run still reaches
`blocked_posted` or `denied`, and the approver is recorded as `external` and
shown as such in the UI (Contract 6). A stray message is the worse case — it
appends a user turn the agent acts on — and is why the console is not the
product surface.

What does not change: the trust boundary, the sandbox contract, the hard rules,
the two review tools and their gate, and one session per PR.

## 18. `apps/cujo` is a projection of TrueForge, not a source of truth

TrueForge keeps the event log. `apps/cujo` stores only what TrueForge cannot
know — the PR-to-session map, the derived run status, and who approved — and
rebuilds everything else from `listTurnEvents` after a restart. So there is no
second event store to drift out of sync, and no migration for event data. It is
one Node process (webhook route, stream consumer, API, static UI) with a SQLite
file on a volume; splitting it is a later problem. `github-mcp` stays a
separate container because it holds the GitHub App private key and is the
process TrueForge calls as a tool; folding it in would put the key in the
public-facing service. The approve route validates the Cloudflare Access JWT
(`Cf-Access-Jwt-Assertion`) so a direct request cannot skip the OTP, and
records the approver's email on the run as the human-oversight audit trail.

## 19. The sensor script reaches the sandbox by public URL, not by upload

The agent fetches `sniff.py` with `curl` from `CUJO_SNIFF_URL`, the raw GitHub
URL of this repo's `main`, before any check runs. Nothing on the server pushes
the file in, so the trust boundary stays as decision 4 states it: the only
things that enter the sandbox are the PR's public clone and Cujo's own script
and commands, fetched without a credential. The cost is that a sandbox needs
egress to `raw.githubusercontent.com` at setup, which is on the known-host list
anyway. Pinning the URL to a commit instead of `main` is a one-variable change
when the script is stable; during the hackathon `main` keeps the sandbox and
the repo in step.

The harness's own Git-backed skills would carry the rubric the same way, and
are the natural next step: `agent/SKILL.md` is already in the skill format so
registering it as a skill later is a bootstrap call, not a rewrite.

## 20. One run, one turn chain; the newest head supersedes the rest

Decision 16 puts every run on a PR in one session, so a run must know which
turns on that session are its own. It records the id of each turn it creates
(`createTurn`, then `subscribeToTurn`) before the first event, and Cujo's own
resume turns are persisted too; a turn another run recorded is never adopted,
and a run with no recorded turn after a restart ends in `error` rather than
guessing from timestamps. That errored, turnless run does not hold its head,
so a redelivery re-claims it. Chosen over deriving ownership from the event
stream (the first `turn.created` after the run's creation time), which folded
the next head's turn into a run that was still waiting on a human.

When GitHub's current head differs from a run's head, that run is
`superseded`: it stops following its turn, no decision can be made on it, and
a turn still running on the harness is cancelled so it cannot post a review
for a commit nobody is looking at. The webhook confirms the head with GitHub
rather than trusting delivery order, because a delayed delivery for an older
commit can arrive after the newer one. Chosen over keeping both runs live,
which would let a human approve a blocking review on a stale SHA.

Cancelling the turn turned out not to be enough for a run that was waiting on a
human: a superseded run answers its pending approval too, or the pull request
becomes unreviewable for good (decision 37).

## 21. The hard rules are re-derived in `apps/cujo`, not only in the rubric

Contract 3 calls Layer 1 "deterministic, code", but until this decision the
rules lived in two places that are both untrusted at the moment of judgment:
prose in `agent/SKILL.md` that the model applies, and `derived` booleans that
`sniff.py` computes inside the sandbox. `apps/cujo` now reads every check
report as its `thread.done` arrives and derives the hard-rule findings itself
(`apps/cujo/src/findings.ts`), so a `critical` the sensors recorded cannot be
reasoned away or dropped between the sandbox and the review. The agent's own
findings ride on the review tool call as `findings[]` and are merged after the
hard-rule ones.

What `apps/cujo` cannot do is stop the advisory review from posting:
`post_advisory_review` is deliberately ungated. So when the agent posts an
advisory review while a hard rule has tripped, the run ends `error` with the
rule named, not `clean`. Chosen over gating the advisory tool too (every review
would then wait for a human, which is the product's value lost) and over
re-posting a blocking review from `apps/cujo` (that would make `apps/cujo` a
second author of reviews and break "one review per turn"). The rubric still
carries the rules so the common case takes the blocking path on its own; the
trusted-side check is the tripwire behind the tripwire.

## 22. A brand system in `brand/`: guard dog, amber, dark and light

Cujo had no logo, palette, or type, and the Savile Row track judges the UI on
the video and the running product (see 17). One source of truth in `brand/`
now feeds the UI, the README, and the video, so they cannot drift apart. The
choices: keep the name and read it as a guard dog on a chain (loyal, watchful,
contained), which is what `cujo-guard[bot]` and the approval gate already say;
a flat geometric dog head with one amber eye as the mark; lowercase `cujo` in
Bricolage Grotesque with JetBrains Mono for evidence; warm near-black and warm
bone grounds with both themes built at once; amber as the brand accent and
`high`, red reserved for `critical` so the two never blur.

Rejected: renaming (the name is short, memorable, and already in every
handle); the rabid reading (it undercuts the restraint story); a cage-only or
detonation mark (abstract, loses the name); pixel and single-line styles (fail
at 16 px); red-orange as the accent (too close to critical). Five hand-authored
candidates stay in `brand/logo/candidates/` with prompts for a raster route, so
the mark can be swapped without redoing the system. The tagline is deliberately
unset. Wiring the tokens and favicon into `apps/cujo` is a separate change.

## 23. Discord is notified by `apps/cujo`, not by the agent, and it notifies only

The obvious way to tell a team about a review is to hand the agent a Discord
tool and let it announce its own progress. That makes notification a model
decision, and the facts worth announcing are not the agent's to know: "review
started" happens before the agent runs, `error` means the turn died, and
`superseded` means the turn was cancelled. The agent could also skip the call
or make it twice. `apps/cujo` already folds every one of those out of the
TrueForge event stream (Contract 6), so it notifies and the agent is not told
Discord exists. That also keeps the agent's toolset the two review tools and
nothing else.

A bot application rather than a channel webhook URL. A card that is edited in
place needs a message the poster owns; a webhook cannot read a channel, so a
binding could not be validated when it is written; and a webhook cannot host
interactions, so the button below would need the bot anyway. REST only, no
gateway and no `discord.js`: Cujo only writes, a WebSocket would be a second
always-on connection with its own reconnect state machine and nothing to
receive, `tsup` bundles with `noExternal` so a heavy dependency lands in the
image, and the interactions endpoint is HTTP too.

Notify-only, for now. A Discord interaction proves that whoever clicked is in
the channel. The Access JWT proves an email against a policy and is what
`approver` records, which is the audit trail decision 17 relies on. Approving
from Discord would quietly swap the first for the second, so the card links to
the run in Cujo instead. What is reserved for later: the unique index on
`run_discord_messages.message_id` gives the message-to-run lookup an
interaction needs, `custom_id` fits `cujo:approve:{runId}` inside its 100
characters, `approver` is free text so `discord:{userId}` needs no schema
change, and the endpoint belongs on the **webhook** host (Discord cannot solve
an Access challenge) verified with `node:crypto`'s Ed25519 against a separate
`DISCORD_PUBLIC_KEY`. Building it means deciding which Discord users may
approve, which is a change to the human gate and gets its own entry.

One card per run rather than one per pull request. A card is then one run, one
review, one approve link, and the mapping stays one-to-one. The cost is that a
pull request pushed to five times leaves five cards; that is paid down by
rewriting a superseded run's card and its ping to say so, rather than by
re-pointing a single card at whichever run is newest and losing the history of
the earlier heads.

## 24. The repo-to-channel binding lives in the store, not the environment

An environment variable would need a redeploy to add a repo, could not be
validated, and has nowhere to put `notify_role_id`. The binding is operator
data, so it sits next to the runs and is written over the API behind Cloudflare
Access, which records who bound it. The write calls Discord with the bot token
first, so a mistyped channel id is a 400 at bind time instead of silence at the
first blocked run.

The token itself stays in the environment, because a secret is not operator
data. That split is also why this does not weaken decision 18: what the store
gains is a channel id and a message id, neither of which is a credential and
neither of which TrueForge could know.

## 25. New tables, not new columns: the store has no migration path

`apps/cujo`'s whole schema is one `CREATE TABLE IF NOT EXISTS` block in the
`Store` constructor. There is no `ALTER TABLE` anywhere and no migration
runner, so adding a column to `runs` would apply to a fresh database and
silently not to the deployed one, whose `runs` table already exists. Contract 7
therefore adds `discord_channels`, `run_discord_messages` and `run_pr_meta` as
separate tables, which `CREATE TABLE IF NOT EXISTS` genuinely does apply to a
live database. It also keeps `RunRecord` and the `/runs` responses untouched,
and makes removing the feature a `DROP TABLE` rather than a column rewrite.

This defers the problem, it does not solve it. The next change that genuinely
needs to alter an existing table should add the mechanism rather than contort
around it: `PRAGMA user_version` read in the constructor, an ordered list of
migration statements, each applied inside a transaction that bumps
`user_version` in the same transaction. That was not done here because a
migration runner is its own feature with its own failure mode — a half-applied
migration on a container Coolify restarts — and `best_practices.md` asks for
one concern per pull request.

## 26. Every Discord payload is treated as attacker-controlled

Nothing on a card is written by us. The pull request title comes from GitHub,
and the finding titles, the evidence, the summary and the error text were
written by a model that had just read the code in a stranger's pull request.
So mention suppression, markdown escaping, bidi and zero-width stripping, and
hard truncation in Contract 7 are not formatting hygiene: they are the reason a
hostile pull request cannot make Cujo `@everyone` a company Discord, post an
attacker-chosen link under Cujo's name, or render "not critical" as "critical".
Escaping alone does not do it — a bidi override survives escaping, so those
characters are removed — and the 6000-character embed budget is clamped rather
than hoped for, because exceeding it is a 400 that loses the card for the whole
run.

One consequence to revisit, not a bug today: a channel's membership is not the
Access policy's membership, so a card discloses finding titles and evidence to
a wider audience than the Cujo UI does. Private repos are a non-goal for this
milestone, so everything on a card is already public. That stops being true the
day private repos are in scope, and this is the entry to reopen.

## 27. The operator UI is `apps/web`; `apps/cujo` becomes API-only

Decision 17 said the human approves in Cujo's own UI. That UI is now a Next.js
app in `apps/web` with its own container, and it takes
`cujo.spencerjireh.com`. `apps/cujo` keeps the webhook host, the run store, the
TrueForge client, and the JSON API, and stops serving HTML; its placeholder
page is gone. `cujo-harness.spencerjireh.com` is untouched and still the
TrueForge operator console.

The API is same-origin with the UI, at `/api/*`, proxied server-side by
`apps/web`. That is not tidiness: Cloudflare Access injects
`Cf-Access-Jwt-Assertion` at the edge and browser code cannot forge it, and
native `EventSource` has no header API at all, so a cross-origin API would need
a second Access application, cross-site cookie handling, and a hand-rolled
replacement for the run stream. Same origin also means no CORS and no public
route for the run store or the approve endpoint. `apps/cujo` still verifies the
assertion itself; the proxy forwards rather than terminates the check.

Chosen over path-routing at the edge, which is also same-origin but puts the
rule in Coolify where CI cannot test it and a reviewer cannot see it, and would
still need a rewrite for `pnpm dev`, so dev and production would diverge.

One wrinkle forced a small change to `apps/cujo`. Node's `fetch` silently
ignores an attempt to set the `Host` header — verified, it always sends the
target's own authority — so the proxy cannot present the public hostname to a
service it reaches at `http://cujo:8080`, and Contract 6's host dispatch would
404 every call. `createApp` therefore accepts an `internalHost`
(`CUJO_INTERNAL_HOST`, default `cujo`) alongside the UI host, serving the same
Access-gated routes on it. Rejected: forwarding `Host` verbatim through
`node:http`, which works but gives up `fetch` and forces a manual Node-stream
to web-stream bridge for the SSE proxy; and setting `CUJO_UI_HOST` to the
service name, which costs no code but makes that variable mean the internal
name and its documentation misleading.

`CheckState` gained `startedAt` and `endedAt`, taken from each thread event's
own `createdAt` rather than the clock, so the fold stays pure and a rehydrated
run keeps its timing. The UI puts the four checks on one shared time axis with
them, because when a check went red relative to the others is the information a
grid of status cards throws away.

The stack is Next.js with TanStack Query for server state, Table for the run
list, Virtual for the unbounded sensor lists, Radix for interaction behaviour
only, and Tailwind reading `brand/tokens.css` through `@theme inline` so no hex
value is restated outside `brand/`. Storybook covers the states that are hard
to reach against a live stack and is deliberately not in CI, where its browser
download would roughly double the install.

## 28. Two tiers: an operator authorizes a server, the server configures itself

Decision 24 put the repo-to-channel binding behind Cloudflare Access, which
made every routing change an operator's errand and put the choice behind a
login the people who care about the channel may not have. Moving it wholesale
into Discord would have replaced "an email that passes an Access policy" with
"a member of a Discord server", and those are not the same principal: a member
could point a repo at a channel only they are in and the team would quietly
stop hearing that reviews were blocked.

So the two questions are split. Which repos a server may reach is authorized by
an operator over the Access-gated API and recorded with their email. Which
channel and which role, inside that reach, is a `/cujo` command anyone with
Manage Server can run. The annoying part moves to the people who feel the
annoyance; the part worth an audit trail keeps one.

Rejected: Manage Server alone, with the repo restricted to the App's
installations. It is defensible today — Public Bot is off, so the only servers
holding the bot are ones the owner invited — but it rests on a fact nothing in
the system enforces or notices changing, and it would silently weaken the first
time the bot joined a second server. Also rejected: a guild allowlist in the
environment, which needs a redeploy per server and cannot express per-repo
reach.

Manage Server is enforced twice: Discord hides the command below that bar
through `default_member_permissions`, and the handler re-checks the
interaction's own `member.permissions`, because a server admin can change that
default and a check that lives only on the client is not a check.

What does not change: nobody approves a blocking review from Discord. The
interactions endpoint now exists, which makes an Approve button a small diff,
and that is exactly why Contract 8 says in writing that it must not be built
without its own entry here. An interaction proves channel membership; the
Access JWT proves an email against a policy and is what `approver` records
(decision 23).

## 29. Slash commands over the HTTP interactions endpoint, registered per server

Discord can be talked to two ways: a gateway WebSocket, or an interactions
endpoint it posts to. Decision 23 already rejected the gateway for
notifications — a second always-on connection with its own reconnect state
machine — and commands do not need it either: slash commands, autocomplete and
deferred replies are all HTTP callbacks. So `/cujo` is a route on the existing
Hono app, on the webhook host, verified with `node:crypto`'s Ed25519 and no new
dependency.

Registered per server rather than globally. A guild command appears the moment
it is written where a global one takes up to an hour to propagate, which is the
difference between a demo that works and one that does not. Registration is a
full replace on every start, so a definition cannot drift from the code across
deploys. The cost is that a server the bot joins later has no commands until the
next start; registering both ways would cover that, but Discord treats a global
and a guild command as separate, so `/cujo` would appear twice in the picker
with identical descriptions, and that confusion is worse than the gap.

## 30. The store gets a migration path, at the first change that needed one

Decision 25 chose new tables over new columns because `apps/cujo` had no way to
alter a table that already exists in a deployed database, and wrote down the
shape of the fix for whoever needed it first. Recording who bound a repo to a
channel is that change: `discord_channels` already ships, so `bound_by` had to
be a column on it or a second table existing only to hold one string.

The mechanism is the one that entry described. `PRAGMA user_version` — SQLite's
own four-byte slot, so it needs no table — is read in the constructor, and each
statement in an ordered, append-only list runs inside the transaction that
bumps the version. A container killed mid-migration comes back either before or
after a migration, never halfway. A fresh database creates the tables at their
original shape and then runs the same migrations a deployed one does, so the two
converge rather than drifting into two schemas that happen to match today.

Adding a table is still simpler and still preferred. This is for altering one
that is already out there.

## 31. The repo declares its Discord server; the operator route becomes an override

Decision 28 made a Cujo operator vouch that a Discord server may see a repo.
That was wrong in two ways at once. The authority was misplaced — a Cujo
operator is not necessarily anyone who owns the repo, so the check confirmed
the wrong fact — and it did not scale, because every repo needed a human with
an Access login to run a request by hand. In practice that meant a `curl`,
which is a fair thing to object to.

A repo now names its server itself:

```yaml
# .cujo.yml on the default branch
discord_guild: "222222222222222222"
```

The authority becomes repo write access, which is the thing that actually
correlates with owning a repo. It is self-serve for any number of repos, it is
auditable in git history like every other config change, and it is revoked by a
commit rather than by finding whoever holds a Cujo login. `.cujo.yml` was
already the repo's policy file, read from a ref the pull request cannot change,
so the file and the habit both existed.

The handshake stays two-sided, which is what stops abuse in both directions.
The repo's declaration alone would let anyone route a repo they do not own; the
server's `/cujo watch` alone would let anyone send a repo's reviews into a
server they do not belong to. Both are still required.

Cujo reads the file trusted-side, through the App, from the default branch.
Never the sandbox's copy: the sandbox holds the pull request's code, and code
that declares its own authorization is not an authorization. Reading the
default branch rather than the pull request's is also what makes the
declaration proof of control — it has to be merged.

The key is extracted with one strict pattern rather than parsed as YAML. It has
one shape, a snowflake at the top level, so anything else does not match and
the repo counts as undeclared; a YAML dependency for one scalar is not worth
the bundle or the parser's own surface. A wrong declaration is silent and never
costs a review: `/cujo watch` prints the exact line to add, and `/cujo status`
closes with it.

Revocation is checked on the delivery path, not only at bind time. A binding
written before a declaration was reverted would otherwise keep delivering
forever, which would make "revoked by a commit" a claim the code did not keep.
The cost is one cached read per notification; the alternative is a promise in
the docs that is false in the product. For the same reason `/cujo unwatch` is
ungated: the commit that revokes is exactly what makes a binding stale, so
gating cleanup behind the declaration would strand the channel.

An unreadable `.cujo.yml` is not a revocation. `declaredGuild` throws rather
than returning null on a failed read, so the two facts stay distinguishable,
and the delivery path keeps sending while a command refuses and asks for a
retry. Collapsing them would let a GitHub hiccup silence a team's reviews.

Autocomplete deliberately stopped narrowing to what a server may watch, because
that would be one `.cujo.yml` read per installed repo per keystroke against a
three-second budget. It offers everything the App is installed on, and the
refusal carries the fix.

What survives from 28: the operator route, now an override for moving a repo
between servers or for a repo whose `.cujo.yml` cannot be changed; Manage
Server, still checked twice; and the rule that nothing here approves a review.

Rejected: a claim-code flow (`/cujo claim` prints a code, someone pastes it
into a GitHub issue), which proves the same thing but is a stateful dance with
expiry and replay to get right and leaves no lasting record of the decision.
Also rejected, again, Manage Server alone — it still lets any server admin bind
any repo Cujo knows about.

## 32. The file tree carries the trust boundary, not the layer

`apps/cujo/src` was twenty flat files. Every load-bearing fact about the service
— two trust zones, two hostnames, one pure fold from events to a run — lived in
prose: `AGENTS.md`, `docs/architecture.md`, and a header comment on nearly every
file. None of it lived in the directory structure, so `webhook.ts` (reachable by
anyone on the internet, HMAC the only gate) sat indistinguishable from `api.ts`
(behind Cloudflare Access), and the distinction existed in exactly one place,
the host dispatch.

`src/` is now grouped by **trust plane and bounded context**: `http/ingress`,
`http/operator`, `review`, `notify`, `clients`, `store`, with `tests/` mirroring
it. Each directory carries a `README.md` stating its invariant, which GitHub
renders when you browse into it.

Rejected: `controllers/services/models`. It is the convention everyone already
knows, which is a real argument, and it was weighed on that basis. It loses
because layering sorts by technical role and trust zone is orthogonal to
technical role — a layered tree puts `webhook.controller.ts` beside
`runs.controller.ts` and deletes the one distinction most expensive to get
wrong. The `services/` bucket also destroys information here: `fold.ts` and
`findings.ts` are pure, `runner` and `notifier` are long-lived and stateful, and
the clients are IO; calling all of them "service" says none of that. And
`models/` implies authority, which is the opposite of what a projection is
(decision 18). Two of the four layers were kept under different names:
`clients/` is infrastructure, `store/` is repositories.

Naming: suffix only where the directory does not already say it. `store/runs.ts`
is obviously a repository and `clients/github.ts` is obviously a client, so
`.repository` and `.client` would be noise. Only `.service.ts` is used, on the
two objects that hold state across requests — `runner` and `notifier` — so its
*absence* means a file is safe to call from anywhere.

Invariants that were comments are now types. Splitting the store means the
`/cujo` command handlers hold a `NotificationStore`, which has no
`claimDecision`, so "Discord routes notifications and never approves a review"
(decision 28) is a compile error rather than a rule to remember. Splitting
`clients/` off means nothing there imports from the contexts it serves.

The duplicated rule that prompted this: "can the bot post an embed in that
channel" was written twice and had already drifted — the operator API turned a
failed permission lookup into a 400, the slash command let it reach a generic
"something went wrong". It is stated once in `notify/channel-check.ts`, which
returns a typed refusal so each caller keeps its own wording.

`sniff.py` moved to `sandbox/`, so the untrusted zone is visible at the repo
root. That changed `CUJO_SNIFF_URL`'s default; see the breaking-change note on
that commit, because the deployed value comes from Coolify and not from this
repo.

Paths named in decisions 1–31 refer to the pre-restructure tree. They are left
as written, per the rule that a decision is reversed rather than edited.

Deferred: splitting `runner.service.ts` into run lifecycle and TrueForge stream
transport. It is the largest test surface in the service and the split is a
behaviour risk, not a move.

## 33. The origin accepts Cloudflare only; the ACME path is bypassed to match

Cloudflare proxies all three hostnames, so until now the server's own address
was a path that skipped Access: fetching `https://cujo.spencerjireh.com/`
against the origin IP returned the operator UI with no login. Nothing leaked,
because `access.ts` re-checks the assertion on every request (Contract 6), so
`/api/*` answered `401` and only the empty shell rendered, which is the case
the second gate was written for. A Hetzner Cloud firewall now accepts ports 80
and 443, TCP and the UDP used by HTTP/3, only from Cloudflare's published
ranges. Port 22 stays open: the Coolify control plane deploys over it from
another host (see 2), its egress address is not fixed, and narrowing it would
risk every future deploy to close a door that already needs a key.

Locking the origin surfaced a second problem that predates it. Traefik answers
the Let's Encrypt HTTP-01 challenge and has no DNS challenge configured, but
Access sat in front of `/.well-known/acme-challenge` on
`cujo.spencerjireh.com`, so Let's Encrypt was served a login page instead of
the token and the certificate would have failed to renew on 2026-10-24,
expiring on 11-23. A
second Access application scoped to that path, holding one bypass policy, now
lets the challenge through; the path serves single-use random tokens and is
public by design. `cujo-ingress` was never affected, having no Access policy
(see 7), and `cujo-harness` uses a Cloudflare Origin CA certificate that does
not renew.

Chosen over an on-host `iptables` rule, which Docker's own chains bypass unless
it is written into `DOCKER-USER`, and which can lock the machine out with no
undo; the Hetzner firewall sits outside the server and detaches in one call.
Rejected: an Origin CA certificate for `cujo.spencerjireh.com` like the
console's, which ends the renewal dependency but puts a fifteen-year
certificate on the box and loses browser trust the moment the proxy is turned
off; and restricting port 22 to a guessed control-plane address.

## 34. The run board is public and read-only; the operator surface moves hosts

`cujo.spencerjireh.com` sat behind Cloudflare Access, so nobody could see what
Cujo does without being admitted one email at a time. The board is a projection
of *public* pull requests — the finding text and the review body describe code
that is already public. What is not public is who approved, and anything at all
about a repo that is not. So the board is now anonymous and read-only, and
everything an operator can act on moves to `cujo-admin.spencerjireh.com`, which
keeps the Access application. `cujo-harness` is untouched (see 2).

Access stays on the operator side because it is not only a lock, it is the
identity source: `approver` is an email taken from the assertion, and that
record is the whole point of the human gate (see 23 and 28). An API key would
make everyone who holds it the same principal, and a browser has nowhere safe
to keep one.

**The split is by path, not by a third hostname.** `apps/cujo` never receives
the public name — `apps/web` reaches it over the compose network and Node's
`fetch` overwrites `Host` with the target's own authority (see 27) — so a
fourth branch in the host dispatch would have to trust a forwarded header, and
a header a client can also send is not a boundary. `/public` is therefore a
route group, mounted on its own router *beside* the gated one rather than under
it. That last part is not styling: `operatorRoutes` applies its gate with
`app.use("*")`, which matches `/public/*` too, and before this the sibling
`/healthz` escaped only because Hono returns from the earlier matching handler
first — true, invisible to a reviewer, and one `await next()` from being false.

**The serializer is an allowlist.** Naming the fields to remove makes the next
field added to the projection public by default; naming the fields to keep
makes it private by default. Which one is right is decided entirely by what
happens when someone forgets, so the response is built field by field, nothing
in the public module may import from the operator one, and a compile-time
exhaustive test over both source types turns a new field into a red build until
it has been classified. A sentinel sweep covers the nested case the key checks
would miss.

**Visibility is stamped once and corrected twice.** `repository.private` on the
webhook is the fact at claim time and costs no API call. GitHub's `repository`
event carries a flip in seconds. A periodic sweep covers a delivery that never
arrived, a repo renamed out from under its stamp, and the rows that predate the
column — that last one is why it also runs at start, since without it the
fail-closed default leaves every existing run invisible and the board launches
empty. A row nobody has answered reads as private *in SQL*, so a route that
forgets the filter returns nothing rather than everything. The sweep marks a
404 private and leaves anything else alone: failing closed on a five-minute
GitHub outage would take the whole board dark while protecting nothing, because
the repo did not become private.

**The stream is bounded twice, and the two codes differ on purpose.**
Cloudflare rate-limits per address at the edge and answers 429; the process
caps concurrent public streams and answers 503 with `Retry-After`, because that
visitor sent one request and the limit is capacity, not abuse. Keeping them
apart is what lets a log say which bound bit. Operator streams are never
counted, so a busy board cannot cost somebody the approval page. The realistic
pressure is idle tabs rather than an attacker — a blocked run stays live for
hours — which is why the cap is 200 and why the page says so and falls back to
polling instead of freezing silently.

A Discord card links per run: the public board when the run is public, the
operator UI when it is not. A repo's channel holds its team, not Cujo's
operators, so pointing every card at the gated name would answer most of them
with a login page; the public run page carries its own link on to `cujo-admin`
when a decision is pending. `CUJO_UI_BASE_URL` follows `CUJO_UI_HOST` to the
admin name, which is easy to miss and would otherwise send every "needs a
human" ping to a page with no buttons.

Both hostnames are `noindex`. Cujo reviews public pull requests belonging to
people who never asked to be indexed here, and a link someone chooses to share
is a different thing from a result that surfaces beside their repository.

Chosen over a second, read-only deployment of `apps/web` against a replica of
the store, which is airtight and costs a second image and a replication story
for a demo. Rejected: redacting the operator serializer, which is
public-by-default; a fourth hostname in the router, which would trust a
forwarded header; path-scoped Access on one hostname, which answers XHR and
`EventSource` with an HTML login redirect; `NOT NULL DEFAULT 0` on the new
column, which collapses "never answered" into "private" and loses the ability
to say how many rows the sweep still owes; and two `web` containers differing
by one static variable, which is simpler and safer but doubles the deploy for a
boolean.

Known limit: `runs.repo` is a name, not an id, so a rename orphans the stamp
until the sweep's 404 rule catches up. Storing `repository.id` is the durable
fix and is not in this change.

## 35. Merging is the deploy, so an env-coupled change is valid on both sides

Coolify rebuilds on every push to `main`, so a merge is a release. Nothing in
the repo said so. That is not a documentation gap on its own — it is the reason
the wrong sequencing survived a review, so the mechanism is now in
[architecture.md](architecture.md) and the rule is in the Standards that Qodo
reads.

32 moved `sniff.py` to `sandbox/`, which changed `CUJO_SNIFF_URL`'s default
while the deployed value came from Coolify. The value was PATCHed to the new
path before the merge, on the reasoning that a variable applies at the next
deploy, so the new value and the new path would arrive together. **That
reasoning was wrong**, and it was written into the review thread as "no window
in either direction." The merge deletes the old path from `main` at once, but
the running container keeps the old value until the new one replaces it. The
health poll across that deploy shows the overlap directly: `200` after the
merge, then `503` at the container swap, then `200`. A review starting in the
overlap fetches a path that no longer exists and dies at sandbox setup — which
reads as a Cujo bug, not as a deploy artifact. None did, by luck.

So the rule is two releases, not two minutes: **add the new location while the
old one still answers, let the deploy land, delete the old one in a follow-up.**
PATCH-then-merge is still the right order and is still not enough; it narrows
the window to the deploy rather than removing it.

This binds only what Coolify holds and what is fetched from `main` at run time.
A path inside the image moves with the image and has no window at all, which is
why this is a rule about variables and raw-content URLs and not about
refactoring.

Rejected: patching the variable after the merge, and restarting before it — both
widen the same window, the second by pointing the new value at old `main`.
Also rejected: accepting it because a deploy is short. The length is not
observable from here (`GET /deployments/...` is 403 for this token), so the
argument rests on a number nobody can check, and the failure it trades away is
silent.

Known limit: nothing enforces this mechanically. It is a review rule, which is
why it lives in `best_practices.md` rather than only here.

## 36. The review links to its own evidence, and the bot wears the brand

Decision 34 made the run board public and anonymous, and then nothing pointed
at it. The review `cujo-guard[bot]` posts is *What ran*, *Results*, *Egress*
and then it stops, so a reader who wants the test output, the egress table, or
the detonation report has nowhere to go — the evidence is sitting on a page
anyone can open and the pull request never mentions it. Every review on a
public repo now ends with a rule and one line: `Full evidence: <run page>`.

`github-mcp` composes that footer, and the agent supplies neither the format nor
the destination. The alternative was a line in `agent/SKILL.md` telling the
model to end its body a particular way, which is a rule that fails silently — a
model can forget it, reword it, or put it above *Egress*, and none of those are
visible until a human reads a posted review. Composed in `body.ts` the footer is
correct or absent, and absent only when Cujo says so.

**The agent relays a run id, not a URL**, and that distinction is the whole
security argument. The value crosses an agent that has just read a stranger's
pull request, so anything it carries is something that pull request can try to
choose. A URL would let it choose the host, and the bot would then vouch for an
arbitrary link under `Full evidence:` in a review posted as `cujo-guard[bot]` —
which is exactly the credibility the product is built to earn. It would also
have been injectable: `z.string().url()` accepts a string with embedded
newlines, because WHATWG parsing strips them for validation while Zod returns
the original, so `https://x/\n\n## Merged and approved\n\n[Click here](…)`
passes and reaches the body verbatim. A UUID admits neither. `github-mcp` holds
the host in `CUJO_PUBLIC_BASE_URL` and builds `<base>/runs/<uuid>` itself, so
the worst a redirected agent can do is name a different run on Cujo's own board.

Two independent conditions gate the footer and each side owns the one it can
answer. `apps/cujo` knows repository visibility, so `review/links.ts` exports
`publicRunId`, which returns `""` for a private run, and `buildTurnMessage` then
omits the key entirely; omitting rather than sending `""` makes the absent key
and the optional schema field the same rule, so nothing downstream needs a
special case. `github-mcp` knows whether this deployment has a board, and
appends nothing without one. Either missing costs every review its footer and
costs no review its posting, which is the right direction for a cosmetic field.

A private repository therefore gets no footer at all. It has no page a reader of
the pull request could open: the operator host would answer with a login screen
and the board root would answer with a page about some other run, and both are
worse than saying nothing.

The Discord cards move off Discord's palette onto `brand/tokens.css`. Two rules
decide the map and both are worth keeping when a status is added: **amber marks
exactly one status**, `blocked_pending`, because amber is the brand and
`brand.md` spends it on the thing a person must act on; and **red means the pull
request is dangerous, never that Cujo fell over**, which is why a run that
errors is `--sev-info` blue. An errored run is a status, not a verdict on
someone's code, and colouring it red teaches an operator to discount the colour
that matters most. The three states nobody can act on — clean, denied,
superseded — form a ramp of decreasing lightness rather than three arbitrary
greys.

Writing this down exposed that `brand.md`'s five-level severity ramp never
matched the product. Cujo emits three severities, `critical`, `warn`, and
`info`; `warn` is not in the ramp at all, `SeverityBadge.tsx` has been quietly
bridging it to the high tokens, and `--sev-medium` and `--sev-low` are
referenced by nothing outside Storybook. `brand.md` now says so. The words stay
as they are: they are matched literally in `review/fold.ts` and validated by the
review tool's schema, so renaming one is a code change and not a copy change,
and the voice pass in `agent/SKILL.md` deliberately does not touch them.

The GitHub App also gets an avatar and a description, which it had never had.
Neither existing mark could serve: `logo/mark.svg` is near-black on transparent
and `logo/favicon.svg` is bone on transparent, while an App avatar renders on
both the light and the dark GitHub UI, so it has to carry its own ground.
`logo/avatar.svg` is the mark on a `--bg` dark tile with the clear-space rule
satisfied at 512.

On the trust boundary: `run_id` is the one field this adds to the turn payload,
and it is Cujo's own artifact identifier — the same category as the sensor
script URL already substituted into the rubric, and already public, since it is
the last path segment of a page anyone can open. It carries no secret, names no
host, and grants the sandbox nothing it could not read off the board. It is
deliberately the smallest thing that could have crossed: the URL it replaced
would have carried a hostname, which is precisely the part worth withholding.

Chosen over / Rejected: **a full `run_url` from the agent**, which hands the
pull request under review a say in where the bot's own evidence link points, and
which `z.string().url()` cannot even be made to sanitise properly; having
`github-mcp` verify repository visibility itself through the GitHub API, which
is more robust but adds an API call and a failure mode to every review and
widens a server whose comment says it "reads nothing but the PR's diff"; linking
a private repo's review to `cujo-admin`, which
sends most readers to a login screen for a page they will never be allowed to
see; linking to the board root, which loads for everyone and says nothing about
this pull request, so it reads as a broken link; adding a success green to the
brand ramp so `clean` could be positive, when `brand.md` already says a calm
review has almost no colour on the page and a passing run is quiet rather than
celebratory; keeping Discord's green for `clean` alone, which leaves two design
systems in one file; and putting the mark in the review body, which GitHub
renders small, adds a remote asset to every comment, and argues against the
terse and evidential voice the same pass was tightening.

Known limit: the footer is a permalink to a page whose visibility can change. A
repo made private after a review leaves a live GitHub comment pointing at a URL
that now 404s. That is the correct answer — the page is gone — but the link
stays in the comment, and nothing in this decision can retract it.

## 37. A superseded run answers its pending approval

Decision 20 says a superseded run cancels its turn so it cannot post a review
for a commit nobody is looking at. That was not enough, and the gap made the
ordinary workflow fail: Cujo blocks a pull request, the author pushes the fix,
and the fix is never reviewed. Every head after the block failed to start with

```
422 thread main: user message cannot be sent while approvals or questions are pending
```

An approval is outstanding on the **session**, not on the turn that raised it.
`tool.approval_required` ends the turn it arrives in (Contract 4), so by the
time a newer head arrives there is nothing left to cancel, and `sessions.cancel`
was never the call that answers it. Decision 16 keys the session on the pull
request, so the wedge is permanent: that pull request can never be reviewed
again. Reproduced on `orders-api` PR 5, which had to be closed and reopened
before the run could complete.

So `supersede` now denies the approval before cancelling, with a reason of its
own. The operator's deny says a human rejected the block; here nobody rejected
anything, and the string reaches the model, which the rubric tells to end its
turn saying the block was denied. `STALE_DENY_REASON` says the commit was
replaced instead. The deny starts a turn, which is cancelled straight after:
that turn holds a review of a head nobody is looking at, and `supersede`'s
caller starts the newer head's turn as soon as it resolves. The deny turn is
recorded through `addCujoTurn`, so a replay can never read it as a resume sent
from outside and stamp the run `approver: external`. The run stays
`superseded`, never `denied` — `denied` means an operator said no.

That closes the one known cause. It does not heal a session already wedged, so
`Runner.start` retries once: on any `startTurn` failure it looks for an
approval left pending on the session (`pendingApproval` in `review/fold.ts`),
denies it, and tries again. `fold` cannot answer that question — it never
clears `approval`, and `decision` does not record which tool call it answered,
so a session holding one answered and one outstanding approval folds to both
fields set. The heal refuses while any run on the session is `blocked_pending`:
that approval is one a human is being asked about right now, and answering it
for them is the one thing this must never do.

Chosen over / Rejected: **matching the 422 text** to decide whether to retry,
which pins Cujo to wording that belongs to TrueForge and fails silently when it
changes — `startTurn` failing at all is rare enough to afford one `listEvents`;
**a session per head SHA**, which reverses decision 16 and costs the agent its
memory of what it already said on the pull request, to fix a lifecycle bug;
**cancelling the approval without answering it**, which is what the code
already did and is the bug; **leaving the wedge and telling operators to reopen
the pull request**, which turns a Cujo defect into a manual step on the exact
path the product exists to serve; and **denying whatever is pending with no
`blocked_pending` guard**, which is simpler and would eventually answer for a
human mid-decision.

Known limit: if the deny itself fails, the session stays wedged exactly as it
was. The next head retries it through `start`, so the wedge is no longer
permanent, but that head's run still ends in `error` first.
