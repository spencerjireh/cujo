# Decisions archive

The full text of decisions that a later decision fully reversed. Each entry
is kept verbatim as it stood before decision 178 moved it here. The live
record, with a stub and status line for each of these, is
[decisions.md](decisions.md).

## 1. Build on stock TrueForge — no fork

**Reversed by 123.** The harness is `apps/harness`, built on the pi coding agent SDK; TrueForge is gone from the deploy.

Use the published `@truefoundry/trueforge` package as-is. The rubric rewards
using the harness well (real MCP tools, sandbox execution, human approvals), not
modifying it; no criterion rewards upstream contributions. A fork adds
maintenance and risk for no score. Everything Cujo needs is reachable through
configuration and the SDK.

## 2. Hosted mode on Hetzner via Coolify, gated by Cloudflare Access

**Superseded in part by 34, 49 and 57, and the rest by 123.** There is no
hosted-mode harness and no console left to gate: `apps/harness` is a
single-process service on a volume. The operator plane is gone
entirely, and its Access gate with it; the `cujo-harness` console gate
stands and is now the only one anywhere in this system.

TrueForge runs in hosted mode (Postgres + Redis) on one Hetzner server, deployed
by Coolify. Its bundled UI is reachable at `cujo-harness.spencerjireh.com` as an
operator console, behind Cloudflare Access (email OTP) because TrueForge's own
auth is disabled — without a gate, anyone reaching it would be admin. The
product surface, `cujo.spencerjireh.com`, is Cujo's own UI (see 17); it sits
behind the same Access policy. The Coolify control plane stays on a separate
host that never runs untrusted code. (Revised 2026-08-27: the first design put
the TrueForge UI on `cujo.spencerjireh.com` as the surface where a human
approved a block.)

## 6. Reviews auto-post; the human gate is on the block

**Superseded by 42.** The gate no longer fires on any blocking review, only
on the accusation.

Gating every review post would turn an automation tool into a manual one and
destroy its value. Instead, advisory reviews post automatically, and the
human-approval gate fires only on a blocking review. This keeps the routine
case automatic and gives the human a real decision to make instead of a rubber
stamp. It also fits the rule "ask before a sensitive action" better: blocking a
merge is sensitive, whereas posting a comment is not. (Revised 2026-08-25 after
the first design gated all posts.)

## 17. Cujo owns the operator UI; TrueForge is a dependency, not a destination

**Superseded by 27, and refined by 123.** The operator UI is `apps/web`;
`apps/cujo` is API-only. There is no harness console at all any more, so the
rule that nobody approves in one holds by construction.

The human who approves a block does it in Cujo's own UI, not in TrueForge's
bundled chat. `apps/ingress` grows into `apps/cujo`: one service that receives
the webhook, starts the turn, consumes the turn's event stream, renders the
run, and resumes the paused turn when a human approves. It is TrueForge's only
client. TrueForge keeps every runtime job it had — the model loop, the Daytona
sandbox, the subagents, sessions, and the approval pause — and gives up one
thing: being the surface a person looks at.

Why: a customer of a PR review bot wants to see which PRs ran, what the checks
found, and one button to approve or reject the block, not an agent transcript.
The product is used through its UI, and one we did not build could not carry
the brand or the approval flow as designed. The harness loses nothing: it does
the same work, Cujo's UI is plainly a client of the harness API, and driving
the approval gate over the SDK uses the harness as infrastructure rather than
as a chat window. Decision 1 (stock TrueForge, no fork) holds; the SDK and
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

## 19. The sensor script reaches the sandbox by public URL, not by upload

**Superseded by 46.** The sensors are a package, delivered as a source
archive from `CUJO_SNIFF_TARBALL_URL`.

The agent fetches `sniff.py` with `curl` from `CUJO_SNIFF_URL`, the raw GitHub
URL of this repo's `main`, before any check runs. Nothing on the server pushes
the file in, so the trust boundary stays as decision 4 states it: the only
things that enter the sandbox are the PR's public clone and Cujo's own script
and commands, fetched without a credential. The cost is that a sandbox needs
egress to `raw.githubusercontent.com` at setup, which is on the known-host list
anyway. Pinning the URL to a commit instead of `main` is a one-variable change
when the script is stable; while the script is still changing, `main` keeps
the sandbox and the repo in step.

