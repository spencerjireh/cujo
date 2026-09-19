# Plan

Everything Cujo should change, in dependency order. Written 2026-09-11, after the
provider outage investigated in `findings-2026-09-10.md`.

No dates anywhere in this file on purpose. The ordering is by what blocks what,
not by when.

## Ordering principle

Four tracks. Two of them are independent of everything else and can start
immediately. The other two are a single architectural move with a cheap door
into it that is worth taking first.

| track | needs a push | blocks | blocked by |
| --- | --- | --- | --- |
| 1. Provider and model | no, config only | nothing | nothing |
| 2. The five bugfixes | yes | nothing | nothing |
| 3. Own the sandbox | yes | finding 4, decision 46 | the MCP door, or track 4 |
| 4. Own the harness | yes | dropping Daytona outright | nothing, but see 3 |
| 5. Remove every hackathon mention | yes, plus two external | nothing | nothing |

Tracks 1, 2 and 5 are worth doing regardless of what happens to 3 and 4. Do not
let a rewrite absorb them.

---

## Track 1 — provider and model

**Goal.** Move off `openai/gpt-5.6-luna` and back onto `z-ai/glm-5.3-flash`, then
restore zero-data-retention enforcement across every vendor.

### Why

Measured at the fan-out the rubric actually uses, three concurrent sub-agents,
ten waves.

| model | requests failed | providers serving |
| --- | --- | --- |
| luna, ZDR on | 23 of 30 | Azure only |
| luna, ZDR off, BYOK | 0 of 30 | OpenAI direct |
| glm-5.3-flash, ZDR on | 0 of 30 | Parasail, Together |

glm survives concurrency because ZDR leaves it two independent providers to
spread across. luna under ZDR has one. The current fix works but it bought
reliability by giving up a privacy control on the vendor that sees pull request
diffs, and it made the deploy depend on an OpenAI account that nothing else
needs.

Going back to glm gets the reliability without either cost.

### Steps

1. Confirm `MODEL_PROVIDER_MODELS` still maps a `glm-flash` name. It was edited
   30 minutes before `CUJO_MODEL` switched to luna, and Coolify returns
   environment keys without values, so this cannot be read back. If the entry
   was replaced rather than added, restore it.
2. Confirm `MODEL_PROVIDER_REASONING_EFFORTS` still covers whatever
   `CUJO_MODEL_REASONING_EFFORT` is set to. Decision 56 makes an undeclared
   effort a boot refusal, and the declaration is fanned out per model.
3. Set `CUJO_MODEL` to `openrouter/glm-flash`. Redeploy.
4. Verify on a **new** pull request. Session pinning means an existing one
   resumes its pinned session and proves nothing.
5. Set `enforce_zdr_openai` back to `true` on the `cujo-allowlist` guardrail.
   The pre-change object is saved and the flag is the only thing that moved.
6. Decide whether to remove the BYOK OpenAI key. Leaving it costs nothing while
   ZDR is on, because it can never be selected. Removing it is tidier.

### Watch for

- The guardrail allowlists models **by dated pin**. `z-ai/glm-5.3-flash-20260826`
  is already on it. Any future model needs adding there too, and the failure
  mode is silent.
- Do not let this decision reach `docs/`. Model and provider are deploy-time
  choices and the design docs stay vendor-neutral.

---

## Track 2 — the five bugfixes

Full evidence for each is in `findings-2026-09-10.md`. Summarised here with the
intended change.

### 2.1 Retry a sub-agent that fails on a provider error

`clients/trueforge.ts:133`. The only backoff in the client is
`bootstrapUntilReady`. A model error inside a turn is terminal for that
sub-agent, and the rubric spawns three at once (`agent/SKILL.md:176`), so a
provider that throttles concurrency takes all three together.

Add bounded retry with backoff around the sub-agent turn. Distinguish a
retryable provider fault from a real failure, and record the attempts so a
review can say it retried rather than hiding it.

### 2.2 Stop recording a run that executed nothing as `clean`

`review/fold.ts:466`. `status = "clean"` is reached whenever a review posted and
no contradiction was detected. Coverage is not part of that decision, so run
`b30239c8` ran zero checks, posted four warnings, and sits on the board as
`clean`.

Either fold coverage into the status, or add a distinct status for a review that
posted without evidence. The board must be able to distinguish "ran everything
and found nothing" from "could not run anything", because those are opposite
claims.

### 2.3 Do not discard completed reports on a turn timeout

`review/runner.service.ts:414`. Run `b5724912` hit the 30-minute ceiling with
`smoke` still running. `tests` had finished at 930,958 ms and `probes` at
1,215,088 ms, both with real reports. Neither reached the pull request, and the
author saw nothing at all.

On timeout, harvest whatever sub-agent reports exist, fold them, and post a
review that names the check that hung. Silence is the one outcome that carries
no information.

The same signature appears in `c7bf0e13` and `ced0c934`, so this is not new.

### 2.4 Make the install step reach the service directory

`orders-api` holds six services under `services/` and the repository root has no
manifest. Two runs recorded the consequence, the second on an otherwise
successful review.

> `python -m pytest -q` exited 1 on base and head with
> `/usr/local/bin/python: No module named pytest`

The `tests` check is the strongest evidence available and it has never once run
against this repository. Setup needs to locate the project root per service
rather than assuming the repository root, which is also what the `.cujo.yml`
comment already says it intends.

Partly downstream of track 3, since there is no install step in the sandbox at
all.

### 2.5 Fix the smoke report envelope, and decide where hard-rule warnings surface

Observed in `319e3f8a` as hard rule `report_invalid`.

```
runs.0.schema_version: Required (+31 more)
```

