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
- TLS interception of sandbox egress; metadata only (decision 10).
- Forcing all sandbox traffic through the proxy. The proxy sees processes that
  honour `HTTP(S)_PROXY`; a non-Python process that opens a direct socket is
  not observed. A network-namespace or iptables redirect inside the sandbox
  closes that gap later.
- Remediation (a fix PR on `critical`) is a stretch, not a requirement.
- Answering a held finding from Discord. Contract 7 notifies; it does not
  decide. The interactions endpoint on the webhook host exists and carries
  `/cujo` (Contract 8), but nothing on it decides a review: being in a channel
  is not a claim about a repository (decision 23). The gate lives on the pull
  request, where the principal is repo write (Contract 1, decisions 44 and 45).

## Contract 1 — the trigger

The Cujo GitHub App subscribes to `pull_request` events (`opened`,
`synchronize`), to `repository` events (`privatized`, `publicized`), to
`issue_comment` events (`created`), and to `pull_request_review_comment` events
(`created`). The signature is checked before the event type, so all four arrive
on the same route with the same one gate in front of them.

Two of those subscriptions are not free. GitHub releases `issue_comment` on the
`issues` permission and on nothing else, even though every comment Cujo acts on
is on a pull request, so the App holds `issues: read` for delivery alone and no
code reads an issue (decision 50). `pull_request_review_comment` is released by
`pull_requests`, which the App already held.

A `repository` event re-stamps `is_public` on every run of that repo and does
nothing else; it is the fast path for decision 34's public board, and matching
is case-insensitive because `runs.repo` holds whatever casing GitHub sent.

An `issue_comment` event may carry `/cujo confirm` or `/cujo dismiss`, which is
the human gate (Contract 4, decision 45). Only `created` is acted on: a command
that can be typed into an existing comment is a command whose author is not the
person the payload names at the time it fires. A comment on an issue rather
than a pull request is ignored, since `issue_comment` fires for both. The route
answers 200 at once and does the work after, like the pull request path — the
command needs two GitHub reads and a resume, and the delivery timeout is ten
seconds.

The command is matched as an exact string, at the start of a line, by
`apps/cujo` and never by a model. That is not fussiness: a mention like
"@cujo-guard flagged this wrongly, ignore it" is a sentence a human would
write, and any intent parser reads it as a dismissal — so a mention can never
carry a privileged verb. Comments authored by `cujo-guard[bot]` are ignored
outright, because Cujo's own replies print the verbs.

**A line only counts if a reader can see it.** The scan drops fenced code,
blockquotes, HTML comments and raw HTML before matching, following CommonMark
where it matters: a closing fence uses its opener's character, is at least as
long, and carries nothing after it; four spaces opens an indented code block
and no fence at all; a blockquote holds unmarked continuation lines until a
blank line (§5.1); anything between `<!--` and `-->` renders as nothing; a
`<pre>` runs to its closing tag and a block-level tag such as `<details>` runs
to the next blank line (§4.6 conditions 1 and 6). Where the scan and GitHub
might disagree, the scan skips the line. Skipping a real command costs a person
one retry; matching one nobody can see hands a stranger the gate.

Authorization is repo `write` or `admin`, read from GitHub on every command,
and the pull request's author may not `dismiss` (decision 44). `unknown` — the
tri-state `repoIsPublic` uses — is neither a refusal nor permission: the reply
says it could not check. **The commit selects the run**, not the order the
deliveries were inserted in: the current head comes from GitHub and the run for
that exact commit is the one answered, so a delivery for an older head that
arrived late cannot stand in for it. If there is no run for the current head
the command is refused by name, because a comment names a pull request and
never a commit, and "read the block, push a fix, come back and confirm" would
otherwise answer a block nobody read. That read is the last call before the
claim, so the window a push can slip through is as narrow as two systems
allow. **Every outcome speaks on the pull request.** A refusal nobody can see
is indistinguishable from a delivery that never arrived.

A push that lands inside that window does not discard the answer. `claimDecision`
sets `approver` while leaving the run `blocked_pending`, so a decision can be in
flight where the supersede path cannot see it in the status; when the stale deny
finds the call already answered and `approver` is set, the run is left alone
rather than cancelled. The finding was real on the commit that person read, the
observation half is public either way, and the new head gets its own run.