The harness's own Git-backed skills would carry the rubric the same way, and
are the natural next step: `agent/SKILL.md` is already in the skill format so
registering it as a skill later is a bootstrap call, not a rewrite.

## 24. The repo-to-channel binding lives in the store, not the environment

**Superseded by 28, then by 31.** The binding is no longer an operator's
errand behind a login.

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

## 28. Two tiers: an operator authorizes a server, the server configures itself

**Superseded by 31 and 49.** The repo declares its own server, and the
operator plane's principal is a shared token, not a policy-checked email.

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

## 39. A superseded run answers its pending approval

**Refined by 125.** The stale deny is still sent, so the model hears why; the harness no longer refuses a new turn while an approval is pending, it voids the approval instead.

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

## 42. The projection holds two reviews, and a blocking review can end a run

Decision 6 said reviews auto-post and the gate fires on a blocking review.
Design 1 of the HITL design (removed in decision 51) narrows that gate to the
accusation, which needs two things the projection could not express.

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

## 49. The operator plane swaps an email for a shared token, because it no longer decides anything

**Superseded by 57.** The token is deleted with the plane it gated.

**This is the downward swap of principal decision 28 refused**, and the entry
has to say so first rather than last. Decision 28 rejected Discord channel
membership as a principal because "a Cloudflare Access email is a policy-checked
identity and channel membership is not", and it built Contract 8's two-half
model around exactly that. Decision 31 then narrowed it and said so plainly.
This one goes further: it replaces the email with a shared token that names
nobody.

The reason that is acceptable is not that the token is stronger. It is not. The
action that justified the email no longer lives here.

Every version of that argument turned on **publishing an accusation**: an
irreversible public claim about a person's code, made under the bot's name, and
therefore something that had to be attributable to a human being. Decision 44
moved that action to the pull request, where the principal is repo write —
checked against GitHub on every command — and the audit trail is a GitHub login
in `approver`. So the plane that used to hold the one attributable action now
holds none.

What is left on it is reads, and Discord bindings. A binding decides where cards
go and which server may see which repo. That is real, and it is why the plane
keeps a gate rather than becoming public: this is not "delete the login", it is
"the login was carrying a claim it no longer has to carry". `authorized_by` and
`bound_by` record the fixed string `operator`, which is honest — an email there
would assert a policy check nothing performs any more.

**`POST /runs/:id/approve` is deleted, not left working.** Two ways to answer
one finding is one audit trail too many, and the one that would rot is the one
nobody uses. `ApproveBar` becomes a panel that says a maintainer is being waited
on and prints the two commands; `canDecide` survives with its meaning corrected
from "this page may decide" to "a decision is outstanding".

**The token never enters JavaScript.** `apps/web` takes it once at `/login` and
keeps it in an httpOnly cookie on its own origin, then turns it into an
`Authorization: Bearer` header server-side. A value a page can read is a value a
script injected into that page can read, and this token gates every write on the
plane. That is also why `/login` is not served on the public host: a sign-in
form on an anonymous board is an invitation to phish one.

The comparison is constant time. A shared secret checked with `===` leaks its
prefix to anyone who can time the answer; lengths are compared first, because
`timingSafeEqual` throws on a mismatch and a length is not the secret.

**Both credentials are accepted for one release.** Merging is the deploy
(decision 35), so a gate that accepts only the credential nobody has issued yet
locks the operator out of their own board — and the ordering is genuinely
two-sided here: the token has to reach the environment, and the Cloudflare
Access application has to be removed, and neither is this repository's to
sequence. So the token is checked first and the assertion still works, and the
`CF_ACCESS_*` pair becomes required only while the token is unset. A *wrong*
token is refused rather than falling through, because whoever sent one meant to
use that gate, and falling through would let a request carrying a bad token and
a good assertion in while reading as though the token had worked.

The `cujo-harness` Access application stays regardless. That console has its own
authentication disabled, and an OTP in front of it is exactly what it is for.

