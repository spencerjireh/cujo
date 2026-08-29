# Design: the pull request is the control surface

A design that is not built yet. It is the design of record for moving the human
gate off Cloudflare Access and onto the pull request; the contracts in
[spec.md](spec.md) still describe what the code does today. Every load-bearing
claim here is anchored to code that exists. Sections marked **⚠ hazard** are
things an adversarial read of the codebase proved will break if implemented
naively; they are not warnings, they are requirements.

---

## Context

Cujo's human gate today is one bit, answered on a Cloudflare Access-gated web
route. The agent posts `post_advisory_review` when nothing is `critical`, or
`post_blocking_review` when anything is, and only the second pauses
(`review/agent-spec.ts:69`, `requireApprovalForTools: ["post_blocking_review"]`).
A human opens `cujo-admin`, passes an email OTP, and clicks.

Three things are wrong with it.

**1. The gate fires on a category that isn't one.** The four hard rules at
`agent/SKILL.md:83-87` are treated as interchangeable. They are not — but the
axis is not the obvious one. Reading `review/findings.ts` carefully:

| Hard rule | Fires on | What it claims |
|---|---|---|
| `tests.base_pass_head_fail` | `tests` only (`findings.ts:87`) | **correctness** — "your tests fail" |
| `secret_probe.decoy_read` | **any** check (`findings.ts:103`) | **malice** — "code read a decoy secret" |
| `secret_probe.decoy_in_egress` | **any** check (`findings.ts:112`) | **malice** — "a secret left the box" |
| `derived.wrote_sensitive` | **any** check (`findings.ts:121`) | **malice** — "code wrote outside the workspace" |
| `derived.egress_to_unknown_host` | `detonation` only (`findings.ts:131`) | **malice** — "a dependency phoned home" |

The tempting split is "the author's code vs a third party's." **That split is
wrong.** Three of the four malice rules fire on *any* check, including `tests`
and `smoke` running the author's own code. Only `egress_to_unknown_host` is
scoped to `detonation`.

The real axis is **a correctness claim versus a malice claim.** "Your tests
fail" is mechanical, verifiable by the author in thirty seconds, the most common
trigger by far, and no reasonable human ever answers "no" — asking is ceremony.
"This code tried to steal a credential" is an accusation that harms someone if
it is wrong, whether the someone is a dependency maintainer or the PR author.
That is the only place in this pipeline where a human holds information the
sandbox cannot observe: they know the host, or they know the package, or they
know the test fixture that touches a fake credentials file on purpose.

**2. The gate is on the reversible half.** `REQUEST_CHANGES` is dismissible in
one click by anyone with write access. The *accusation text* — naming code as
malicious, permanently in the record — is not reversible at all, and today it
publishes on the same unattended path as everything else. The gate protects
merge authority, which is cheap, and leaves reputation, which is not.

**3. A missing human destroys the work.** `SKILL.md:125-126` makes the review
tools mutually exclusive and `:127` says a denied approval posts nothing. A
denial, or a thirty-minute timeout with nobody awake, leaves a pull request
carrying a 👀 reaction and no trace that four checks ran in a sandbox. A
human-in-the-loop system should degrade to *less authority*, never to *less
information*.

**And the gate is behind a login the audience does not have.** Decision 1 names
human approvals as a scored criterion; a judge cannot see the one feature that
satisfies it without being admitted to an Access policy one email at a time.

**Intended outcome.** The human stops being a switch and becomes a source of
information the sandbox cannot observe. The pull request thread becomes the
control surface. Cloudflare Access stops being load-bearing.

---

## The reframe: human-in-the-loop is three shapes

Automation is the point of a review bot, so every touchpoint except one narrow
gate must be **off the critical path**: the run completes with nobody watching.

| Shape | What the human does | Friction | Unique to Cujo |
|---|---|---|---|
| **Steer** | asks the agent to run a new experiment | none | **yes** |
| **Teach** | corrects the agent durably | none | partly |
| **Gate** | authorizes an irreversible public accusation | some | no |

