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
becomes unreviewable for good (decision 39).

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

## 37. Logging is a closed vocabulary on stdout, and readiness is not liveness

The happy path used to be invisible in Coolify: every `console.error` covered a
failure and nothing recorded that a webhook arrived, a run was claimed, or a
turn reached a terminal status. Two changes fixed the visibility — a Standards
bullet saying to promote a stray `console.log` to `console.info`, and a pass
that added lifecycle lines across the critical path. That was the right instinct
at the wrong unit, and **this decision reverses that Standards bullet.** The
lines it produced are prose: `run abc123: status → clean`. Asking how many runs
blocked last week, or which delivery started this run, means a regular
expression over English that the next PR is free to reword. Everything that pass
made visible stays visible here; only the unit changes.

Logs are structured events on stdout, one JSON object per line, through
`@cujo/log`. No sink, no collector, no OpenTelemetry. Docker already captures
stdout and Coolify already shows it, and a collector is a service to run, back
up and secure for a system whose per-run detail is already durable — the fold
persists every projection and the UI renders it (18). What was missing was
service-level, not run-level, and stdout answers that.

**The message is an event name from a closed set.** `log.info` takes a name from
`EVENT_NAMES` and a bag of fields; there is no free-text argument. A name is
greppable and countable without parsing, which is what an audit trail needs, and
a closed set can be checked: a test scans the source for emit calls and fails on
a name that is not declared, *and* on a declared name that nothing emits, since a
vocabulary with dead entries is fiction. That test reads source files, the way
the public plane's import guard does and for the same reason — no linter
expresses the rule. `console` is then banned outright by `noConsole`, which is
what stops the vocabulary being bypassed by the older habit.

**Fields are an allowlist of scalars.** A name not in `FIELD_NAMES` is dropped at
emit and its name — never its value — is reported under `dropped_fields`, and
every name must be classified before it compiles. The value type is
`string | number | boolean | null`, so an object, an `Error`, or the `Config`
cannot be passed at all. That is the point: this process holds the App private
key, the webhook secret and the bot token, and the way a logger leaks is that
somebody spreads a wide object into a call. The same reasoning already shaped
`agent-spec.ts`, which takes the two fields it needs rather than a config, so a
future spread is a compile error instead of a leak. A pattern scrubber over every
string value is the second layer, not the first. `github-mcp` was interpolating
GitHub's raw response body into an error message that reached the logs; that is
the concrete form of the hazard, and fixing it belongs to this change.

Rejected: handing the logger the secrets to redact by exact match. It is more
precise than patterns, and it makes a bug in the logging path a total
disclosure. The logger is given nothing to lose.

**`/healthz` does not learn anything; `/readyz` is new.** The tempting fix was to
have the existing endpoint report whether the harness had bootstrapped, since a
green healthcheck sits today on a process whose webhook may have answered `503`
since boot. That would restart-loop the container. `/healthz` is the compose
healthcheck on a roughly sixty-second budget, `bootstrapUntilReady` backs off to
a minute and retries forever, and `web` starts only once `cujo` is healthy — so
readiness in `healthz` would kill the container exactly when the retry schedule
is being patient, and take the UI down with it. `/healthz` stays a liveness probe
with the body it already has; `/readyz` carries the same harness flag the
webhook itself gates on, a store ping, the public stream count, and a count of
the log lines the process could not write, and answers `503` when *either* of
the first two fails. The store belongs in that disjunction
rather than in the body alone: a delivery calls `getSession`, `putSession` and
`createRun` synchronously, so an unreachable store means no run can be claimed
however healthy the harness is. Only `cujo` gets one: `github-mcp` is stateless
per request, so its readiness *is* its liveness, and a second name for one fact
is how a health endpoint starts lying.

**A run carries the delivery that started it.** The correlation id is `ray` —
Cloudflare's `cf-ray`, or GitHub's `x-github-delivery` on the webhook plane,
which wins there because it is the value you redeliver from. But the request
answers `202` and returns while the run outlives it, and a rehydrate, a poll tick
and an approve have no request at all. So the delivery id is a column on `runs`
(appended to `MIGRATIONS`, per 25 and 30) and every run event carries it, across
restarts. It is a GitHub-side handle, so the public serializer withholds it
alongside `sessionId` and `turnIds`.