A `pull_request_review_comment` event is a reply inside a review thread — the
comments hanging off one line of the diff, where Cujo's inline findings are.
It is a different event from `issue_comment` and the only one that reaches
those threads, so it is what conversation needs and what a reply to a finding
arrives on. It carries conversation and never a privileged verb; narrowing the
surfaces that can decide a review costs nothing, since `/cujo` is about the run
rather than about one line. Contract 10 has the rest.

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

### The report

**[`docs/contracts/report.example.json`](contracts/report.example.json) is the
shape.** One complete example carrying every field at once, and the normative
one: this section says what the fields mean and that file says what they are.
It is there rather than inline because there is no schema — `check.report` is
`unknown` in `apps/cujo` and in `apps/web`, so a renamed field produces no
compile error anywhere, only rules that stop firing and tables that empty. A
conformance test in each of the three consumers loads that file, which is what
makes a change on one side fail on the others (decision 54).

The envelope a check sub-agent returns:

| field | |
|---|---|
| `schema_version` | The report shape, an integer. Read what you recognise; never reject a report for carrying a version you do not know. |
| `check` | One of `tests`, `probes`, `smoke`, `detonation`. It must match the sub-agent's own name, which is how a report is attributed to a check. |
| `runs[]` | Every `sniff.py run` or `detonate` report, in order, verbatim. |
| `derived`, `sensors`, `truncated` | The roll-up over every run. The hard rules read the top level *and* each `runs[]` entry, so a roll-up the sub-agent got wrong cannot hide a signal. |

plus the per-check fields in the rubric: `base` / `head` / `base_pass_head_fail`
for `tests`, `probes[]`, `endpoints[]` and `log_tail` for `smoke`.

Each entry of `runs[]` is what `sniff.py run` printed: `schema_version`, `argv`,
`exit`, `duration_s`, `window_exclusive`, `stdout_tail`, `stderr_tail`, and the
sensor block below. A `detonate` entry carries `dependency`, `source`,
`install_ok` and `duration_s` in place of `argv` and `exit`.

The sensor block itself, the same on every check so the hard rules read one
shape regardless of which one ran: `egress[]`, `files_read[]`, `fs_changes[]`,
`subprocesses[]`, `secret_probe`, `sensors`, `truncated`, `derived`.

**Every string in a report is written by the code under review** — what it
printed, the arguments it ran, the filenames it chose, the hosts it asked for —
and it is read by the parent agent, quoted into a review, and rendered in a
browser. Control characters, terminal escapes, and the bidirectional and
zero-width characters are therefore escaped where they appear, as visible
`\xNN` and `\uNNNN`. Escaped, not stripped: the record still says what the
command did, and the escape is its own account of itself, so there is no
"sanitized" flag to carry.

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

The filesystem sensor identifies a file by `(mtime_ns, size)`, plus a SHA-256
digest where a silent edit is the whole attack — the credential and shell-rc
locations, and the rest of `/etc`, which is walked anyway. Metadata alone is
defeated by `os.utime`: overwrite a key with another key of the same length, put
the timestamp back, and two `lstat` calls see no change. Hashing everything
would make each snapshot a full read of `$HOME`, so it is spent only there. A
symlink is digested by its target string, so a link repointed with its timestamp
preserved is still a change.

A digest that was wanted and could not be taken is recorded as its own value,
distinct from one that was never wanted. A file with a digest on one side and
none on the other has changed — readable before and not now, hashed before and
swapped since, both are events a command causes while it runs, and both are
reported. Where *neither* side has one, nothing was compared, so it falls back
to metadata: much of `/etc` is root-owned and unreadable from one run to the
next, and calling those files modified would put a non-lowerable critical on
every check of every repository.

`truncated.hashes` counts the files this walk *could* have compared and did
not — the ones past `HASH_MAX_BYTES`, and the ones whose identity did not match
between the `lstat` and the open. It deliberately does not count a file the
sensors have never been able to read: that is not a gap that opened during the
run, it is a part of the filesystem outside their reach, the same standing
condition as a directory the walk cannot descend into and already skips without
comment. Counting it would raise the flag on every run on every Linux box, and a
flag that is always true says nothing.

