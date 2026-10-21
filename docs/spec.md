# Spec and contracts

This is the doc the code follows. It defines what Cujo acts on, the data that
moves between its parts, and the rules that turn an observation into a finding
and an action. The reasons live in `docs/decisions.md`.

## Scope

- **Trigger:** every non-draft pull request on a repo where the Cujo GitHub App
  is installed, unless the PR carries the `cujo:skip` label (decision 79).
  There is no file filter. A docs-only PR gets a full run in advisory mode
  (`docs_only: true` in the turn payload).
- **Two reviews (decision 133).** A run's `mode` says what it does. `sandbox`
  runs the pull request (Contracts 2 to 4). `diff` reads it (Contract 11): no
  sandbox, a cheap model, a token budget, one advisory review with findings of
  at most `warn`. Contract 1 resolves the mode; a dependency-manifest change or
  a Bot-authored pull request is always `sandbox`.
- **Ecosystem:** any the agent recognises. The agent infers how to install,
  test, and boot the repo from `pyproject.toml`, `package.json`, `Makefile`, CI
  workflows and similar files. A `.cujo.yml` in the target repo overrides it.
- **Repositories:** public and private. A private repository's trees are
  staged on the trusted side, and the sandbox never clones them (decision 158).
  An owner sees every run, private ones included (decision 159).
- **Dependencies:** an added or version-changed dependency, a registry release
  (`humanize==4.9.0`) or a direct reference (`git+https://…`), is installed in
  isolation by the detonation check.

## Non-goals (for this milestone)

- TLS interception of sandbox egress; metadata only (decision 10).
- Forcing all sandbox traffic through the proxy. The proxy sees processes that
  honour `HTTP(S)_PROXY`. A non-Python process that opens a direct socket is
  not observed.
- Remediation (a fix PR on `critical`). It is a stretch, not a requirement.
- Lifting a block from Discord. Contract 7 notifies and does not decide. The
  interactions endpoint carries `/cujo` (Contract 8), but nothing on it lifts a
  block (decision 23). The unlock is on the pull request, and its principal is
  repo write (Contract 1, decisions 44, 45 and 138).

## Contract 1 — the trigger

The Cujo GitHub App subscribes to `pull_request` (`opened`, `synchronize`,
`ready_for_review`), `repository` (`privatized`, `publicized`),
`issue_comment` (`created`) and `pull_request_review_comment` (`created`). It
also receives `installation` (`created`, `deleted`, `suspend`, `unsuspend`)
and `installation_repositories` (`added`, `removed`), which feed only the
repository registry (decision 151). All six arrive on one route, and the
signature is checked before the event type.

A repository the owner turned off in the registry gets no work: its
`pull_request`, `issue_comment` and `pull_request_review_comment` deliveries
get 200 with `ignored: "disabled"`. A repository the registry does not know is
not disabled. The App holds `issues: read` only for `issue_comment` delivery;
no code reads an issue (decision 50). A `repository` event re-stamps
`is_public` on every run of that repo, matched case-insensitively (decision
34).

**Commands.** An `issue_comment` may carry `/cujo dismiss`, the unlock
(Contract 4, decisions 45 and 138), or `/cujo review`, a new review of the
current head (decision 63). Only `created` is acted on; a comment on an issue
is ignored. The route answers 200 at once and works after.

- `apps/cujo` matches the command as an exact string at the start of a line,
  never through a model. Comments by `cujo-guard[bot]` are ignored.
- **A line counts only if a reader can see it.** The scan drops fenced code,
  blockquotes, HTML comments and raw HTML first, by CommonMark: a closing
  fence uses its opener's character, is at least as long, and has nothing
  after it; four spaces open an indented code block; a blockquote holds
  unmarked continuation lines until a blank line (§5.1); `<!--` to `-->`
  renders nothing; `<pre>` runs to its closing tag and a block-level tag such
  as `<details>` to the next blank line (§4.6 conditions 1 and 6). When the
  scan and GitHub could disagree, the scan skips the line.
- **Authorization** is repo `write` or `admin`, read from GitHub on every
  command. Neither the PR author (decision 44) nor a Bot account (decision
  138, from `user.type`, before any read) may `dismiss`. `unknown` (from
  `repoIsPublic`) is neither refusal nor permission; the reply says so.
- **The commit selects the run**: the current head, read from GitHub last
  before the claim; no run for it is a refusal by name (dismissal: Contract 4).
- `/cujo review` needs repo write, and the PR author may use it. It needs no
  existing run and no stale-head check. It reclaims the head's existing run,
  deleting its projection, board page and Discord card; the reply says so.
- **Every outcome speaks on the pull request.**

A `pull_request_review_comment` (a reply in a review thread) carries
conversation (Contract 10) and never a privileged verb.

**Entry filters** (decision 79), in order: a draft PR
(`pull_request.draft === true`) and a PR with the `cujo:skip` label get 200
with no session and no run. A docs-only PR (`isDocsOnly`) gets a full run with
`docs_only: true`. The label filter reads `labels` as delivered and does not
cancel a run in flight.

**A push waits out a window** (decision 144). A `synchronize` claims its run
row and answers 202; the start waits `CUJO_PUSH_DEBOUNCE_MS` (one minute by
default; `0` starts at once), logged as `webhook.debounced`. A newer push in
the window drops the older pending start, and the run that starts supersedes
the dropped rows. The reaction and the check run land at the start. `opened`,
`ready_for_review` and shutdown start pending runs at once.

**Budgets.** A sandbox turn carries `tokenBudget` from `sandboxBudgetTokens`
(decision 165), as a diff turn carries `diffBudgetTokens`; the run row stamps
it. The brief carries `turn_budget_ms`. Each check's sub-agent uses
`agent/checks/<CHECK>.md` on `checks/COMMON.md` as its system prompt, named on
the spec as `subagents`.

**Judge run or gather run (decision 161).** With `CUJO_EXECUTE_DECLARED` on and
a `.cujo.yml` at base that parses and declares `test`, the run is a **judge
run**: `apps/cujo` runs `tests`, `smoke` and `detonation` itself with no model
(Contract 2; decisions 162, 163, 169), then starts a turn on `agent/JUDGE.md`
with its own session and spec. The brief carries `sandbox: {id, env}`,
`policy`, `executed: {tests: {report, truncated}, smoke?: {…},
detonation?: {…}}`, a prefilled `coverage`, and `build_facts`, and neither
`clone_url` nor `staged`. The declared install's exit code is a field of
`sniff.py run` (decision 173): a **head** install that exits non-zero ends the
run in `error`, naming the command and its tail; a **base** one skips base's
suite and marks `base_not_installed`. Extras merge into each envelope on the
trusted side, under the envelope's own keys. The parent reads the evidence,
spawns `probes` by default, and posts; `apps/cujo` destroys the box after.
Any other run is a **gather run** on `agent/SKILL.md`. The choice is logged as
`run.path.resolved` with `path_kind` and a reason (`declared`, `undeclared`,
`disabled`); a file that does not parse logs `policy.invalid` and gathers.

**Private repositories (decision 158).** The turn message carries `staged`, a
32-hex ticket, in place of `clone_url`, never both. Before the turn,
`apps/cujo` fetches base and head as GitHub archives with the installation
token and streams them to `sandbox-mcp`'s staging route under the ticket;
`sandbox_create` with the ticket copies them into the box. The ticket is single
use and swept after thirty minutes. A staging failure fails the run before any
session is spent.

For a `pull_request` event the `apps/cujo` webhook module:

1. Verifies the `X-Hub-Signature-256` HMAC and rejects anything unsigned or
   mismatched.
2. Reads the PR metadata, the changed files (with hunks for the diff review),
   and whether the author is a Bot, with the installation token (Contents:
   read, Pull requests: read).
3. Resolves the **mode** (decision 135) and logs `run.mode.resolved`. In
   order: the instance's `reviewMode`, seeded from `CUJO_REVIEW_MODE`
   (decision 152); the board's setting for the repository (decision 155);
   `mode:` in `.cujo.yml` at the **base SHA** (decision 13); then the floors,
   enforced whatever the others said: a changed dependency manifest is
   `sandbox`, and a Bot author is `sandbox`. `mode:` uses the strict line rule
   of `discord_guild`, so a malformed value is no declaration. A failed read
   ends the run in `error`.