The gate is last because it is the only one that costs automation.

Two mechanisms exist, and conflating them is what made this hard:

- **The approval resume.** `harness.resume(sessionId, approval, "allow" | "deny")`
  (`runner.service.ts:684`). Binary, mid-turn, keyed on the tool name. This is
  the gate.
- **A new session.** Not a new turn on the review session — see the ⚠ hazard in
  Design 3, which is the single most important finding in this document.

---

## Design 1 — the gate moves to the malice claim

### `post_gated_review`

A third tool on `github-mcp`. It posts `REQUEST_CHANGES` exactly as
`post_blocking_review` does; the only difference is that **it is the one named
in `requireApprovalForTools`**.

- Criticals that are correctness claims — `tests.base_pass_head_fail`, or agent
  judgment that does not allege malice → `post_blocking_review`, unattended.
  Cujo blocks a merge on its own authority.
- The four malice hard rules, **or an agent-judged critical that alleges malice
  or names a dependency** → `post_gated_review`. It pauses.

The name deliberately describes the mechanism, not the claim, which means **the
rubric carries all of the meaning**. `SKILL.md` must state the selection rule
precisely enough that a model reading tool names alone cannot guess wrong. This
is the one place where vagueness in the rubric becomes a silently ungated
accusation.

### ⚠ hazard: the gate's coverage moves from code into a model output

Today the gate is safe against model error by construction — *every*
`REQUEST_CHANGES` pauses, whatever the agent believes. After this change, "is
this a malice claim?" is a decision the model expresses by choosing a tool name.
A confused or prompt-injected agent posts the accusation through the ungated
tool and it publishes unattended.

There is no place to catch it in time. `github-mcp` is deliberately write-only
(decision 5) and has no access to the check reports, so it cannot tell a
tests-fail body from an exfiltration body. `apps/cujo` knows the finding class
(`findings.ts:79-145`) but is not on the posting path.

**Verification is therefore one-directional, and after the fact.** `apps/cujo`
already re-derives the hard rules rather than trusting the agent (decision 21):

- **Detectable:** a malice hard rule fired and the agent did *not* use
  `post_gated_review`. This is under-gating, it is the direction that matters,
  and it is exactly the shape of the existing guard at `fold.ts:242-254`.
- **Not detectable:** the agent used `post_gated_review` for something Cujo
  cannot independently classify. This is over-gating; its only cost is asking a
  human who did not need to be asked.
- **Not preventable in either direction.** The review is already public under the
  bot's name by the time `fold` sees it.

Accept this, or keep every `REQUEST_CHANGES` gated. There is no third option
that does not put `apps/cujo` on the posting path.

### Observation publishes; conclusion waits

The evidence is a fact, and it is what the maintainer needs in order to decide:

> **warn** — detonation: during `npm install`, a postinstall script in
> `left-pad-utils@2.1.0` opened a connection to `45.33.12.9`. The decoy secret
> was read 40 ms earlier.
>
> This matches a supply-chain pattern. Cujo will not publish that conclusion or
> block this merge until a maintainer confirms. Reply `/cujo confirm` or
> `/cujo dismiss`.

The conclusion is the accusation, and it waits. So **the advisory posts first
and always**, and the gated review is a second call in the same turn.

What this buys: the advisory body *is* the notification, so discoverability
needs no new writer and decision 38 stays intact; a thirty-minute timeout leaves
the findings on the pull request; and a dismissal drops the escalation while the
observation stands.

### ⚠ hazard: the projection cannot represent two reviews

This is the expensive part, and it was chosen with the cost known.

- **`Projection.review` is a single `DraftedReview | null`** (`review/types.ts:79`).
  `fold` overwrites it on every review tool call (`fold.ts:148`) and again at
  `tool.approval_required` (`fold.ts:204-205`). Post an advisory then draft a
  gated review, and the record of what was *actually posted* is destroyed — the
  operator UI (`operator/runs.ts:37`) and the public board (`serialize.ts:133`)
  both show the un-posted accusation and not the posted advisory. The projection
  must hold the posted review and the pending draft separately.