**What that leaves open**, stated rather than implied: a file kept unreadable
across both snapshots can be edited between them with its size and timestamp
restored, and the filesystem sensor will not see it. Doing so takes control of
the file's permissions before the sensed command starts, since `before` is taken
at the top of the window. Whether such a file's contents changed is not
observable from inside the sandbox in either direction, and this design would
rather miss it than accuse every pull request of touching `/etc/shadow`.

The walk opens what it hashes with `O_NOFOLLOW | O_NONBLOCK` and then checks the
descriptor — that it is still a regular file, and that its device and inode are
the ones just measured. The command under test owns this tree: a FIFO
substituted between the `lstat` and the open would block the snapshot for as
long as nobody writes to it, and a file swapped in only for the duration of the
open would pair an innocent digest with the metadata of whatever replaced it.

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
agent fetches a source archive of this repo from `CUJO_SNIFF_TARBALL_URL`, a
public URL, with no credential, and moves `sandbox/` out of it so `sniff.py`
and the `cujo_sniff` package land side by side (decision 46). `sniff.py` is the
entry point and nothing else: every one of those commands is implemented in the
package, and the script exists so the rubric's spelling stays the same and so
`sys.path[0]` finds the package with no install (decision 48).

The commands keep their state in `CUJO_DIR`, which defaults *beside* the
extracted code and never inside it, so logs, pid files, the decoy backup, and
the sensed lock are neither mixed in with the modules nor destroyed by the
fetch, which replaces the code directory wholesale (decision 48). The rubric
never names that directory: every path it needs comes back in `setup`'s JSON.

The `derived` block holds the booleans the hard rules read.
`egress_to_unknown_host` is true when a host is neither a known package index
nor in `allow_hosts`.

`secret_probe.decoy_in_egress` is `null` on every report, and null is the
claim: the proxy counts bytes and never reads a payload, so nothing in this
sandbox can tell whether the decoy's value left the box. It was `false` until
decision 54, which asserted an observation nobody had made. The hard rule stays
— it fires on `true` and nothing emits one — so that a later sandbox that can
measure it needs no change on the trusted side.

#### `sensors` — what was watching

A tripwire that cannot say it was disarmed is worth less than it looks: `false`
on every signal is also what a report says when the sensor producing it was not
running. `sensors` carries one `{armed, detail}` entry per sensor, so "not
observed" and "not observable" stop reading alike.

| sensor | armed when | `detail` |
|---|---|---|
| `proxy` | the daemon bound its port during `setup` **and** is still alive now | the loopback port |
| `decoy` | the watcher armed during `setup`, is still alive, **and** the file it armed on is still the file at that path | `inotify` or `atime` — which one matters, because the atime fallback is close to useless under `relatime` |
| `audit` | the hook wrote its `armed` row into this command's log | the row count, or that no Python process ran |
| `fs_diff` | the walk reached any file at all | how many paths, and whether the cap cut it |

Both daemon entries are re-checked per command, not taken from `setup`: a proxy
that died during the first check used to leave the three that followed with an
empty `egress` and a clean `egress_to_unknown_host` — a clean bill of health
from a blind sensor.

For the watcher, still running is not enough. inotify watches an inode rather
than a name, so a command that deletes the decoy or renames a file over it moves
the watch off the path it was asked about while the daemon stays alive and
blocked. It re-arms on `IN_IGNORED` where a file is there to re-arm on; where
there is not, the seeded decoy is gone, nothing is left to read, and a quiet
`decoy_read` means nothing. `setup` records the inode for that comparison.

An unarmed `proxy` or `decoy` is one `warn` in `apps/cujo` (`sensor_unarmed`),
never a `critical`: it says the evidence is thin, not that the code did
anything, and it does not gate the review. `audit` and `fs_diff` are reported
and not ruled on — a check running `npm test` has no Python process to hook,
and the filesystem sensor is never off, only short.

Nothing in this block may name a host, a path, or a repository. A check report
crosses to the anonymous public plane verbatim, with no field-level allowlist
between here and there.