4. For a **sandbox** run, finds or creates the PR's session (Contract 5) and
   starts one turn with one user message: repo full name, PR number, base SHA,
   head SHA, the changed-file list, `run_id` only for a public repo (never a
   URL or host), and when present:
   - `detonation_cached` (decisions 145, 148): for each exact specifier the
     manifest hunks add that this instance detonated within seven days, its
     `dependency`, `source`, `cached_at`, and `run_id` only when that run is
     public. The entry stays on the trusted side.
   - `instructions` (decision 155): `{source, text, truncated}` from
     `.cujo/REVIEW.md` at base or from the board.
   - `build_facts` (decisions 170, 171): read at head before the mode branch;
     shape as in Contract 11; each hazard is a `warn` finding on the run.

   For a **diff** run, creates a fresh session on the diff spec (decision 137),
   prepares the package (Contract 11), stamps the run with the diff spec's
   model, rubric digest, budget and session, and starts one turn with the
   package. The PR's own session row is untouched.
5. Records a run (Contract 6) and folds the turn's event stream into it until
   `turn.done`.
6. Reacts with `eyes` once the run is worth starting, before the turn exists
   (Contract 9). A head the bot already reviewed and a late delivery for an old
   head get no reaction.

The webhook module does not decide what to check. The agent does.

## Contract 2 — the sandbox run

One sandbox per turn. The parent agent sets it up, delegates each check to a
sub-agent, and collects one JSON report per check. Only those reports leave
the sandbox.

### Setup

Two commands (decision 71).