Rejected: **keeping the approve route behind the token**, which preserves a
second way to publish an accusation with a shared identity — the precise thing
decision 44 moved away from. **Holding the token in `apps/web`'s own
environment** and injecting it server-side on every call, which is nearly free
and gates nothing: anyone reaching the operator hostname would get the board and
the Discord admin forms. And **making the whole plane public**, which is
tempting now that `approver` is a GitHub login already visible on the pull
request, but publishes `session_id`, `turn_ids` and `delivery_id` and hands the
Discord bindings to anyone.

## 55. A card names both parties, and a login reaches a URL only through an allowlist

**Reversed by 86.** The allocation below gave the author line to Cujo and the
person a field plus the footer icon; 86 gives the author line to the person
and the footer icon to the Cujo mark, on this decision's own premise. The two
URL allowlists in the second half stand unchanged.

A Discord card said `spencerjireh/orders-api #7 — Add refund endpoint` and
nothing else identified either side of it. Cujo appeared only as the bot avatar
above the embed, and the person who opened the pull request was not named at
all — so a channel watching four repos read a wall of near-identical grey
blocks, and answering "whose is this" meant opening GitHub.

**Cujo takes the embed's author line; the pull request's author takes a field
and the footer icon.** An embed has one author slot, and it goes to the fixed
party rather than the variable one, because the alternative spends the only
avatar affordance on an identity already visible in the message header. That
leaves the person a field — `Opened by`, second so it renders inline beside
`Head` — and the footer icon, which is the one image slot left once the author
line is spent. A field value cannot carry an image, which is the whole reason
the two are split across three slots rather than one.

Both are on every status, `running` and `superseded` included. The rule that
keeps those two cards sparse is that the card is rewritten only on a status
change, so anything that moves under it would freeze and then lie. Who opened a
pull request does not move.

**The mark is served from this repository, not from `apps/web`.** Discord's
media proxy fetches the icon anonymously, and the operator hostname is gated
while the public one is deploy configuration this process cannot depend on.
`raw.githubusercontent.com` is neither. That needs a committed PNG —
`brand/logo/png/` is gitignored — so `brand/tools/render.mjs` now also writes
`brand/logo/avatar-64.png` beside the SVG, and a mark change cannot leave the
icon stale. It renders `avatar.svg` and not `mark.svg`: the mark is
`currentColor` on transparent, which disappears on one of Discord's two themes,
while the avatar carries its own dark ground.

**Contract 7's rule 7 is amended, not dropped.** It said no derived string is
ever written into an embed URL field. It now says none reaches one without
passing a strict allowlist first, and there are exactly two:

- The avatar is `https://avatars.githubusercontent.com/u/<id>?s=64`, built from
  the numeric account id. A login is a string somebody else chose; an id is not.
- The profile link is built only from a login matching
  `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`. GitHub cannot issue a login outside
  that set, so the check should never fire — it is there so the rule is enforced
  by code rather than assumed. A bot login (`dependabot[bot]`) fails it by
  design: its profile is at `/apps/<name>`, a second URL shape nothing else
  needs, so a bot is named with its avatar and no link.

The field value is assembled rather than escaped whole, because `clean()`
defangs `://` — that is its job. The login goes through the escape pass and the
URL is concatenated after it.

**The store joins, rather than the caller looking up.** The title already lived
in `run_pr_meta`, read by one explicit call in the notifier. The author needed
to reach the card *and* two serializers *and* the SSE stream, so instead of
three more lookups every run read is now a `LEFT JOIN` and `RunRecord` carries
`prTitle`, `prAuthorLogin` and `prAuthorId`. That also buys the public plane's
allowlist test for free: a field on `RunRecord` is a red build until somebody
classifies it (decision 34). Two migrations, both nullable with no default, for
the same reason 2 and 3 were — a run recorded before them has no author, and a
deleted account has none either, neither of which is an empty string.

