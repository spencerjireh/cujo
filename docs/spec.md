# Spec and contracts

This is the doc the code follows. It defines what Cujo acts on, the data that
moves between its parts, and the rules that turn an observation into a finding
and an action.

## Scope

- **Trigger:** every non-draft pull request on a repo where the Cujo GitHub App
  is installed, unless the PR carries the `cujo:skip` label (decision 79).
  There is no file filter; a PR that changes only code gets the same run as
  one that changes a dependency manifest. A PR whose changed files are all
  documentation receives a full run but the agent uses advisory mode
  (`docs_only: true` in the turn payload) rather than blocking.
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
`synchronize`, `ready_for_review`), to `repository` events (`privatized`, `publicized`), to
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
the human gate (Contract 4, decision 45), or `/cujo review`, which asks for the
current head to be reviewed again (decision 63). Only `created` is acted on: a command
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

`/cujo review` takes the same principal as the other two — repo write — but for
a different reason: it decides nothing, and it provisions a sandbox and a model
turn, which is a cost a stranger should not be able to impose on somebody else's
repository from a comment box. The pull request's author may use it, unlike
`dismiss`, since asking to be looked at again buries nothing.

It also takes a different path. It answers no run, so a pull request Cujo has
never seen is its main case rather than a refusal, and the stale-head rule does
not apply — that rule stops somebody answering an old commit's finding, while
this verb targets whatever the head is now. Claiming reclaims the head's
existing run, which deletes that run's projection, its board page and its
Discord card; the reply says so.

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

Before claiming a run, the webhook applies three entry filters in order
(decision 79). A draft PR (`pull_request.draft === true`) is ignored. A PR
carrying the `cujo:skip` label is ignored. Both return 200 with no session and
no run. A PR whose changed files are all documentation (`isDocsOnly`) proceeds
to a full run, but the turn message carries `docs_only: true` so the agent
selects advisory mode.

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

Two commands, not six. Everything before the sensors are armed has no decision
in it, so `sniff.py prepare` does all of it at once and hands back the two
things the next decision needs (decision 71).