Rejected: correlating background work by run id alone. It works for a human with
a log search and breaks the moment anything wants to join a delivery to its
outcome, which is the one question the audit trail exists to answer.

The one place both ids belong on a single line is the approval, because two
different questions are being asked of it: which request decided, and which
delivery it decided about. `approve.requested` carries `ray` — the operator's
own request, bound by the middleware — beside `delivery_id`, read from the run
row and omitted when the run predates that column. `approve.applied` follows
from the run's own logger once the resume lands. They are two fields and not
one: bound fields beat call-site fields, so a handler cannot repoint `ray` at
the run without a child logger, and an earlier attempt that named the second
field `request_ray` set it from the same request ray the middleware had already
bound — one fact under two names, on the one line where the second fact
mattered.

Known limit: the vocabulary scan sees a literal first argument on a receiver
named `log` or `logger`, and nothing else. A computed name is already a type
error, since the parameter is a union of string literals, so the scan and the
compiler cover each other's gap — but neither alone is sufficient, and a third
way of reaching the logger would escape both.

## 38. `apps/cujo` may write a reaction; the gate is about reviews, not writes

A pull request gave no sign that Cujo had seen it. Everything Cujo says it says
elsewhere — a review at the end, a Discord card, a page on the board — so
between the push and the review the pull request is silent for as long as a
sandbox takes. That costs a reader an acknowledgement, and it costs an operator
the one cheap signal that would say *where* a silent run stopped: the ingress,
the signature, the session and the claim all happen before the agent does
anything, and all of them were invisible. `apps/cujo` now reacts on the pull
request as `cujo-guard[bot]` and moves that reaction with the run's status
(Contract 9).

**The invariant this appears to break is not the one that matters.** The rule
was that `apps/cujo` reads GitHub and every write goes through `github-mcp`,
where `post_blocking_review` is marked destructive and TrueForge's
`@destructive` selector pauses for a human. But the thing being protected is
that **nothing states a finding on a pull request without a human allowing it**.
A reaction states no finding, carries no text, names no file, and approves
nothing; the payload is one member of a closed set of eight emoji. Restated
honestly the rule is about reviews, and it survives intact. Kept literally, it
would have forced the acknowledgement onto the agent's own path — a third
`github-mcp` tool — where it could only fire after the agent was already
running, which is exactly the case nobody needs to debug.

**Three facts were checked against the live App before any of this was
designed**, and each one removed a piece of the build:

- **`pull_requests: write` is enough.** The endpoint is
  `POST /repos/{repo}/issues/{n}/reactions` and GitHub's docs name
  `issues: write`, but a pull request target is accepted with the permission
  the App already holds. So there is no permission change, and **no installation
  has to re-approve** — which would have left every repo unreacted until someone
  clicked, for a feature whose whole value is being immediate.
- **The POST is idempotent**: the same content twice answers 200 rather than
  201 and leaves one reaction. So "set the reaction" needs no read first and no
  stored reaction id, and a restart simply re-applies and converges. That is
  why this decision adds **no table and no migration** to a store that has to
  migrate by hand (decision 30).
- **Ours are identifiable from the list**, by `user.login` against the same
  `BOT_LOGIN` that `alreadyReviewed` already trusts, so nothing has to be
  remembered across a restart to know what to clear.

**The reactions describe what happened to the pull request, not what Cujo
concluded.** `denied` is a thumbs up: a human cleared the pull request to
proceed, even though the critical finding stands. The alternative read it as
Cujo's verdict and kept the thumbs down, which is more precise and less useful —
the audience for a reaction is whoever opened the pull request, and the board
and the Discord card both carry the precise version. `error` gets 😕 and shares
it with nothing, so one glance separates "Cujo blocked this" from "Cujo broke".

**One reaction, several runs: only a current run may write.** Reactions attach
to the pull request and not to a head SHA, so every run on a pull request is
writing to the same square inch, and delivery order is not commit order — the
stale-head guard in `start-run.ts` exists precisely because an older head's
delivery can arrive after a newer one's. The first draft acknowledged the run
before that guard and mapped `superseded` back to 👀, and the two together were
a hole: a delayed delivery for an older SHA would replace the current run's
posted verdict with 👀, then settle as `superseded` — 👀 again — and nothing
would ever restore it. The pull request would sit on a finished, clean review
wearing an eye forever. Both halves are now closed. The eye is placed only after
GitHub has confirmed this run's head is the pull request's head, and
`superseded` writes nothing at all, because the run that replaced it is about to
say what the pull request should show.