1. `sniff.py prepare` clones the repo at the head SHA and adds a worktree at
   the base SHA in the same sandbox. It returns:
   - `cujo_yml`: `.cujo.yml` from the **base** SHA, or null. If the PR changes
     it, the parent emits a `warn` ("`.cujo.yml` changed in this PR; the base
     version was used").
   - `cujo_yml_status`: `read`, `absent`, `too_large` (may be opened in
     `/work/base`) or `unreadable` (must not be opened; the run stops), with
     `cujo_yml_error`. The policy is never returned in part, never in
     `truncated`, and has its own cap, `PREPARE_POLICY_CHARS`.
   - `files`: the head's build files by path (`pyproject.toml`,
     `package.json`, `go.mod`, `composer.json`, `CMakeLists.txt`, `Makefile`,
     CI workflows and similar), two directories deep, each capped at
     `PREPARE_FILE_CHARS`. `node_modules` and lock files are skipped.
   - `truncated`, `unreadable`, `omitted`: capped files (may be opened in
     `/work/head`), refused files (must not be opened), and the count the file
     cap dropped.

   `prepare` parses no YAML; `sandbox/` is stdlib-only by default (decision
   117). Caps bound the read and are spent on escaped text (decision 72). Only
   regular files inside the clone are read. The head is always fetched as
   `refs/pull/<n>/head` from the base repository's clone URL; if it moved off
   `--head-sha`, `prepare` refuses and names both. A path is replaced only when
   absent or marked by this command. The clone URL must name the host and the
   `--repo` repository, be `http`/`https`, and carry no credential in userinfo
   or query. Each git call has a timeout.

   `--staged DIR`, exclusive with `--clone-url` (decision 158), adopts the
   trees `sandbox_create` unpacked under `/work/stage/base` and
   `/work/stage/head`, each made a repository of one synthetic commit, and
   reports `source: "staged"` (else `"clone"`). A missing or symlinked tree is
   refused before anything moves.

   On a judge run (decision 161), `apps/cujo` issues steps 1 and 2 and the
   `tests` runs and `report` through `sandbox-mcp`. A declared line runs as
   `sh -c <line>`: install under `--check setup`, tests under `--check tests`,
   on head, and on base only when head is not clean (exit 0 with no failing
   test named; decision 169). The `base`, `head` and `base_pass_head_fail`
   extras are parsed on the trusted side (pytest, vitest, jest and go failure
   lines; else the suite's exit). When base was not run they carry
   `base_not_run: true`, an empty `base`, and a coverage note; `smoke` extras
   carry the same marker. The envelope is kept in `run_executions` and folded
   as a check with no thread (`threadId: executed:tests`).
2. `sniff.py setup` seeds the decoy secret (a fake `~/.aws/credentials` with a
   bogus key), starts the in-sandbox logging proxy and the inotify watcher, and
   prints the env every later command exports, `HTTP(S)_PROXY` included. Its
   `--allow-host` list is the policy's `allow_hosts`.
3. The parent runs the install once per project root per tree, and delegates.
   **The project root is where a manifest is** (decision 111). `--cwd` narrows
   to the service; `--workspace-root` is the tree root. Installs serialise on
   the sensor lock.

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

   Any key can be omitted. Missing keys are inferred from the repo. If the
   agent cannot infer `test`, the run stops as described under `tests`.

### The checks

Each check runs in its own sub-agent with fresh context, the check's
instructions and the sandbox tools. Only its final JSON report returns. No
check reads another's report. Sensed commands run one at a time (decision 41).
`detonation` is spawned first, during setup; `tests`, `probes` and `smoke`
together once the install finishes (decision 73).

**A sub-agent that returns an error instead of a report is respawned once**
(decision 108), under the same name, after a short wait.
`CheckState.attempts` says which attempt a thread was; the digest reads the
later thread. A second failure is `check_missing`. **A report is an answer,
whatever it says** (decision 143): one that records a timed-out command is a
coverage gap and is not respawned.

**The parent's install is wrapped in `sniff.py run --check setup`** to hold
the sensor lock; no report is folded from it. Under a name outside the four
checks, `sniff.py run` prints only `exit`, `duration_s`, the tails, `derived`,
`sensors`, `truncated` and `recorded`, the entry file's path in the box
(decision 166). The four check names print the entry whole.

- **`tests`** — run the suite on base and on head (on a judge run, head alone
  when head is clean: decision 169). Report per-test status for each tree that
  ran, and the derived set `base_pass_head_fail`. If no suite is found and
  `.cujo.yml` names none, the parent emits one `warn` finding ("no test suite
  found") and stops: no checks are spawned. This skips `tests`, `probes` and
  `smoke` but not `detonation` (decision 87).
- **`probes`** — the sub-agent reads the diff, writes small scripts that call
  the changed functions with inputs it chooses, and runs them against head.
  Report each probe's script, the expectation stated before the run, and the
  outcome.
- **`smoke`** — boot the app with the configured or inferred command, hit the
  configured or inferred endpoints, stop it. Report status codes, response
  tails, and the log tail. On a judge run this is `sniff.py smoke` (decision
  162), run by `apps/cujo` on head then base: the boot is one sensed command in
  its own process group, the sensor process makes the requests, and the group
  is stopped inside the same window. One `runs[]` entry per tree carries
  `tree`, `port`, `port_source`, `ready`, `requests[]` and the app's sensor
  block. `endpoints[]` and `log_tail` are joined on the trusted side.
- **`detonation`** — runs only when the changed files include a dependency
  manifest (`requirements*.txt`, `pyproject.toml`, `setup.py`, `setup.cfg`,
  `Pipfile`, `uv.lock`, `package.json`, `package-lock.json`, `pnpm-lock.yaml`,
  `yarn.lock`, `Cargo.toml`, `go.mod`, and similar). The sub-agent diffs the
  manifest to the added or version-changed specifiers and runs `sniff.py` once
  per specifier, which installs it in a fresh environment behind the proxy and
  prints:

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

  plus the sensor block, and `resolved`: what the install said the specifier
  became, or `null` on any doubt or a failed install. On a judge run
  `apps/cujo` runs this check (decision 163): `sniff.py detonate` per added
  specifier, then `sniff.py report --check detonation`.

  **One detonation per exact specifier per instance per week** (decision
  145). An exact specifier (`name==X`, `name@X`, `module@vX.Y.Z`, `name:X`, or
  `git+url@<40 hex>`) is looked up before the turn in a table keyed on
  `(source, normalised specifier)` with a seven-day TTL enforced on read. The
  entry is kept on the run (`run_detonation_cache`, decision 148). For a hit
  the sub-agent runs `sniff.py detonate --dependency <spec> --source <src>
  --cached`, which records a stub (`dependency`, `source`, `cached: true`) and
  installs nothing. The fold replaces the stub with the kept entry, marked
  `cached_from_run` and `cached_at`, before the schema or a rule sees it. A
  stub with no entry stays a stub (decision 112). After a `detonation` check,
  `apps/cujo` caches each entry with `install_ok` under an exclusive window, no
  hard-rule flag (`wrote_sensitive`, `egress_to_unknown_host`), no decoy read,
  every egress host on the sensors' index list, an exact specifier, and no
  cached origin. Ranges, tags, branches and bare names are never cached.

### The report

**`sniff.py report --check <name>` assembles the envelope** (decision 112):
`check`, `schema_version`, every `runs[]` entry in order and whole, and the
`derived` / `sensors` / `truncated` roll-up. The sub-agent passes per-check
fields in `--extra`, which is spread *under* the envelope's own keys, and copies
the output verbatim.

**[`docs/contracts/report.example.json`](contracts/report.example.json) is the
shape.** It is one complete, normative example. A conformance test in each of
the three consumers loads it (decision 54).

**Validation may only add** (decision 62).
`apps/cujo/src/review/report-schema.ts` checks the envelope and every `runs[]`
entry. A failing report produces one `warn` finding, `report_invalid`; the
status does not change and the hard rules still read the report. An unknown
`schema_version` or field passes. The schema requires `check`, `runs[]` and
`derived` on the envelope, and each `runs[]` entry whole.

| field | |
|---|---|
| `schema_version` | The report shape, an integer. Never reject a report for a version you do not know. |
| `check` | One of `tests`, `probes`, `smoke`, `detonation`. It must match the sub-agent's own name. |
| `runs[]` | Every `sniff.py run` or `detonate` report, in order, verbatim. |
| `derived`, `sensors`, `truncated` | The roll-up over every run. The hard rules read the top level *and* each `runs[]` entry. `derived` and `truncated` hold named booleans, every key optional; each sensor in `sensors` must carry `armed`. `derived` is required as a block; `sensors` and `truncated` may be absent. |

plus the per-check fields: `base` / `head` / `base_pass_head_fail` for
`tests`, `probes[]`, and `endpoints[]` and `log_tail` for `smoke`.

Each `runs[]` entry: `schema_version`, `argv`, `exit`, `duration_s`,
`window_exclusive`, `stdout_tail`, `stderr_tail`, and the sensor block. A
`detonate` entry carries `dependency`, `source`, `install_ok`, `duration_s`
and `resolved` in place of `argv` and `exit`, plus `cached_from_run` and
`cached_at` when copied (decision 145).

The sensor block, the same on every check: `egress[]`, `files_read[]`,
`fs_changes[]`, `subprocesses[]`, `secret_probe`, `sensors`, `truncated`,
`derived`. In `sensors`, each entry carries `armed` (required) and `detail`
(optional in the envelope roll-up). Inside `runs[]` every `derived` and
`truncated` key is required; at the envelope every key is optional and must be
a boolean when present. A roll-up that is not an object is refused (decision
96).

**Every string in a report is written by the code under review.** Control
characters, terminal escapes, and bidirectional and zero-width characters are
escaped in place as visible `\xNN` and `\uNNNN`, not stripped. A length cap is
measured on the escaped text and spends whole characters, so no escape is cut
(decision 72). `truncated` is true when the output or its escaped form was cut.

The sensors:

- **Logging proxy.** Records host, port, and byte count for every process that
  honours `HTTP(S)_PROXY`. Gives `egress`. Payloads are not read.
- **Filesystem diff.** A snapshot before and after each command flags anything
  created or modified outside the workspace and its install environment
  (`in_workspace: false`), and anything under a sensitive path (`~/.ssh`, a
  shell rc, cron, a credentials path) as `wrote_sensitive`. Each `fs_changes`
  entry carries a `sensitive` flag. A path is sensitive on its lexically
  normalised or its resolved form.
- **Decoy inotify watcher.** `IN_OPEN` and `IN_ACCESS` on the decoy file; any
  event during a check sets `decoy_read`.
- **Python audit hook.** A `sitecustomize.py` on `PYTHONPATH` calls
  `sys.addaudithook` and records `open`, `socket.connect`, and
  `subprocess`/`os.exec` in every Python subprocess. It gives `files_read`,
  `subprocesses`, and a second source for `decoy_read`. `files_read` omits
  interpreter and package-manager reads (the interpreter's `lib/` tree,
  `site-packages`, `__pycache__` and `.pyc`, `.dist-info`, `node_modules`,
  `/proc`, `/sys`, `/dev`), but always lists a sensitive path and a read of
  Cujo's state directory.

A file is identified by `(mtime_ns, size)`, plus a SHA-256 digest for the
credential and shell-rc locations and the rest of `/etc` (a symlink by its
target string; never the decoy, decision 58). A digest wanted and not taken is
its own value; a digest on one side only is a change; with none on either
side, metadata decides. Hashed files are opened `O_NOFOLLOW | O_NONBLOCK` and
checked for type, device and inode. **Known gap:** a file unreadable in both
snapshots can be edited with size and timestamp restored without detection.

`sniff.py run` and `detonate` hold an exclusive lock, one sensed command at a
time (decision 41); a report is the slice of the shared proxy and watcher logs
written while its command ran, and the audit hook gets one log per command.
Only a wrapped command is sensed. Commands: `setup`; `run --check NAME --
CMD...`; `detonate --dependency SPEC`; `report --check NAME` (decision 112);
`teardown`, which stops the daemons and restores or removes the decoy. **The
sensors ship in the sandbox image** at `/opt/cujo`, `sniff.py` beside the
`cujo_sniff` package (decisions 48, 117). State lives in `CUJO_DIR`, beside the
code; `setup`'s JSON returns every path the rubric needs.

`derived.egress_to_unknown_host` is true when a host is neither a known package
index nor in `allow_hosts`. `secret_probe.decoy_in_egress` is `null` on every
report, because the proxy never reads a payload (decision 54); its hard rule
fires on `true`.

#### `sensors` — what was watching

One `{armed, detail}` entry per sensor:

| sensor | armed when | `detail` |
|---|---|---|
| `proxy` | the daemon bound its port during `setup` **and** is still alive now | the loopback port |
| `decoy` | the watcher armed during `setup`, is still alive, **and** the file it armed on is still the file at that path | `inotify` or `atime` |
| `audit` | the hook wrote its `armed` row into this command's log | the row count, or that no Python process ran |
| `fs_diff` | the walk reached any file | how many paths, and whether the cap cut it |

Both daemon entries are re-checked per command. The watcher re-arms on
`IN_IGNORED` when a file is there; `setup` records the decoy's inode.
`daemon_alive` checks that the pid's command line is one of ours.

An unarmed `proxy` or `decoy` is one `warn` (`sensor_unarmed`), never a
`critical`, and does not gate the review. `audit` and `fs_diff` are not ruled
on. Nothing in this block may name a host, a path, or a repository; a report
reaches the public plane verbatim. The block is evidence, not proof: forged
health can hide a gap but cannot create a finding, because every rule fires on
a sensor reporting *false*.

#### `truncated` — where the evidence was cut

Seven caps, one boolean each: `TAIL_CHARS` on each output tail (the output *or
its escaped form*, decision 72); `MAX_FILES_READ` on `files_read` (a sensitive
read is never dropped); `MAX_FS_CHANGES` on the benign rows of `fs_changes`,
each side of the workspace line (a sensitive row is never dropped, and
`derived` reads the full list, decisions 146 and 166); `MAX_SNAPSHOT_FILES` on
each walk; `HASH_MAX_BYTES` on a digested file; and the JSONL parser
(`truncated.sensor_logs`, a log line that did not decode). `truncated.hashes`
counts files this walk could have compared and did not (past `HASH_MAX_BYTES`,
or identity changed between `lstat` and open), not files never readable.

A `created` row needs the *before* walk complete; a `deleted` row needs the
*after* walk. A change to a path both walks hold is always reported.
`window_exclusive` on a run is `false` when another sensed command overlapped
it.

#### `script_content` — what the sensor captured before execution

When `argv[0]` is a known interpreter (`python3`, `node`, `bash`, `sh`, and
versioned Python names) and the first positional argument is a readable file,
`run_sensed` reads that file before the subprocess starts, scrubs it through
`scrub()`, and caps it at `MAX_SCRIPT_CHARS` (8 000). It sits beside `argv` as
`script_content`, a string or `null`; `null` means not a script invocation.
`truncated.script_content` is `true` when the cap cut it (decision 70).

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
  "path": "app/orders.py",
  "line": 42,
  "side": "RIGHT"
}
```

`severity` is `info`, `warn` or `critical`. `detail` is one paragraph of
judgment, expected on every `critical`. `next` is one imperative clause:
required on `critical`, allowed on `warn`, never on `info`, and only from
something a sensor observed. `path`, `line` (a line in the PR diff) and `side`
(`RIGHT`, head, the default; or `LEFT`, a line only on base) are optional and
anchor an inline comment.

**Layer 1 — the hard rules (code).** Any of these forces a `critical` the agent
cannot change:

| Rule | Claim |
|------|-------|
| `tests.base_pass_head_fail` non-empty | **correctness** — the pull request broke something |
| `secret_probe.decoy_read`, any check | **malice** — code read a credential it was not given |
| `secret_probe.decoy_in_egress`, any check | **malice** — a secret left the box |
| `derived.wrote_sensitive`, any check | **malice** — a write in `~/.ssh`, a shell rc, cron, or a credentials path |
| `derived.egress_to_unknown_host`, `detonation` only | **malice** — a dependency phoned home |

Both kinds block the same way. A malice finding states the measurement (the
path, the host, the time); a person who knows better lifts the block
(Contract 4, decision 138). Each finding carries its rule as `rule`.
`github-mcp`'s title backstop (decision 74) rewrites a title that is only a
Contract 2 field name into a sentence. The rules fire only on positive
evidence; `false` means "not observed".

The rules run twice (decision 21): in the rubric, and in `apps/cujo` on each
check's `thread.done`, over the top level and `runs[]`, as one `critical` per
rule per check with `source: "hard_rule"`. A required check (`tests`, `probes`,
`smoke`) with no report by `turn.done`, or a spawned `detonation` thread that
ended without one (decision 146), adds a `warn` ("the tests check returned no
report"). These head `findings`; the agent's (`source: "agent"`) follow, minus
repeats of a hard-rule check and title. A `post_advisory_review` while a
hard-rule finding exists ends the run `error` naming the rule.

**Layer 1b — build facts (code, no execution; decisions 170, 171).** Before the
turn, `apps/cujo` reads how each touched service is packaged and derives a
`warn` for each proven hazard; today one rule,
`esm_bundle_without_require_shim`. The findings carry `check: "build"` and
`source: "build_fact"`, head the list beside the hard rules, are deduped like
them, and are stored before the turn. Always `warn`, never `critical`
(decisions 136, 168). The rubric reports each hazard verbatim. A `build_fact`
finding is not held out of `previous_findings`.

**Layer 2 — the agent judges the rest** against `SKILL.md`:

- **`critical`** — a probe shows the change does not do what the diff claims;
  a smoke endpoint that worked on base now errors; a suspicious combination
  without a Layer 1 signal.
- **`warn`** — changed code with no test, a cache write outside the
  workspace, an unfamiliar but plausibly benign host, a smoke endpoint slower
  or noisier than on base.
- **`info`** — what ran and what it showed, when nothing is wrong.

## Contract 4 — reviews, the block and the unlock

Every review posts automatically. The one human decision is the unlock. Two
tools on `github-mcp`:

| Tool | When | GitHub review |
|------|------|---------------|
| `post_advisory_review` | no `critical` finding | COMMENT |
| `post_blocking_review` | any `critical` finding | REQUEST_CHANGES (blocks merge) |

**One call, never two** (decision 138). The rubric picks the tool, and
`apps/cujo` re-derives the choice (Contract 3): an advisory over a `critical`
ends the run `error`. Advisory is COMMENT, never APPROVE.

**`github-mcp` composes the body** (decision 74) from a one-sentence `body`,
`findings[]`, and optional `coverage` and `egress`: a headline with the verdict
word (from the tool, not the model) and severity counts, the lede, findings by
severity, the coverage caveat (one line per check), the egress line and host
table, and a collapsed machine-readable block (`schema_version` 2, decision
138). Empty sections are omitted. A finding renders title, `detail`, `next`,
then quoted `evidence` (decision 97); one with neither `detail` nor `next` and
one-line evidence renders as `**title** · meta — evidence`, except a
`critical`. Check names, titles and coverage notes are flattened to one line.
An inline comment puts evidence first.

**`comments[]` is deprecated.** A finding with `path`, `line` and `side`
becomes an inline comment; a call that still sends `comments[]` posts those
(decision 16). Anchors are validated against the diff; a finding whose anchor
is not in it is marked `(not in this diff)`, and the rejection
(`file_not_in_diff`, `line_not_in_hunk` or `bad_line`) is logged (decision 37).
A prose body from an older rubric renders under `### Notes` (decision 16). A
non-2xx GitHub call raises a `GitHubError` with `status`, `path` and `method`
fields; only GitHub's `message` is read, capped.

Both tools take an optional `run_id`, validated as a UUID. `github-mcp` builds
the link from `CUJO_PUBLIC_BASE_URL` and appends a footer: a rule, then a bold
link *View the full evidence* (decision 36); the same URL is `run_url` in the
machine-readable block. No footer when `run_id` is absent (a private
repository) or `CUJO_PUBLIC_BASE_URL` is unset.

**The lock is a check run** (decision 138). `apps/cujo` writes `cujo/guard` on
every commit it reviews and moves it with the run's status, beside the
reaction (Contract 9):

| Status | Check run |
|--------|-----------|
| `running` | `in_progress`, from the moment the head is claimed |
| `clean` | `completed` / `success` |
| `unproven` | `completed` / `neutral` |
| `blocked` | `completed` / `failure` |
| `dismissed` | `completed` / `neutral`, titled *Dismissed by @login* |
| `error` | `completed` / `neutral` |
| `superseded` | `completed` / `skipped`, only while this run is still the latest for its head; on `/cujo review` the replacement writes its own |

The title is the Discord card's status sentence; the summary is the severity
counts; `details_url` is the run page (decision 159); `external_id` is the run
id. The check is found by name and App on the commit and PATCHed, or POSTed;
the id is cached per run. It needs `checks: write`; without it the write fails
with 403 and nothing else changes. `CUJO_PR_CHECKS=0` turns it off. A merge is
held only where branch protection **requires** `cujo/guard`.

**The unlock is `/cujo dismiss`** (Contract 1, decisions 44, 45, 138), for the
run on the current head, only when `blocked`. In order: claim
(`claimDecision`, one winner); dismiss the bot's `CHANGES_REQUESTED` reviews
on that commit with *Dismissed by @login with /cujo dismiss.*; move the run to
`dismissed` with `approver = github:<login>` and emit. A failed GitHub write
releases the claim; zero matching reviews is not a failure. The findings stay.

**Stale review dismissal (decision 52).** Only when a run completes `clean`,
`apps/cujo` dismisses the bot's `CHANGES_REQUESTED` reviews on other commits,
with a fixed message naming the new head, unless a fresh read shows the head
moved past this run's commit. It is a service action, not an agent tool.

## Contract 5 — one session per PR, no double-posting

- A PR maps to one session, keyed by repo and PR number. **A diff run is the
  exception** (decision 137): a fresh session on the diff spec each time, with
  the previous review's findings as its memory (Contract 11). The per-PR
  session row is still claimed.
- On `synchronize`, the session runs a new turn on the new head SHA.
- **`/cujo reset` from Discord forgets a PR's sessions** (decision 123), review
  and conversation, so the next push or `/cujo review` starts fresh ones on the
  current rubric and model (decision 16). It is refused while a run on the PR
  is unfinished, and needs the same authorization as `/cujo watch`.
- **The idempotency check lives in `apps/cujo`.** Before a turn, it lists the
  PR's reviews and skips if `cujo-guard[bot]` already reviewed the head SHA.
  `github-mcp` only posts.
- **`/cujo review` supersedes instead of deleting (decision 104).** The old
  run is marked `superseded`, so its review's footer still resolves. The
  `runs_head` unique index covers non-terminal statuses only.
- **One turn posts one review** (decision 138): one run, review and verdict per
  head SHA.

## Contract 6 — the run record and the read API

`apps/cujo` keeps one record per PR event it acted on, a run: a projection of
the harness session (decision 18). The fields below are all it stores; the UI
rebuilds the rest from the session's event log (`listEvents`, decision 123).

Harness events are validated against `packages/harness-contract` (decision
105): `safeParse`, a `run.event.invalid` warning on mismatch, never a
rejection. An unnamed type is checked for an id and a timestamp only.

A turn that ended in error with nothing posted is retried once (decision 130);
the retry's `turn.created` carries `previousTurnId`. A run holds an ordered
list of turn ids, appended on every `turn.created` for the session, and
rehydration replays them in order.

| Field | Meaning |
|-------|---------|
| `id` | Run id, `apps/cujo`'s own. |
| `repo`, `pr_number`, `head_sha` | The PR event that started it. |
| `session_id` | The harness session (one per PR, Contract 5). |
| `turn_ids` | Ordered list: the turn started for this head SHA, then a retry if there was one. |
| `status` | One of the seven states below. |
| `approver`, `decided_at` | Who lifted a block and when: `github:<login>` of the person whose `/cujo dismiss` moved the run to `dismissed` (decisions 44, 138). Unset otherwise. Never on the public plane. |
| `is_public` | Whether the repo was public at claim, from `repository.private`. Corrected by the `repository` event and a periodic re-check. Unset reads as private (decision 34). |
| `delivery_id` | The claiming webhook's `X-GitHub-Delivery`, or unset for an older run. The correlation id on every log line for the run (decision 37). Never on the public plane. |
| `pr_title`, `pr_author_login`, `pr_author_id` | Read once at claim (decision 55). Unset for an older run or a failed PR read; author fields also unset for a deleted account. The avatar URL is built from the id. Served on both planes. |
| `model`, `rubric_sha256` | The configured model and a SHA-256 of the instructions a session would be given. **Both describe the process that claimed the run**, not necessarily the session that reviewed it (decision 16). A diff run is stamped with the diff spec's pair. Unset for an older run. Served on both planes. |
| `mode` | `sandbox` or `diff` (decision 135). Written by `startRun` once the PR is read; reads `sandbox` before that and for older rows. Served on both planes, the list included. |
| `budget_tokens` | The turn's token budget as stamped at start (decision 132), or unset. Detail only. |
| `usage` | Summed over every `turn.done` from the harness's `TurnMetrics`: input, output, cache-read, cache-write and reasoning tokens, plus estimated USD cost when the harness reports one above zero. No price table. Each check carries its own token total from its thread's messages. **Always present**, `null` for a projection stored before the field existed; per-check `usage` and `timings` likewise. `messages` counts every `model.message` on every thread (decision 141). |
| `ledger` | (decision 141) `threads[]`, one row per thread in order (the parent first, titled `main`, then each sub-agent by title with its `attempt`), each summed from its own `model.message` usage (`messages`, input, output, cache read, cache write, `reasoningTokens` null until reported) plus `toolResultBytes`; and `largestToolResults[]`, the ten largest tool results by bytes, largest first, as thread title, tool name, byte count and whether it was an error. Never a thread id or result content. **Always present**, `null` as for `usage`. |
| `setup` | `turnCreatedAt` (first `turn.created`), `sandboxCreatedAt` (always null since decision 115; `sandboxProvisionedMs` beside it), `agentStartedAt` (the parent's first `model.message` on `main`), `firstCheckAt` (the first `thread.created` titled for a check), `messages` (the parent's messages before it), and `ms`, from `agentStartedAt` to `firstCheckAt`, omitted while either end is missing. **Always present**, `null` as for `usage`. |
| `created_at`, `updated_at` | Timestamps. |

Status moves on turn events, except `superseded`, which the webhook sets:

| Status | Set when |
|--------|----------|
| `running` | The run was claimed; the first turn is being started. |
| `clean` | `turn.done` on a posted advisory review with at least one check report. On a diff run: the advisory review posted. |
| `unproven` | `turn.done` on a posted review with **no check report** (decision 107). Terminal: `TERMINAL_STATUSES_SQL` names it and the partial index excludes it. Exception (decision 87): no suite inferred and `detonation` reported alone is `clean`. |
| `blocked` | `turn.done` on a `post_blocking_review`; `cujo/guard` fails on the head (decision 138). Terminal; only a person moves it. `approver` null until then. |
| `dismissed` | `/cujo dismiss` lifted the block (Contract 1). Set by `Runner.dismiss` outside the fold. Terminal. |
| `error` | `turn.done` with an error state, including `token budget exhausted: N of B` (decision 132, not retried); stream lost and no terminal event after the turn timeout; the run could not be prepared (a GitHub read, the mode read, or the turn start failed); an advisory while a `critical` stood (Contract 3); a diff run called `post_blocking_review` (Contract 11); a held tool call, `approval requested for <tool>; nothing is gated on this spec` (not retried); GitHub refused the review, `review post failed: <tool> — <reason>` (decision 140, not retried). **A lost stream is not itself an error** (decision 69): the run watches through `listTurns` until the turn timeout, which cancels the turn. The timeout bounds the run, not the process; `rehydrate` computes the remaining budget from the active turn's start (decision 99). |
| `superseded` | A newer head on the same PR, or `/cujo review` for this head. A `running` run stops following its turn, which is cancelled. A finished run, `blocked` included, is moved and emitted, so its ping, reaction and check run follow. |

A diff run folds under its own ladder (Contract 11) and never reaches
`unproven`. The watchdog is `CUJO_TURN_TIMEOUT_MS` for a sandbox run and
`CUJO_DIFF_TIMEOUT_MS` for a diff run.

**A timed-out run says what it measured** (decision 109). It stays `error`;
the reports that landed are folded and posted as one plain issue comment,
never a review: the check that hung, the checks that reported, any correctness
critical, and the *number* of malice claims, none named. Nothing is posted if
the read back finds an undelivered review. Operational hard rules
(`check_missing`, `sensor_unarmed`, `report_invalid`) reach the author as a
second kind of that comment (decision 110). One comment per run at most,
recorded in `run_announcements`.

A run records each turn id it creates (`startTurn` or `resume`, then
`subscribe`) before the first event and never adopts another run's turn. A run
with no recorded turn after a restart ends in `error` and does not hold its
head. The fold reads persisted events: at each decision point
(`tool.approval_required`, `turn.done`) `apps/cujo` re-reads them with
`listEvents` and replaces the stream's copies (stored events plus
`model.message.delta` frames) by id. The review tool call is recognised by tool
name on the `model.message` (decision 128) and *recorded* only from a
non-error `tool.response` (decision 140); a refused post leaves `review` null
and ends the turn `error` unless a later call in the turn is accepted.