The envelope is short more than one field. Separately, this warning appears in
the run record and on the evidence page but not in the posted comment, which
showed `0 critical, 1 warn` while the run held two. Read `review/fold.ts`
closely enough to establish whether that split is intended. A malformed envelope
is arguably an operator concern rather than something to tell a pull request
author, but right now nothing states which.

---

## Track 3 — own the sandbox

**Goal.** Move egress enforcement out of the sandbox and take back control of
the image.

### Why

Daytona tier one gives no sandbox-level egress policy, which is why the logging
proxy is load-bearing. That proxy runs inside the untrusted zone. The thing
enforcing the trust boundary sits on the wrong side of it, and that is the
weakest joint in the whole two-zone story.

Owning the runtime moves egress to the network layer, outside the sandbox, where
pull request code cannot reach it. The proxy stops being a control and becomes a
sensor, which is what it should always have been.

Owning the image also removes the constraint behind decision 46. There is no
install step in the sandbox today, which is why nothing under `sandbox/` may
import a third-party module, and why `pytest` is never available. Track 2.4
partly resolves itself here.

### The blocker, and the door around it

`type: "daytona"` is a string literal in the TrueForge SDK's
`SandboxProviderManifest`, not a union. Daytona is the only sandbox provider the
harness knows about. On the current architecture you cannot drop Daytona and
keep TrueForge.

The door around that is to stop using TrueForge's sandbox provider at all and
reach your own runtime through an MCP server instead. The pattern already exists
in this repo. `apps/github-mcp` is an MCP server the agent calls for exactly one
privileged thing, and `sandbox/sniff.py` already has a CLI contract with a
defined report shape.

This is the cheapest real move available. It is reversible, it removes the
vendor, it needs no fork, and it decouples the sandbox decision from the harness
decision entirely.

### Steps

1. Define the sandbox interface as an interface, with Daytona as one
   implementation. Making `type` pluggable from the start is the entire lesson
   of the literal.
2. Expose it behind an MCP server, modelled on `apps/github-mcp`.
3. Stand up an own-runtime implementation. Candidates are Firecracker, gVisor,
   or plain containers on the existing Hetzner box. The deciding factor is
   egress enforcement at the network layer, not cold-start speed.
4. Move egress policy out of the in-sandbox proxy. Keep the proxy as a sensor.
5. Add an install step to the image. Revisit decision 46 once it exists.

---

## Track 4 — own the harness, in Python

**Goal.** Replace TrueForge with a service of your own, in a separate repository,
dogfooded here.

### The contract is already eight operations

`clients/trueforge.ts` is the entire surface, 232 lines.

| operation | difficulty |
| --- | --- |
| `bootstrap` — register model provider, sandbox provider, MCP servers | easy |
| `createSession(spec)` → sessionId | easy |
| `startTurn(sessionId, message)` → turnId | easy |
| `listTurns(sessionId)` | easy |
| `listEvents(sessionId)` → ordered event log | easy, drop the 100 cap |
| `cancelTurn(sessionId)` | medium |
| `subscribe(sessionId, turnId)` → async iterable | medium, make these real not stubs |
| `resume(sessionId, {threadId, toolCallId}, allow \| deny, reason)` | hard, see below |

`apps/cujo/tests/contract/trueforge.contract.test.ts` already runs against a
live server. That is the acceptance suite. Point it at the new service and make
it go green.

The language split costs nothing. TrueForge is already a separate service on
`:8790` reached over HTTP. A Python service drops into the same hole.

### Do not write the agent loop

The loop, sub-agents and tool dispatch are commodity. Use the Claude Agent SDK
for Python and build the service layer around it. Everything that actually hurt
in the outage lives in that layer.

- Sub-agent results durable the moment they land, independent of the parent
  turn's terminal state. This alone removes 2.3 by construction.
- Retry and backoff at one chokepoint. Removes 2.1 by construction.
- A session lifecycle that can be reset. Today a session is keyed by repository
  and pull request number at `store/runs.ts:131` and there is no reset short of
  opening a new pull request.
- Model provider config that does not refuse boot over an undeclared reasoning
  effort enum. Removes the sharp edge decision 56 documents.
- A sandbox interface that is an interface.

If the loop is worth writing for the understanding, write it, then throw it away
and use the SDK.

### `resume` is the design

One send answers a pending approval and starts a new turn, carrying `threadId`,
`toolCallId` and a deny reason that reaches the model. That single path is the
product's central claim, since the gate is one line in the spec.

```ts
mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["post_gated_review"] }]
```

It means the harness must persist a half-finished turn across a process restart,
hold a tool call suspended with its arguments intact, accept an answer from a
different request much later, and resume without replaying side effects. Crash
in the middle and it still has to be correct.

Build it first, not last. It constrains the session and event model underneath
everything else.

### What not to build

No console or UI, because Cujo has a board. No multi-tenancy. No plugin system.
No provider abstraction wider than one consumer needs. There is exactly one
dogfood consumer with a written contract, and designing for imagined second
users is how that advantage gets spent.

### Steps

1. Implement the four read operations plus `createSession` and `startTurn`.
   Contract test partially green.
2. Build `resume` and its persistence. Contract test fully green.
3. Run both harnesses behind a config switch in `clients/`. Same pull request
   through both paths, compare the folded output.
4. Move the sandbox behind the track 3 interface. Daytona can go once this
   lands.

### The failure mode to guard against

When the harness cannot meet the contract, the contract quietly moves. Pin the
harness as a versioned dependency, per the repo's own pinning rule, and treat
`trueforge.contract.test.ts` as something the harness must satisfy rather than
something that gets adjusted. Editing that test to accommodate the new service
spends the only external check available.

---

## Track 5 — remove every hackathon mention