- **The happy path currently ends `error`.** Hard-rule severity is hardcoded
  `critical` (`findings.ts:103-142`) and the agent cannot demote it — that is
  decision 21 and Contract 3. So an advisory review plus a tripped malice rule
  hits `fold.ts:242-254` and ends the run with "hard rule tripped … but the agent
  posted an advisory review", every time. That branch must narrow to "posted
  advisory *and nothing else* despite a critical", not be deleted — deleting it
  reopens the contradiction it exists to surface.
- **The pending accusation is already published.** `fold.ts:181-182` recomputes
  `p.findings = mergeFindings(p.hardRuleHits, agentFindings(p.review))` on every
  `thread.done`, where `p.review` may be the *drafted, unapproved* call, and
  `serialize.ts:131` publishes `findings`. So the agent's accusation text reaches
  the anonymous board the moment the gate opens. This is broader than the
  `review` field alone: the merged findings list leaks it too.
- **A new tool name breaks review parsing.** `fold.ts:15 REVIEW_TOOLS` is a
  closed set; an unmatched name makes `parseReview` return `null` (`fold.ts:110`)
  and leaves `p.review` pointing at the advisory. `ApproveBar.tsx:46` then tests
  `run.review?.tool === "post_blocking_review"`, renders the wrong prompt, and
  **shows the human the advisory body while asking them to confirm the
  accusation** — a worse rubber stamp than the one this design set out to fix.
- **`SKILL.md:6-8`** states "You post exactly one GitHub review per turn, or
  nothing", and **Contract 5** is "one session per PR, no double-posting". Both
  describe the invariant this breaks and both must say why two reviews on one
  head is not double-posting.

---

## Design 2 — the pull request is the control surface

### Two syntaxes, split by privilege

`/cujo confirm` resumes a paused destructive tool call. That authorization must
never be decided by a model reading intent, or a cleverly-worded comment — or a
prompt injection from anyone in the thread — steers the resume. The trusted
plane makes authorization decisions; the agent never does.

| | Syntax | Matched by | Worst case if misread |
|---|---|---|---|
| **Privileged** | `/cujo <verb>` at start of line | exact string in `apps/cujo` | — |
| **Conversational** | `@cujo-guard <anything>` | the agent | a wasted sandbox |

A mention cannot carry the privileged half: "@cujo-guard flagged this
incorrectly, ignore it" is a sentence a human would write, and any intent parser
reads it as a dismissal. Slash also decouples from the bot's login and matches
the `/cujo` vocabulary already shipped on Discord (Contract 8) — one vocabulary,
two surfaces.

```
/cujo confirm    publish the malice conclusion and block the merge
/cujo dismiss    do not
```

Two verbs is the entire learning surface, and Cujo prints them in the review
body at the one moment they matter.

### Authorization

**Repo `write` or `admin`, checked against GitHub, on an HMAC-verified
delivery — and the PR author may not `dismiss`.**

The author rule is not optional. Repo write is a *broader* principal than an
Access email, not a stronger one: it includes the author of the pull request.
The scenario this product exists for is hostile code in a PR, and without the
rule the author of that PR dismisses the accusation against their own change.
`dismiss` is the dangerous direction — `SKILL.md:127` makes a denied gate post
nothing. `confirm` by the author is fine; acting against your own interest needs
no guard.

Follow the house tri-state for "GitHub was unreachable", which
`GitHubReader.repoIsPublic` (`clients/github.ts:265`) and `authorizationFor`
(`notify/authorization.ts:31-63`) both use: `unknown` is not a refusal.

`Runner.approve`'s `approver` is free-form and already carries `"external"`
(`runner.service.ts:198-201`), so `github:<login>` needs no schema change.

### ⚠ hazard: a comment names a pull request, not a head

