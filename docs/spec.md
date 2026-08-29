# Spec and contracts

This is the doc the code follows. It defines what Cujo acts on, the data that
moves between its parts, and the rules that turn an observation into a finding
and an action.

## Scope

- **Trigger:** every pull request on a repo where the Cujo GitHub App is
  installed. There is no file filter; a PR that changes only code gets the same
  run as one that changes a dependency manifest.
- **Ecosystem:** any the agent recognises. The agent infers how to install,
  test, and boot the repo from what it finds (`pyproject.toml`, `package.json`,
  `Makefile`, CI workflows). A `.cujo.yml` in the target repo overrides the
  inference when present.
- **Dependencies:** when a PR adds or version-changes a dependency, the
  detonation check installs it in isolation and records what the install does.
  A version bump gets a run because a compromised release is a real
  supply-chain attack, and the new version runs new install code. A dependency
  can be a normal registry release (`humanize==4.9.0`) or a direct reference
  (`git+https://…`); the `git+https` form is how the hostile demo is delivered
  without publishing anything to a public index.

## Division of labor: code senses, the agent judges

The split between deterministic code and agent reasoning is fixed:

- **Code senses.** The sandbox run produces raw, factual signals: which tests
  passed on base and failed on head, what a probe returned, which hosts were
  contacted, which files were read, what ran, what was written outside the
  workspace. No judgment.
- **The agent judges.** It reasons over those signals against the rubric to
  assign each finding a severity and write the review.
- **A hard rule overrides the agent on the dangerous case.** If a critical
  signal is present (a regression the tests caught, the decoy secret read or
  seen leaving, a write to a sensitive path, egress to an unknown host during an
  install), the finding is `critical` and the agent cannot downgrade it. The
  model reasons about the ambiguous cases; it cannot reason away a confirmed
  regression or exfiltration.

## Non-goals (for this milestone)

- Private repos and self-hosted Daytona.
- TLS interception of sandbox egress (metadata only for now; see the
  egress-depth decision).
- Forcing all sandbox traffic through the proxy. The proxy sees processes that
  honour `HTTP(S)_PROXY`; a non-Python process that opens a direct socket is
  not observed. A network-namespace or iptables redirect inside the sandbox
  closes that gap later.
- Remediation (a fix PR on `critical`) is a stretch, not a requirement.
- Approving a blocking review from Discord. Contract 7 notifies; it does not
  decide. The design leaves room for an interactions endpoint on the webhook
  host, but the button is not built and approval stays behind Cloudflare
  Access (decision 23).

## Contract 1 — the trigger

The Cujo GitHub App subscribes to `pull_request` events (`opened`,
`synchronize`) and to `repository` events (`privatized`, `publicized`). The
signature is checked before the event type, so both arrive on the same route
with the same one gate in front of them.

A `repository` event re-stamps `is_public` on every run of that repo and does
nothing else; it is the fast path for decision 34's public board, and matching
is case-insensitive because `runs.repo` holds whatever casing GitHub sent.

For a `pull_request` event the `apps/cujo` webhook module:

1. Verifies the `X-Hub-Signature-256` HMAC against the webhook secret. Rejects
   anything unsigned or mismatched.
2. Reads the PR metadata and the changed-file list with the App installation
   token (Contents: read, Pull requests: read).
3. Finds or creates the TrueForge session for this PR (see Contract 5) and
   starts one turn with a single user message: repo full name, PR number, base
   SHA, head SHA, the changed-file list, and — only when the repo is public —
   `run_id`, which the agent passes back to the review tool (Contract 4). An id
   and not a URL: the payload reaches an agent that is about to read a
   stranger's pull request, so it names no host.
4. Records a run (see Contract 6) and stays subscribed to the turn's event
   stream, folding events into that run until `turn.done`.
5. Reacts on the pull request with an eye, once this run is known to be the
   one worth starting and before the turn exists (Contract 9). A head the bot
   already reviewed, and a delayed delivery for a head that is no longer
   current, are both released before this point and get no reaction — one pull
   request has one reaction, and neither of those runs will produce a status
   that could clear it.

The webhook module does not decide what to check. That is the agent's job.

## Contract 2 — the sandbox run

One Daytona sandbox per turn. The parent agent sets it up, delegates each
check to a subagent, and collects one JSON report per check. Only those reports
cross back out of the sandbox.

### Setup

1. Clone the repo at the head SHA; add a worktree at the base SHA. Both live
   in the same sandbox so the comparison is like-for-like.
2. Seed the decoy secret: a fake credential file (`~/.aws/credentials` with a
   bogus key) placed before anything runs.
3. Start the in-sandbox logging proxy and export `HTTP(S)_PROXY` for every
   process the checks spawn. Start the inotify watcher on the decoy file.