1. `sniff.py prepare` clones the repo at the head SHA and adds a worktree at the
   base SHA — both in the same sandbox, so the comparison is like-for-like — and
   returns, in the same result:
   - `cujo_yml`: the text of `.cujo.yml` from the **base** SHA, or null. Policy
     comes from the branch the PR targets, never from the PR itself, so a PR
     cannot allowlist its own exfiltration host. If the PR changes `.cujo.yml`,
     the parent emits a `warn` finding ("`.cujo.yml` changed in this PR; the
     base version was used") and ignores the head copy for that run.
   - `files`: the head's human-authored build files, keyed by path relative to
     the clone — `pyproject.toml`, `package.json`, `go.mod`, `composer.json`,
     `CMakeLists.txt`, `Makefile`, CI workflows and the like — from which the
     parent infers whatever `install`, `test` and `boot` the policy did not
     give. Found up to two directories deep, so a repository of services under
     `services/<name>/` is covered; `node_modules` and its kin are never
     descended. Lock files are never read: hundreds of kilobytes that say
     nothing about how to run anything.
   - `truncated`, `unreadable` and `omitted`: which files came back capped,
     which matched but could not be read at all, and how many the file cap
     dropped entirely. They are answered differently: a capped or omitted file
     is an ordinary file the parent may open in `/work/head`, while an
     `unreadable` one was *refused* — usually a symlink out of the checkout —
     and opening it directly would walk around the containment check that put it
     there. All three are the parent's cue that `files` is a
     starting point rather than the whole repository — "no test suite found"
     skips every check and becomes the entire review, so it must mean the
     repository has none, never that one result did not name one.

   It parses no YAML. Nothing under `sandbox/` may import a third-party module
   (decision 46), so the raw text goes back and the parent reads it.

   The two texts have different sources and different caps. `files` is head
   content: written by the pull request, under `PREPARE_FILE_CHARS` each.
   `cujo_yml` is the target branch's policy, which the pull request cannot
   write — that is the whole reason it is read from base — and it has its own
   much larger `PREPARE_POLICY_CHARS`. Both are still escaped on the way out,
   because "the PR did not write it" is a statement about this commit and not a
   property of the bytes, and escaping costs nothing on text that needs none.

   Every cap bounds the read itself and not only the output, and each is spent
   on the *escaped* text: escaping expands one character into four or six, so a
   cap applied before it bounds the wrong quantity. Only real files resolving
   inside the clone are read — a build file's name is the PR's to choose, and so
   is whether it is a symlink.

   `.cujo.yml` is **not** one of those capped strings and never appears in
   `truncated`. It comes from base, it decides `allow_hosts`, and `truncated` is
   the list the rubric re-reads from `/work/head` — so a policy file long enough
   to cap would have handed the pull request its own allowlist. It has a much
   larger budget of its own, and past that it is reported unreadable through
   `cujo_yml_error` rather than returned in part: half a policy is worse than
   none, because the missing half may be the hosts.

   The head commit is fetched as `refs/pull/<n>/head` and not assumed to be in
   the clone. `apps/cujo` sends the base repository's clone URL and no
   credential, so a pull request opened from a fork has its head in a repository
   the sandbox never sees; GitHub publishes that commit on the base repository,
   publicly. The fetch is on the always path, not a fallback, so one code path
   serves fork and same-repository alike. If the ref has moved off `--head-sha`
   — somebody pushed between the webhook and the clone — `prepare` refuses and
   names both, because a review attached to a SHA the run does not claim is
   worse than a late one, and `supersede` already handles the new push.

   `prepare` never deletes a directory it did not create. `--head` and `--base`
   arrive on argv, argv is composed by the model, and the model has just read a
   pull request: a path is replaced only when it is absent or when a marker this
   command wrote sits beside it. The clone URL is checked against `--repo` for
   the same reason — it starts at the GitHub API and arrives through a prompt,
   so it must name the host *and the repository* the run is for.

   `cujo_yml_status` is `read`, `absent`, `too_large` or `unreadable`, and the
   rubric acts differently on each. `too_large` is a real file the parent may
   open in `/work/base`; `unreadable` was refused and must not be opened, and
   the run stops rather than proceeding without a policy it knows exists.

   The clone URL must be `http`/`https` and must carry no credential, in
   userinfo or in a query string; `prepare` refuses one that does, which is
   where the trust boundary's "no clone credential may ever reach the sandbox"
   is now enforced rather than assumed. Each git call has a timeout, so a
   stalled remote is a diagnosable failed step rather than a hung run.
2. `sniff.py setup` seeds the decoy secret — a fake credential file
   (`~/.aws/credentials` with a bogus key) placed before anything runs — starts
   the in-sandbox logging proxy and the inotify watcher on the decoy, and prints
   the env every later command exports, `HTTP(S)_PROXY` included. Its
   `--allow-host` list is the `allow_hosts` the parent just read.
3. The parent runs the install in `/work/head` and `/work/base`, and delegates.

`.cujo.yml`'s schema:

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

No check reads another's report, and the two facts that decide which checks run
at all — whether a test command could be inferred, and whether the manifest
changed — are both settled during setup, before any subagent exists. The sensors
serialise themselves (decision 41), so the wrapped commands still run one at a
time whatever the parent does; what runs in parallel is the subagents' own
reasoning, which is where almost all of a run's wall clock goes.

So each is spawned as early as it can do anything, which is two moments and not
one (decision 73). `detonation` goes first, during setup, because it needs only
the two trees and the armed sensors: it installs each added specifier into its
own fresh environment, so the repository's own install is nothing to it, and the
manifest diff it reads first is free while that install runs. `tests`, `probes`
and `smoke` go together once the install finishes, because all three run against
an installed tree.

**The parent's install is wrapped in `sniff.py run --check setup` for the lock,
not for a report.** The proxy and decoy logs are shared and sliced by offset, so
an unwrapped install running beside a spawned `detonation` would have its egress
and any decoy read counted as that check's — feeding `egress_to_unknown_host`
and `decoy_read`, both hard rules. Wrapping makes it a lock participant, so the
windows queue rather than overlap. `setup` is not one of the four check names,
so no report is folded from it and it is never evidence.

- **`tests`** — run the suite on base and on head. Report per-test status for
  both, and the derived set `base_pass_head_fail`. If no suite is found and
  `.cujo.yml` names none, the parent emits a single `warn` finding ("no test
  suite found") and stops: no checks are spawned at all, and no review beyond
  that finding. That is settled at setup, from the inference, and not from a
  `tests` report — which is why it does not make `tests` a gate the other checks
  wait behind. Without a suite the regression tripwire cannot fire, and the
  missing suite is itself the finding.
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
It is there rather than inline because `check.report` is `unknown` in
`apps/cujo` and in `apps/web`, so a renamed field produces no compile error
anywhere, only rules that stop firing and tables that empty. A conformance test
in each of the three consumers loads that file, which is what makes a change on
one side fail on the others (decision 54).

**A report is validated on arrival, and validation may only add** (decision 62).
`apps/cujo/src/review/report-schema.ts` checks the envelope and every `runs[]`
entry; a report that does not hold produces one `warn` finding, `report_invalid`,
in the same family as `check_missing` and `sensor_unarmed`. It costs the run
nothing else: the status is untouched, and the hard rules still read the same
report, field by field and as leniently as they always have. A sub-agent that
gets one roll-up wrong must not be able to turn a `decoy_read` sitting in plain
sight inside `runs[]` into a warning about formatting.

An unrecognised `schema_version` is still not a rejection, and an unknown field
anywhere passes through — the sandbox is always newer than the container reading
it. What the schema requires is what the rubric asks for: `check`, `runs[]` and
`derived` on the envelope, and each `runs[]` entry whole rather than trimmed.

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

Inside `sensors`, each entry carries `armed` and `detail`. **`armed` is
required and `detail` is not.** `sniff.py` writes both in every `runs[]` entry,
and `docs/contracts/report.example.json` shows that maximal shape — but the
envelope's `sensors` is a roll-up the sub-agent writes by hand, where only
`armed` carries meaning: it is the half `unarmedSensors` rules on, while
`detail` is prose for a reader ("port 8899", "793 rows") already quoted
verbatim in the runs below. The validator accepts a roll-up without it, and the
rubric says so, because the first production review after the validator shipped
warned on four sensors that were correct and complete in every way a rule or a
reader can use.

**Every string in a report is written by the code under review** — what it
printed, the arguments it ran, the filenames it chose, the hosts it asked for —
and it is read by the parent agent, quoted into a review, and rendered in a
browser. Control characters, terminal escapes, and the bidirectional and
zero-width characters are therefore escaped where they appear, as visible
`\xNN` and `\uNNNN`. Escaped, not stripped: the record still says what the
command did, and the escape is its own account of itself, so there is no
"sanitized" flag to carry.

Because escaping expands — four characters for a control byte, six for a
bidirectional override — a length cap is measured on the escaped text and never
on the text (decision 72). Every capped string spends its budget one whole
character at a time, so no escape is ever cut in half: a truncated `\u202e`
would read as `\u20`, which is text the command did not print. `truncated` is
true when either the output or its escaped form was cut.

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

The seeded decoy is the one sensitive path never digested. A digest means an
open, the watcher is armed on that inode for exactly that event, and it cannot
tell the snapshot's read from the read it exists to catch — so hashing it set
`decoy_read` on every command of every check, base control included, and a hard
rule reads that field (decision 58). Nothing is lost by the exclusion: the entry
still carries metadata, `decoy` health follows the inode, and a command that
overwrites the decoy has to open it, which is the same event by another route.
It excludes the watched file and not every name that reaches it — a symlink is
digested by `readlink`, which opens nothing, so a link resolving to the decoy is
hashed like any other and a retarget with the timestamp restored is still a
change.

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

Six caps bound what a report can cost: `TAIL_CHARS` on each output tail,
`MAX_FILES_READ` on `files_read` (a sensitive read is never dropped),
`MAX_SNAPSHOT_FILES` on each filesystem walk, `HASH_MAX_BYTES` on the file a
digest will be taken over, and the JSONL parser itself. `truncated` carries one
boolean per cap, because a list that was cut is not a list that was empty — and
because a comparison that was never made must not read like one that came back
clean. The tail flags mean the output *or its escaped form* was cut: escaping
expands, the cap is charged after it, so a command that printed only bidi
overrides overflows a budget its raw length fits inside (decision 72).
`truncated.sensor_logs` is true when any sensor log file contained lines that
could not be decoded as JSON — typically a torn last line written by a
daemon killed mid-flush. `truncated.hashes` is the size-limit case: over the
limit there is no digest on either side, so the file falls back to the
`(mtime, size)` a restored timestamp defeats. The limit sits well past any real
credential for exactly that reason.

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

#### `script_content` — what the sensor captured before execution

When `argv[0]` is a known interpreter (`python3`, `node`, `bash`, `sh`, and
versioned Python names) and the first positional argument is a readable file,
`run_sensed` reads and scrubs that file before the subprocess starts. The result
sits beside `argv` on the per-run dict as `script_content`, a string or `null`.
`null` means the command was not a script invocation — a bare `python3 -m
pytest` carries no file — not that the capture failed.

This closes a trust gap: the rubric asks the agent to self-report
`{script, expectation, outcome}` for probes, but that is voluntary and
unvalidated. `script_content` is written by the sensor from the file as it
existed at the moment the command was about to run, scrubbed through `scrub()`
and capped at `MAX_SCRIPT_CHARS` (8 000). `truncated.script_content` is `true`
when the cap cut the file short (decision 70).

## Contract 3 — findings and the hard rules

The parent turns the check reports into a list of findings. Each finding:

```json
{
  "check": "tests",
  "severity": "critical",
  "title": "test_order_total_rounding passes on base, fails on head",
  "evidence": "AssertionError: 10.05 != 10.04 (tests/test_orders.py::test_order_total_rounding)",
  "detail": "The change rounds the line total before the discount is applied rather than after.",
  "next": "Round after the discount is applied, or update the two expectations.",
  "held": false,
  "path": "app/orders.py",
  "line": 42,
  "side": "RIGHT"
}
```

`severity` is one of `info`, `warn`, `critical`. `detail` is one paragraph of
judgment, expected on every `critical`; `next` is one imperative clause naming
the action, required on `critical`, allowed on `warn`, never on `info`, and only
ever following from something a sensor observed — never style, architecture or
preference. `held` marks a malice observation whose conclusion a
`post_gated_review` call is holding back, and is set only on the call that also
passes `accusation_follows`. `path`, `line`, and `side`
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
matched on an id and never on the wording of a title. `github-mcp`'s title
backstop (decision 74) is that rule pointed the other way: it rewrites a title
that is *nothing but* a Contract 2 field name into the sentence it means, and
leaves one that is already prose alone — which is why no hard-rule finding is
ever rewritten, since those have carried plain titles since they were written.

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
malice findings `warn`, and setting `accusation_follows` so `github-mcp` ends
the body with the two commands a maintainer can reply with. Then the gated call
drafts the accusation and the turn pauses. So a run
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

**The review body is composed by `github-mcp`, not written by the agent**
(decision 74). All three tools take the same input: a one-sentence `body` giving
the verdict in plain language, a `findings[]` array, and optional `coverage` and
`egress`. From those the server builds the posted body, in a fixed order: a
headline carrying the verdict word and the severity counts, the lede, the
findings by severity, the coverage caveat, the egress line and its host table,
and a collapsed machine-readable block. An empty section is omitted. **The
verdict word comes from the tool**, so a model cannot write "blocked" onto an
advisory review — the word is not a thing it supplies.

**`comments[]` is deprecated.** A finding carrying a `path`, a `line` and a
`side` becomes an inline review comment on that diff line, derived from the
finding rather than sent beside it. The parameter survives only for the
migration: a session pins its rubric at creation (decision 16), so an in-flight
pull request goes on sending one, and a call that does still posts exactly
those comments rather than derived ones. Remove it once no session predating
decision 74 can be running. `github-mcp` validates each derived anchor against the PR
diff before posting, and a finding whose anchor is not in the diff is marked in
place in the body — `(not in this diff)` — rather than moved to a section of its
own, because the body already carries every finding. Which of the three
rejections it was — `file_not_in_diff`, `line_not_in_hunk` or `bad_line` — is
recorded per comment and logged, because an agent citing a file the PR does not
touch and one citing a real file outside the hunk are different mistakes
(decision 37).

**A body written against an older rubric still renders.** A session pins its
rubric at creation (decision 16) while `github-mcp` is stateless, so both shapes
arrive on the same deploy: prose is detected, its headings demoted, and it is
kept under a `### Notes` section with the headline and findings composed around
it as usual. Nothing about an in-flight pull request degrades.

A GitHub call that does not return 2xx raises a `GitHubError` carrying `status`,
`path` and `method` as fields rather than interpolated into a message, so a
caller can tell an expected `404` from an outage without parsing prose. The
response body is not forwarded into the message: only GitHub's own `message`
field is read from its error envelope, and capped — an upstream body can echo
a request header back, and that is how one reaches a log line.

Both also take an optional `run_id`, which the agent copies verbatim from the
turn payload and never writes into the body itself. `github-mcp` validates it
as a UUID, builds the link from its own `CUJO_PUBLIC_BASE_URL`, and appends the
footer — a rule, then `Full evidence: <url>` — after the composed body, so the
link is always last, always the same shape, and always on Cujo's own host
(decision 36). The agent supplies neither the format nor the destination. The
same URL is built once and appears twice, in the footer and as `run_url` inside
the machine-readable block, so the visible link and the parseable one cannot
disagree.

Two independent conditions gate the footer, and each side owns the one it can
answer: `apps/cujo` omits `run_id` from the turn payload for a private
repository, which has no page a reader of the pull request could open; and
`github-mcp` appends nothing when it has no `CUJO_PUBLIC_BASE_URL`. Either
missing means the review body is exactly what it would have been without this
feature.

The maintainer prompt is the second block `github-mcp` writes, on the same
argument. `/cujo confirm` and `/cujo dismiss` are this system's own commands, so
the sentence naming them is composed here rather than quoted for the agent to
reproduce. Only `post_advisory_review` and `post_blocking_review` take
`accusation_follows`; `post_gated_review` has no such parameter, so the prompt
cannot reach the accusation — where it would ask for the very approval that let
that call run (decision 60). It sits directly above `Full evidence: <url>`,
which stays last.

Advisory results post as a COMMENT review, not an APPROVE: the bot never formally
approves, so it can never satisfy branch protection and wave a bad merge through.

The gate is the harness's `require_approval_for_tools` on `post_gated_review`,
and that one name is the whole mechanism: the annotation `@destructive` marks
what a tool does, but it is the explicit list that decides what pauses, so
`post_blocking_review` stays annotated destructive and is no longer gated. When
a finding accuses code of acting maliciously the agent calls the gated tool,
after posting the observation, and the turn pauses with a `tool.approval_required`
event on the `main` thread, carrying `tool_calls[{id, source_event_id}]`.
`apps/cujo` reads the drafted review from the `model.message` event that
`source_event_id` names, and rebuilds both the posted body and its inline
comments by calling `@cujo/review-render` — the same package `github-mcp`
posts with, so the board cannot describe a finding differently from the pull
request (decision 74). It marks the run `blocked_pending`. The board shows nothing of it until it posts: publishing a
held accusation is exactly what the gate prevents, and the audience there had no
way to allow it. The answer comes from `/cujo confirm` or
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
| `pr_title`, `pr_author_login`, `pr_author_id` | What the pull request says about itself, read once when the run is claimed (decision 55). A card and a run page name the pull request and the person who opened it with them. All unset for a run claimed before they were stored or one whose PR read never completed; the two author fields are also unset for a deleted account. The id is what an avatar URL is built from, never the login. Served on both planes: for a public repo, GitHub already shows both to anyone. |
| `model`, `rubric_sha256` | What produced this verdict: the configured model, and a SHA-256 of the instructions a session would be given — `agent/SKILL.md` after the tarball URL is substituted, so two deploys pointing at different sensor code hash differently. **Both describe the process that claimed the run, not necessarily the session that reviewed it**: the spec is built once at boot and a session is created once per pull request and then kept (decision 16), so a run claimed on an older session carries today's values. Unset for a run claimed before the columns existed. Served on both planes: a model name and a digest of a public rubric name no person and authorize nothing. |
| `usage` | What the run cost, summed over every `turn.done` on it, from TrueForge's own `TurnMetrics`: input, output, cache-read, cache-write and reasoning tokens, plus its estimated cost in USD. Cujo keeps no price table — the number is the harness's, or it is absent. Reads zero for most of a run and fills in at the end, because the streamed `model.message` is a stub and usage arrives with the persisted copy. Each check carries its own token total beside it, summed from its thread's messages, which is the only way to attribute anything per check. **The key is always present**, and is `null` for a run whose projection was stored before the field existed — null and not zeros, because such a run did not cost nothing, it has no record. The per-check `usage` and `timings` are null on the same terms. |
| `setup` | Where the run went before the first check existed: `turnCreatedAt` (the run's first `turn.created`), `sandboxCreatedAt` (`sandbox.created`, where Daytona provisioning ends), `agentStartedAt` (the parent's first `model.message` on `main`), `firstCheckAt` (the first `thread.created` titled for a check), `messages` (the parent's own messages before it, which is the round-trip count setup cost), and `ms`, the span from `agentStartedAt` to `firstCheckAt`. Four stamps and not one duration, because two of the useful spans end outside this object — the claim is `created_at`, and a reader subtracts. `sandboxCreatedAt` is null on a second run for one pull request: the event is session-scoped and a fold sees only its own run's turns, so null says the sandbox was already there, which is why a re-run is faster. `ms` is omitted while either end is missing. **The key is always present**, `null` for a projection stored before the field existed, on the same terms as `usage`. |
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
| `error` | `turn.done` with an error state, the stream was lost and the replayed turns show no terminal event after the turn timeout, the run could not be prepared (a GitHub read or the turn start failed) and so never had a turn, or the turn ended on an advisory review while a hard rule had tripped (Contract 3). **Losing the stream is not itself an error** (decision 69): when every resubscribe is spent the run keeps watching the turn through `listTurns` and folds the verdict it really reached, so only the turn timeout ends a run Cujo can no longer see — and that timeout cancels the turn it ends. |
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

`apps/cujo` serves one read plane, under `/public`, on the internal service
name in `CUJO_INTERNAL_HOST`. No gate stands in front of it, and there is no
second plane behind one — the operator API was deleted with its hostname
(decision 57):

| Route | Returns or does |
|-------|-----------------|
| `GET /public/runs` | Public runs only, newest first, capped at 100. Filtered on `is_public = 1` in SQL, not by the route. Carries `id`, `repo`, `pr_number`, `head_sha`, `status`, `created_at`, `updated_at`, `pr_title`, and `digest` — and nothing else. Never the author, which belongs to the page about one run. |
| `digest` on a list row | The run's checks and findings reduced to what a row can hold (decision 65): `checks` keyed by check name, each `{ status, ms, sandboxMs }`; `findings` as `{ critical, warn, info }` counts; and `durationMs`, the envelope from the first `startedAt` to the last `endedAt`. Nested keys stay camelCase, like every other nested object on this wire. A check name absent from `checks` never appeared, which is not the same fact as one that failed. `ms` and `durationMs` are null while a check is still running and on a run recorded before those stamps existed. `sandboxMs` is how much of `ms` was the sandbox executing the pull request, read off the check's own `timings` (Contract 6, decision 70) — the rest was the sub-agent deciding what to do next. It is null on the same terms plus a third: a check whose report carried no `runs[]` measured no sandbox time rather than zero, and a digest stored before the field existed never regains it, because `backfillDigest` re-derives a *missing* digest and not a stale one. Every one of these is emitted as `null` and never omitted; `durationMs` is deliberately not `updated_at − created_at`, which on a `blocked_pending` run counts the hours it waited on a person. The whole field is null for a run claimed but never folded. Derived once per fold and stored in `run_digests`; a run folded before that table existed is derived on read and backfilled. |
| `GET /public/runs/:id` | The run, its checks (status, report, the `startedAt` / `endedAt` taken from each thread event's own `createdAt`, without the thread id, and each check's own `usage` and `timings`), `findings` (Contract 3, critical first, each with `source`), `hard_rule_hits`, the posted review, `usage`, `setup`, `model` and `rubric_sha256`, and `session_id`, `turn_ids`, `delivery_id` and `external_resume` (decision 57) — but never `approver`, `decided_at`, `approval`, `decision` or `is_public`. The held review appears only once `status` is `blocked_posted`. 404 when the run does not exist **or** its repo is not public — the same answer either way, so the plane does not confirm that a private repo has runs. |
| `GET /public/runs/:id/events` | The same stream, in the same shape. 503 with `Retry-After` when the process is already holding `CUJO_PUBLIC_STREAM_LIMIT` streams. Closes if the repo goes private while it is open. |

There is no write route, and the `/discord/*` routes that were Contract 7's
admin surface are gone: a channel is bound with `/cujo watch` (Contract 8).

The response is built by an allowlist, field by field, and never by removing
fields from a wider shape: the difference is what happens when a field is added
to the projection later, and only the allowlist keeps that field private until
somebody says otherwise.

Two probes answer on each host this process already serves — the webhook host
and the internal name in `CUJO_INTERNAL_HOST` — plus `/healthz` on
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
  `POST /discord/interactions`, `GET /healthz` and `GET /readyz`, and answers
  404 to everything else, including `/public/runs`. On the internal service name
  in `CUJO_INTERNAL_HOST` (default `cujo`), it serves `/public/*` and the two
  probes, and answers 404 to everything else — `/webhook` and
  `/discord/interactions` included. A request with any other `Host` gets 404.
  The internal name is the only one the read plane answers on, because the UI
  reaches this process over the compose network and Node's `fetch` always sends
  the target's own authority as `Host`, so a published name could never arrive
  here anyway (decision 57).
- **404, not 401, outside `/public`.** There is no credential to present since
  decision 57, so "not the board" cannot mean "behind the check" — it means not
  served. A 401 would be a route somebody could still reach with the right
  header; the absence is the point. A request carrying an
  `Authorization: Bearer` or a `Cf-Access-Jwt-Assertion` is answered exactly as
  one carrying neither.
- `/public` is mounted on its own router, which is what it was moved to when
  there was a gate that might otherwise have matched it (decision 34). It stays
  that way: the mount is matched exactly, so `/publicity` is a 404 and not the
  board.
- The UI itself is `apps/web`, a separate service on `cujo.spencerjireh.com`.
  It proxies `/api/cujo/*` and the run stream to this process, forwarding only
  `/public/*` and no credential — there is none — so the API is same-origin
  with the page and needs no published route of its own (decision 27). `GET`
  only: the board has no write route, so the other verbs are 405 by omission.
  When this process is unreachable the proxy answers `502` with
  `{ok: false, error: "cujo is unreachable"}`, rather than letting the failed
  fetch surface as an unhandled `500` that says nothing (decision 37). It also
  forwards `Cf-Ray`, so a line from the UI and a line from this process share
  one correlation id. The run page serves `generateMetadata` from the same
  anonymous read, so a run link pasted anywhere unfurls as that run rather
  than as the site's front page — disclosing nothing the same caller cannot
  already read from the same URL (decision 86, on 65's argument). A private
  run 404s and inherits the site default, and the page stays `noindex`.
- A path the board does not serve renders the board's own 404 and not the
  framework's, so a link left over from the deleted operator plane — `/login`
  before any other — lands on a Cujo page with a way back rather than on a
  page that names nothing (decision 57). It is a real 404 and not a soft one:
  the status is what tells a crawler, a `curl` or a proxy that the page is
  gone, and markup alone cannot say it. The copy names no removed operator
  area, because what a reader arriving on a dead link needs is what *is*
  served. A run id that is not in the store keeps its own narrower answer,
  which is the nearer boundary and wins for that segment.
- The webhook route on `cujo-ingress.spencerjireh.com` accepts only a request
  whose HMAC verifies (Contract 1), and `/discord/interactions` only one whose
  Ed25519 signature does (Contract 8). Those two signatures are the only
  credentials anywhere in this process.

Tripwire: a `tool.approval_required` whose `thread_id` is not `main` means a
subagent was given the review tool, which the design forbids. `apps/cujo` logs
it and marks the run `error`; no `/cujo` command can decide it.

### Run lifecycle log events

Every run emits structured events to stdout through `@cujo/log` (decision 37).
The events below are the run-level subset; service-level events
(`webhook.accepted`, `webhook.skipped`, etc.) are documented beside their
emitters.

| Event | Level | Fields | When |
|-------|-------|--------|------|
| `run.status.changed` | info | `from`, `to`, `error_message`? | Each status transition. `error_message` is present only when `to` is `error` and the projection carries an error string; omitted on clean endings. |
| `check.started` | info | `check`, `thread_id` | A sub-agent thread whose title matches a check name moves to running. |
| `check.finished` | info | `check`, `thread_id`, `status`, `duration_ms`? | A check thread reaches a terminal state. |
| `run.setup.completed` | info | `session_id` | Fires once, on the first `check.started`, confirming sandbox setup succeeded and sensors are armed. `session_id` is the TrueForge session, not a turn id. Seeded from the stored projection on rehydrate so a restart does not re-emit. |
| `check.hard_rule.tripped` | warn | `rule`, `check`, `severity`, `claim` | One line per rule per check. `claim` is `"malice"` for the four supply-chain rules (decision 21), `"correctness"` for `tests_failed`, or `"operational"` for `check_missing` and `sensor_unarmed` (evidence-quality warnings, not code defects). Deduplicated by `rule:check` and seeded from the stored projection, so a restart does not re-announce. |

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
| `running` | amber (`--sev-medium`) | Review running. | `Head`, `Pull request`. Nothing that changes while the checks run: the card is rewritten only on a status change, so a progress count would freeze and then lie. |
| `clean` | grey (`--fg-muted`) | No critical finding; the advisory review posted. | Identity row, `Checks`, `Summary`. |
| `blocked_pending` | brand amber (`--accent`) | Blocked, waiting for a human. | Identity row with `Findings`, then up to three *distinct* critical findings — grouped by title and evidence, naming the checks that saw each — then `Checks`. Also posts the ping below. |
| `blocked_unattended` | red (`--sev-critical`) | The blocking review posted. A correctness finding: nobody was asked. | Grouped critical findings, `Checks`. |
| `blocked_posted` | red (`--sev-critical`) | The blocking review posted, and who decided. | Grouped critical findings, `Checks`. |
| `denied` | grey (`--sev-low`) | The block was rejected; nothing was posted. | Grouped critical findings, `Checks`. |
| `error` | blue (`--sev-info`) | The run ended in error. | `Error`. Red, never: red means the pull request is dangerous, and an infrastructure failure is a status, not a verdict. |
| `superseded` | near-black (`--line`) | Replaced by a newer commit. | `Head` and `Pull request` only. No findings: they describe a commit nobody is looking at, and showing them invites acting on a stale review. |

The colour column is the brand severity ramp, dark values (decision 36); an
embed carries one colour and is read on a dark client.

**The author line is the opener's** (decision 86, reversing 55's allocation).
An embed's author line is the one slot that renders an icon in front of text,
and it goes to the variable party: the person who opened the pull request,
avatar built from the numeric account id, profile linked only for a login the
allowlist in rule 7 accepts, name stripped of invisible characters but never
escaped — the line renders no markdown, so a backslash there is litter. Cujo
was already named twice above it, by the app badge and its avatar on the
message header, so the Cujo mark moves into the freed footer icon and the
`Opened by` field is gone rather than kept beside the line. With the field
gone, `Head` shares its inline row with `Pull request` (the card's link to
`https://github.com/<repo>/pull/<n>`, structural, shape-checked in code, and a
private run's only live link) and the `Findings` counts. The line is on every
status, including
`running` and `superseded`: who opened a pull request cannot change under the
card, so the rule that keeps those two sparse does not reach it — and because
the clamp only drops fields, the author line is the one identity the
6000-character budget can never take. A run recorded before the author was
stored, or one whose account has since been deleted, shows Cujo in the author
line as before, with no footer icon.

**A check says what it measured, not a tick** (decision 86, on 65's precedent
for the list row). The `Checks` field carries, per check, its terminal state
in words, the criticals attributed to it, and how long it watched —
`tests done, 1 critical, 41s` — with `0 critical` written out rather than
implied by an absence, because an absent count next to a `done` would read as
a pass again. Critical findings group by title and evidence for display, so
one fact reported by three checks costs one line naming all three; the fold
still records each finding, and the heading keeps the raw count.

Two runs get no card at all: a run whose repo has no binding, and an `error`
run with no turn. The second is the "lost before its turn started" case, which
a webhook redelivery re-claims under a fresh run id (Contract 6) — a card for
it would sit in the channel beside the real one.

**The ping.** A Discord edit notifies nobody, so the one moment that needs a
person cannot be an edit. On `blocked_pending` Cujo posts a second message
that mentions `notify_role_id`, and that message carries its own card
(decision 86): a slim amber embed titled `repo #n — <pr title>` — linking the
run when it has a page — saying the critical count and that a human is
blocked, with no fields, because it sits directly under the run card and
anything it repeated from the card above it would be noise. The mention stays
in `content`, because a mention only pings from there, and Cujo's own link is
wrapped in angle brackets so Discord does not unfurl the site beneath the
embed Cujo just built. With no role configured it still posts, without a
mention: a new message is what raises the channel's unread mark, which is the
entire point. Once the run leaves `blocked_pending` that same message is
edited in place: the embed is recoloured to the outcome and the content says
resolved.

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
   readable as evidence and unclickable. The only real URLs on a card are the
   run's own link and the pull request's, both structural (rule 8's argument:
   the repo was validated when the channel was bound, and the number is a
   number) — and the pull request's is shape-checked `owner/name` in code
   before it is built, with the field omitted when the check fails, for the
   same reason rule 7's login check exists: enforced, not assumed.
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
7. No derived string reaches an embed URL field unless it passed a strict
   allowlist first (decision 55; the slots moved with decision 86, the
   allowlists did not). There are exactly two, both about the pull request's
   author: the avatar is built from the numeric account id and sits in the
   author line, and the profile link only from a login matching
   `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`. GitHub cannot issue a login outside
   that set, so the check should never fire; it is there so the rule is
   enforced by code rather than assumed. A bot login (`dependabot[bot]`) fails
   it by design and is named — still with its avatar, which is built from the
   id — but without a link.
8. The ping's `content` is structural only — the repo (validated when the
   channel was bound), the PR number, and Cujo's own link, wrapped in angle
   brackets so Discord does not unfurl it beside the embed. The ping's embed
   is not structural: its title carries the pull request's title, which is
   stranger-authored text on this payload for the first time, so it passes
   through the same escaping, truncation and clamping as any card string
   (amended by decision 86; before it, the whole ping was plain text).

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

**There is no HTTP admin surface.** `apps/cujo` served a `/discord/*` API on
the operator hostname until decision 57 deleted both. A binding is created and
removed with `/cujo watch` and `/cujo unwatch` (Contract 8), which is a better
gate than the shared token ever was: the invoking member needs Manage Server in
that Discord server, and the repo has to name that server in its `.cujo.yml`.

A repo is stored lower-cased: GitHub repo names are case-insensitive and
`repository.full_name` carries whatever casing the owner typed, so a binding
typed by hand would otherwise silently never match.

The write is validated because a wrong id would otherwise fail silently at the
first blocked run: `channel_id` must be a Discord id, the bot must be able to
read the channel, and the channel must be a guild text or announcement channel
in a server. A channel the bot cannot read and a channel that does not exist
give the **same** answer on purpose — the difference would let a caller probe
channels across all of Discord — and the real status is logged instead.
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

**There is no override.** A table on the operator plane used to allow a pair
directly, for moving a repo between servers or for a repo whose `.cujo.yml`
cannot be changed. It went with the plane (decision 57), and the table is
dropped by a migration rather than left unread. The declaration is the whole
authority: repo write access, auditable in git history, revoked by a commit
(decision 31).

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
| `/cujo status` | Where each repo watched here currently goes, and the line to add to a repo to allow another. There is no "allowed but not sent" state to report since decision 57: a declaration alone is not a binding. |
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
4. The repo names this server in `.cujo.yml`, or this is the deploy's own
   server and the repo declares nothing (decision 40). `watch` checks this again
   immediately before it writes: the Discord round trips in between are awaits,
   and a declaration reverted during them must not end with a binding for a
   server that may no longer see the repo.
5. For `unwatch`: no **other** server already holds this repo. One repo
   notifies one channel (Contract 7), and `unwatch` is reachable without
   authorization on purpose, so without this one server could silence
   another's reviews.

   For `watch` the rule is narrower, because this is also how a repo moves
   between servers now that the operator override is gone (decision 57). An
   existing binding held by another server is refused **unless that server's
   claim has gone stale** — the holder's authorization is re-read `fresh`, and
   only a holder the declaration no longer names loses the binding. A holder
   that is still authorized keeps it, and a read that fails is refused rather
   than guessed: taking a binding from another server on a guess is the one
   mistake here that does not correct itself. So moving a repo is two steps
   its own maintainers control — change `discord_guild` on the default branch,
   then run `/cujo watch` in the new server.
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
Discord can answer no login challenge, so
a gated host could never receive it. It is signature-gated
ingress, so the read host answers 404 for it, in the process and not only at the
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
