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
`synchronize`). For each event the `apps/cujo` webhook module:

1. Verifies the `X-Hub-Signature-256` HMAC against the webhook secret. Rejects
   anything unsigned or mismatched.
2. Reads the PR metadata and the changed-file list with the App installation
   token (Contents: read, Pull requests: read).
3. Finds or creates the TrueForge session for this PR (see Contract 5) and
   starts one turn with a single user message: repo full name, PR number, base
   SHA, head SHA, and the changed-file list.
4. Records a run (see Contract 6) and stays subscribed to the turn's event
   stream, folding events into that run until `turn.done`.

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
  `/sys`, `/dev`); a sensitive path is listed whatever it looks like. This is
  a filter on what leaves the sandbox in the JSON report, not on what the
  hook records, and it exists because a single `pytest` run otherwise ships
  hundreds of bytecode rows into the agent's context.

The block also carries `subprocesses[]` (from the audit hook) and a
`sensitive` flag on each `fs_changes` entry, so the `derived` booleans can be
traced to the rows that set them.

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
body so a bad anchor never blocks the review.

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
| `status` | One of the six states below. |
| `approver`, `decided_at` | Who decided and when. The email from the Access JWT for a decision made through `POST /runs/:id/approve`; the literal `external` when the resume came from somewhere else (see below). |
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
| `superseded` | A newer head arrived on the same PR while this run was `running` or `blocked_pending`. The run stops following its turn and no decision can be made on it. |

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

The API `apps/cujo` serves on `cujo.spencerjireh.com`:

| Route | Returns or does |
|-------|-----------------|
| `GET /runs` | Runs, newest first, with status. |
| `GET /runs/:id` | The run, its checks (thread, status, report, and the `startedAt` / `endedAt` taken from each thread event's own `createdAt`), `findings` (Contract 3, critical first, each with `source`), `hard_rule_hits` (the hard-rule subset), and the drafted review when `blocked_pending`. |
| `GET /runs/:id/events` | Server-sent events: the folded run as it changes, for a live page. |
| `POST /runs/:id/approve` | Body `{decision: 'allow' \| 'deny'}`. Records the approver; resumes the turn as Contract 4 describes. Rejected unless the run is `blocked_pending`. |

The `/discord/*` routes on the same host are Contract 7.

One process serves two hostnames, so the split between them is enforced in the
process, not only at the edge:

- Every request is dispatched on the `Host` header. On
  `cujo-ingress.spencerjireh.com` the process serves `POST /webhook` and
  `GET /healthz` and answers 404 to everything else, including `/runs`. On
  `cujo.spencerjireh.com`, and on the internal service name in
  `CUJO_INTERNAL_HOST` (default `cujo`), it serves the routes above and answers
  404 to `/webhook`. A request with any other `Host` gets 404. The internal name
  exists because the operator UI reaches this process over the compose network
  and Node's `fetch` always sends the target's own authority as `Host`; those
  routes are not exempt from the Access check.
- The UI itself is `apps/web`, a separate service on
  `cujo.spencerjireh.com`. It proxies `/api/*` to this process, forwarding the
  Access assertion, so the API is same-origin with the page and needs no public
  route of its own (decision 24).
- Every route on `cujo.spencerjireh.com` — reads as well as the approve route —
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

## Stretch — remediation

If hackathon time allows, add a third gated tool `open_remediation_pr`: on a
`critical` finding with an obvious fix (a broken test the agent can repair, a
dependency to remove or pin), the agent opens a fix PR. The human approves
opening it. This turns Cujo from a reviewer into a gatekeeper that also proposes
the fix — a stronger demonstration of an agent taking a real, sensitive action
under human oversight.