Placing the acknowledgement after that confirmation costs one GitHub read of
latency — a few hundred milliseconds — and buys back the property the whole
feature is for: 👀 still means the ingress, the signature, the session and the
claim all worked, and now means the PR read did too. It is a better signal, not
a weaker one.

**A failed call is retried, with backoff.** A terminal status is the last event
a run produces, so "the next status change will fix it" is not true where it
matters most: one transient GitHub failure on `clean` would leave the pull
request wearing 👀 indefinitely. Two retries, abandoned the moment a newer status
is queued behind — the ordering property doing its job rather than a second
mechanism. And what the reactor holds in memory to collapse the per-event storm
is bounded and evicts the least recently seen run: it lives as long as the
process and sees every run, so an unbounded map was a slow leak with no ceiling.

`CUJO_PR_REACTIONS=0` turns it off. This is the only thing `apps/cujo` writes
into somebody else's repository, and a switch that does not need a code change
is worth one line of config.

Chosen over / Rejected: **a Check Run** (`Cujo / review`, with in-progress and
completed states and a details link), which is the better product and stays on
the list — it needs `Checks: write`, which *is* a new permission every
installation must accept, and it is a much larger build than this; **a status
comment edited in place**, which is louder than a review deserves, sends a
notification on every status change, and clutters a thread Cujo is about to post
a review into; **a third `github-mcp` tool**, rejected above; **reacting before
either guard** in `start-run.ts`, covered above; and **keying the
de-duplication on the run status**, where the claim and the first fold both want
👀 and would make two identical calls — keying on the reaction set collapses
them, and two statuses that look the same on the pull request genuinely have
nothing to say to each other.

Known limit: a reaction is per pull request, so a pull request with two runs in
flight (a push landing mid-review) shows one state, the newer one. That is the
correct answer and it is still lossy; the board and the Discord card are where
per-run history lives. The residual case is narrow: a stale delivery whose
`pullRequest()` read *fails* ends in `error`, and 😕 will land over a current
run's verdict. It takes a delayed delivery and a transient GitHub failure at the
same moment, it self-corrects on the next push, and closing it would mean
teaching the reactor which run is newest for a pull request — a store query on
the fold path to buy back an emoji.

## 39. A superseded run answers its pending approval

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

The cancel is unconditional, and that is load-bearing. `claimDecision` sets the
approver without moving the status off `blocked_pending`, so an operator's
resume can be in flight and invisible to `supersede`. If that decision answered
the approval first, the deny fails — and the turn it started is reviewing a
commit nobody is looking at. Decision 20's cancel is what stops it posting, so a
failed deny falls through to it rather than returning.

That closes the one known cause. It does not heal a session already wedged, so
`Runner.start` retries once: on any `startTurn` failure it looks for an
approval left pending on the session (`pendingApproval` in `review/fold.ts`),
denies it, and tries again. `fold` cannot answer that question — it never
clears `approval`, and `decision` does not record which tool call it answered,
so a session holding one answered and one outstanding approval folds to both
fields set.

The heal refuses while any other run on the session is unfinished — `running`
included, not only `blocked_pending`. A run whose turn has already raised
`tool.approval_required` stays `running` until its own stream folds that event,
so an approval the server reports as pending can belong to a run that has not
reached the waiting state yet; a `blocked_pending`-only guard would answer for
that human. The check is repeated after `listEvents`, which is a round trip a
run can cross the line during. It costs nothing in the case that matters:
`startRun` supersedes every older run on the pull request before it starts a
turn, so by the time a heal is possible they are all terminal.

Chosen over / Rejected: **matching the 422 text** to decide whether to retry,
which pins Cujo to wording that belongs to TrueForge and fails silently when it
changes — `startTurn` failing at all is rare enough to afford one `listEvents`;
**a session per head SHA**, which reverses decision 16 and costs the agent its
memory of what it already said on the pull request, to fix a lifecycle bug;
**cancelling the approval without answering it**, which is what the code
already did and is the bug; **leaving the wedge and telling operators to reopen
the pull request**, which turns a Cujo defect into a manual step on the exact
path the product exists to serve; **denying whatever is pending with no guard
on the other runs**, which is simpler and would eventually answer for a human
mid-decision; and **an atomic store claim over the session** to serialise the
heal against an operator, which is the general answer but buys nothing the
unconditional cancel does not already cover.