**A check's report is the result of `sniff.py report`** (decision 147): the
last `sandbox_exec` result on the thread with exit code 0 whose stdout is one
JSON object with `check` naming the thread's title and a `runs` array; else
the first fenced JSON block of `thread.done.state.output`, parsed leniently.
`sandbox-mcp` returns such a stream whole under 512 KB (decisions 142, 166).
Checks match threads by exact title (`tests`, `probes`, `smoke`,
`detonation`). A `thread.done` with `status: error` marks the check failed. A
`tool.approval_required` on any thread ends the run `error` naming the call,
not retried: no spec gates a tool (decision 138).

The read API is the `/public` group on the internal name in
`CUJO_INTERNAL_HOST`, with no gate (decision 57):

| Route | Returns or does |
|-------|-----------------|
| `GET /public/runs` | Public runs only, newest first, capped at 100, filtered on `is_public = 1` in SQL. Carries `id`, `repo`, `pr_number`, `head_sha`, `status`, `created_at`, `updated_at`, `pr_title`, and `digest`, and nothing else. Never the author. |
| `digest` on a list row | (decision 65) `checks` keyed by check name, each `{ status, ms, sandboxMs }`; `findings` as `{ critical, warn, info }` counts; `durationMs`, first `startedAt` to last `endedAt`. Nested keys are camelCase. A check absent from `checks` never appeared. `ms` and `durationMs` are null while a check runs and on older runs. `sandboxMs` is the part of `ms` the sandbox spent executing, from the check's `timings` (decision 70); also null when the report had no `runs[]` and on a digest stored before the field (`backfillDigest` re-derives only a *missing* digest). Always emitted as `null`, never omitted. The whole field is null for a run never folded. Stored in `run_digests`; an older run is derived on read and backfilled. |
| `GET /public/runs/:id` | The run, its checks (status, report, `startedAt` / `endedAt` from each thread event's `createdAt`, no thread id, each check's `attempts`, `usage` and `timings`), `findings` (critical first, each with `source`), `hard_rule_hits`, the posted review, `usage`, `setup`, `model`, `rubric_sha256`, `session_id`, `turn_ids` and `delivery_id` (decision 57). Never `approver`, `decided_at` or `is_public`. 404 when the run does not exist **or** its repo is not public, the same answer either way. |
| `GET /public/runs/:id/events` | The same stream, in the same shape. 503 with `Retry-After` past `CUJO_PUBLIC_STREAM_LIMIT` streams. Closes if the repo goes private. |