**Goal.** Nothing in the project, or on any surface the project publishes,
refers to a hackathon, a hackathon track, or judging.

The word itself appears only twice. The artefacts are wider than the word, so
grep for `hackathon` alone will report the job done while five other references
remain.

### Full inventory

In the repository.

| where | what it says |
| --- | --- |
| `docs/architecture.md:26` | "The centerpiece the hackathon scores." |
| `docs/decisions.md:270` | "feature the Double-O track names" |
| `docs/decisions.md:311` | "The Savile Row track (best UI) cannot be won with a UI we did not build" |
| `docs/decisions.md:312` | "the Double-O track is not hurt" |
| `docs/decisions.md:388` | "during the hackathon `main` keeps the sandbox and the repo in step" |
| `docs/decisions.md:446` | "the Savile Row track judges the UI on the video and the running product" |
| `docs/decisions.md:448` | "feeds the UI, the README, and the video" |
| `apps/web/src/lib/fixtures.ts:6` | "the same evidence the video does" |

Outside the repository.

| where | what to do |
| --- | --- |
| GitHub topic `hackathon` on `spencerjireh/cujo` | remove the topic, keep the other eight |
| Local working directory `agent-harness-hackathon` | rename to `cujo`, matching the remote |

Do not confuse these with the product's own language. "Code senses, the agent
judges" appears throughout `docs/spec.md`, `docs/decisions.md` and `apps/web`
and is unrelated. Search for `judges the UI`, `track`, `scores` and `the video`,
not for `judges` on its own.

### How to do it, not just what to delete

`docs/decisions.md` is a historical record, and the repo rule is that an entry
is reversed rather than deleted when it changes. Several of these mentions are
load-bearing motivation rather than decoration. Deleting the clause leaves the
entry reading as unmotivated, which is worse than the mention.

Replace the motivation with the durable reason underneath it. Two worked
examples.

> during the hackathon `main` keeps the sandbox and the repo in step

becomes something like "while the script is still changing, `main` keeps the
sandbox and the repo in step". The reason was never the hackathon. It was that
the script was not stable yet, which is still true and still explains the
choice.

> the Savile Row track (best UI) cannot be won with a UI we did not build

becomes something like "the product is used through its UI, and one we did not
build could not carry the brand". Same argument, no external scoreboard.

Where a mention is genuinely decorative, delete it. `docs/architecture.md:26`
is one — "the centerpiece the hackathon scores" adds nothing to a table entry
that already says what TrueForge is and how it is reached.

### The demo video goes

Decided. The link at `README.md:10` was the submission video and it is removed.
The header now carries two links rather than three.

```diff
-  <a href="https://youtu.be/rA7HLMxZypU">Demo video</a> &middot;
   <a href="https://cujo.spencerjireh.com">Live board</a> &middot;
   <a href="docs/architecture.md">Architecture</a>
```

That leaves three references to a video nothing links to any more, which is
worse than either having it or not. All three need rewording, not deleting,
because each one is carrying a real point.

- `docs/decisions.md:446` and `:448` argue that one source of truth in `brand/`
  keeps the UI, the README and the video from drifting apart. The argument still
  holds with the video dropped from the list.
- `apps/web/src/lib/fixtures.ts:6` says the fixtures show the same evidence the
  video does. Point it at the live board instead, which is the surface that
  actually has to match.

If a new demo video is ever made, it is a new artefact and a new link, not this
one restored.

### Steps

1. Fix the eight in-repo references in one pull request, with the decisions
   entries rewritten rather than stripped.
2. Reword the three video references so nothing points at a link that is gone.
3. Re-grep for `hackathon`, `track`, `judges the`, `scores`, `Savile`,
   `Double-O`, `submission`, `video` and `youtu` to confirm nothing was missed.
4. Remove the `hackathon` GitHub topic.
5. Rename the local working directory to match the remote. The remote is
   already `spencerjireh/cujo`, so only the local path lags.

---

## Decisions to record

Each of these is load-bearing and belongs in `docs/decisions.md` as it is made,
reversed rather than deleted if it later changes. Numbers are taken at the time
of writing.

- Why the deploy runs the model it runs, and why ZDR enforcement is on for every
  vendor. Keep the entry vendor-neutral.
- Coverage as part of run status, from 2.2.
- Posting a partial review on a turn timeout, from 2.3.
- Where hard-rule warnings surface, from 2.5.
- The sandbox interface, and reaching it through MCP rather than through the
  harness.
- Replacing the harness, and what the eight-operation contract is.
- Revisiting decision 46 once the sandbox image has an install step.
- Nothing for track 5. Removing a mention is not a design decision, and the
  decisions entries it touches are being reworded rather than reversed.

## Open questions

- Does `MODEL_PROVIDER_MODELS` still carry a `glm-flash` entry. Unreadable
  through the Coolify API, so this needs checking another way before track 1
  step 3.
- Why were `b5724912`'s checks 30 to 60 times slower than the same checks on a
  fresh session. Session weight against a 200,000 token compaction threshold is
  the suspect, but the diffs also differ in size and nothing isolates the two.
  The clean experiment is a new pull request carrying the identical diff.
- Is the hard-rule warning being absent from the posted comment intended.
- Which own-runtime option actually gives the cleanest network-layer egress
  policy on the existing host.

## Conventions this plan assumes

- Every change is a pull request. No direct commits to `main`.
- `docs/` is the design of record and changes in the same pull request as the
  code, or before it.
- Dependencies are pinned.
- Conventional Commits for subjects, with the why in the body.
- Wait for the Qodo review and resolve every thread before merging.

---

# Addendum — the measurement week and what follows it