Known limit: if the deny itself fails, the session stays wedged exactly as it
was. The next head retries it through `start`, so the wedge is no longer
permanent, but that head's run still ends in `error` first.

## 40. A single-server deploy may name its server, and skip the declaration

Decision 31 made a repo name its Discord server in `.cujo.yml`, so the
authority behind a binding is repo write access. That is right when a Cujo
deploy serves repos and servers belonging to different people. It costs a
commit and a merge per repo when the deploy serves exactly one server, and the
person adding the line is also the person who runs the server and owns the
repo. That is this deploy: one GitHub App installation over a hand-picked list
of one account's repos, one Discord server.

So `CUJO_DEFAULT_DISCORD_GUILD` names that server, and a repo that declares
nothing belongs to it. Setup becomes an environment variable set once and
`/cujo watch`, with nothing to merge.

This is not decision 28's rejected "guild allowlist in the environment", which
had to grow by a redeploy per server and could not express per-repo reach. It
is **one id**, and it answers "is this my own server?" rather than "is this any
server?". Public Bot is on and cannot be turned off without Discord's
verification, so anyone can invite the bot into a server they control — and
that server's id will not match, so it gets exactly the refusal it gets today.
The narrowing is what makes the default safe, not an assumption about who holds
the bot. That distinction is the whole entry: a list would be the rejected
design.

Neither half of decision 31's handshake is removed. `/cujo watch` still has to
be run by someone with Manage Server, still checked twice. A repo that names a
server still wins, including when it names a different one — the default is
consulted only after the declaration is read and found absent, so it can fill a
silence but never overrule a sentence.

Nor does it become a permanent grant. The default is checked on the delivery
path like a declaration, so unsetting the variable drops a binding it created,
exactly as reverting the commit drops a declared one. Revocation stays true of
delivery and not only of the bind.

An unreadable `.cujo.yml` is still `unknown` and the default does not rescue
it. The two callers want opposite things from that state — a command refuses
and asks for a retry, delivery keeps going — and deciding it here would decide
it for both. It also keeps the one case where the default could quietly
overrule a repo that had named someone else.

Rejected: **turning Public Bot off** and resting on "only servers the owner
invited hold the bot", which is decision 28's own rejected reasoning and is not
available anyway; **a channel webhook URL instead of the bot**, which is
genuinely simpler — the URL is a capability for one channel, and two of
decision 23's three reasons against it are wrong, since a webhook can edit its
own messages and can be validated through `GET /webhooks/{id}/{token}` — but
the URL is a secret, so configuring it goes back through the Access-gated API
that decisions 28 and 31 spent two entries escaping, and it deletes `/cujo`
along with Contract 8; **dropping the declaration entirely** for Manage Server
plus the App's installation list, which is the alternative rejected twice and
would be actively wrong while Public Bot is on.

## 41. One sensed command at a time, and one audit log per command

A check report is the slice of the shared sensor logs written while one command
ran, bounded by the byte offset `run_sensed` took before starting it. Every
check writes to the same `proxy.jsonl`, `audit.jsonl`, and `decoy.jsonl`, and
nothing in the rubric serialises the checks: `agent/SKILL.md` says to run
`tests` first and then `probes` and `smoke`, which does not stop two sub-agent
threads from wrapping a command at the same time. When they do, each report
carries the other's egress and file reads, and each filesystem snapshot diff
picks up the other's writes. The evidence is not merely noisy — it is
attributed to the wrong check, which is the one thing a report exists to get
right.

`sniff.py run` and `sniff.py detonate` now hold an exclusive `flock` on
`CUJO_DIR/sensed.lock` for the whole sensed window, so a second command waits.
A wait that exceeds fifteen minutes proceeds anyway and says so on stderr: a
review that blocks forever is not better than one that reports an overlapping
window, and the timeout is longer than any check should take.

The lock cannot fix attribution on its own, because a process a check leaves
running keeps appending after that check's window closes. So `run_sensed` also
gives each sensed command its own audit log, `CUJO_DIR/audit/<random>.jsonl`,
and points that command's `CUJO_AUDIT_LOG` at it. Attribution is then which
file a row landed in. A process an earlier check left running holds that
check's log and cannot write into this one; a command the agent runs with the
environment `setup` printed holds the shared `audit.jsonl`, which no report
reads. Previously those rows were claimed by whichever report came next.