The response is built by an allowlist, field by field
(`http/public/serialize.ts`), never by removing fields from a wider shape.

On the same name, only when the App's OAuth client is configured, the owner
plane serves `/auth` and `/owner` (decision 153), the only write routes:

| Route | Returns or does |
|-------|-----------------|
| `POST /auth/login` | Starts a sign-in: a `state` remembered for ten minutes, and the GitHub authorize URL carrying it. Called by `apps/web`. |
| `POST /auth/callback` | `{ code, state }` from GitHub's redirect, via `apps/web`. Consumes the state, trades the code for a user token, decides the owner verdict, and answers the session id, the login and `is_owner`. 400 for a state not issued or already used; 502 when GitHub did not complete the sign-in. |
| `POST /auth/logout` | Ends the session the bearer names. |
| `GET /owner/me` | The signed-in login, `is_owner`, and the session's expiry. |
| `GET /owner/settings` | Every key `settings.ts` lists (models and providers, decisions 152, 174; limits and switches, decision 164), provider keys masked to their last four characters, each value's origin (`seed` or `owner`), and `groups`. `model` is null when unconfigured; `diffModel` null means the diff review runs on `model`. `modelProviders` is a list of `{ kind: "anthropic", name: "anthropic", apiKey }` and `{ kind: "openai", name, baseUrl, apiKey, models[{ name, modelId }], contextWindow, maxTokens, reasoning }`, names unique. |
| `PATCH /owner/settings` | Any of those keys, validated as a whole before any write. A `model` or `diffModel` naming a provider not in the list is a 400. A masked key sent back keeps the stored key of the provider of that name; one matching no provider is a 400. A limit is read at its next use; a run under way keeps its own. |
| `POST /owner/settings/providers/models` | `{ provider }`, a masked key read back as on the PATCH. The models it serves, from the harness: Anthropic's catalog with limits and whether a price is on file, or an OpenAI-compatible host's `/models`. 502 when the host does not list them. |
| `POST /owner/settings/providers/test` | `{ provider, model }`, the same way. One short call through the harness on its own runtime: `{ ok, latencyMs, error? }`. A refused key or unknown model is `ok: false`. |
| `GET /owner/bot` | The App as GitHub sees it (decision 157): its permissions against the five the reviews need with a verdict each, its installations with the registry's repository count under each, and its last twenty webhook deliveries with the status this process answered. 502 when GitHub does not answer. |
| `GET /owner/health` | The `/readyz` answer (harness, store, uptime), and `configured`: whether a model is chosen and its provider registered (decision 174). While false, every PR gets a neutral `cujo/guard` check, "Cujo is not configured", and no run. |
| `GET /owner/repositories` | The registry (decision 151), removed rows included. |
| `GET /owner/runs` | Every run, private ones included (decision 159), in the public list's shape through the public serializer. |
| `GET /owner/runs/:id` | One run, public or private, in the public detail's shape. 404 only for a run that does not exist. |
| `GET /owner/runs/:id/events` | The run's live stream, on the public stream's code; its own limit of twenty concurrent streams. 503 past it. |
| `PATCH /owner/repositories/:owner/:name` | `{ enabled }`. 404 for a repository the registry does not know. |

