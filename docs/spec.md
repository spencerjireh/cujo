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
- Remediation (a fix PR on `critical`) is a stretch, not a requirement.

## Contract 1 — the trigger

The Cujo GitHub App subscribes to `pull_request` events (`opened`,
`synchronize`). For each event the ingress service:

1. Verifies the `X-Hub-Signature-256` HMAC against the webhook secret. Rejects
   anything unsigned or mismatched.
2. Reads the PR metadata and the changed-file list with the App installation
   token (Contents: read, Pull requests: read).
3. Finds or creates the TrueForge session for this PR (see Contract 5) and
   starts one turn with a single user message: repo full name, PR number, base
   SHA, head SHA, and the changed-file list.

Ingress does not decide what to check. That is the agent's job.

## Contract 2 — the sandbox run

One Daytona sandbox per turn. The parent agent sets it up, delegates each
check to a subagent, and collects one JSON report per check. Only those reports
cross back out of the sandbox.

### Setup

1. Clone the repo at the head SHA; add a worktree at the base SHA. Both live
   in the same sandbox so the comparison is like-for-like.
2. Seed the decoy secret: a fake credential file (`~/.aws/credentials` with a
   bogus key) placed before anything runs.
3. Start the in-sandbox logging proxy and export `HTTP(S)_PROXY` so every
   process the checks spawn routes through it.
4. Read `.cujo.yml` if present. Schema:

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
    { "host": "pypi.org", "port": 443, "bytes": 3200 },
    { "host": "files.pythonhosted.org", "port": 443, "bytes": 1048576 }
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
  every process that honours `HTTP(S)_PROXY`. Gives the `egress` list. Payload
  contents stay encrypted until TLS interception is added.
- **Filesystem diff.** A snapshot before and after each check flags anything
  created or modified outside the workspace and its install environment
  (`in_workspace: false`), and anything under a sensitive path (`~/.ssh`, a
  shell rc, cron, a credentials path) as `wrote_sensitive`.
- **Decoy access time.** The decoy file's access and modification times are
  read before and after each check; a changed access time sets `decoy_read`.
  This works for any language.
- **Python audit hook.** When a check runs Python, a `sitecustomize.py` on
  `PYTHONPATH` calls `sys.addaudithook` and records `open`, `socket.connect`,
  and `subprocess`/`os.exec` events. It rides into every Python subprocess
  (including pip running `setup.py`), so it gives the richer `files_read` and
  `subprocesses` lists and a second, independent source for `decoy_read`.

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
  "line": 42
}
```

`severity` is one of `info`, `warn`, `critical`. `path` and `line` are
optional and anchor the finding as an inline comment.

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
egress observed. Each entry in `comments[]` is one finding with a `path` and
`line`, posted as an inline review comment on that line. Findings with no
anchor appear in the body only.

Advisory results post as a COMMENT review, not an APPROVE: the bot never formally
approves, so it can never satisfy branch protection and wave a bad merge through.
(Posting a formal APPROVE on a clean run for a green check is a later option if
we want the nicer UX.)

The gate is the harness's `require_approval_for_tools` on `post_blocking_review`
(and the tool is annotated `@destructive`). When any finding is `critical` the
agent calls that tool; the turn pauses with a `tool.approval_required` event;
the paused session appears in the TrueForge UI; a human reviews the findings
and the evidence and clicks Allow; only then does the blocking review post as
`cujo-guard[bot]`.

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
- The idempotency check lives in **ingress**, not the agent or `github-mcp`.
  Before starting a turn, ingress lists the PR's existing reviews with the
  installation token and skips the turn if `cujo-guard[bot]` has already
  reviewed the current head SHA. So a retried webhook or a re-run never
  produces a duplicate review, and `github-mcp` stays write-only (it posts; it
  does not read PR state).

## Stretch — remediation

If hackathon time allows, add a third gated tool `open_remediation_pr`: on a
`critical` finding with an obvious fix (a broken test the agent can repair, a
dependency to remove or pin), the agent opens a fix PR. The human approves
opening it. This turns Cujo from a reviewer into a gatekeeper that also proposes
the fix — a stronger demonstration of an agent taking a real, sensitive action
under human oversight.