4. Read `.cujo.yml` from the **base** SHA, if present. Policy comes from the
   branch the PR targets, never from the PR itself, so a PR cannot allowlist
   its own exfiltration host. If the PR changes `.cujo.yml`, the parent emits
   a `warn` finding ("`.cujo.yml` changed in this PR; the base version was
   used") and ignores the head copy for that run. Schema:

   ```yaml
   install: uv sync            # how to install the repo
   test: uv run pytest         # how to run the suite
   boot: uv run uvicorn app:app --port 8000   # how to start the app
   smoke:                      # endpoints to hit after boot
     - GET /health
     - GET /orders/1
   allow_hosts:                # egress the repo legitimately needs
     - api.stripe.com
   discord_guild: "2222…"      # which Discord server may watch it (Contract 8)
   ```

   Any key can be omitted. Missing keys are inferred from the repo; if the
   agent cannot infer `test`, the run stops as described under `tests`.

### The checks

Each check runs in its own subagent with fresh context. The subagent has the
check's instructions and the sandbox tools, nothing else; only its final JSON
report returns to the parent.

- **`tests`** — run the suite on base and on head. Report per-test status for
  both, and the derived set `base_pass_head_fail`. If no suite is found and
  `.cujo.yml` names none, the report says so, the parent emits a single `warn`
  finding ("no test suite found") and stops: no probes, no smoke, no review
  beyond that finding. Without a suite the regression tripwire cannot fire, and
  the missing suite is itself the finding.
- **`probes`** — the subagent reads the diff, writes small scripts that call the
  changed functions with inputs it chooses, and runs them against head. Report
  each probe's script, the expectation the subagent stated before running it,
  and the outcome. Probes exist to check claims the diff makes that the suite
  does not cover.
- **`smoke`** — boot the app with the configured or inferred command, hit the
  configured or inferred endpoints, stop it. Report status codes, response
  tails, and the log tail.
- **`detonation`** — runs only when the changed-file list includes a
  dependency manifest (`requirements*.txt`, `pyproject.toml`, `setup.py`,
  `setup.cfg`, `Pipfile`, `uv.lock`, `package.json`, `package-lock.json`,
  `pnpm-lock.yaml`, `yarn.lock`, `Cargo.toml`, `go.mod`, and the like). The
  subagent diffs the manifest at base and head to the specifiers that are added
  or version-changed and runs `sniff.py` once per specifier. `sniff.py`
  installs one dependency in a fresh environment behind the proxy and prints
  one JSON object:

  ```json
  {
    "dependency": "humanize==4.9.0",
    "source": "pypi",
    "install_ok": true,
    "duration_s": 11.4,
    "subprocesses": [
      { "argv": ["pip", "install", "humanize==4.9.0"], "exit": 0 }
    ],
    "stdout_tail": "Successfully installed humanize-4.9.0"
  }
  ```

  plus the shared sensor block below.

### The sensor block

Every check report carries the same sensor block, produced by the same sensors,
so the hard rules read one shape regardless of which check ran:

```json
{
  "egress": [
    { "host": "pypi.org", "port": 443, "bytes": 3200, "known": true },
    { "host": "files.pythonhosted.org", "port": 443, "bytes": 1048576, "known": true }
  ],
  "files_read": [
    { "path": "~/.aws/credentials", "sensitive": true }
  ],
  "fs_changes": [
    { "path": "~/.venv/lib/python3.12/site-packages/humanize", "type": "created", "in_workspace": true }
  ],
  "secret_probe": {
    "decoy_read": false,
    "decoy_in_egress": false
  },
  "derived": {
    "egress_to_unknown_host": false,
    "wrote_outside_workspace": false,
    "wrote_sensitive": false,
    "spawned_subprocess": false
  }
}
```

The sensors, layered from language-agnostic to language-specific:

- **In-sandbox logging proxy.** Records each host, port, and byte count for
  every process that honours `HTTP(S)_PROXY`, which covers pip, npm, cargo,
  go, curl, and the common HTTP client libraries. Gives the `egress` list.
  Payload contents stay encrypted until TLS interception is added. A process
  that ignores the proxy variables and opens a direct socket is not seen by
  this sensor; for Python the audit hook below still records it, and for other
  languages that is a known gap (see non-goals).
- **Filesystem diff.** A snapshot before and after each check flags anything
  created or modified outside the workspace and its install environment
  (`in_workspace: false`), and anything under a sensitive path (`~/.ssh`, a
  shell rc, cron, a credentials path) as `wrote_sensitive`.
- **Decoy inotify watcher.** A watcher started at setup subscribes to
  `IN_OPEN` and `IN_ACCESS` on the decoy file; any event during a check sets
  `decoy_read`. This works for any language and does not depend on mount
  options (access-time comparison was rejected because `relatime`, the Linux
  default, only updates `atime` once per day, and `noatime` never does).
- **Python audit hook.** When a check runs Python, a `sitecustomize.py` on
  `PYTHONPATH` calls `sys.addaudithook` and records `open`, `socket.connect`,
  and `subprocess`/`os.exec` events. It rides into every Python subprocess
  (including pip running `setup.py`), so it gives the richer `files_read` and
  `subprocesses` lists and a second, independent source for `decoy_read`.
  `files_read` omits the reads the interpreter and package managers make on
  their own account (the interpreter's `lib/` tree, `site-packages`,
  `__pycache__` and `.pyc`, `.dist-info` metadata, `node_modules`, `/proc`,
  `/sys`, `/dev`); a sensitive path is listed whatever it looks like, and so
  is a read of Cujo's own state directory, which holds the real credentials
  file the decoy displaced. This is
  a filter on what leaves the sandbox in the JSON report, not on what the
  hook records, and it exists because a single `pytest` run otherwise ships
  hundreds of bytecode rows into the agent's context.

The block also carries `subprocesses[]` (from the audit hook) and a
`sensitive` flag on each `fs_changes` entry, so the `derived` booleans can be
traced to the rows that set them.

A path is classified sensitive on either its lexically normalised or its fully
resolved form, so a `..` segment cannot walk into a credentials directory
unnoticed and a symlink planted inside one is still sensitive.

The proxy and the watcher write to logs shared by every check, so a report is
the slice of those logs written while one command ran. `sniff.py run` and
`detonate` therefore take an exclusive lock for the duration: one sensed
command at a time, and a second waits (decision 41). The audit hook instead
gets one log per sensed command, so which file a row landed in is what
attributes it. Only a command wrapped in `run` or `detonate` is sensed — a
command the agent runs with the exported environment but outside a wrapper
writes to the shared audit log, which no report reads.

`sniff.py` exposes the sensors as four commands the rubric (`agent/SKILL.md`)
names: `setup` seeds the decoy, starts the proxy and the watcher, and prints
the environment every later command must carry; `run --check NAME -- CMD...`
wraps one command and prints its report with the sensor block; `detonate
--dependency SPEC` is the detonation check; `teardown` stops the daemons and restores or removes the decoy. The
agent fetches the script from `CUJO_SNIFF_URL`, a public raw URL of this repo,
with no credential.

`decoy_in_egress` stays `false` until TLS interception can confirm the value
left the box. The `derived` block holds the booleans the hard rules read.
`egress_to_unknown_host` is true when a host is neither a known package index
nor in `allow_hosts`.

## Contract 3 — findings and the hard rules

The parent turns the check reports into a list of findings. Each finding:

```json
{
  "check": "tests",
  "severity": "critical",
  "title": "test_order_total_rounding passes on base, fails on head",
  "evidence": "AssertionError: 10.05 != 10.04 (tests/test_orders.py::test_order_total_rounding)",
  "path": "app/orders.py",
  "line": 42,
  "side": "RIGHT"
}
```

`severity` is one of `info`, `warn`, `critical`. `path`, `line`, and `side`
are optional and anchor the finding as an inline comment. `line` is a line in
the PR diff; `side` is `RIGHT` (the head version, the default) or `LEFT` (a
line that exists only on base, for a finding about removed code).

Two layers decide severity, in order.

**Layer 1 — the hard rules (deterministic, code).** Any of these forces a
`critical` finding the agent cannot change:

- `tests.base_pass_head_fail` is non-empty — the PR broke a test that passed
  before it.
- `secret_probe.decoy_read` or `secret_probe.decoy_in_egress` on any check —
  something read or leaked the seeded secret.
- `derived.wrote_sensitive` on any check — a write landed in `~/.ssh`, a shell
  rc, cron, or a credentials path.
- `derived.egress_to_unknown_host` on the `detonation` check — an install
  called a host that is neither a package index nor allowlisted.

The hard rules are tripwires, not proofs of absence. Each fires only on
positive evidence a sensor recorded, so a sensor gap (a direct socket the
proxy did not see) can produce a missed `critical`, never a false one. A
`false` in the sensor block means "not observed," and Layer 2 treats it that
way.

The rules run twice. The rubric tells the agent to apply them, and
`apps/cujo` applies them again on its own side (decision 21): as each check's
`thread.done` arrives it reads the report (`base_pass_head_fail`, and the
`secret_probe` and `derived` blocks at the top level and inside `runs[]`) and
derives one `critical` finding per rule per check, with `source: "hard_rule"`.
A required check (`tests`, `probes`, `smoke`) whose sub-agent thread has not
returned a report by `turn.done` adds a `warn` finding of its own ("the tests
check returned no report"): the parent ran it inline, skipped it, or the
thread failed, and either way the rules had no report to read (seen on the first real
review, where the model delegated only `smoke`). These findings head the run's
`findings` list; the agent's own findings,
passed as `findings[]` on the review tool call with `source: "agent"`, follow,
minus any that repeats a hard-rule finding's check and title. If the agent
calls `post_advisory_review` while a hard-rule finding exists, the review has
already posted (that tool is not gated), so the run ends `error` with a
message naming the rule instead of `clean`; the operator sees the
contradiction rather than a green run.

**Layer 2 — the agent judges the rest** against the rubric carried as its
instructions (the `SKILL.md`):

- **`critical`** — a probe shows the change does not do what the diff claims;
  a smoke endpoint that worked on base now errors; a suspicious combination the
  agent judges to cross the line without a Layer 1 signal (for example, egress
  to an unknown host during `smoke` paired with an unexpected subprocess).
- **`warn`** — worth a human glance: changed code with no test covering it, a
  cache write outside the workspace, an unfamiliar but plausibly benign host, a
  smoke endpoint that is slower or noisier than on base.
- **`info`** — what ran and what it showed, when nothing is wrong. The
  execution summary is mostly `info`.

Layer 1 protects the cases that must never be reasoned away; Layer 2 is where
the agent's judgment does real work.

## Contract 4 — reviews and the approval model

Reviews mostly post automatically — that is the product's value. A human is
pulled in only for the consequential action. Two tool paths on `github-mcp`:

| Tool | When | GitHub review | Gated? |
|------|------|---------------|--------|
| `post_advisory_review` | no `critical` finding | COMMENT | No — posts automatically |
| `post_blocking_review` | any `critical` finding | REQUEST_CHANGES (blocks merge) | **Yes** — pauses for human approval |

Both tools take the same input: a summary body and a `comments[]` array. The
summary body lists what ran (checks, commands, durations), the results, and the
egress observed. Each entry in `comments[]` is one finding with a `path`,
`line`, and `side`, posted as an inline review comment on that diff line.
`github-mcp` validates each anchor against the PR diff before posting; a
finding with no anchor, or with an anchor outside the diff, moves into the
body so a bad anchor never blocks the review. Which of the three it was —
`file_not_in_diff`, `line_not_in_hunk` or `bad_line` — is recorded per comment
and logged, because an agent citing a file the PR does not touch and one citing
a real file outside the hunk are different mistakes (decision 37). The review
body is unchanged either way.

A GitHub call that does not return 2xx raises a `GitHubError` carrying `status`,
`path` and `method` as fields rather than interpolated into a message, so a
caller can tell an expected `404` from an outage without parsing prose. The
response body is not forwarded into the message: only GitHub's own `message`
field is read from its error envelope, and capped — an upstream body can echo
a request header back, and that is how one reaches a log line.

Both also take an optional `run_id`, which the agent copies verbatim from the
turn payload and never writes into the body itself. `github-mcp` validates it
as a UUID, builds the link from its own `CUJO_PUBLIC_BASE_URL`, and appends the
footer — a rule, then `Full evidence: <url>` — after the anchorless findings,
so the link is always last, always the same shape, and always on Cujo's own
host (decision 36). The agent supplies neither the format nor the destination.

Two independent conditions gate the footer, and each side owns the one it can
answer: `apps/cujo` omits `run_id` from the turn payload for a private
repository, which has no page a reader of the pull request could open; and
`github-mcp` appends nothing when it has no `CUJO_PUBLIC_BASE_URL`. Either
missing means the review body is exactly what it would have been without this
feature.

Advisory results post as a COMMENT review, not an APPROVE: the bot never formally
approves, so it can never satisfy branch protection and wave a bad merge through.
(Posting a formal APPROVE on a clean run for a green check is a later option if
we want the nicer UX.)

The gate is the harness's `require_approval_for_tools` on `post_blocking_review`
(and the tool is annotated `@destructive`). When any finding is `critical` the
agent calls that tool and the turn pauses with a `tool.approval_required`
event on the `main` thread, carrying `tool_calls[{id, source_event_id}]`.
`apps/cujo` reads the drafted review (the tool call's `body` and `comments[]`)
from the `model.message` event that `source_event_id` names, marks the run
`blocked_pending`, and shows the review with the findings and the evidence in
the Cujo UI. A human approves or rejects there. `apps/cujo` resumes the turn
with `sessions.createTurn(sessionId, {input: [{type:
'user.tool_approval', threadId: 'main', toolCallId, approval: {status:
'allow' | 'deny'}}]})` and then `subscribeToTurn` on the returned id, which it
records as its own before any event arrives. On `allow` the blocking review posts as
`cujo-guard[bot]`. On `deny` the agent posts nothing and ends the turn; the
rubric says so explicitly, so a denied block never degrades into an advisory
review nobody asked for.

The deny is not always a human's. The approval is outstanding on the session
rather than on the turn that raised it, and while one is pending TrueForge
refuses every later user message on the thread, so a block nobody will decide
has to be answered before the pull request can be reviewed again. `apps/cujo`
sends that deny itself when a newer head supersedes the run, and once more as a
retry if a turn cannot be started at all; the reason it sends says the commit
was replaced, not that an operator rejected the block, and the run stays
`superseded` with no approver (decision 39).

The review body carries the findings, the signals behind them, and the
execution summary, so the human confirms a judgment rather than reconstructing
it.

A REQUEST_CHANGES review only *blocks* a merge when the target repo's default
branch has branch protection requiring PR review. Without it, the review still
posts and shows as changes-requested, but does not gate the merge. So `orders-api`
needs branch protection enabled on `main` for the block to bite (a setup step on
that repo, done later).

## Contract 5 — one session per PR, no double-posting

- A PR maps to one Cujo session, keyed by repo and PR number.
- On `synchronize` (new commits), the session runs a fresh turn against the new
  head SHA rather than opening a new session. The earlier turns stay in the
  session, so the agent can see what it said before.
- The idempotency check lives in **`apps/cujo`**, not the agent or `github-mcp`.
  Before starting a turn, it lists the PR's existing reviews with the
  installation token and skips the turn if `cujo-guard[bot]` has already
  reviewed the current head SHA. So a retried webhook or a re-run never
  produces a duplicate review, and `github-mcp` stays write-only (it posts; it
  does not read PR state).

## Contract 6 — the run record and the operator API

`apps/cujo` keeps one record per PR event it acted on, called a run. It is a
projection of the TrueForge session (decision 18): the fields below are all
`apps/cujo` stores, and everything else the UI shows is rebuilt from
`listTurnEvents` on demand.

A run spans more than one TrueForge turn. `tool.approval_required` ends the
turn it arrives in, and the resume (Contract 4) is a new turn whose
`turn.created` carries `previous_turn_id`. So a run holds an ordered list of
turn ids, appended on every `turn.created` `apps/cujo` sees for the session,
whether it started that turn or not, and rehydration replays every turn in the
list in order.

| Field | Meaning |
|-------|---------|
| `id` | Run id, `apps/cujo`'s own. |
| `repo`, `pr_number`, `head_sha` | The PR event that started it. |
| `session_id` | The TrueForge session (one per PR, Contract 5). |
| `turn_ids` | Ordered list: the turn started for this head SHA, then each resume turn. |
| `status` | One of the seven states below. |
| `approver`, `decided_at` | Who decided and when. The email from the Access JWT for a decision made through `POST /runs/:id/approve`; the literal `external` when the resume came from somewhere else (see below). Never served on the public plane. |
| `is_public` | Whether the repo was public when the run was claimed, from the webhook's `repository.private`. Corrected by the `repository` event and by a periodic re-check; unset reads as private (decision 34). |
| `delivery_id` | The `X-GitHub-Delivery` of the webhook that claimed the run, or unset for a run claimed before the column existed. It is the correlation id every log line for this run carries, which is what survives the request ending while the run does not (decision 37). A GitHub-side handle, so never served on the public plane. |
| `created_at`, `updated_at` | Timestamps. |

Status moves on events from the session's turn streams, with one exception
(`superseded`, set by the webhook):

| Status | Set when |
|--------|----------|
| `running` | The run was claimed; the first turn is being started. |
| `clean` | `turn.done` with no `tool.approval_required` seen: the advisory review posted. |
| `blocked_pending` | `tool.approval_required` arrived on thread `main`. |
| `blocked_posted` | The `tool.response` for the gated call arrived in a later turn, and that turn's `turn.done` followed. |
| `denied` | A later turn's `turn.done` arrived with no `tool.response` for the gated call and the resume was a `deny`. |
| `error` | `turn.done` with an error state, the stream was lost and the replayed turns show no terminal event after the turn timeout, the run could not be prepared (a GitHub read or the turn start failed) and so never had a turn, or the turn ended on an advisory review while a hard rule had tripped (Contract 3). |
| `superseded` | A newer head arrived on the same PR while this run was `running` or `blocked_pending`. The run stops following its turn and no decision can be made on it. A run that was waiting on a human also has its approval denied, so the session can take the newer head's turn (decision 39). |

One run, one turn chain. Every run on a PR shares the PR's session, so a run
records the id of each turn it creates (`createTurn`, then `subscribeToTurn`)
before the first event arrives, and never adopts a turn another run on the
session recorded. A run that has no recorded turn after a restart was lost
between the claim and the turn; it ends in `error`, and because an errored run
with no turn does not hold its head, a redelivery of the webhook claims the
head again and reviews it.

The fold reads persisted events. The turn stream's `model.message` is a stub
(id only; the server streams text as deltas and never streams tool calls), so
at each decision point (`tool.approval_required`, `turn.done`) `apps/cujo`
re-reads the session's events with `listEvents` and replaces the stream's
copies by id before folding. The review tool call is recognised whether the
model called the MCP tool by name or through the harness's `call_tool`
meta-tool (`{mcp_server: 'github-mcp', tool_name, input}`), which is what the
server exposes by default.

A resume `apps/cujo` did not send is still tracked. After `blocked_pending`,
`apps/cujo` keeps a subscription on the session (`subscribeToTurn` for a turn
still running; `listEvents` on the session after a restart), so a new turn
started from the TrueForge operator console is seen like any other: its id is
appended to `turn_ids`, the gated call's `tool.response` moves the run to
`blocked_posted` or its absence to `denied`, and `approver` is set to
`external`. The UI shows such a run with an "approved outside Cujo" mark
instead of a name. The run cannot go stale, and the audit trail records that
the decision bypassed the approve route rather than pretending it did not
happen. The operator-console rule in decision 17 says not to do this; the
projection makes it survivable when someone does.

The four checks are matched to subagent threads by title. The parent titles
each spawned thread exactly `tests`, `probes`, `smoke`, or `detonation`; a
thread with any other title is shown but not treated as a check. A check's
report is the JSON in `thread.done.state.output` — the first fenced JSON block
in the message, parsed leniently, because the output is a model message and not
a structured field. A `thread.done` with `status: error` marks the check
failed and the parent decides what that means for the findings.

The operator API `apps/cujo` serves on `cujo-admin.spencerjireh.com`:

| Route | Returns or does |
|-------|-----------------|
| `GET /runs` | Runs, newest first, with status. |
| `GET /runs/:id` | The run, its checks (thread, status, report, and the `startedAt` / `endedAt` taken from each thread event's own `createdAt`), `findings` (Contract 3, critical first, each with `source`), `hard_rule_hits` (the hard-rule subset), and the drafted review when `blocked_pending`. |
| `GET /runs/:id/events` | Server-sent events: the folded run as it changes, for a live page. |
| `POST /runs/:id/approve` | Body `{decision: 'allow' \| 'deny'}`. Records the approver; resumes the turn as Contract 4 describes. Rejected unless the run is `blocked_pending`. A refusal answers `409` with `{ok: false, error, reason}`: `error` is the sentence the UI shows and `reason` is one of `no_such_run`, `not_blocked_pending`, `already_decided` or `resume_failed` — four conditions that used to arrive as one prose string a caller could only match on (decision 37). The decision leaves a pair of log lines: `approve.requested` before the outcome, carrying the actor, the decision, `ray` (the operator request that decided) and `delivery_id` (the webhook that claimed the run, omitted for a run claimed before that column existed); then `approve.applied` from the run's own logger once the resume lands. |

The `/discord/*` routes on the same host are Contract 7.

And the public plane, under `/public`, which no gate stands in front of
(decision 34):

| Route | Returns or does |
|-------|-----------------|
| `GET /public/runs` | Public runs only, newest first. Filtered on `is_public = 1` in SQL, not by the route. |
| `GET /public/runs/:id` | The same run the operator route returns, minus `approver`, `decided_at`, `session_id`, `turn_ids`, `delivery_id`, `approval` and `external_resume`, and with the drafted review shaped down to its tool, body and comments. 404 when the run does not exist **or** its repo is not public — the same answer either way, so the plane does not confirm that a private repo has runs. |
| `GET /public/runs/:id/events` | The same stream, in the same shape. 503 with `Retry-After` when the process is already holding `CUJO_PUBLIC_STREAM_LIMIT` public streams; operator streams are not counted. Closes if the repo goes private while it is open. |

The response is built by an allowlist, field by field, and never by removing
fields from the operator shape: the difference is what happens when a field is
added to the projection later, and only the allowlist keeps that field private
until somebody says otherwise.

Two probes answer on each host this process already serves — the webhook host,
the UI host, and the internal name in `CUJO_INTERNAL_HOST` — plus `/healthz` on
`127.0.0.1` and `localhost` for the container healthcheck. They widen no host
boundary: an unrecognised `Host` still gets 404, exactly as below. No gate
stands in front of either:

| Route | Returns or does |
|-------|-----------------|
| `GET /healthz` | Liveness. `{ok: true, service: 'cujo'}` for as long as the process is up. This is the container healthcheck, so it reads nothing and can fail for one reason only. |
| `GET /readyz` | Readiness. `200` when the process can accept work, carrying the harness flag the webhook itself gates on, a store ping, the public stream count, the process uptime, and a count of log lines the process could not write. `503` when **either** the harness has not finished bootstrapping **or** the store ping fails, with the same body and the failing check named — a webhook delivery calls `getSession`, `putSession` and `createRun` synchronously, so an unreachable store means no run can be claimed and readiness is false whatever the harness says. Deliberately *not* the healthcheck: a readiness failure there would restart the container while `bootstrapUntilReady` is backing off on purpose, and would take `web` down with it (decision 37). |

Neither is gated because neither says anything an anonymous reader could not
already infer: the body is booleans and counts, names no repo and no person, and
the webhook's own `503` already announces that the harness is not ready.

One process serves two hostnames and two planes, so both splits are enforced in
the process, not only at the edge:

- Every request is dispatched on the `Host` header. On
  `cujo-ingress.spencerjireh.com` the process serves `POST /webhook`,
  `GET /healthz` and `GET /readyz`, and answers 404 to everything else,
  including `/runs`. On
  `cujo-admin.spencerjireh.com`, and on the internal service name in
  `CUJO_INTERNAL_HOST` (default `cujo`), it serves the routes above and answers
  404 to `/webhook`. A request with any other `Host` gets 404. The internal name
  exists because the UI reaches this process over the compose network
  and Node's `fetch` always sends the target's own authority as `Host`; those
  routes are not exempt from the Access check.
- The plane split is by path, not by a third hostname, for that same reason:
  this process never receives the public name, so a fourth branch in the host
  dispatch would have to trust a forwarded header, and a header a client can
  also send is not a boundary. `/public` is mounted on its own router beside
  the gated one rather than under it, so the Access middleware cannot match it
  by accident.
- The UI itself is `apps/web`, a separate service on both
  `cujo.spencerjireh.com` and `cujo-admin.spencerjireh.com`. It proxies
  `/api/cujo/*` and the run stream to this process, forwarding the Access
  assertion on the operator hostname and forwarding none — and refusing any
  path outside `/public` — on the public one, so the API is same-origin with
  the page and needs no public route of its own (decision 27). When this
  process is unreachable the proxy answers `502` with
  `{ok: false, error: "cujo is unreachable"}`, rather than letting the failed
  fetch surface as an unhandled `500` that says nothing (decision 37). It also
  forwards `Cf-Ray`, so a line from the UI and a line from this process share
  one correlation id.
- Every route outside `/public` — reads as well as the approve route —
  requires a `Cf-Access-Jwt-Assertion` header that verifies against the
  Cloudflare Access public keys for the application's audience tag. A missing
  or invalid token is 401. Cloudflare Access at the edge is the first gate;
  this check is the second, so a request that reaches the origin by another
  path (a misrouted hostname, a direct hit on the origin IP) is still refused.
- The webhook route on `cujo-ingress.spencerjireh.com` is the only route that
  accepts a request without an Access token, and it accepts only a request
  whose HMAC verifies (Contract 1).

Tripwire: a `tool.approval_required` whose `thread_id` is not `main` means a
subagent was given the review tool, which the design forbids. `apps/cujo` logs
it, marks the run `error`, and does not offer an approve button for it.

## Contract 7 — Discord notifications

A review that blocks a pull request is only useful if someone finds out. Cujo
posts to a Discord channel as a bot, so a team sees a run start, sees it land,
and is told once — loudly — when a run is waiting on a human.

The feature is optional and off by default. Without `DISCORD_BOT_TOKEN` the
service runs exactly as before and posts nothing.

**What is configuration and what is data.** The bot token is a secret and lives
in the environment. The repo-to-channel binding is operator data and lives in
the run store behind the API, so adding a repo needs no redeploy and the write
can be validated against Discord (decision 24). One repo binds to at most one
channel, with an optional `notify_role_id` the ping mentions. A repo with no
binding is never notified.

**One card per run, edited in place.** Every run gets one message, posted when
the run first reaches a status worth showing and rewritten on each later status
change. A push to the pull request starts a new run (Contract 5), so it gets
its own card and the earlier run's card is rewritten to say it was superseded.

| Status | Colour | The card says | Fields |
|--------|--------|---------------|--------|
| `running` | blurple | Review running. | `Head`. Nothing that changes while the checks run: the card is rewritten only on a status change, so a progress count would freeze and then lie. |
| `clean` | green | No critical finding; the advisory review posted. | `Checks`, `Findings` (counts by severity), `Summary`. |
| `blocked_pending` | yellow | Blocked, waiting for a human. | Up to three critical findings with their anchor and a clipped line of evidence, then `Checks`. Also sends the ping below. |
| `blocked_posted` | red | The blocking review posted, and who decided. | Critical findings, `Checks`. |
| `denied` | grey | The block was rejected; nothing was posted. | Critical findings, `Checks`. |
| `error` | orange | The run ended in error. | `Error`. |
| `superseded` | dark grey | Replaced by a newer commit. | `Head` only. No findings: they describe a commit nobody is looking at, and showing them invites acting on a stale review. |

Two runs get no card at all: a run whose repo has no binding, and an `error`
run with no turn. The second is the "lost before its turn started" case, which
a webhook redelivery re-claims under a fresh run id (Contract 6) — a card for
it would sit in the channel beside the real one.

**The ping.** A Discord edit notifies nobody, so the one moment that needs a
person cannot be an edit. On `blocked_pending` Cujo posts a second, short
message that mentions `notify_role_id` and links to the run, and edits that
message to "resolved" once the run leaves `blocked_pending`. With no role
configured it still posts, without a mention: a new message is what raises the
channel's unread mark, which is the entire point.

Both ping steps are deduped on their own durable marker rather than on the
run's status, because the card is written first and a matching status would
otherwise hide outstanding work. The ping is sent at most once per run, keyed
on its message id, so a crash between the card and the ping still sends it. The
resolving edit is keyed on its own flag, so a failed edit is retried on the
next event and after a restart — otherwise a channel could keep showing an
actionable "needs a human" alert for a run nobody can decide any more. The role
a ping mentions is only used when the repo is still bound to the channel the
run's card lives in; a repo re-bound to another server mid-run gets a ping with
no mention rather than one naming a role that server never had.

**Every string in a payload is attacker-controlled** (decision 26). The PR
title comes from GitHub, and finding titles, evidence, the summary and the
error were written by a model that had just read the code in a stranger's pull
request. So, without exception:

1. Every payload carries `allowed_mentions: {"parse": []}`. Without it a pull
   request titled `@everyone` pings the server. The ping's own mention is the
   one exception, and it is an explicit `roles: [id]` for the configured role,
   never a parsed one.
2. Derived text is markdown-escaped (`` \ ` * _ ~ | [ ] ( ) ``), so nothing
   renders as formatting and no `[label](url)` becomes a live link.
3. Escaping the link syntax is not enough, because Discord also linkifies a
   bare web address and an `<https://…>` autolink and a backslash stops
   neither. So the scheme and the bare `www.` form are defanged —
   `http[:]//example.com` — before the escape pass, which keeps the address
   readable as evidence and unclickable. The only real URL on a card is the
   run's own link.
4. Control characters and the zero-width and bidi ranges are **removed**, not
   escaped. A bidi override can render "not critical" as "critical"; escaping
   does not stop that, only deletion does.
5. Every string is truncated by code point, not UTF-16 unit, so a clipped emoji
   cannot leave a lone surrogate. Limits: content 2000, embed title 256,
   description 4096, field value 1024, footer 2048, 25 fields.
6. The 6000-character total across an embed is a hard clamp, not a hope. Fields
   are dropped in reverse priority until the payload fits. Exceeding it is a
   400 that loses the card for the whole run, since every later edit then has
   no message id to edit.
7. No derived string is ever written into an embed URL field.
8. The ping's `content` is structural only — the repo (validated when the
   channel was bound), the PR number, and Cujo's own link.

**Delivery is at-least-once, and never blocks a run.** A failed send is logged
and dropped; nothing about a run's status, review, or approval depends on
Discord. Sends run on one serial queue, so an edit cannot overtake the create
it depends on and a fan-out across many pull requests cannot exceed Discord's
global rate. A 429 is retried once against `retry_after`. A `PATCH` answered
`10008` (Unknown Message) means the card was deleted, and a fresh one is
posted. A crash between Discord's 200 and the store write costs a duplicate
card rather than a missed one; Discord has no idempotency key, and that is the
safe direction. The channel is pinned to the run when its card is created, so
re-pointing a repo mid-run cannot edit a message into a channel that never held
it.

The API `apps/cujo` serves on `cujo.spencerjireh.com`, behind the same Access
check as every other route in Contract 6:

| Route | Returns or does |
|-------|-----------------|
| `GET /discord/channels` | Every binding, and `configured`: whether a bot token is set at all. |
| `PUT /discord/channels/:owner/:name` | Body `{channel_id, notify_role_id?}`. Validates against Discord, then stores the binding with the guild and channel name Discord reported. |
| `DELETE /discord/channels/:owner/:name` | Removes the binding. 404 when there was none. |
| `GET /discord/guilds` | The servers the bot is in, so a picker need not ask for a raw id. |
| `GET /discord/guilds/:id/channels` | That server's postable channels, in channel order. |

The repo is two path segments rather than one, because `owner/name` holds a
slash and `%2F` is handled differently by the router, the proxy, and `curl`.
It is stored lower-cased: GitHub repo names are case-insensitive and
`repository.full_name` carries whatever casing the owner typed, so a binding
typed by hand would otherwise silently never match.

The write is validated because a wrong id would otherwise fail silently at the
first blocked run: `channel_id` must be a Discord id, the bot must be able to
read the channel, and the channel must be a guild text or announcement channel
in a server. A channel the bot cannot read and a channel that does not exist
give the **same** answer on purpose — the difference would let an operator
probe channels across all of Discord — and the real status is logged instead.
A `notify_role_id` is checked against the server's roles, so "the ping mentions
nobody" becomes an error at bind time.

Reading a channel is not permission to post an embed in it, so the write also
resolves the bot's effective permissions there — its roles, then the channel's
overwrites applied `@everyone` first, then the union of the bot's role
overwrites, then its own, with `Administrator` short-circuiting — and refuses
the binding unless View Channel, Send Messages and Embed Links all survive. A
channel-level deny would otherwise bind cleanly and then fail on every run,
which is exactly the silent failure this route exists to prevent.

The three routes that call Discord answer 503 with no token configured; the two
that only read and write the store still work.

**The token stays on the server.** `DISCORD_BOT_TOKEN` is held by `apps/cujo`
alone. It is not in the agent spec, not in the turn message, not in any command
that reaches the sandbox, and it never appears in an error message or a log
line. Nothing on the notification path touches the sandbox at all.

## Contract 8 — the `/cujo` slash command

Contract 7 routes notifications; deciding where they go was an operator's job
over the Access-gated API. That put the fiddly part — which channel, which
role — in the wrong place, behind a login the people who care about the channel
may not have. This contract moves that choice into Discord without moving the
decision that matters.

**Two halves** (decisions 28 and 31). They answer different questions and are
proved by different people. Neither alone does anything:

| Half | Question | Proved by | Where |
|------|----------|-----------|-------|
| Declaration | Which Discord server may have this repo's reviews? | Whoever can merge to the repo's default branch | `discord_guild` in `.cujo.yml` |
| Binding | Which channel, and which role gets pinged? | A member with Manage Server | `/cujo watch` in that server |

Without the repo's half, anyone could point a repo they do not own at their own
channel. Without the server's half, anyone could send a repo's reviews into a
server they do not belong to. A binding records who made it: an email, or
`discord:<user id>`. On a deploy that serves one server, the declaration half
can be answered once in the environment instead of once per repo — see **The
deploy's own server** below; the server's half is never skipped.

```yaml
# .cujo.yml on the default branch
discord_guild: "222222222222222222"
```

Cujo reads that file through the GitHub App, from the **default branch**, and
never from the sandbox's copy — the sandbox holds the pull request's code, and
code that declares its own authorization is not an authorization. Reading the
default branch rather than the pull request's is also what makes the
declaration proof: it has to be merged.

The key is extracted, not parsed as YAML. It has one shape — a Discord
snowflake at the top level — so anything else simply does not match and the
repo counts as undeclared, which is the silent-but-visible behaviour below.

**The deploy's own server.** `CUJO_DEFAULT_DISCORD_GUILD` names one Discord
server, and a repo that declares nothing belongs to it (decision 40). A deploy
serving a single server then needs no per-repo commit: set the variable once
and run `/cujo watch`. Unset, every repo must declare, which is the rule above.

It is one id and never a list, so it answers "is this the deploy's own
server?" — every other server is refused exactly as it is today, including one
that invited the bot itself. It is consulted only after the declaration is read
and found absent, so a repo that named a different server still wins. It is
checked on the delivery path too, so unsetting it drops a binding it created,
the same way reverting a commit drops a declared one. An unreadable
`.cujo.yml` stays `unknown` and the default does not rescue it.

**The operator override.** `PUT /discord/authorizations/:guildId/:owner/:name`
on the UI host still allows a pair directly, recorded with the operator's
Access email in `authorized_by`. It is for moving a repo between servers, and
for a repo whose `.cujo.yml` cannot be changed. It is no longer the way
notifications are normally set up.

**When a declaration is wrong**, nothing fails: a malformed value, a server the
bot is not in, or a missing file all mean "not declared". Reviews are
unaffected — a config typo must not cost a review. `/cujo watch` says exactly
what to add and where, and `/cujo status` closes with the line to paste, since
listing every repo that named a server would mean reading each installed
repo's `.cujo.yml` on every command.

**Revoking is a commit, and it stops delivery.** Removing or changing
`discord_guild` is checked before every card, not only when a channel is bound:
a binding written before the edit would otherwise keep delivering forever,
since nothing else on that path consults the declaration. On a definite "no"
the binding is dropped and the run says nothing.

"Definite" is doing work there. A repo that declares nothing and a repo whose
`.cujo.yml` could not be read are different facts, and only the first stops
delivery. Treating an unreachable GitHub as a revocation would let a hiccup
silence a team's reviews, so an unreadable declaration keeps a binding that was
legitimately created and logs. A command in the same position refuses and asks
for a retry, because a command has someone waiting who can try again.

`/cujo unwatch` is checked **before** the declaration and before the
installed-repo list. A server must always be able to stop receiving: the very
commit that revokes a declaration is what makes a binding stale, and removing
the App from a repo is another, so gating cleanup behind either would strand
the channel with reviews it can neither justify nor stop.

Revoking an authorization also drops the binding it permitted. Leaving the
channel bound would keep a server receiving reviews it may no longer see.

**The command.** One `/cujo` with four subcommands, so a server gets one entry
in the picker. `channel:` and `role:` are Discord's own option types, which
render as native pickers; `repo:` is completed from every repo the Cujo App is
installed on. It is deliberately not narrowed to the ones this server may
watch: that would mean reading each repo's `.cujo.yml` on every keystroke,
against a three-second budget. `watch` does one targeted read for the repo that
was picked and says exactly what to add if it has not named this server, which
teaches more than a row missing from a dropdown.

| Subcommand | Does |
|------------|------|
| `/cujo watch repo channel [role]` | Sends that repo's cards to that channel, pinging that role when a review blocks. |
| `/cujo unwatch repo` | Stops sending them. |
| `/cujo status` | Where each repo watched here currently goes, plus anything an operator allowed that is not being sent yet, and the line to add to a repo to allow another. |
| `/cujo test repo` | Posts a sample card to the bound channel. It exercises the token, the channel permissions and the rendering at once, which nothing else can do without waiting for a real pull request. |

Every reply is ephemeral, so configuring makes no noise in the channel.

**The gates, in order.** A command is refused unless all of these hold, and the
reply says which one failed:

0. `/cujo unwatch` passes everything below except the Manage Server check and
   the rule that a server may only remove its own binding. Stopping is never
   gated.
1. It came from a server, not a direct message.
2. The invoker has Manage Server. Discord enforces this itself through
   `default_member_permissions`, which hides the command from everyone below
   the bar — but a server admin can change that default, so the handler checks
   the interaction's own `member.permissions` as well. A permission check that
   lives only on the client is not a permission check.
3. The repo is one the Cujo App is installed on. A repo it is not can be bound
   and then never notified, which is the silent failure the rest of these
   checks exist to prevent. Only a list Cujo managed to read can refuse a bind:
   GitHub being unreachable is not a reason to block one. The authorization
   route applies the same check when a pair is allowed by hand. This comes
   before the next check on purpose: a repo the App cannot see has no readable
   `.cujo.yml` either, and "it has not named this server" would send someone to
   edit a file Cujo could not have read.
4. The repo names this server in `.cujo.yml`, or an operator allowed the pair.
   `watch` checks this again immediately before it writes: the Discord round
   trips in between are awaits, and a declaration reverted or an allowance
   withdrawn during them must not end with a binding for a server that may no
   longer see the repo.
5. For `watch` and `unwatch`: no **other** server already holds this repo. One
   repo notifies one channel (Contract 7), so two servers allowed the same repo
   would otherwise be able to redirect or silence each other's reviews. Moving
   a repo between servers is an operator's job, over
   `PUT /discord/channels/:owner/:name`.
6. For `watch`: the channel is in **this** server, is a text or announcement
   channel, and the bot has View Channel, Send Messages and Embed Links there,
   resolved through the overwrites exactly as Contract 7's bind route does. The
   channel option comes from this server's own picker, but a request is a
   request; nothing stops a crafted one naming a channel somewhere else.
7. For `watch` with a role: the role is in this server.

**Discord's limits are enforced, not hoped for.** A `status` reply is cut with
a count rather than sent over the 2000-character message cap, since a deferred
reply that fails leaves the invoker staring at "thinking" forever. A repo name
longer than Discord's 100-character choice limit is not offered by autocomplete
— it can still be typed, and the bind accepts it.

**Transport.** `POST /discord/interactions` on `cujo-ingress.spencerjireh.com`,
the same host as the GitHub webhook and for the same reason (decision 7):
Discord cannot solve a Cloudflare Access challenge. It is signature-gated
ingress, so the UI host answers 404 for it, in the process and not only at the
edge.

Each request is verified with Ed25519 over `timestamp + rawBody`, from
`X-Signature-Ed25519` and `X-Signature-Timestamp`, against the application's
public key in `DISCORD_PUBLIC_KEY`. That is a different value from the bot
token, and it is checked on the raw body before anything is parsed. An invalid
signature is **401** — Discord probes the endpoint with a deliberately bad
signature when the URL is saved and refuses it unless it answers exactly that.
A `PING` is answered with a `PONG`.

Discord allows three seconds to respond and a bind needs several Discord round
trips, so a command is answered immediately with a deferred ephemeral reply and
filled in when the work is done. Autocomplete cannot be deferred, so the repo
list is cached and a slow or failing GitHub read falls back to the repos Cujo
already knows about rather than showing an empty picker. The cache holds the
in-flight scan, not only its result, so a burst of keystrokes against a cold
cache makes one pass over GitHub rather than one per keystroke.

Commands are registered per server at startup, with a full replace, so a
definition cannot drift from the code across deploys and a change is visible at
once (decision 28). A server the bot joins later gets its commands at the next
start.

**What this endpoint may not do.** It routes notifications. It cannot approve a
blocking review, and it must not be extended to, because that would swap a
policy-verified email for Discord channel membership on the one action the
whole product gates. Contract 4 and decision 23 own that decision; this one
does not reopen it.

## Contract 9 — the pull request's own reaction

Everything Cujo says about a run it says somewhere else: a review at the end, a
Discord card, a page on the board. Between the push and the review the pull
request itself is silent, which costs a reader an acknowledgement and costs an
operator the one cheap signal that would say *where* a silent run stopped.

`apps/cujo` therefore reacts on the pull request description as
`cujo-guard[bot]`, and moves that reaction as the run's status moves. The eye
lands within a second of the delivery, before the agent has done anything, so
its presence proves the ingress, the signature, the session and the claim; its
absence localises a failure to the front half of the pipeline without opening a
log.

| Run state | Reaction | Why |
|-----------|----------|-----|
| Claimed, before any turn | 👀 | Cujo has the pull request. |
| `running` | 👀 | Still reading. |
| `blocked_pending` | 👀 🚀 | Still reading, and now waiting on a human. |
| `clean` | 🎉 | No critical finding. |
| `blocked_posted` | 👎 | The blocking review posted. |
| `denied` | 👍 | A human cleared the pull request to proceed. |
| `error` | 😕 | Cujo broke. Shared with no other state. |
| `superseded` | *nothing* | Not this run's pull request to describe any more. |

The reactions describe **what happened to the pull request**, not what Cujo
concluded, which is why `denied` is a thumbs up even though the finding stands.
GitHub's reaction set is closed — `+1 -1 laugh confused heart hooray rocket
eyes` — so there is no check mark and no cross to spend, and this is the whole
vocabulary available.

**One pull request has one reaction, and a pull request may have had several
runs.** Only a run that is current may write, and that rule is enforced at both
ends. The eye is placed only after `review/start-run.ts` has confirmed with
GitHub that this run's head is the pull request's head, so a delayed delivery
for an older SHA never touches it; and `superseded` writes nothing at all,
because the run that replaced it is about to say what the pull request should
show. Without both, a stale delivery would overwrite a finished verdict with 👀
and nothing would restore it.

Four properties, the first three the same ones Contract 7 holds:

- **A run never fails because GitHub did.** The call is queued, never awaited on
  the fold path, and every failure is caught and logged.
- **Calls are totally ordered**, so a later status cannot be overtaken by an
  earlier one and leave the pull request showing a state the run has left.
- **Nothing is remembered.** `POST .../reactions` is idempotent — the same
  content twice answers 200 and leaves one reaction — so a restart re-applies
  the current status and converges. This contract adds no table and no
  migration. What is held in memory to collapse the per-event storm is bounded
  and evicts the least recently seen run.
- **A failed call is retried with backoff.** A terminal status is the last event
  a run produces, so there is no later change to recover on: one transient
  failure would otherwise leave the pull request wearing the previous status
  indefinitely. A retry is abandoned as soon as a newer status is queued behind
  it, which is the ordering property doing its job.

`CUJO_PR_REACTIONS=0` turns the whole thing off. It is the only thing
`apps/cujo` writes to a repository, so it gets a switch (decision 38).

## Stretch — remediation

If hackathon time allows, add a third gated tool `open_remediation_pr`: on a
`critical` finding with an obvious fix (a broken test the agent can repair, a
dependency to remove or pin), the agent opens a fix PR. The human approves
opening it. This turns Cujo from a reviewer into a gatekeeper that also proposes
the fix — a stronger demonstration of an agent taking a real, sensitive action
under human oversight.