**The first attempt tagged rows instead, and was wrong in the dangerous
direction.** `run_sensed` minted a run id, passed it as `CUJO_RUN_ID`, and
dropped rows carrying any other value. But the tag lives in the environment of
the process being measured, so a child that kept `CUJO_AUDIT_LOG` and dropped
`CUJO_RUN_ID` still wrote rows — and those rows were then filtered out of the
report. A sensor that can be silenced by unsetting a variable is worse than no
filter at all, because the report still reads as complete. Naming the file is
the same idea with the trust moved: the child cannot write into a log it was
never told about. Caught by Qodo on the pull request.

That change also removed a rule that had been added alongside the tag, which
treated every read under `CUJO_DIR` as sensor noise. With per-command logs the
wrapper's own reads of the sensor logs never reach a report anyway, so the rule
bought nothing — and it hid a command reading `decoy.backup`, which is where
`setup` parks the real credentials file the decoy displaced. Also Qodo's.

Chosen over **tagging the proxy and watcher rows the same way**, which cannot
work: those are long-lived daemons serving every check, and nothing in a
connection tells them which check opened it. Over **a proxy and a log file per
sensed run**, which is a port and two daemons per command and moves the same
ambiguity into the port allocation. Over **attributing by process tree**, which
the audit hook could nearly support (it records `pid`) but the proxy cannot.
And over **leaving it to the rubric** to serialise the checks, which is a
sentence of prose defending a correctness property, in the place where prose is
least reliable.

Known limit: the proxy rows are still bounded only by offsets. Under the lock
that is correct, and outside it — after a timeout — the report may carry
another command's hosts. The per-command log makes the audit rows exact in
both cases.

## 42. The projection holds two reviews, and a blocking review can end a run

Decision 6 said reviews auto-post and the gate fires on a blocking review.
Design 1 in [hitl.md](hitl.md) narrows that gate to the accusation, which needs
two things the projection could not express.

**Two slots, not one.** A run on the malice path posts its observation as an
advisory review and holds its conclusion for a human, so it holds two reviews at
once. `Projection.review` was a single field the folder overwrote on every review
tool call, so the second call destroyed the record of the first: the operator UI
and the public board would both have shown the un-posted accusation and not the
advisory that was actually on the pull request. `review` now means *the ungated
call, which posted*, and `gatedReview` means *the accusation, drafted*. The
classification is by tool name, so it needs no `tool.response` bookkeeping and no
new state, and it keeps `review` under its own name — which matters, because
projections are read back with `JSON.parse` and no validation and a terminal run
is never refolded, so renaming it would blank the review body on every historical
row.

The findings list splits the same way and for a sharper reason. `p.findings`
reaches the anonymous board through `public/serialize.ts`, and the drafted
review's own `findings[]` is the accusation in list form. So the agent's findings
join only once `gatedResponseSeen` says the review is on the pull request. The
hard-rule hits are not held back: those are Cujo's own measurement, and
publishing the observation while the conclusion waits is the whole design.

**`blocked_unattended`.** With the gate on `post_gated_review`, an ungated
`post_blocking_review` raises no approval, so `gatedResponseSeen` is never set,
`blocked_posted` is unreachable, and the run fell through to `clean` — a green
board row, a 🎉 on the pull request and "No critical finding" on the Discord card
for a pull request carrying REQUEST_CHANGES. Reusing `blocked_posted` was the
other candidate and it fails differently: `approver` is null on that path, so an
operator could not tell "a maintainer confirmed this accusation" from "nobody was
ever asked", which is the exact distinction this whole change exists to draw.

The status is terminal and it is not unfinished. It is deliberately absent from
`listUnfinishedRuns`' SQL, from `isTerminal`'s live pair, from `claimDecision`'s
`WHERE`, and from `canDecide` — a run in it is done, has nothing to approve, and
must never be re-followed on restart or cancelled by a supersede. It shares 👎
with `blocked_posted` because Contract 9's vocabulary is eight emoji and what
happened to the pull request is identical.