Written after a design conversation on the reframing question: is Cujo a
reviewer, a verifier, or a pipeline of existing tools. The answer settled on is
narrower than any of those. Cujo stays an agent pull request reviewer for the
user's own repositories, others later. The agent's job moves from gathering
evidence to judging evidence that code hands it. Nothing structural ships until
three measurements exist. Tracks 6 to 9 below; track 6 blocks the rest.

Tracks 1 to 5 above are done, except where a later entry says otherwise.

| track | needs a push | blocks | blocked by |
| --- | --- | --- | --- |
| 6. The measurement week | yes, one sidecar PR and one script | 7, 8, 9 | nothing |
| 7. Judge of handed evidence | yes | nothing | 6 |
| 8. Agent-PR facts, zero tokens | yes | nothing | 6, for priority only |
| 9. Reviewer patterns Cujo lacks | yes, several small | nothing | 6, for priority only |

The market benchmark for context, published per-review prices as of the survey:
Claude Code Review 15 to 25 USD, Bugbot 1 to 1.50, Copilot 0.25 to 5, Greptile
1 per review over quota. If a Cujo run lands under about 1 USD, efficiency work
targets precision and not tokens.

---

## Track 6 — the measurement week

**Goal.** Put numbers on the three things the reframing conversation argued
about from reasoning alone: what each check costs, what each check catches,
and whether an off-the-shelf diff reader matches diff mode.

### Why

The last thirty merged pull requests changed what a review says in about three
of them. The rest was harness, sandbox and docs. The review output has not been
iterated since August, and the case for restructuring rests on a cost premise
nobody has measured. The ledger from decision 141 records tokens per thread and
check threads are titled by check name, so the per-check numbers already exist
in every projection; nobody has read them across runs.

### The three measurements

1. **Ledger readout.** `scripts/ledger_report.py` over a copy of the production
   database: per run and per check thread, tokens by kind, dollars when a price
   table is passed on the command line, findings by check. Cujo itself keeps no
   price table (decision 53's spirit) and this does not change that.
2. **Fixture attribution.** The planted-regression pull requests on `orders-api`
   run as usual, three times each. Findings carry `check` and `source`, so
   which check found the bug is read off normal runs. Nothing runs one check
   alone; nothing needs to.
3. **OCR beside the review.** Alibaba's Open Code Review (`ocr`, Apache-2.0,
   Go, verified) runs on every pull request in its own trusted compose service,
   stores its JSON per run in `run_ocr_reviews`, and posts nothing. Same model
   as `CUJO_DIFF_MODEL`, so the comparison isolates the tool.

Plus an acceptance metric, which every reviewer in the survey tunes on and Cujo
has never had: per posted finding, `acted`, `ignored` or `wrong`, tallied by
hand for the week, and for OCR's stored findings as if they had been posted.

### What the numbers decide

- Run total under about 1 USD: track 7 is for latency and predictability, not
  cost, and precision work comes first.
- `probes` never finds what `tests` did not: track 7 makes it off by default.
  It does on the fixture: the parent decides per run with the coverage map.
- OCR's acceptance at or above diff mode's at fewer tokens: diff mode is
  replaced by the sidecar's output posted under the review. Otherwise the
  sidecar is removed in the pull request that records the result.

### Steps

1. Append this addendum. Done by being here.
2. The report script, one pull request.
3. The sidecar, one pull request, with decision 149 and the architecture rows.
4. A week of real pull requests, the fixture runs, the tally, then a dated
   findings file in the shape of `findings-2026-09-10.md`, then this file
   updated with what the numbers decided.

---

## Track 7 — judge of handed evidence

**Goal.** The agent reviews with evidence handed to it instead of gathering the
evidence itself.

### Why

`.cujo.yml` at base already carries `install`, `test`, `boot`, `smoke` and
`allow_hosts`, and the parent only infers what the policy left out. But even
with every command declared, the parent spawns four sub-agents, and `tests`,
`smoke` and `detonation` each exist to wrap one `sniff.py run` command and hand
back a JSON report. That is a model doing the work of a shell script. Only
`probes` writes something new.

Where the agent earns tokens: inferring commands for a repository with no
policy; writing probes; judging the evidence and writing the review. Where it
does not: running a declared command and collecting the report.

### Shape

- Declared commands run with no model. Their reports land in the parent's
  input beside the pull request.
- The parent infers commands only when the policy is absent, which keeps the
  door open for repositories that are not the user's.
- The `tests`, `smoke` and `detonation` sub-agents go.
- `probes` stays as the one sub-agent. The parent decides per run whether to
  spawn it, with a coverage map handed to it: which tests reach the changed
  files, from `vitest --changed`, `jest --changedSince` or `pytest-testmon`,
  computed with no model. If the ledger later shows the parent over-spending,
  the map is already there to turn into a rule.
- The red check stays hard rules plus an agent critical, as today.

### Steps

1. Coverage map in `sniff.py prepare` or a sibling command, per ecosystem.
2. A deterministic execute stage on the trusted side for declared commands,
   producing the same report shapes as Contract 2, so the hard rules and the
   fold do not change.
3. Rubric: the parent starts at judgment when reports are present; the
   inference path stays for when they are not.
4. Retire the three sub-agents from the rubric; keep `probes`.

---

## Track 8 — agent-PR facts, zero tokens

**Goal.** Catch the documented failure mode of agent-written pull requests:
tests weakened until they pass.

### Why

The tests delta is base-pass-head-fail. It is blind to deleted assertions,
widened tolerances, skips, regenerated snapshots, and code built to the test
with the library dead or absent. Head's `conftest.py` or test config runs on
head's tree and can redefine what pass means. These are facts and cost nothing.

### Signals, each stated as a finding the way hard rules are