**The public board now names one kind of person.** It publishes `pr_title`,
`pr_author_login` and `pr_author_id`, and the run page renders the author with
their avatar. Every row that plane serves is one where `is_public` is true, so
all three are already world-readable on the pull request itself — a different
fact from `approver`, which names a Cujo operator and appears nowhere else and
stays withheld. The summary carries only the title: a list row names a pull
request, not a person.

**The web app loads avatars through `next/image`.** They are fetched and
resized by the Next server, so opening a run on the anonymous board does not
make a request to github.com carrying the visitor's address. That costs a pinned
`sharp` dependency, which the standalone build traces. A plain `<img>` would
have cost nothing and leaked exactly that.

Rejected: **the author line for Cujo *and* a thumbnail for the person**, which
puts a large image on every card and squeezes the fields on a narrow client.
**Naming the person in the footer text**, which reads better but cannot carry
the link, since Discord renders no markdown in a footer. **Falling back to the
Cujo mark when there is no author avatar**, which puts the same icon on one card
twice and reads as a bug rather than as an absence. **An `Author` column on the
runs list**, which repeats a face down a table that is scanned for status.

## 56. A provider must declare the reasoning efforts it will accept

**Reversed by 127.** The harness clamps an effort against what the model declares; nothing is announced to the provider and nothing refuses boot over it.

Decision 53 added `CUJO_MODEL_REASONING_EFFORT` and shipped it unusable. Setting
it to `low` made **every** pull request webhook answer 502 —
`createSession` throwing with `reason: "session_create_failed"` — and no review
started on any repository. It did that twice in one afternoon.

The cause was one line. `clients/trueforge.ts` registered every model with
`properties: {}`, and `ModelProperties` carries `reasoningEfforts`. So the
server was told each model supports no reasoning effort at all, and then refused
any session spec that named one. Decision 53 named the seven values correctly
and never said who had to declare them.

**The provider was never the problem, and this was measured.** Calling
OpenRouter directly with the deploy's own key: `z-ai/glm-5.3-flash` answers 200
with `reasoning_tokens: 11`, and the same call with `reasoning: {effort: "low"}`
answers 200 with `reasoning_tokens: 0`. Low effort works, and does the thing it
was wanted for. The model call simply never happened, because validation failed
first.

So `MODEL_PROVIDER_REASONING_EFFORTS` joins `MODEL_PROVIDER_MODELS`, and every
model this process registers carries it.

**One list, fanned out per model.** There is no provider-level field:
`CustomModelProvider` has only `auth`, `baseUrl`, `models`, `name` and `type`,
and the declaration lives on each `ConfiguredModel.properties`. The catalog's
`supportedReasoningEfforts` reads like the right field and is not — it is
read-only, carries no models, and cannot be sent. A per-model syntax was
rejected in favour of one list because `MODEL_PROVIDER_MODELS` is parsed by one
`indexOf("=")` and is a value the deployment cannot read back to check.

**An undeclared effort now stops the process, not the reviews.** This is the
half that matters more than the fix. Nothing failed at boot: bootstrap
succeeded, `/readyz` reported `harness: ready`, both hostnames answered 200, and
the only evidence anywhere was the GitHub App's delivery log — which nobody
watches, and which GitHub does not retry from. A configuration error that
silently stops all work while every health signal stays green is worse than a
crash, so `loadConfig` now refuses.

It refuses **only when this process is the one registering the provider**. With
the provider configured in the operator console instead, Cujo cannot know what
it declares, and blocking a working deploy on a guess would be the same mistake
in the other direction.

**The values are checked against the SDK's own enum, not just against each
other.** A first cut compared the chosen effort only to the declared list, which
a typo in both variables satisfies by agreeing with itself; the bad value then
reached the server, which rejects the *provider*, and `bootstrapUntilReady`
retries that forever. The webhook would have answered 503 for good — the same
silent outage, moved one step earlier. `Object.values(ReasoningEffort)` is the
source of truth so the list cannot drift from the server validating against it.

**The contract test now asks for an effort.** It created a session with
`model: { name }` and no `params`, so the one job it exists for — catching a
spec the real server rejects — did not cover the field that broke production.
CI was green throughout. That gap, not the missing declaration, is why this
reached a deploy.