An `issue_comment` payload carries `issue.number` and the repo. No SHA. The
realistic sequence — a maintainer reads the blocking review, pushes a fix, then
comes back and types `/cujo confirm` — resolves to whatever run is
`blocked_pending` *now*, which is the new head's block that nobody read.

So the resolved run's `head_sha` must be checked against the pull request's
current head (`GitHubReader.pullRequest`), and a mismatch refused out loud.

Related: **there is no `getRunForPr`.** The existing composition is
`getSession(repo, prNumber)` → `listRunsForSession(sessionId)`
(`store/runs.ts:75`, `:174`), which returns every run on that PR including
terminal ones. `listUnfinishedRuns` (`:228`) filters to `running` and
`blocked_pending` with a **binary** `repo = ?` comparison, unlike
`setRepoVisibility`'s `COLLATE NOCASE`.

### ⚠ hazard: the confirm can be swallowed silently

`claimDecision` (`store/runs.ts:268`) sets `approver` and `decided_at` but leaves
`status = 'blocked_pending'`, so an in-flight allow is invisible to `supersede`.
`supersede`'s deny is then rejected by TrueForge ("a second answer for an
already-decided call is rejected", `docs/trueforge.md:93`), `denyStaleApproval`
returns false, and control falls to the unconditional `cancelTurn`
(`runner.service.ts:518`). The human's allow turn is cancelled, the review never
posts, and the row records them as the approver.

The web UI at least surfaces a 409 (`operator/runs.ts:126`). **A comment gets
nothing**, so the design must specify a failure reply for every
`ApproveRefusal` — `no_such_run`, `not_blocked_pending`, `already_decided`,
`resume_failed` — plus the two new ones (stale head, author dismissal).

### ⚠ hazard: acknowledging with a reaction erases the run's verdict

`GitHubReactions.set` **deletes** every bot reaction on the target that is not in
`wanted` (`clients/github-reactions.ts:106-117`), its path is hardcoded to
`/issues/{prNumber}/reactions` (`:96`), and `PrReactor.apply` keys its dedupe map
on `runId` (`reactions.service.ts:159-161`). Acknowledging a comment through that
path clears the run's status reaction from the pull request and desyncs the cache
so it is never restored. A comment acknowledgement needs a separate method
against `/issues/comments/{id}/reactions` and its own dedupe identity.

### Parsing rules

- Ignore comments authored by `cujo-guard[bot]`; `BOT_LOGIN` is exported at
  `clients/github.ts:21`. Without this, a reply containing the trigger string
  re-triggers — and `tools.ts:124` already inlines model prose into bodies.
- `/cujo` only at the start of a line, never inside a code fence or blockquote.
- Repo write or admin for **both** syntaxes. Conversation spends a Daytona
  sandbox, so it is not free speech.
- **A rate limit is required and none exists.** Every `@cujo-guard` comment
  provisions a sandbox with a 30-minute budget and `iterationLimit: 150`
  (`agent-spec.ts:75`). The only limiter in `Config` is `publicStreamLimit`
  (`config.ts:50`). There is no per-PR, per-actor or per-repo ceiling to extend.

---

## Design 3 — conversation, in a **separate session**

The uniquely-Cujo verb is re-execution, not re-reading. Qodo and CodeRabbit can
only re-read the diff; Cujo still has a sandbox recipe.

> `@cujo-guard` seed the database first, that route needs orders to exist

> With `scripts/seed.ts` run first, `GET /api/orders` returns 200 in 340 ms on
> head and 355 ms on base. The 500 reproduces only against an empty database.

The finding is refined, not dismissed. The maintainer supplied knowledge the
sandbox could not observe; the agent supplied execution.

### ⚠ hazard: a second turn on the review session is three separate failures

This is the most important finding in this document. The obvious implementation —
`harness.startTurn(sessionId, message)` on the run's own session — **does not
work**, for three independent reasons, all verified against `docs/trueforge.md`:

1. **It silently cancels a live review.** `docs/trueforge.md:107`: "Creating a
   turn while one runs cancels the old one (`cancelled-for-next-turn`), but a
   subscriber to the old turn is never told; only `sessions.cancel` closes the
   stream." `Runner.consume`'s drain loop never sees `turn.done`, the stream does
   not drop so the resubscribe path is not entered, and the only thing that fires
   is the 30-minute watchdog (`runner.service.ts:320-328`), ending the run
   `error`. One comment throws away a whole sandbox run. Ungated, that is a
   one-comment denial-of-review against every PR in every installed repo.
2. **It is refused in exactly the state where it is wanted.**
   `docs/decisions.md:1143`: `422 thread main: user message cannot be sent while
   approvals or questions are pending`, and an approval is outstanding on the
   **session**, not the turn. While a run is `blocked_pending` — the exact moment
   a maintainer wants to say "seed the db first" — the message is rejected.
   Worse, if that failure is routed through `Runner.start`, the retry calls
   `healSession`, whose `othersInFlight` guard excludes the run itself
   (`runner.service.ts:539`), so `denyStaleApproval` answers the human's pending
   gate with `STALE_DENY_REASON` — a lie, and a silent denial.
3. **It corrupts the projection.** `fold` is one accumulator over the run's whole
   event list, scoped per run and never reset. A re-run spawns a second thread
   titled `tests`; `p.checks` dedupes by `threadId`, not title (`fold.ts:156`), so
   `hardRuleFindings` emits the same critical twice and the hard list is never
   deduped (`findings.ts:199-207` dedupes only agent findings). Old reports stay
   forever, so a successful re-run **can never clear the finding it was meant to
   correct**. `refold` writes status unconditionally (`runner.service.ts:186-202`),
   so a conversation turn can move a `clean` run to `error`, rewriting the PR
   reaction 🎉→😕 and the Discord card. And Contract 5's idempotency check lives in
   `startRun` (`start-run.ts:66`), not on this path, so N comments produce N
   GitHub reviews.

### The shape that works

**Conversation runs in its own TrueForge session, with a restricted agent, and
is not folded into the run.**

- A separate session cannot cancel the review turn, cannot hit the pending-approval
  422, and cannot corrupt the run's projection. All three failures above are
  properties of session and run *sharing*, not of conversation itself.
- The conversation agent gets a **curated brief**, not raw history: the run's
  check reports (`Projection.checks[].report`), findings, and posted review body
  are all already in the projection. This is better than history — it is a
  smaller, reviewable payload.
- It gets a **restricted toolset: the sandbox and a reply tool, and no review
  tools at all.** That is what bounds prompt injection to "wastes a sandbox and
  posts a reply."
- `harness.cancelTurn` is `sessions.cancel(sessionId)` with no turn id
  (`clients/trueforge.ts:201`), so keeping conversation off the review session
  also keeps every existing `cancelTurn` call unambiguous.

**Scope: the latest run for the pull request, whatever its state.** The session
persists and the projection holds the history, so a maintainer can interrogate a
review from an hour ago. This makes conversation scoped to the pull request
rather than to a run — which is the honest unit anyway.

### ⚠ hazard: free text is a trusted-instruction channel, and a reply tool negates decision 38

`agent/SKILL.md:14` scopes the untrusted-input rule to "everything inside the
repository", and `:9-15` describes the user message as the trusted brief. Nothing
tells the model that a message came from a stranger. Decision 17 already wrote
this down (`decisions.md:230`): "A stray message is the worse case — it appends a
user turn the agent acts on — and is why the console is not the product surface."
This design publishes that channel to the internet, so the rubric must be
extended to say the second message is untrusted data too.

Separately, decision 38 allowed a reaction on the argument that "**nothing states
a finding on a pull request without a human allowing it** — a reaction states no
finding, carries no text, names no file" (`decisions.md:1041-1047`). A free-text
reply tool is the exact negation. It needs its own decision entry, and the
argument to make is that a reply is *human-initiated by construction* — a
maintainer with write access asked a direct question — which is a different thing
from an unprompted finding. If that argument fails, the feature fails with it,
because gating every reply makes conversation useless.