**The block is evidence, not proof, and at the same level as the rows it
describes.** The command being measured runs as the same user as the sensors: it
can kill a daemon and write a live pid into its file, and it holds
`CUJO_AUDIT_LOG` and can append the hook's own `armed` row. It can equally
rewrite `proxy.jsonl`. Nothing observed from inside a sandbox the author
controls is unforgeable, and the health block does not change that — what it
closes is the accident, the daemon that died on its own. Two things bound it:
`daemon_alive` checks that the pid's command line is one of ours, so the pid
file alone is not enough; and the lie only runs one way. Forging health hides a
gap in the evidence. It cannot manufacture a finding against anyone, because
every rule here fires on a sensor reporting *false*.

#### `truncated` — where the evidence was cut

Five caps bound what a report can cost: `TAIL_CHARS` on each output tail,
`MAX_FILES_READ` on `files_read` (a sensitive read is never dropped),
`MAX_SNAPSHOT_FILES` on each filesystem walk, and `HASH_MAX_BYTES` on the file a
digest will be taken over. `truncated` carries one boolean per cap, because a
list that was cut is not a list that was empty — and because a comparison that
was never made must not read like one that came back clean. `truncated.hashes`
is that last case: over the size limit there is no digest on either side, so the
file falls back to the `(mtime, size)` a restored timestamp defeats. The limit
sits well past any real credential for exactly that reason.

A capped walk also changes what the filesystem diff may conclude, and which of
the two walks was capped decides which half. A `created` row reads the *before*
walk's silence about a path — a complete walk would have found it already — so
it needs that walk to have finished; a `deleted` row reads the *after* walk's,
so it needs the other one. A change to a path both walks hold is always
reported, because no absence is being read. Getting this wrong in either
direction invents evidence, and `wrote_sensitive` is a `critical` the agent may
not lower.

`window_exclusive`, on each run, is the same kind of statement about the lock:
`false` means another sensed command overlapped this one, so rows in this report
may belong to it.

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

**The five rules are not interchangeable, and the axis is not the obvious one.**
The tempting split is "the author's code versus a third party's", and it is
wrong: three of the four rules below fire on *any* check, `tests` and `smoke`
included, and only `egress_to_unknown_host` is scoped to `detonation`. The real
split is the **claim**:

| Rule | Claim |
|------|-------|
| `tests.base_pass_head_fail` | **correctness** — the pull request broke something |
| `secret_probe.decoy_read` | **malice** — code read a credential it was not given |
| `secret_probe.decoy_in_egress` | **malice** — a secret left the box |
| `derived.wrote_sensitive` | **malice** — code wrote outside the workspace |
| `derived.egress_to_unknown_host` | **malice** — a dependency phoned home |

"Your tests fail" is mechanical, verifiable by the author in thirty seconds, and
nobody sensible answers "no" to it. "This code tried to steal a credential" is an
accusation that harms someone if it is wrong, and it is the one place in this
pipeline where a human holds information the sandbox cannot observe: they know
the host, or the package, or the fixture that touches a fake credentials file on
purpose. Each rule carries its identity on the finding as `rule`, so the split is
matched on an id and never on the wording of a title.

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
pulled in only for the consequential action. Three tool paths on `github-mcp`:

| Tool | When | GitHub review | Gated? |
|------|------|---------------|--------|
| `post_advisory_review` | no `critical` finding, **or** the observation half of a malice finding | COMMENT | No — posts automatically |
| `post_blocking_review` | every `critical` is a correctness finding | REQUEST_CHANGES (blocks merge) | No — posts automatically |
| `post_gated_review` | any `critical` is a malice finding | REQUEST_CHANGES (blocks merge) | **Yes** — pauses for human approval |

**The gate is on the accusation, not on the block** (decision 42). Contract 3's
table says which rule makes which kind of claim.

**A malice finding posts twice, in order: observation, then conclusion.** The
first call goes always, stating what the sensors recorded as fact, marking the
malice findings `warn`, and ending with the two commands a maintainer can reply
with. Then the gated call drafts the accusation and the turn pauses. So a run
that nobody answers still leaves the evidence on the pull request, a denial
drops the escalation while the observation stands, and the merge is never
blocked by a claim no human confirmed. Contract 5 says why two reviews on one
head is not double-posting.