## 60. The prompt for a maintainer is written by the thing it instructs

The first run to complete design 1 end to end published an accusation that ended
by asking for a confirmation it had already received:

> This matches a supply-chain pattern. Cujo will not publish that conclusion
> until a maintainer confirms. Reply `/cujo confirm` or `/cujo dismiss`.

On the observation that sentence is true and load-bearing. On the accusation it
is false at the moment anybody reads it: `post_gated_review` is the only tool in
`requireApprovalForTools`, so the approval is what let that call run at all. It
went out on a public review, under the bot's name, naming a third party's
package as malicious.

The rubric had quoted the sentence for the agent to reproduce, and told it to
end "that first body" with it. Nothing said the second body must not carry it
too, and nothing tested for it — `grep "supply-chain pattern"` across this
repository hit exactly one file, the rubric itself. Given a fixed string to
reproduce, the model reproduced it twice.

Decision 36 had already made this argument and won it, one function away.
`body.ts` composes the `Full evidence:` footer precisely because "a model asked
to end its body with a particular line can forget it, reword it, or put it above
the Egress section". So the prompt joins it: `github-mcp` holds the wording, and
the agent is told not to write it.

**The flag exists on two tools and not the third, and that is the whole
guarantee.** `post_advisory_review` and `post_blocking_review` take
`accusation_follows`; `post_gated_review` is registered with the bare shape, so
the prompt cannot be requested on the one call where it would be false. Zod
strips a key it does not declare, so a model that sends it anyway is ignored.
Nothing has to check the tool name at the point of use, which matters because
`postReview` serves all three and decision 5 leaves this server unable to tell
an accusation from a broken test on its own.

It has to be a flag rather than an inference for that same reason: `github-mcp`
is write-only, has no access to the check reports, and cannot see that a gated
call follows. A model that forgets the flag leaves the prompt off an
observation — the same "correct or absent" failure the run footer already
accepts, and a much smaller one than the duplicate.

Rejected: **a rule in the rubric** saying the gated body must not repeat the
prompt, which is prose defending a property, in the place decision 41 already
called the least reliable one for that. **Stripping the sentence from a gated
body that contains it anyway**, which would reach the pull requests whose
sessions are pinned to the old rubric, but only by string-matching model prose,
and a paraphrase defeats it.

## 64. Nothing says when a compaction happened, so Cujo does not

**Reversed by 129.** Compaction is pi's context-window rule and the harness logs each one; the threshold knob is gone.

`contextManagement` was unset, so the review agent compacted at TrueForge's
default of 50,000 tokens. The parent collects four full check reports and then
writes its review body from them, so a compaction in that window produces a
review argued from a summary of the evidence rather than from the evidence. The
hard rules survive it — Cujo re-derives those from the reports on its own side —
but the prose and the agent's own findings do not. The threshold is raised, and
configurable.

The second half was meant to be a `compacted` flag on the projection, so a
summarised review would be visible rather than silent. It is not there, because
it cannot be honest.

**TrueForge emits no compaction event.** The SDK's event vocabulary is
`mcp.auth_required`, `mcp.initialize`, `model.message`, `model.message.delta`,
`sandbox.created`, `thread.created`, `thread.done`, `tool.approval_required`,
`tool.response`, `tool.response_required`, `turn.created` and `turn.done`.
Compaction exists only as configuration. The nearest available signal is
`usage.inputTokensBreakdown.messages` falling between two messages on one
thread, which is an inference — and one that fires for a large tool response
being offloaded to a file as well.

Publishing that inference as an observation is exactly the pattern decision 54
exists to forbid: a report that says what it did not measure. The per-check token
counts are published, and a reader can see the drop for themselves and draw
their own conclusion, which is the difference between showing evidence and
making a claim.

Rejected: **inferring it from the token drop and calling the field
`compacted`**, for the reason above. **Disabling compaction on the review
agent**, which trades a review argued from a summary for a run that fails
outright when the context fills — the wrong direction, since the hard rules
survive a compaction and nothing survives a failed turn. **Leaving the threshold
at the default and adding nothing**, which keeps a known hazard for no reason
now that the setting is one line.