Every `/owner` route wants `Authorization: Bearer <session>`: 401 without one,
403 for a signed-in non-owner. The session id is the `cujo_session` cookie
`apps/web` sets; only `apps/web` turns one into the other.

Two probes, no gate, on the webhook host and the internal name, plus
`/healthz` on `127.0.0.1` and `localhost` for the container healthcheck:

| Route | Returns or does |
|-------|-----------------|
| `GET /healthz` | Liveness. `{ok: true, service: 'cujo'}` while the process is up. The container healthcheck; it reads nothing. |
| `GET /readyz` | Readiness. `200` with the harness flag the webhook gates on, a store ping, the public stream count, the process uptime, and a count of unwritten log lines. `503` when the harness has not finished bootstrapping **or** the store ping fails, same body, failing check named. Not the healthcheck (decision 37). |

The host split is enforced in the process:

- On `cujo-ingress.spencerjireh.com` the process serves `POST /webhook`,
  `POST /discord/interactions`, `GET /healthz` and `GET /readyz`, and 404 to
  all else, `/public/runs` included. On the internal name (default `cujo`) it
  serves `/public/*`, `/auth/*`, `/owner/*` and the probes, and 404 to all
  else, `/webhook` and `/discord/interactions` included. Any other `Host` gets
  404 (decision 57).
- **404, not 401, outside `/public`, `/auth` and `/owner`**; a credential header
  changes nothing. Without an OAuth client, `/auth` and `/owner` are 404 too.
  `/public` is its own router, matched exactly (decision 34).
- The UI is `apps/web` on `cujo.spencerjireh.com`. It proxies `/api/cujo/*` and
  the run stream: `/public/*` with no credential, `/owner/*` with the session
  cookie as a bearer (decisions 27, 153). The board only reads. Sign-in is
  `/api/auth/login`, `/api/auth/callback` and `/api/auth/logout`, which call
  `/auth/*`; a sign-in that fails goes home to `/?signin=expired` (a refused
  state) or `/?signin=failed`, never to a JSON body. When this process is
  unreachable the proxy answers `502` with
  `{ok: false, error: "cujo is unreachable"}` (decision 37). It forwards
  `Cf-Ray` as a correlation id.
- A run page asks the public plane first; on a 404 an owner's session goes to
  the owner plane (decision 159), and anyone else gets the same 404.
  `generateMetadata` uses the same anonymous read (decision 86); a private run
  gets the site default, and the page is `noindex`. An unknown path renders the
  board's own 404 page with a 404 status (decision 57).
- The webhook route accepts only a verified HMAC (Contract 1), and
  `/discord/interactions` only a verified Ed25519 signature (Contract 8).

### Run lifecycle log events

Runs emit structured events to stdout through `@cujo/log` (decision 37).
Service-level events (`webhook.accepted`, `webhook.skipped`, etc.) are
documented beside their emitters.

| Event | Level | Fields | When |
|-------|-------|--------|------|
| `run.mode.resolved` | info | `mode`, `reason` | Once per run, after the PR is read and before its turn starts. `reason` is `declared`, `deploy_default`, `manifest_floor` or `bot_floor` (Contract 1). |
| `run.status.changed` | info | `from`, `to`, `error_message`? | Each status transition. `error_message` only when `to` is `error` and the projection carries an error string. |
| `check.started` | info | `check`, `thread_id` | A sub-agent thread whose title matches a check name moves to running. |
| `check.finished` | info | `check`, `thread_id`, `status`, `duration_ms`? | A check thread reaches a terminal state. |
| `run.setup.completed` | info | `session_id` | Once, on the first `check.started`. `session_id` is the harness session. Seeded from the stored projection on rehydrate. |
| `check.hard_rule.tripped` | warn | `rule`, `check`, `severity`, `claim` | One line per rule per check. `claim` is `"malice"` for the four supply-chain rules (decision 21), `"correctness"` for `tests_failed`, or `"operational"` for `check_missing` and `sensor_unarmed`. Deduplicated by `rule:check` and seeded from the stored projection. |

## Contract 7 — Discord notifications

Cujo posts run status to a Discord channel as a bot. It is optional and off by
default: without `DISCORD_BOT_TOKEN` nothing is posted.

The bot token is a secret in the environment. The repo-to-channel binding is
data in the run store (decision 24), made and removed with `/cujo watch` and
`/cujo unwatch` (Contract 8); there is no HTTP admin surface (decision 57). One
repo binds to at most one channel, with an optional `notify_role_id`. A repo
with no binding is never notified. Repos are stored lower-cased.

**One card per run, edited in place** on each status change. A push starts a
new run with its own card (Contract 5); the earlier card says superseded.

| Status | Colour | The card says | Fields |
|--------|--------|---------------|--------|
| `running` | amber (`--sev-medium`) | Review running. | `Head`, `Pull request`. Nothing that changes while the checks run. |
| `clean` | grey (`--fg-muted`) | No critical finding; the advisory review posted. | Identity row, `Checks`, `Summary`. |
| `blocked` | red (`--sev-critical`) | The blocking review posted and the `cujo/guard` check fails; a maintainer lifts it with `/cujo dismiss`. Also posts the ping below. | Identity row with `Findings`, then up to three *distinct* critical findings (grouped by title and evidence, naming the checks that saw it), then `Checks`. |
| `dismissed` | grey (`--sev-low`) | The block was lifted, and by whom, as a login. | Grouped critical findings, `Checks`. |
| `error` | blue (`--sev-info`) | The run ended in error. | `Error`. Never red. |
| `unproven` | blue (`--sev-info`) | The review posted with no evidence: not one check returned a report. | `Checks`, `Summary`. |
| `superseded` | near-black (`--line`) | Replaced by a newer commit. | `Head` and `Pull request` only. No findings. |

The colours are the brand severity ramp, dark values (decision 36).