**Verification is one-directional, and after the fact.** Which review is an
accusation is now a decision the model expresses by choosing a tool name, where
before it was safe by construction because every REQUEST_CHANGES paused.
`github-mcp` cannot catch a mistake — it is write-only by decision 5 and has no
access to the check reports — and `apps/cujo` is not on the posting path. So the
folder checks the one direction it can: a malice rule tripped and nothing was
held is under-gating, and ends the run `error` naming the rule, the same shape as
decision 21's existing tripwire. Over-gating is undetectable and costs only a
question nobody needed to answer. Neither is preventable: the review is already
public under the bot's name by the time the fold sees it. Accepted, because the
alternative is keeping every REQUEST_CHANGES gated, which is the ceremony this
change removes.

## 43. `apps/cujo` may reply on a pull request, because a person asked it to

Decision 38 let `apps/cujo` write a reaction, on the argument that the rule
being protected is that **nothing states a finding on a pull request without a
human allowing it** — and that a reaction states no finding, carries no text and
names no file. A comment does carry text, so that argument does not extend to
it, and this needs its own.

The argument is that a reply is **human-initiated by construction**. Every
caller of `createComment` is answering a person who addressed Cujo directly: a
maintainer who typed `/cujo confirm` and is owed the outcome, one whose command
was refused and is owed the reason, or one who asked `@cujo-guard` a question.
Cujo never opens a thread. The thing decision 38 protects is an *unprompted*
statement about someone's code, and a reply to a direct question is a different
act — the same distinction that makes answering the door not the same as
knocking on it.

Two properties keep that honest. The write lives in `apps/cujo`, not in
`github-mcp`, so the agent has no path to it and no tool that could be
prompt-injected into using one; the conversation agent in particular holds no
write authority at all, and its answer reaches the pull request only because the
trusted plane read it out of the turn and posted it. And the body is capped at
8000 characters here rather than at GitHub's 65536, because the text can be a
model's and a reply long enough to bury a thread is a worse answer than a short
one — the one call that must never fail with a 422 is the one explaining why
something was refused.

`GitHubReactions.addToComment` is a separate method rather than a parameter on
`set`, and the reason is not tidiness. `set` deletes every bot reaction on its
target that it did not ask for, and `PrReactor` caches by run id, so a reaction
cleared through that path would never be restored: acknowledging a comment
through the pull request's reaction endpoint would silently strip the run's
verdict off the pull request for the rest of its life. The comment method is
add-only, because there is nothing to reconcile — a comment does not change
state, and "seen" is said once.

**Checked against the live App, not read off the docs**, because decision 38
already found that the docs are wrong about this family of endpoints — they name
`issues: write` for a target that a pull request permission reaches. The
installation on `spencerjireh/orders-api` holds exactly `contents: read`,
`metadata: read`, `pull_requests: write`, and with that token:

- `POST /repos/{repo}/issues/{n}/comments` — created, and deleted again.
- `POST /repos/{repo}/issues/comments/{id}/reactions` — 201.
- `GET /repos/{repo}/collaborators/{user}/permission` — 200, `permission: admin`.
  Included here because Design 2's authorization rests on it and it is the one
  most likely to have needed a grant; GitHub's own documentation states no
  permission requirement for it at all. It is reachable with `metadata: read`.

So no installation has to re-approve, which is the bar decision 38 set when it
rejected a Check Run for needing `checks: write`. The script that established
this is worth re-running if the App's permissions are ever narrowed.

## 44. Repo write is the principal that may publish an accusation

[hitl.md](hitl.md) ends by naming the question it does not answer: *who, exactly,
is the principal that may publish a public accusation naming a third party, and
is repo write access that principal?* Design 2 rests entirely on the answer. It
is yes, with one exception.

Repo write is **broader** than the policy-verified email decision 34 kept Access
for, not narrower. It includes the pull request's author, every bot with write
access, and everyone a repo admin has ever added. Decision 28 rejected a
downward swap of principal once already — Discord channel membership for an
Access email — so the swap needs an argument rather than a shrug.

The argument is that this is a different swap. Decision 28's was *sideways into
a different system*: being in a Discord channel says nothing about a repository,
so the two principals were not comparable and the weaker one was being
substituted for convenience. Repo write is the authority that actually
corresponds to the thing being decided. The claim is about code in a repository,
the consequence lands on that repository's pull request, and the people who
carry that consequence are the people who can merge to it. It is also
self-serve, auditable in GitHub's own audit log, and revoked by removing
someone — where an Access email is revoked by finding whoever holds a Cujo login.
That is decision 31's argument for `.cujo.yml`, applied to a decision rather than
a declaration.