- Test count and skip count, base against head.
- Test files deleted or renamed.
- Changes to test configuration and fixtures: `conftest.py`, `pytest.ini`,
  `pyproject.toml [tool.pytest]`, `vitest.config.*`, `jest.config.*`,
  snapshot directories.
- Assertion count in changed test files, base against head.

---

## Track 9 — reviewer patterns Cujo lacks

Each one line, with the tool that has it, so a later track can pick from the
list with the numbers in hand.

- Incremental re-review on push, and auto-resolving threads the push fixed
  (CodeRabbit, Ellipsis, Qodo, Claude Code Review, Bugbot). Cujo re-runs
  everything and supersedes.
- Validation before posting: majority vote over parallel passes and a
  validator model (Bugbot), or a judge that drops findings it cannot ground
  (CodeRabbit). Cujo validates hard rules through the sensor and posts the
  agent's judgment findings unchecked.
- A per-repo review instructions file with path scoping and skip lists for
  generated code and lockfiles (`REVIEW.md`, `BUGBOT.md`, `.greptile/rules.md`).
  `.cujo.yml` carries commands, not review rules.
- A severity threshold knob: quiet, chill, assertive, or P0 and P1 only.
- Learnings from feedback: thumbs and dismissals become stored, path-scoped
  learnings (CodeRabbit, Greptile). `/cujo dismiss` teaches nothing.
- Dedup against the bot's own earlier comments and against human comments.
- A review model from a different family than the authoring model. Greptile
  measured self-review recall at 54 to 62 percent. One config line.
- One retry on a head-only test failure before reporting. Base against head
  already filters most flakes, which no product has; the retry is the
  remainder.
- Monthly spend cap and a pause after N reviewed commits. The per-turn budget
  exists; the outer caps do not.