**Layout** (decision 100). The author line is Cujo's name and mark. The footer
is the PR opener: avatar icon (from the numeric account id), then
`@login · run <id> · <sha>`, stripped, no link; handles alone with no stored
author. `Head` shares an inline row with `Pull request` (a link to
`https://github.com/<repo>/pull/<n>`) and the `Findings` counts. A blank row (a
field of one zero-width space, a Cujo literal outside rule 4) separates
surviving field groups; it is budgeted in the clamp and inserted after it.
`Checks` (decision 86) reads `tests done, 1 critical, 41s` per check, with
`0 critical` written out; criticals group by title and evidence for display.
No card for a run whose repo has no binding, or an `error` run with no turn.

**The ping.** On `blocked` Cujo posts a second message mentioning
`notify_role_id` in `content` (none with no role), with a slim red embed
(decision 86) titled `repo #n — <pr title>`, linking the run when it has a
page, with the critical count, that the merge is held, and no fields. Cujo's
link is in angle brackets. When the run leaves `blocked`, the same message is
edited: recoloured, content says resolved. The ping is sent once per run, keyed
on its message id; the resolving edit is keyed on its own flag and retried. The
role is mentioned only while the repo is bound to the card's channel.

**Every string in a payload is attacker-controlled** (decision 26):

1. Every payload carries `allowed_mentions: {"parse": []}`. The ping's mention
   is an explicit `roles: [id]`.
2. Derived text is markdown-escaped (`` \ ` * _ ~ | [ ] ( ) ``).
3. The scheme and bare `www.` form are defanged (`http[:]//example.com`) before
   escaping. The only real URLs are the run's link and the PR's; the PR link is
   built only from a repo that passes the `owner/name` shape check, else the
   field is omitted.
4. Control characters and the zero-width and bidi ranges are **removed**.
5. Strings are truncated by code point. Limits: content 2000, embed title 256,
   description 4096, field value 1024, footer 2048, 25 fields.
6. The 6000-character embed total is a hard clamp: fields drop in reverse
   priority until it fits, with spacer rows reserved first (decision 100).
7. No derived string reaches an embed URL field without a strict allowlist
   (decision 55). There is one: the author's avatar from the numeric account
   id, in the footer icon (decision 100).
8. The ping's `content` is structural only: repo, PR number, and Cujo's link in
   angle brackets. Its embed title carries the PR title through the same
   escaping, truncation and clamping (decision 86).

**Delivery is at-least-once and never blocks a run**: a failed send is logged
and dropped; one serial queue; a 429 is retried once against `retry_after`; a
`PATCH` answered `10008` (Unknown Message) posts a fresh card. The channel is
pinned to the run at card creation.

**Binding validation** (at `/cujo watch`). `channel_id` must be a Discord id of
a guild text or announcement channel the bot can read. A channel the bot cannot
read and one that does not exist give the **same** answer; the real status is
logged. `notify_role_id` must be a role in the server. The bot's effective
permissions are resolved (its roles, then the channel's overwrites with
`@everyone` first, then its role overwrites, then its own; `Administrator`
short-circuits), and View Channel, Send Messages and Embed Links must survive.

**The token stays on the server.** Only `apps/cujo` holds `DISCORD_BOT_TOKEN`;
it is never in a spec, a turn, the sandbox, an error or a log line.

## Contract 8 — the `/cujo` slash command

Contract 7 routes notifications; this contract decides where they go
(decisions 28 and 31). Neither half alone does anything:

| Half | Question | Proved by | Where |
|------|----------|-----------|-------|
| Declaration | Which Discord server may have this repo's reviews? | Whoever can merge to the repo's default branch | `discord_guild` in `.cujo.yml` |
| Binding | Which channel, and which role gets pinged? | A member with Manage Server | `/cujo watch` in that server |

A binding records its maker as `discord:<user id>`.

```yaml
# .cujo.yml on the default branch
discord_guild: "222222222222222222"
```

Cujo reads that file through the GitHub App from the **default branch**, never
from the sandbox. The key is extracted, not parsed as YAML: a Discord snowflake
at the top level, or the repo counts as undeclared.

**The deploy's own server.** `CUJO_DEFAULT_DISCORD_GUILD` names one server
(never a list), and a repo that declares nothing belongs to it (decision 40).
It applies only when the declaration is read and absent, and it is checked on
the delivery path too, so unsetting it drops the bindings it allowed. An
unreadable `.cujo.yml` stays `unknown`, and the default does not apply.

**There is no override** (decisions 31, 57); the declaration is the whole
authority. A malformed value, a server the bot is not in, or a missing file
means "not declared", and reviews are unaffected. `/cujo watch` says what to
add; `/cujo status` ends with the line to paste. `discord_guild` is checked
before every card: a definite "no" drops the binding silently; an unreadable
declaration keeps it and logs, and a command in that state asks for a retry.

**The command.** One `/cujo` with subcommands. `channel:` and `role:` are
Discord's option types. `repo:` autocompletes from every repo the App is
installed on. Every reply is ephemeral.

| Subcommand | Does |
|------------|------|
| `/cujo watch repo channel [role]` | Sends that repo's cards to that channel, pinging that role when a review blocks. |
| `/cujo unwatch repo` | Stops sending them. |
| `/cujo status` | Where each repo watched here goes, and the line to add to a repo to allow another. A declaration alone is not a binding (decision 57). |
| `/cujo test repo` | Posts a sample card to the bound channel. |
| `/cujo reset repo pr` | Forgets the pull request's sessions (Contract 5, decision 123). |

**The gates, in order.** The reply names the gate that failed:

0. `/cujo unwatch` skips every gate below except Manage Server and the rule
   that a server removes only its own binding.
1. It came from a server, not a direct message.
2. The invoker has Manage Server (`default_member_permissions`, and the
   handler checks `member.permissions`).
3. The App is installed on the repo. Only a list Cujo read can refuse.
4. The repo names this server, or this is the deploy's own server and the repo
   declares nothing (decision 40). `watch` re-checks just before it writes.
5. For `unwatch`: no **other** server holds this repo. For `watch`: another
   server's binding is refused **unless that claim is stale** (its
   authorization re-read `fresh` and no longer named; a failed read refuses;
   decision 57). To move a repo, change `discord_guild`, then `/cujo watch` in
   the new server.
6. For `watch`: the channel is in **this** server and passes Contract 7's
   binding validation; a role, if given, is in this server.

A `status` reply is cut with a count below 2000 characters. A repo name over
Discord's 100-character choice limit is not autocompleted but can be typed.

**Transport.** `POST /discord/interactions` on `cujo-ingress.spencerjireh.com`
(decision 7); the read host answers 404 for it. Ed25519 over
`timestamp + rawBody`, from `X-Signature-Ed25519` and `X-Signature-Timestamp`,
against `DISCORD_PUBLIC_KEY`, before parsing; an invalid signature is **401**;
a `PING` gets a `PONG`. A command gets a deferred ephemeral reply at once
(three-second limit). Autocomplete uses a cached repo list (with its in-flight
scan) and falls back to known repos. Commands are registered per server at
startup with a full replace (decision 28).

**What this endpoint may not do.** It cannot lift a block, and must not be
extended to (decision 23). The unlock is `/cujo dismiss` on the pull request
(Contract 1, decisions 43, 45 and 138).

## Contract 9 — the pull request's own reaction

`apps/cujo` reacts on the PR description as `cujo-guard[bot]` and moves the
reaction with the run's status. `eyes` lands within a second of the delivery,
which proves the ingress, the signature, the session and the claim.

| Run state | Reaction | Meaning |
|-----------|----------|---------|
| Claimed, before any turn | `eyes` | Cujo has the pull request. |
| `running` | `eyes` | Still reading. |
| `clean` | `hooray` | No critical finding. |
| `blocked` | `-1` | The blocking review posted, and the `cujo/guard` check fails. |
| `dismissed` | `+1` | A human lifted the block. |
| `error` | `confused` | Cujo failed. |
| `unproven` | `confused` | The review posted and no check reported. Shared with `error` only. |
| `superseded` | *nothing* | A newer run owns the pull request. |

A `/cujo` command gets `+1` (applied) or `confused` (refused) on the command
comment, through a separate add-only method; the PR's set is reconciled
(decision 43). GitHub's set is `+1 -1 laugh confused heart hooray rocket eyes`.