**A run can hold both kinds at once, and the correctness half must not wait.**
When a malice rule and `tests.base_pass_head_fail` trip together, the first call
is `post_blocking_review` rather than the advisory. That body carries the
correctness findings as `critical` and the malice observations as `warn`; the
gated call that follows carries only the accusation. The ordered pair is
therefore blocking-then-gated for a mixed run and advisory-then-gated for a pure
malice one — in both, what waits is the accusation and only the accusation.

Which kind a finding is, is a decision the model expresses by choosing a tool
name — see Contract 3 for what `apps/cujo` can and cannot verify about it after
the fact.

All three tools take the same input: a summary body and a `comments[]` array. The
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

The gate is the harness's `require_approval_for_tools` on `post_gated_review`,
and that one name is the whole mechanism: the annotation `@destructive` marks
what a tool does, but it is the explicit list that decides what pauses, so
`post_blocking_review` stays annotated destructive and is no longer gated. When
a finding accuses code of acting maliciously the agent calls the gated tool,
after posting the observation, and the turn pauses with a `tool.approval_required`
event on the `main` thread, carrying `tool_calls[{id, source_event_id}]`.
`apps/cujo` reads the drafted review (the tool call's `body` and `comments[]`)
from the `model.message` event that `source_event_id` names, marks the run
`blocked_pending`, and shows the drafted review on the operator plane, which
displays it but decides nothing. The answer comes from `/cujo confirm` or
`/cujo dismiss` on the pull request (Contract 8, decisions 45 and 49), and
`apps/cujo` resumes the turn
with `sessions.createTurn(sessionId, {input: [{type:
'user.tool_approval', threadId: 'main', toolCallId, approval: {status:
'allow' | 'deny'}}]})` and then `subscribeToTurn` on the returned id, which it
records as its own before any event arrives. On `allow` the gated review posts as
`cujo-guard[bot]`. On `deny` the agent posts nothing further and ends the turn;
the rubric says so explicitly, so a dismissed accusation never degrades into a
second review nobody asked for. The advisory observation posted before the pause
and is unaffected either way, which is what makes a denial and a timeout both
safe: the evidence stands, and only the claim about a person is dropped.

The deny is not always a human's. The approval is outstanding on the session
rather than on the turn that raised it, and while one is pending TrueForge
refuses every later user message on the thread, so a block nobody will decide
has to be answered before the pull request can be reviewed again. `apps/cujo`
sends that deny itself when a newer head supersedes the run, and once more as a
retry if a turn cannot be started at all; the reason it sends says the commit
was replaced, not that an operator rejected the block, and the run stays
`superseded` with no approver (decision 39).

**Stale review dismissal (decision 52).** A `REQUEST_CHANGES` review from an
older commit stays on the pull request when a newer head replaces it. When a new
run on the same PR completes `clean`, `apps/cujo` lists the bot's own reviews,
finds any whose `commit_id` differs from the current head and whose state is
`CHANGES_REQUESTED`, and dismisses them with a fixed message naming the new
head. The trigger is the `clean` status — by definition, zero critical findings
remain — and no other terminal status fires it. A run that ends `blocked_*` or
`error` leaves stale reviews standing, since the original condition may not be
resolved. Before listing reviews, the dismissal reads the PR's current head
from GitHub; if the head has moved past this run's commit, the operation is
skipped entirely to prevent dismissing a newer run's valid blocking review.
The dismissal is a service-level action in `apps/cujo`, not a tool the agent
calls, and `github-mcp` is unaffected.

A REQUEST_CHANGES review only *blocks* a merge when the target repo's default
branch has branch protection requiring PR review. Without it, the review still
posts and shows as changes-requested, but does not gate the merge.

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
- **One turn may post two reviews, and that is not double-posting.** A run whose
  finding is an accusation posts the observation as an advisory review and holds
  the conclusion for a human, so the pull request carries a COMMENT review and,
  once confirmed, a REQUEST_CHANGES one. The rule this contract protects is that
  a head SHA gets one *run* and one verdict, not that it gets one HTTP call:
  double-posting means two runs reviewing the same commit, which the idempotency
  check above still prevents. The two reviews are one verdict in two parts, and
  the second half never posts unless a human says so.

  The projection holds them apart for the same reason. `review` is what reached
  the pull request; `gated_review` is what is waiting. One field for both would
  have the accusation overwrite the record of the posted observation, and every
  surface would then show a human the un-posted text as though it were live.

  **A denied accusation leaves nothing behind.** `findings` publishes the
  gated review's own findings only once that review actually posted, which
  means an approval that was *allowed*. A denied call is answered with a
  refusal `tool.response` like any other, so "a response arrived" is not the
  test; the decision is. What survives a denial is the observation — the hard
  rule Cujo derived itself, which never waited on anybody.

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
| `status` | One of the eight states below. |
| `approver`, `decided_at` | Who decided and when. `github:<login>` for a decision made with `/cujo confirm` or `/cujo dismiss` on the pull request, which is the only way a held finding is answered (decisions 45 and 49); the literal `external` when the resume came from somewhere else (see below). Never served on the public plane. |
| `is_public` | Whether the repo was public when the run was claimed, from the webhook's `repository.private`. Corrected by the `repository` event and by a periodic re-check; unset reads as private (decision 34). |
| `delivery_id` | The `X-GitHub-Delivery` of the webhook that claimed the run, or unset for a run claimed before the column existed. It is the correlation id every log line for this run carries, which is what survives the request ending while the run does not (decision 37). A GitHub-side handle, so never served on the public plane. |
| `created_at`, `updated_at` | Timestamps. |

Status moves on events from the session's turn streams, with one exception
(`superseded`, set by the webhook):

| Status | Set when |
|--------|----------|
| `running` | The run was claimed; the first turn is being started. |
| `clean` | `turn.done` with no `tool.approval_required` seen: the advisory review posted. |
| `blocked_unattended` | `turn.done` on an ungated `post_blocking_review`: Cujo blocked the merge on its own authority, for a correctness critical, and no human was asked. `approver` is null and stays null. |
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
the decision was made outside Cujo rather than pretending it did not happen
(decision 17).

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
  routes are not exempt from the gate.
- The plane split is by path, not by a third hostname, for that same reason:
  this process never receives the public name, so a fourth branch in the host
  dispatch would have to trust a forwarded header, and a header a client can
  also send is not a boundary. `/public` is mounted on its own router beside
  the gated one rather than under it, so the gate middleware cannot match it
  by accident.
- The UI itself is `apps/web`, a separate service on both
  `cujo.spencerjireh.com` and `cujo-admin.spencerjireh.com`. It proxies
  `/api/cujo/*` and the run stream to this process, attaching the operator
  credential on the operator hostname and attaching none — and refusing any
  path outside `/public` — on the public one, so the API is same-origin with
  the page and needs no public route of its own (decision 27). When this
  process is unreachable the proxy answers `502` with
  `{ok: false, error: "cujo is unreachable"}`, rather than letting the failed
  fetch surface as an unhandled `500` that says nothing (decision 37). It also
  forwards `Cf-Ray`, so a line from the UI and a line from this process share
  one correlation id.
- Every route outside `/public` requires an operator credential, and there are
  two for one release (decision 49). An `Authorization: Bearer` carrying
  `CUJO_OPERATOR_TOKEN`, compared in constant time, is the live one; a
  `Cf-Access-Jwt-Assertion` that verifies against the Cloudflare Access public
  keys for the application's audience tag is still accepted, though the
  `cujo-admin` Access application it came from has since been removed.
  A missing or invalid credential is a bare 401 either way — naming the failing
  check tells a stranger how to pass it — and the reason goes to the log. A
  presented token that is wrong is refused rather than falling through to
  Access: whoever sent it meant to use that gate.

  Both are accepted so the token could be configured and the Access application
  removed in either order (decision 35).

  The browser never holds the token in JavaScript. `apps/web` takes it once at
  `/login`, keeps it in an httpOnly cookie on its own origin, and turns it into
  the bearer header server-side; a value a page can read is a value a script
  injected into that page can read.
- The webhook route on `cujo-ingress.spencerjireh.com` is the only route that
  accepts a request with no operator credential at all, and it accepts only a
  request whose HMAC verifies (Contract 1).

Tripwire: a `tool.approval_required` whose `thread_id` is not `main` means a
subagent was given the review tool, which the design forbids. `apps/cujo` logs
it and marks the run `error`; no `/cujo` command can decide it.

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
| `blocked_unattended` | red | The blocking review posted. A correctness finding: nobody was asked. | Critical findings, `Checks`. |
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

The API `apps/cujo` serves on `cujo-admin.spencerjireh.com`, behind the same
operator credential as every other gated route in Contract 6:

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

Contract 7 routes notifications. This contract decides where they go: the
choice of channel and role is made in Discord, and the decision of which server
may see a repo at all stays with the repo (decisions 28 and 31).

**Two halves** (decisions 28 and 31). They answer different questions and are
proved by different people. Neither alone does anything:

| Half | Question | Proved by | Where |
|------|----------|-----------|-------|
| Declaration | Which Discord server may have this repo's reviews? | Whoever can merge to the repo's default branch | `discord_guild` in `.cujo.yml` |
| Binding | Which channel, and which role gets pinged? | A member with Manage Server | `/cujo watch` in that server |

Without the repo's half, anyone could point a repo they do not own at their own
channel. Without the server's half, anyone could send a repo's reviews into a
server they do not belong to. A binding records who made it: `operator`, or
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
on the UI host still allows a pair directly, recorded in `authorized_by` as
the fixed identity `operator`, because a shared token names nobody
(decision 49). It is for moving a repo between servers, and for a repo whose
`.cujo.yml` cannot be changed. It is no longer the way notifications are
normally set up.

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
was picked, and says exactly what to add if it has not named this server.

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
Discord carries no operator credential and cannot answer a login challenge, so
a gated host could never receive it. It is signature-gated
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

**What this endpoint may not do.** It routes notifications. It cannot answer a
held finding, and it must not be extended to, because that would swap the
principal for Discord channel membership on the one action the whole product
gates. Being in a channel is not a claim about a repository.

That prohibition is about the *principal*, not about the plane. The human gate
now lives on the signature-gated ingress route too, as `/cujo confirm` on the
pull request (Contract 1, decision 45) — same host, same HMAC, and a principal
that does correspond to the repository: write access, checked against GitHub.
Decision 43 argues that swap; decision 23 still owns this one, and it is
unchanged.

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
| `blocked_unattended` | 👎 | The blocking review posted. Shared with `blocked_posted` on purpose: the reactions describe what happened to the pull request, and a REQUEST_CHANGES is on it either way. |
| `blocked_posted` | 👎 | The blocking review posted. |
| `denied` | 👍 | A human cleared the pull request to proceed. |
| `error` | 😕 | Cujo broke. Shared with no other state. |
| `superseded` | *nothing* | Not this run's pull request to describe any more. |

A `/cujo` command gets its own acknowledgement, on the command comment and not
on the pull request: 👍 when it was applied, 😕 when it was refused. That write
goes through a separate add-only method for a reason worth stating — the pull
request's reaction set is *reconciled*, so anything that cleared a reaction
through that path would take the run's status reaction with it and never put it
back (decision 43). A comment does not change state, so there is nothing to
reconcile and "seen" is said once.

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

## Contract 10 — conversation

`@cujo-guard <anything>` on a pull request asks Cujo a question about a review it
already posted. It is neither a review nor a notification: nothing it does
changes a verdict, and the answer goes only to the person who asked.

The verb it exists for is **re-execution**. Every other review bot can re-read a
diff; Cujo still has the sandbox recipe, so when a maintainer says "that route
needs orders to exist, seed the database first", the answer is a new measurement
rather than a rephrasing of the old one.

**Its own TrueForge session, always.** Keyed `(repo, pr_number)` in
`conversation_sessions`, which is a second table rather than a column because
`sessions` is keyed by the pull request and already holds the review's. Sharing
the review's session fails three ways, each independently fatal:

- it **cancels a live review** — creating a turn while one runs cancels the old
  one, and a subscriber to the cancelled turn is never told, so the run ends on
  the watchdog. Ungated, that is a one-comment denial of review.
- it is **refused `422`** — "user message cannot be sent while approvals or
  questions are pending" — in exactly the `blocked_pending` state a maintainer
  most wants to talk about.
- it **corrupts the projection**: `fold` dedupes checks by thread id, so a
  re-run emits every hard-rule critical twice and can never clear the finding it
  was meant to correct.

**Two events carry it.** `issue_comment` is the pull request's own thread, and
`pull_request_review_comment` is a reply inside a review thread — where Cujo's
inline findings are, and where "prove it" is actually asked. The reply goes back
to whichever surface the question came from, so an answer lands under the
finding it is about. Only conversation is dispatched from the review-thread
event; a `/cujo` verb stays on the pull request's own thread.

**The agent holds no write authority.** Its spec carries `mcpServers: []`, so it
has no review tool and no way to reach GitHub at all; `apps/cujo` reads the
turn's final assistant message — the last one on `main` with text and no tool
call — and posts it. That is what bounds a prompt injection through a stranger's
comment to "wastes a sandbox", and it is why a turn that errors or times out
still answers the person, which a reply tool structurally could not.

**What the agent is given** is a curated brief, not the review session's
history: the run's check reports, its findings, the posted review body, the head
SHA, plus the question. Everything in it is already in the projection, and a
payload a person can review is worth more than one that is merely complete. The
rubric is `agent/CONVERSE.md`, and it states that the question is untrusted
data — `SKILL.md` scoped that rule to the repository, and this contract
publishes a second channel to the internet.

`clone_url` is included **only for a public repository**, omitted rather than
blanked, the same rule `run_id` follows (decision 36). The sandbox holds no
credential and never will, so a private repo has no URL it could clone; the
rubric says to answer from the brief and say so when the key is absent. Private
repositories remain a non-goal rather than a gap this works around.

**Which run a question is about** is decided by the commit GitHub reports, not
by the order deliveries were inserted in — the same hazard `/cujo` has. Unlike a
command, a question about a review the pull request has since been pushed past
is still answered from the newest run rather than refused: the evidence was real
when it was collected, and a question changes nothing.

**One comment is answered once.** GitHub redelivers, and a redelivery is not a
second question; without a claim on the comment id it would start a second
sandbox, post a second reply, and spend a second slot, none of which the
in-flight flag covers. The claim is in memory like the ceiling, because what it
protects is provisioned by this process.

**The deadline is raced against the stream, not set beside it.** Cancelling is
what closes the stream, so a `cancelTurn` that fails would leave the consumer
blocked forever and `CUJO_CONVERSE_TIMEOUT_MS` would bound nothing. A stream
that ends without `turn.done` is a drop rather than a completion — the turn may
still be running — so it is resubscribed once and then answered honestly rather
than by posting whatever happens to be persisted.

**Authorization is repo `write` or `admin`**, the same check `/cujo` uses, and
checked before the rate limit so a stranger cannot spend a maintainer's budget.
A sandbox is not free speech. The refusal says every finding is readable by
anyone, because it is.

**A ceiling, in memory, per pull request.** At most `CUJO_CONVERSE_LIMIT`
questions per `CUJO_CONVERSE_WINDOW_MS` (3 an hour by default) and one at a
time; a second question while one is running is refused rather than queued,
since two sandboxes for one pull request is the thing the limit prevents. The
count lives in the process because the resource does: a restart already means no
turn is in flight. `CUJO_CONVERSE_LIMIT=0` turns conversation off and deliveries
are still answered 200.

**Every outcome speaks**, as with `/cujo`: a refusal nobody can see is
indistinguishable from a delivery that never arrived. The one exception is a
comment that does not mention Cujo at all, which is silence by design.

## Stretch — remediation

A fourth gated tool `open_remediation_pr`: on a `critical` finding with an
obvious fix (a broken test the agent can repair, a dependency to remove or pin),
the agent opens a fix PR and a human approves opening it. Not built. It needs
`contents: write`, which every installation would have to re-approve, and it
must be reconciled with the teaching flow in
[issue #56](https://github.com/spencerjireh/cujo/issues/56), which writes to the
same file through the same mechanism.