- An acceptance metric as the tuning number. Track 6 defines it.
- For a future pre-push CLI: the identical-diff shortcut, where the pull
  request review skips a diff the CLI already reviewed (Bugbot's patch id).

---

## Decisions to record, addendum

- 149, the sidecar: why beside the review, why nothing posted, why its own
  service. With track 6.
- The judge shape and the coverage map. With track 7.
- Whether diff mode survives. With the findings file.

## Open questions, addendum

- What a Cujo run costs today, per check. Track 6 answers it.
- Whether OCR's precision on the fixture beats diff mode's.
- Whether `probes` ever finds what `tests` missed.
- Whether OCR reads repository-controlled rule files, and whether its tools
  execute repository code. Checked before the sidecar ships; a yes on the
  second stops it.

### First observations, before the week starts

- Cujo could not finish its own review of the sidecar pull request (#151)
  inside the 30 minute turn ceiling, twice: the monorepo install in the box
  took 12 minutes and `tests` on base and head took 15, leaving `probes` and
  `smoke` no time. A third attempt died to the harness restart that merging
  #150 caused. The ledger script's pull request (#150), a smaller change to
  the same repository, finished clean in about 12 minutes. Two things for the
  findings file: the ceiling is a function of repository size and not of the
  change, and a deploy kills every run in flight.
- Both pull requests were sandbox runs and not diff runs, because each
  touched a manifest (`pnpm-lock.yaml`, `pyproject.toml`) and the manifest
  floor wins over the repository's `mode: diff`.
- `/cujo review` on a head the session had already reviewed produced no
  review at all: the model read its earlier review in the history and
  declined to post twice (orders-api #45, decision 150). Fixed by giving the
  command a fresh session. Any "run the fixture three times" step depended
  on this working.
- Every pull request to this repository now waits for `cujo/guard` to time
  out at 30 minutes before branch protection lets it merge. Raising
  `CUJO_TURN_TIMEOUT_MS` in Coolify for the week, or excluding this repository
  from the sandbox floor, is a deploy decision and not a code change.

### Track 6 status after day one (2026-09-14)

Numbers and the tally are in `findings-2026-09-14.md`. In one line each:

- Cost: 5 to 13 cents a fixture run, 16 cents for a sandbox run of this
  monorepo. Under 1 USD by an order of magnitude. Track 7 is for latency and
  predictability; precision work first.
- Probes: never found the planted regression (tests did, 4 of 4), but found
  the one thing tests cannot say, a docstring left stale by the change. Off by
  default in track 7, with the parent able to turn it on.
- Detonation: caught the decoy read 2 of 4; once the egress gateway refused
  `github.com` for a git dependency, once the 15 minute ceiling cut the review
  after a provider retry. The malicious-sample path is flaky at the network
  layer, not the sensor.
- OCR: found the planted regression by reading (a `high bug` naming the
  half-cent tie), plus the stale docstring and the sibling-service drift, at
  68k tokens and 1.5 cents, in 9 minutes on this model. Skips manifest-only
  diffs; zero comments on the docstring diff. Undecided against diff mode
  until real PRs run both on the same heads; leaning OCR.
- Acceptance: nothing `wrong` on the fixture. Real-PR rows come from the week.

To extend the sample during the week:

```
# tokens and findings per run and per check, from the public API
python3 <scratchpad>/collect.py runs.tsv 0.15 0.50 0.03     # or scripts/ledger_report.py over a db copy
# the sidecar table, from inside the cujo container: create a Coolify
# scheduled task on the app (container "cujo", any yearly cron, command under
# 255 chars), execute it on demand, read its last execution, delete it after.
# The command that worked:
#   node -e "const{DatabaseSync:D}=require('node:sqlite');console.log(JSON.stringify(new D('/data/cujo.db',{readOnly:true}).prepare('select run_id,status,exit_code,duration_ms,error,substr(result_json,1,60000) r from run_ocr_reviews').all()))"
coolify hetzner POST /applications/2qjoj3npnavykygwoybj8yh5/scheduled-tasks '{"name":"ocr-dump","command":"<above>","frequency":"0 0 1 1 *","container":"cujo","timeout":120,"enabled":true}'
coolify hetzner POST /applications/2qjoj3npnavykygwoybj8yh5/scheduled-tasks/<task>/execute
coolify hetzner GET  /applications/2qjoj3npnavykygwoybj8yh5/scheduled-tasks/<task>/executions
coolify hetzner DELETE /applications/2qjoj3npnavykygwoybj8yh5/scheduled-tasks/<task>
```

Deploy facts learned the same day, and the fixes: a service that exits at
boot takes the compose app down (#152); a merge to `main` kills runs in
flight; `/cujo review` needs a fresh session (#153, decision 150); Node's fetch
gives up after five minutes of headers (#154); `CUJO_TURN_TIMEOUT_MS` is 15
minutes now; `OCR_LLM_TIMEOUT` is 300 s.

---

## Track 10 — a personal pull request reviewer, with a backend

**Goal.** Cujo becomes something one person installs and runs for their own
repositories from the board: which repositories it reviews, how it reviews
each one, what model it runs on, and the bot itself, all managed in one place
and stored in Cujo's own database. What exists is kept: the sandbox, the
checks, the hard rules, the diff review, the board's drawing of a run.

Written 2026-09-15, before any of it is built. It absorbs roadmap items 3, 4
and 5 (OAuth on the board, private repositories, the UI list) and adds two
things they did not say: configuration lives in the store, not the
environment; and the tracker moves to GitHub issues and a project board.

### Why

Today every setting is an environment variable read once at boot
(`apps/cujo/src/config.ts`), the model provider is registered on the harness
once at boot and never again (`clients/harness.ts:74-124`), Cujo learns which
repositories exist only from webhook deliveries (no `installation` event is
handled, no registry table), and the only per-repository state is the Discord
channel binding. Per-repository policy is a two-key `.cujo.yml` read by regex.
There is no authenticated route at all (decision 57), on purpose: the operator
plane was deleted because its only write path went with the human gate.

A product has an owner who changes things. The board has nowhere to put a
change, and the process has nowhere to keep one.

### What stays fixed

- The trust boundary. Every setting, key and token lives on the trusted side
  and nothing new crosses into the sandbox. A provider key moving from Coolify's
  environment to Cujo's SQLite file is a move within the trusted zone.
- The anonymous read-only `/public` plane and the board as it is for a
  visitor. Decision 57's *read* half holds; its *write* half is reversed.
- Decision 34's rejection of API keys as the operator credential. The
  credential is a GitHub login, because GitHub is already the identity on the
  pull request.
- `.cujo.yml` keeps meaning something: the repository's own word on how to
  run it (install, test, boot, smoke, allow_hosts) is read from the base
  branch by the sandbox and cannot be overridden from outside the repository,
  because that is what stops a pull request from talking a box into something.

### The shape

1. **Identity.** GitHub OAuth on `apps/web`, the session held by `apps/cujo`
   (the only place with a store). The principal is a GitHub login, checked
   against the App's installation: the account that installed the App is the
   owner. Single owner for now; a repository's write access decides who may
   dismiss or re-review from the board later, the same rule `/cujo dismiss`
   uses on the pull request today.
2. **An authenticated plane.** A third route group beside ingress and public:
   session-gated, on the internal host, reached only through `apps/web`'s
   proxy, which today forwards `GET /public/*` only and would forward the
   write verbs for this group. Reverses the write half of decision 57 and
   needs its own entry saying why the principal exists again.
3. **A repository registry.** Handle `installation` and
   `installation_repositories` webhook events; list installations with the App
   JWT at boot to backfill. A `repositories` table: full name, installation
   id, visibility, enabled, added at. The board lists what the App is
   installed on, and the owner turns review on or off per repository.
4. **Settings in the store, layered.** `deploy default < store < .cujo.yml`,
   the layering roadmap item 3 already named, and the board shows the
   effective value and where it came from. Instance settings: the model
   provider (name, base URL, key, models, context window, max tokens,
   reasoning), the models for the sandbox review, the diff review and the
   conversation, budgets and timeouts, the review mode default, reactions and
   checks on or off, push debounce, Discord. Per-repository settings: mode,
   enabled, Discord channel (already a table), budgets, and the instructions
   below. The environment keeps only what a process needs before it has a
   database: the port, the database path, the GitHub App identity, the webhook
   secret, the service URLs. `MODEL_PROVIDER_*` and `CUJO_MODEL*` become
   the first store-backed settings, with the environment as the seed on first
   boot and ignored after.
5. **Re-registering the provider at runtime.** The harness's
   `PUT /settings/model-providers` is an upsert already; `apps/cujo` calls it
   on every settings change, not only at boot. The key at rest: SQLite on the
   `cujodata` volume, same host and same trust as the environment file today;
   encrypting it with a key from the environment is a later step and its own
   decision.
6. **Instructions per repository.** A text the owner writes on the board and
   the reviews read beside the standards files: what to care about, what to
   ignore, paths to skip. Stored per repository; also honoured from a file in
   the repository (`.cujo/REVIEW.md` or a key in `.cujo.yml`), read at base,
   so a repository can carry its own. Which wins when both exist is an open
   question below.
7. **Managing the bot.** The board shows the App's installation state per
   repository, the permissions it holds against the ones it needs (checks,
   pull requests, contents), the webhook's last delivery and its result, and
   a link to install or repair on GitHub. Nothing here writes to GitHub
   beyond what the reviews already do.
8. **Private repositories.** With the owner known and the installation
   token in hand, a private repository's clone happens on the trusted side
   and the tree is copied into the box; no token crosses. Roadmap item 4,
   unchanged.
9. **The UI.** Landing with install and manual as primary navigation; a
   repositories page; a repository page with its runs, settings and
   instructions; the run page as an evidence log; an instance page with
   settings, provider, bot state and health; the galaxy at `/galaxy`.
10. **The tracker.** Issues on GitHub, one per slice, labelled by track, on a
    project board with the columns this file's tables use. This file stays as
    the design of record for ordering and why, and shrinks as issues absorb
    the steps.

### Ordering

| slice | needs | unlocks |
| --- | --- | --- |
| a. registry from installation events, plus backfill (#155) | nothing | repositories page, per-repo settings |
| b. OAuth and the session-gated plane (#156) | nothing | every write below |
| c. settings store with the environment as seed; provider re-registration (#157) | b | instance page |
| d. per-repository settings and instructions; layering shown on the board (#158) | a, b, c | repository page |
| e. bot state on the board (#159) | a, b | instance page |
| f. private repositories (#160) | b, d | nothing |
| g. the pages, in the order listed in 9 (#161) | each of the above as its data arrives | dogfooding |

a and b are independent and both small. c is the first thing that changes how
the process boots and is the one to get right. The pages come with their data,
one pull request each, reviewed by Cujo in diff mode with OCR beside it, which
is the real-pull-request half of track 6.

### Decisions to record

- The authenticated plane returns: GitHub OAuth as the credential, single
  owner, reverses the write half of 57, keeps 34's rejection of shared keys.
- Settings live in the store and the environment seeds them once. What stays
  in the environment and why.
- A repository registry from installation events, and what "enabled" means.
- Instructions per repository: where they live and which layer wins.
- Where a provider key rests.

### Settled 2026-09-15

- **Precedence: `deploy default < board < repository file`.** Commands
  (install, test, boot, smoke, allow_hosts) come from the file at base and
  nowhere else. For everything else the file wins when it sets the key and
  the board is the fallback; the board mirrors the file's value automatically
  and shows the source, so an owner reading the board sees what will happen,
  and a board edit applies only to keys the file leaves unset.
- **Owner: any admin of the installation.** Checked against GitHub per
  session and cached; an organisation install has several owners.

### Open questions (#162)

- Whether an owner may change a file-set key from the board by having Cujo
  open a pull request against the repository. Ruled out earlier; worth
  re-asking once instructions have a home.
- Whether the provider key should be encrypted at rest with an environment
  key, or whether the volume's own protection is the line.
- Where track 7 (judge of handed evidence) sits relative to this: it changes
  the review; this changes everything around it. They do not conflict, and
  track 7 still waits on the rest of week 6's real-PR rows.

### Slice f, private repositories (#160): the design, 2026-09-16

**Today.** A private repository's pull request is claimed like any other,
stamped `is_public = 0`, and briefed with the base repository's public clone
URL. The sandbox has no credential, so `prepare` clones nothing and the run
fails in the box. The diff review reads through the API with the installation
token and already works; the OCR sidecar holds no GitHub credential and its
clone fails the same way. The public plane hides private runs (404), and no
other plane shows them.

**Mechanism: stage the two trees on the trusted side, copy them into the
box.** No clone in the sandbox, no token anywhere near it, no clone URL in
the brief.

1. `apps/cujo` fetches GitHub's archive of the base commit and of the head
   commit (`GET /repos/{repo}/tarball/{sha}` with the installation token; a
   fork's head commit is served by the base repository, verified 2026-09-16
   against a fork pull request on a public repository). Each is streamed, not
   buffered, to `sandbox-mcp` as `PUT /stage/{ticket}/{base|head}`, the
   ticket 32 hex characters minted per run. The size cap and the deadline
   are `CUJO_STAGE_MAX_BYTES` (256 MiB per tree) and `CUJO_STAGE_TIMEOUT_MS`
   (5 min). A failure fails the run before any session exists, with a reason
   the board shows.
2. `sandbox-mcp` keeps a staging store on its own tmpfs (`/stage`, sized in
   compose), single use, swept after 30 minutes. `sandbox_create` takes an
   optional `staged: <ticket>`; after the box is up, each tarball is streamed
   into it through `docker exec -i ... tar -xzf - --strip-components=1 -C
   /work/stage/<tree>` — the same stdin path `sandbox_write_file` uses, so
   nothing lands on the host — and the entry is consumed. An unknown, used or
   expired ticket is a refusal the model can read. `daytona` refuses
   `staged` outright.
3. `sniff.py prepare --staged /work/stage` replaces `--clone-url`; the two are
   exclusive. It moves each tree into place, `git init`s and commits each as
   one synthetic commit (so tools that expect a repository still find one),
   and runs the rest of `prepare` unchanged: policy from base, build files
   from head. The report carries `source: "clone" | "staged"`. The
   `refs/pull/<n>/head` check has no equivalent: the trees were fetched by
   SHA on the trusted side, which is the same guarantee made earlier.
4. The brief carries `staged: <ticket>` in place of `clone_url` for a private
   repository in sandbox mode; the rubric's step 1 and 2 branch on which key
   is present. The ticket buys "copy these two trees into a box you create",
   once, for thirty minutes; it is not a credential and it does not enter the
   sandbox.
5. The OCR shadow skips a private repository with a line, rather than
   failing a clone.

**Visibility.** A second pull request: `GET /owner/runs`, `/owner/runs/:id`,
`/owner/runs/:id/events`, the public serializers with no `is_public` filter,
for a signed-in owner. The web's run page falls back to the owner plane when
the public one says 404 and a session is present; the repository page's runs
list reads the owner plane. The anonymous board is unchanged.

**Crossings.** New rows: `apps/cujo → sandbox-mcp` (two archives per private
run, over the compose network, an installation token used on the trusted side
and dropped) and `sandbox-mcp → sandbox` (the archives, through exec stdin).
The line "private repositories are a non-goal" in decisions 134 and 149 is
reversed by decision 158, not deleted.

**Not in this slice.** OCR on private repositories (the sidecar would need
the token; it stays public-only). Per-installation visibility: an owner is an
admin of any installation of the App and already sees every setting, so an
owner sees every run.

**Status 2026-09-16.** #170 (hydration fix from the first real sign-in)
merged. Slice f merged: #171 (staging, decision 158) and #172 (owner run
routes and the run page's owner fallback, decision 159). A private repository
`spencerjireh/cujo-private-check` (a tiny Python package with a `.cujo.yml`)
was created and added to the App's installation for the dogfood; its PR #1
ran on staged trees and Cujo's probes caught the real bug (a discount that
stacks past one), blocking it. Remaining in track 10: g4 (landing and the
galaxy for an owner), the open questions (#162), and OCR on private
repositories, which stays public-only.

**Status 2026-09-16, later.** g4 merged (#174, decision 160): the root is a
landing in the manual's register, the board is at `/galaxy`, robots allows
`/$` and `/docs`. #175 (the manual admits private repositories) merging
behind it. Cujo's reviews: no findings on #174; one `info` on #175 asking
whether the prose matches the code (answered). Track 10 remaining: the open
questions (#162) and OCR on private repositories.

### Track 7 status, 2026-09-16

Settled with the user: probes on by default, the parent may skip with a
stated reason (the private run's bug was found only by probes; the coverage
map is deferred); a repository with no declared `test` keeps the gather
rubric unchanged; three PRs, `tests` first.

PR 1 open as #176 (decision 161): `review/policy.ts` (`.cujo.yml` at base,
`yaml` + zod, allowlist rules copied from sandbox-mcp with an agreement
test), `clients/sandbox-mcp.ts` (the service's tools over MCP from the
trusted side), `review/execute.ts` (box, prepare, setup, declared install per
tree, declared test on base then head, `sniff.py report`; the suite's
outcome read on the trusted side in `review/suite-outcome.ts`),
`store/executions.ts` (`run_executions`, `run_sandboxes`), the fold's
`executed`/`sandbox` options, `agent/JUDGE.md` and `buildJudgeSpec`, the judge
brief, the runner's destroy on turn end / fail / supersede and the boot
sweep. `CUJO_EXECUTE_DECLARED=0` is the rollback switch.

Next: PR 2 `smoke` (a deterministic `sniff.py smoke` in the box; the judge
rubric drops its smoke section), PR 3 `detonation` (the executor runs
`sniff.py detonate` per added specifier from `addedSpecifiers`, the cache
write moves to it; `SKILL.md` becomes the gather rubric for undeclared repos
only). Then the fold cross-checks coverage against what ran.

PR 2 (smoke, decision 162) is written on `feat/judge-smoke`, stacked on
`feat/judge-tests`: `sandbox/cujo_sniff/smoke.py` (`sniff.py smoke --boot
--request --tree`, one sensed command in its own process group via a
`during` hook on `run_sensed`, port off the boot line or `--port`, loopback
requests, group stopped in the window), the executor's smoke stage joining
`endpoints[]` and `log_tail`, the judge rubric reading `executed.smoke` and
spawning no smoke sub-agent, `check_missing` owing smoke on a judge run only
when it ran. Opens once #176 merges.

PR 3 (detonation, decision 163) written on `feat/judge-detonation`, stacked
on smoke. Blocker for the whole stack: #176 changes `apps/cujo/package.json`
(two new deps), so the manifest floor forces a sandbox run of this monorepo,
and the gather path hits the 15-minute ceiling twice (a 13-minute install;
detonation done, tests and probes still running). The cujo/guard check is
neutral, which branch protection does not accept. Options: raise
`CUJO_TURN_TIMEOUT_MS` to 30 min on the deploy for the rerun, merge with
`--admin`, or declare `install`/`test` in this repo's own `.cujo.yml` (the
judge path would then apply after #176 lands, but not to #176 itself).

**Where the stack stands (2026-09-16, end of session).** #176 (tests,
decision 161) → #177 (smoke, decision 162, stacked) → #178 (detonation,
decision 163, stacked), all green on CI and every review thread applied
or answered. #176's `cujo/guard` never reached a verdict: two gather runs on
this monorepo hit the 15-minute ceiling (a 13-minute install), and the
third, after `CUJO_TURN_TIMEOUT_MS` was raised to 30 minutes on the deploy,
died at 11 minutes on OpenRouter's daily key limit (403). #177 and #178
passed Cujo's diff review once and were pushed again after the fixes; their
reruns will hit the same limit until it resets or is raised. The deploy is
still at the 30-minute ceiling.

**Cost work, 2026-09-16.** Key cap 2/day; diff model deepseek-flash; sidecar
off. #179 merged (decision 164: limits and switches on the board). #180
(decision 165: usage recovered on a timed-out turn, a 3M sandbox budget,
per-check pages for sub-agents, a setup bound in the gather brief) green and
reviewed; merges once the #176 sandbox run in flight ends. The judge stack is
restacked: #176 on #180 with its three execute knobs moved into settings and
the judge spec budgeted; #177 and #178 still need rebasing onto the new #176.
Noise to fix next: DIFF.md's info tier fills with confirmations of the PR
body on a head with nothing to say (two reviews today were only that).
#181 (DIFF.md info tier) and #182 (usage recovery polls the turn) merged.
The stack #176 → #177 → #178 is rebased on main; #176's fifth run started
10:47 under the 3M budget, the setup bound and the per-check pages.