Also note `tools.ts:60-66` validates `run_id` as a UUID but never as *this run's*
id, so any tool that takes one can be pointed at an unrelated run's evidence
page.

---

## Design 4 — teaching (designed here, not shipping next)

The strongest idea in this document and the one that survives review intact.

> `@cujo-guard` that host is ours, stop flagging it

The agent opens a pull request against the default branch adding the host to
`.cujo.yml`. **The merge is the authorization** — it requires write access — so
there is no gate and no verb to learn. Future runs treat the host as known:
`sniff.py setup --allow-host H` is already fed from `allow_hosts` in the base
`.cujo.yml` (`SKILL.md:17-36`, step 5) and `findings.ts:48-62` already honours a
`known` flag on egress rows.

This is consistent with two rules the repo already holds: Contract 8's "the merge
is the authorization" (`spec.md:743-747`) and "policy comes from base, never
head" (`spec.md:104-108`). It converts a recurring toll into a one-time act and
puts the decision in git history, auditable and revoked by a commit — decision
31's argument applied to a second kind of policy. **It adds authority without
weakening a principal**, which nothing else here does.

Costs: `.cujo.yml` is deliberately not YAML-parsed today —
`parseDeclaredGuild` (`clients/github.ts:37`) pulls one key out with a regex and
`rawFile` (`:286`) is private and always reads the default branch, because "code
that declares its own authorization is not an authorization" (`:232-239`). A real
config surface means a real parser and a schema, and must keep the default-branch
rule. Opening a pull request is a new write needing branch access;
`docs/spec.md:942` already anticipates the shape as a stretch ("optional third
gated tool `open_remediation_pr`") and this should be reconciled with that entry
rather than invented beside it.

---

## Design 5 — Cloudflare Access stops being load-bearing (staged)

### ⚠ hazard: this deletes decision 28's operator tier, not a login page

`c.get("email")` is not only the approve route. It is `authorized_by` on
`PUT /discord/authorizations` (`operator/discord-admin.ts:163`) and `bound_by` on
the channel bind (`:106`) — **the entire first tier of Contract 8's two-half
model** (`spec.md:728-737`, decision 28), whose whole justification is that it
carries a policy-verified email. Access is also the only gate in front of
`GET /runs` and `GET /runs/:id`, which serve `approver`, `session_id`, `turn_ids`
and `delivery_id` — every field the public plane deliberately withholds
(`public/serialize.ts:45-56`).

So "delete Access and the `cujo-admin` plane" as stated either exposes those
fields or deletes Contract 7 and 8's admin surface wholesale. Both halves need an
answer before this stage is real. The `cujo-harness` Access application stays
regardless — that console has its own auth disabled, which is exactly what an OTP
is for.

What genuinely falls out once `/cujo confirm` works: `operator/access.ts`, the
`app.use("*")` JWT gate in `operator/index.ts`, `CF_ACCESS_TEAM_DOMAIN` and
`CF_ACCESS_AUD`, and the Access application on `cujo-admin`. Sequencing matters
because merging is the deploy (decision 35).

---

## User flows

**A. Nothing is wrong (the common case).** PR opens → 👀 → sandbox runs the four
checks → one COMMENT review with inline comments → 🚀. No human. **This flow must
stay boring** — it is the argument that Cujo is automation.

**B. The pull request breaks something.** `tests.base_pass_head_fail` non-empty →
`post_blocking_review`, unattended → REQUEST_CHANGES → author pushes → the new
run supersedes (`start-run.ts:93-105`) → advisory posts. Still no human. This
flow is what makes the gate in D credible.

**C. "Prove it."** Cujo's inline comment says a smoke endpoint returned 500 on
head and 200 on base. The maintainer replies in that thread asking for a seeded
database. Cujo re-runs in a separate session and answers with the new reading.

**D. The accusation.** Detonation sees egress to an unknown host. The advisory
posts with the observation as a `warn` plus the instruction line. Then
`/cujo confirm` (repo write, not-the-author, head matches) → resume `allow` → the
gated review posts. Or `/cujo dismiss` → resume `deny` → the warn stands. Or
nobody answers → the warn stands and the merge is not blocked.

**E. Teaching.** Third PR in a row flags the same host → `@cujo-guard that host
is ours` → Cujo opens a `.cujo.yml` pull request → a maintainer merges.

**F. Outside contributor.** Fork PR, no write access. They read every finding and
may reply to humans; Cujo refuses their commands and their `@cujo-guard`
messages. This is the security boundary made visible and the flow a judge will
poke at.

---

## Other constraints

**The ingress plane is currently forbidden from approving.**
`apps/cujo/src/http/ingress/README.md`: "**Nothing here may approve a review**
(decision 28)." Contract 8 closes with the same prohibition and `spec.md:41`
lists "Approving a blocking review from Discord" as a non-goal. The argument to
make is that decision 28 rejected *Discord channel membership* as a principal,
not signature-gated ingress as a plane — and `github-webhook.ts:116-117` already
states that the HMAC "is what makes a `repository` delivery as trustworthy as a
`pull_request` one."

**A new `RunStatus` is needed, and it reaches further than the type.** An ungated
blocking review produces its `tool.response` in the same turn, and
`fold.ts:210-215` only sets `gatedResponseSeen` when `p.approval` exists, so
`blocked_posted` is unreachable for it. Besides `BY_STATUS`
(`reactions.service.ts:69`, exhaustive by type, breaks on purpose), a new status
must be handled in `store/runs.ts:229` (a SQL **string**, not a type — a missing
non-terminal status is never rehydrated and never superseded),
`runner.service.ts:243` `isTerminal`, `notifier.service.ts:62-70` `owesWork`,
`apps/web/src/lib/api/types.ts:157` (`reviewPosted === "blocked_posted"`), and
Contract 9's reaction table.

**A third REQUEST_CHANGES tool breaks the name derivation.** `tools.ts:86`
derives the tool name from the event string, a 1:1 mapping a second
REQUEST_CHANGES tool destroys; the name must be passed. Out-of-package
couplings: `fold.ts:15`, `types.ts:58`, `agent-spec.ts:69`,
`apps/web/src/lib/api/types.ts:71` and `:156`, `SKILL.md:125-126`, and the
tool-list assertion at `apps/github-mcp/tests/server.test.ts:52`.

**The permission check may force every installation to re-approve.**
`GET /repos/{owner}/{repo}/collaborators/{user}/permission` is not covered by the
App's current grants (`architecture.md:119`: Contents read, Pull requests
read/write, Metadata). Verify first — decision 38 treated a new permission as
disqualifying for a more valuable feature (`decisions.md:1053-1060`). The
fallback in the payload is `author_association`, but `MEMBER` means org
membership and `COLLABORATOR` does not distinguish triage from push, so it is
**not** the permission check this design claims. If the endpoint is unavailable,
the honest fallback is an approver list in `.cujo.yml`.