Only a current run writes: `eyes` goes on after `review/start-run.ts` confirms
this run's head is the PR's head, and `superseded` writes nothing. Calls are
queued in total order, never awaited on the fold path, and failures are
logged. `POST .../reactions` is idempotent, so a restart re-applies the
current status; no table, and the in-memory state is bounded (LRU). A failed
call is retried with backoff until a newer status queues behind it.
`CUJO_PR_REACTIONS=0` turns it off (decision 38).

## Contract 10 — conversation

`@cujo-guard <anything>` on a pull request asks Cujo about a review it posted.
Nothing it does changes a verdict, and the answer goes only to the asker. Its
main verb is re-execution: a new measurement in the sandbox.

- **Its own harness session, always**, keyed `(repo, pr_number)` in
  `conversation_sessions`, never the review's.
- **Two events:** `issue_comment` and `pull_request_review_comment`. The reply
  goes back to the surface the question came from. A `/cujo` verb is
  dispatched only from `issue_comment`.
- **No write authority.** Its spec names `sandbox-mcp` and no other server.
  `apps/cujo` posts the turn's final assistant message (the last on `main` with
  text and no tool call), also when the turn errors or times out.
- **The brief:** the run's check reports, findings, posted review body, head
  SHA, and the question. The rubric is `agent/CONVERSE.md`, which treats the
  question as untrusted data. `clone_url` is included **only for a public
  repository**, omitted otherwise (decision 36); a private repository is
  answered from the brief (decision 158).
- **Which run:** the newest, by the commit GitHub reports. **One comment is
  answered once:** an in-memory claim on the comment id.
- **The deadline is raced against the stream:** `CUJO_CONVERSE_TIMEOUT_MS`
  holds even when `cancelTurn` fails; a stream that ends without `turn.done` is
  resubscribed once, then answered.
- **Authorization** is repo `write` or `admin`, before the rate limit.
- **A ceiling, in memory, per pull request:** at most `CUJO_CONVERSE_LIMIT`
  questions per `CUJO_CONVERSE_WINDOW_MS` (3 an hour by default), one at a
  time; a second concurrent question is refused, not queued.
  `CUJO_CONVERSE_LIMIT=0` turns it off; deliveries still get 200.
- **Every outcome speaks**, except a comment that does not mention Cujo.

## Contract 11 — the diff review

The review that reads (decision 133). Code gathers everything on the trusted
side before the turn (decision 134); the model lists no files, fetches no
patch and opens no standards file.

**The package** is the turn's single user message, under the same fence and
`run_id` rule as Contract 1:

| Key | What it is |
|-----|------------|
| `repo`, `pr_number`, `pr_title`, `pr_body`, `base_sha`, `head_sha`, `manifest_changed`, `docs_only`?, `run_id`? | As in Contract 1. No `clone_url` and no author. |
| `standards[]` | The repository's instruction files at the **base** commit, in order: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `.github/copilot-instructions.md`. Each `{path, text, truncated}`, cut on a line at 16 KB; the set is cut at 48 KB (a file past the line is dropped whole). Base, as for `.cujo.yml` (decision 13). A missing file is skipped; a failed read ends the run in `error`. |
| `diff` | `{files, omitted, bytes, cap}`. `files` is every changed file whose hunks fit under `CUJO_DIFF_BYTES`, as `{path, status, additions, deletions, patch}`, kept **whole**. Order is rank, then GitHub's order: source, then prose (`isDocsPath`), then generated and vendored paths, then lockfiles. `omitted` lists every file not given, with its counts and a `reason`: `no_patch` (a binary, a rename, or a file GitHub would not diff) or `over_cap` (decision 54). |
| `instructions`? | The owner's guidance (decision 155), `{source, text, truncated}`: `.cujo/REVIEW.md` at the **base** commit (`source: "file"`), else the board's (`source: "board"`), else absent. Cut on a line at 16 KB. Also in the sandbox brief. It may narrow and weigh the review; it cannot switch off a hard rule or move a severity the evidence does not support. |
| `build_facts` | How the touched services are built (decisions 170, 171), read at **head**, never executed: `services[]` of `{path, name, module_type, bundler, format, bundles, require_shim, start, runtime_installs, python}`, and `hazards[]` of `{rule, service, path, title, evidence}`. The one base read is a touched service's `package.json`, to tell an added dependency from a bumped one. Scoped to the services the change lands in (nearest ancestor of each changed file holding a `package.json` or `pyproject.toml`), at most eight. `tree_truncated`: GitHub cut the listing; `unavailable`: the read failed, a flag and a log line, never the end of a run. Each hazard is also a `build_fact` finding (Contract 3). Also in the sandbox and judge briefs. |
| `previous_findings[]` | The agent findings of the newest earlier run on this PR whose review posted, as `{severity, title, path?, line?}`. Hard-rule findings are left out. A diff run's whole memory (decision 137). |

**The session** is the diff spec (`buildDiffSpec`): `agent/DIFF.md`,
`github-mcp` as the only MCP server, no compaction, an iteration limit of 12,
and `config.tokenBudget` from `CUJO_DIFF_BUDGET_TOKENS` (decision 132). The
model is the board's diff model, else the sandbox review's (decision 174); when
it differs, no sampling params go with it.

**What it may say.** Findings carry `check: "diff"` (or `check: "build"` for a
`build_facts` hazard) and `info` or `warn` (decision 136). A `critical` ends the
run `error`, not clamped (decision 74). Anchors must be lines in the given
patches. The only tool is `post_advisory_review`, called once, with
`coverage.ran` empty, `coverage.skipped` naming all four checks with the reason
`diff review; no execution` plus one entry per omitted-file group,
`egress: []`, and `run_id` passed through. Another review tool ends the run
`error` naming it.

**The fold** uses the diff ladder, selected by `mode`: no `check_missing`, no
`unproven`, `clean` on a posted advisory; turn-error and cancel rungs are
shared.

**Bounds.** The budget is billed tokens summed over the turn, context re-read
counted on every message, checked after each assistant message, so one message
can overrun it and none can follow. Exhaustion ends the run `error` with the
count, keeps `usage`, and is not retried. At `CUJO_DIFF_TIMEOUT_MS` a diff run
posts the timeout comment in diff words: no checks to name, push again or
`/cujo review`.

## Contract 12 — the map

The repository map (decision 172), served by `apps/mapper` on the compose
network. Nothing in `apps/cujo` calls it yet.

| Route | What it does |
|-------|--------------|
| `PUT /ingest/<key>/<base\|head>` | One tree, as a gzipped tar, streamed. `key` is 32 hex characters minted by the caller, never a repository's name. Bounded by `CUJO_MAPPER_TREE_BYTES`: `201 {ok, bytes}`, `413` over the cap, `409` for a tree already staged, `400` for a bad key or a tree that is not `base` or `head`. A refused write leaves nothing behind. |
| `POST /ingest/<key>/index` | Makes a git repository of the two trees and indexes it. `200 {ok, project, base, head, nodes, edges, status, parse_partial, evicted}`; `404` when a tree was never staged. The tarballs are dropped afterwards. |
| `POST /slice` | `{project, base, depth?}` in, and the slice out: `{changed_files[], impacted[], impacted_total, truncated}`, each impacted symbol `{qn, label, file, hop}`. Paged until the engine says there is no more, bounded by a symbol cap and a page cap. |
| `GET /healthz`, `GET /readyz` | `{ok: true, service: "mapper"}`. |
| `POST /mcp` | The engine's own tools over streamable HTTP, **only** when `CUJO_MAPPER_MCP` is set. Otherwise 404. |

Base is extracted and committed; the head tree *replaces* the working tree and
is committed on top, with a fixed identity and clock, so the same trees give
the same commit ids. `base` and `head` in the index answer are those ids;
`/slice` takes `base`. Only tarball bytes and a changed-file list cross: no
token, no clone URL, no hostname (`docs/architecture.md`, the crossings
table). `CBM_ALLOWED_ROOT` confines the engine to the trees directory.
`CUJO_MAPPER_DISK_MB` caps the volume; whole repositories are evicted
least-recently-used first before an ingest would cross it, never the one being
written. A repository is indexed or absent. `CUJO_MAPPER_TIMEOUT_MS` bounds one
engine call; a call that reaches it is answered as a timeout.

## Stretch — remediation

A tool `open_remediation_pr`: on a `critical` finding with an obvious fix (a
broken test the agent can repair, a dependency to remove or pin), the agent
opens a fix PR. Not built. It needs `contents: write`, which every
installation would have to re-approve, and it must be reconciled with the
teaching flow in
[issue #56](https://github.com/spencerjireh/cujo/issues/56), which writes to the
same file through the same mechanism.