**The author exception is not optional.** The scenario this product exists for is
hostile code in a pull request, and repo write includes whoever opened it. A
denied gate posts nothing (`SKILL.md`), so `dismiss` is the direction that buries
an accusation against one's own change, and the author is refused it by name.
`confirm` by the author is allowed: acting against your own interest needs no
guard.

Three answers, and `unknown` is why there are more than two. GitHub being
unreachable says nothing about who someone is, so it is not a refusal — but it is
not permission either, and the caller says "I could not check, try again" rather
than either "you may not" or nothing at all. The same tri-state
`GitHubReader.repoIsPublic` and `notify/authorization.ts` already use, and for
the same reason. `none` is kept apart from `unknown` because only one of them is
worth retrying.

What this does **not** claim: that repo write is as strong an identity as an
email that passed a policy. It is not. What it claims is that it is the *right*
identity for this decision, and that the audit trail it leaves — a GitHub login
in `approver`, next to a comment in the pull request's own timeline — is more
legible to the people affected than an email in a database they cannot read.

## 45. The signature-gated plane may answer a held finding

`apps/cujo/src/http/ingress/README.md` said, and Contract 8 closed with,
**nothing here may approve a review**, citing decision 28. `/cujo confirm` on a
pull request is on that plane, so that rule has to be corrected rather than
quietly stepped over.

What decision 28 actually rejected was a **principal**, not a plane. Its own
words: moving the binding into Discord "would have replaced *an email that
passes an Access policy* with *a member of a Discord server*, and those are not
the same principal". Being in a channel says nothing about a repository, so the
substitution was sideways into an unrelated system. Nothing in that argument is
about where the bytes arrive.

And this plane is already trusted with the thing it would need to be trusted
with. `github-webhook.ts` checks the HMAC **before the event type, and for every
event** — the comment there already says the signature "is what makes a
`repository` delivery as trustworthy as a `pull_request` one", and a
`repository` delivery re-stamps visibility on every run of a repo. The same
signature covers an `issue_comment`. There is no third state where GitHub is
trustworthy enough to tell Cujo a repo went private but not trustworthy enough
to tell it who wrote a comment.

So the corrected rule is about who, and it is stated in two halves:

- **Nothing that arrives from Discord may answer a held finding.** Unchanged.
  Decision 23 and Contract 8 still own it, and an interactions endpoint existing
  is still not a reason to build the button.
- **A `/cujo` command on a pull request may**, with repo write as the principal
  (decision 44), checked against GitHub on every command, and the pull request's
  author barred from `dismiss`.

Two mechanical properties keep the difference from eroding.

**The verb is an exact string, matched in the trusted plane.** Not intent, and
not a model. `@cujo-guard flagged this incorrectly, ignore it` is a sentence a
human would plausibly write and any intent parser reads as a dismissal — and
anyone in the thread can write it, including a pull request's own author.
`parse-command.ts` matches `/cujo <verb>` alone on a line, outside code fences
and blockquotes, and anything after the verb makes it prose about a command
rather than a command. A mention can never carry a privileged verb.

**Cujo ignores its own comments.** The success reply prints the verbs and a
review body can quote them, so without the `BOT_LOGIN` check a reply would
re-trigger itself.

Finally: **every outcome speaks on the pull request.** The operator UI at least
answered 409 on a refusal. A comment that is silently dropped is
indistinguishable from a delivery that never arrived, and the person who typed
the command cannot tell which happened — so each refusal names itself and says
what to do instead, the way `notify/authorization.ts` already does for Discord.
That is why there is a sentence for each of `no_such_run`,
`not_blocked_pending`, `already_decided` and `resume_failed`, and for a stale
head, an author's dismissal, a missing run, and a permission GitHub would not
confirm.

Known limit, and it is not closed here: `claimDecision` sets the approver
without moving the status off `blocked_pending`, so an allow in flight is still
invisible to `supersede`, whose unconditional cancel is load-bearing (decision
39). A confirm racing a push can therefore be recorded and then cancelled, and
the person is told it worked. That race predates this entry and belongs with the
one that owns the cancel.