**`issue_comment` is not subscribed.** `spec.md:58` records `pull_request`
(`opened`, `synchronize`) only. A GitHub App settings change, ordered against the
deploy (decision 35). The ingress dispatch is a flat if-chain
(`github-webhook.ts:124-131`) and `handleRepository` (`:65-91`) is the template:
narrow local interface, action allowlist, one store write, domain log, 200 — with
the delivery-scoped `log` passed as a parameter (`:69-72`). The 202 must still
return before any GitHub read (`:217`).

---

## Documentation this changes

`docs/` is the design of record and changes in the same pull request
(CONTRIBUTING Standards 13). The last decision is **41**; new entries start at
**42**.

| File | What changes |
|---|---|
| `agent/SKILL.md` | `:6-8` the one-review-per-turn invariant; `:125-128` the three-tool selection rule and deny semantics; `:14` the untrusted-input rule must cover a second user message |
| `docs/spec.md` C1 | a new event type on the HMAC-gated route |
| `docs/spec.md` C3 | the malice/correctness distinction over the hard rules |
| `docs/spec.md` C4 | three tools, the gated class, deny semantics |
| `docs/spec.md` C5 | why two reviews on one head is not double-posting |
| `docs/spec.md` C6 | the new run status; the ingress host's closed route list |
| `docs/spec.md` C8 | its closing prohibition needs revising, not deleting |
| `docs/spec.md` C9 | reactions on comments |
| `docs/spec.md` stretch | reconcile with `open_remediation_pr` |
| `docs/architecture.md` | `## The approval path` (`:125`), the crossings table, and the stale row still naming `cujo.spencerjireh.com` |
| `docs/decisions.md` | entries from 40; 28 revised per house style — a superseding entry opens by naming what it corrects, as 31 does for 28 |
| `apps/cujo/src/http/ingress/README.md` | the "nothing here may approve" rule |

New log events go in `packages/log/src/events.ts` and fields in `fields.ts`
(decision 37); a schema change appends to `MIGRATIONS` in `store/db.ts`
(decisions 25, 30).

---

## Explicitly out of scope

- **Discord approval.** Notify-only. Decisions 23 and 28 hold.
- **Check-run action buttons.** Real, but costs `checks: write`, a second status
  lifecycle duplicating the reaction, and decision 38's content-free property.
- **A mid-run pause.** Makes the run depend on a human inside the 30-minute turn
  budget; if they are absent the run dies having produced nothing.
- **"Fix it."** Cujo could propose a patch *and verify it in the sandbox* —
  genuinely differentiated. Different product, needs branch write. Name it; do
  not build it.

---

## Verification

Proven on a real pull request, not in tests alone:

1. A clean PR produces one COMMENT review and two reactions, no human.
2. A tests-fail PR blocks itself, and the run does **not** end `error` — this is
   the `fold.ts:242-254` guard and the most likely regression.
3. The evil-package PR posts the advisory observation, reaches the gated state,
   and the public board shows the observation and **not** the drafted conclusion.
4. `/cujo confirm` from a non-author maintainer posts the gated review, records
   `approver = github:<login>`, and reacts on the command comment **without**
   clearing the run's status reaction.
5. `/cujo dismiss` from the PR author is refused, out loud.
6. `/cujo confirm` after a push is refused as stale, out loud.
7. A second `/cujo confirm` loses the `claimDecision` CAS and says so.
8. `@cujo-guard <text>` during a *running* review does not cancel it, and during
   a *blocked_pending* run does not 422 — the two failures a shared session
   guarantees.
9. Nobody answers for 30 minutes → the warn stands and the PR explains itself.

Local stack for 1–3 and 8: `make up-local`, webhook host `cujo-ingress.localhost`.
Whole-app composition in tests goes through `tests/http/helpers.ts` `build()`,
which builds the real `createApp` because the host dispatch is part of the
behaviour.

---

## The question this design does not answer

**Who, exactly, is the principal that may publish a public accusation naming a
third party, and is repo write access that principal?**

Everything in Design 2 rests on the answer being yes. Decision 28 rejected a
downward swap of principal once already. Repo write is broader than a
policy-verified email, not narrower — it includes the PR author (handled by the
author rule), every bot with write access (a bot comment is a comment, and the
match is a literal string), and everyone a repo admin has ever added.

If the answer is no, Design 2 is the wrong gate however well it is implemented,
and the gate stays on an identity Cujo controls. Settle this before writing code
against it.

## Still open

1. **How `SKILL.md` phrases the malice/correctness rule** so it is a rule and not
   a vibe. `post_gated_review` carries no meaning in its name, so this sentence
   is the whole selection mechanism.
2. **The new `RunStatus` name**, and whether `reviewPosted` in the web types
   becomes a set rather than an equality.
3. **What the conversation agent's spec is** — same rubric with tools removed, or
   its own.
4. **Where the rate limit lives**, since nothing in `Config` is shaped for one.
