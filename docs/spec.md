# Spec and contracts

This is the doc the code follows. It defines what Cujo acts on, the data that
moves between its parts, and the rules that turn an observation into a verdict
and an action.

## Scope

- **Ecosystem:** PyPI only. Dependencies declared in `requirements.txt`.
- **Trigger:** a dependency a pull request *adds or version-changes*. Cujo
  evaluates the specifiers a PR introduces or bumps, not the whole existing set.
  A version bump gets a run because a compromised release is a real supply-chain
  attack, and the new version runs new install code.
- **Sources:** a normal pinned PyPI release (`humanize==4.9.0`) or a direct
  reference (`git+https://…`). The `git+https` form is how the hostile demo is
  delivered without publishing anything to PyPI.

## Division of labor: code senses, the agent judges

The split between deterministic code and agent reasoning is fixed:

- **Code senses.** `sniff.py` produces raw, factual signals — which hosts were
  contacted, which files were read, what ran, what was written outside the venv.
  No judgment.
- **The agent judges.** It reasons over those signals against the rubric to pick
  a verdict and write the review.
- **A hard rule overrides the agent on the dangerous case.** If a critical
  signal is present (the decoy secret was read, or later seen leaving; or a write
  landed in a sensitive path), the verdict is `denied` and the agent cannot
  downgrade it. The model reasons about the ambiguous cases; it cannot reason
  away a confirmed exfiltration.

## Non-goals (for this milestone)

- Other ecosystems (npm, Cargo, system packages).
- Runtime behavior after install — Cujo observes the **install**, which is where
  supply-chain payloads fire.
- Private repos, self-hosted Daytona, and fanning a many-dependency PR across
  subagents. Single-dependency path first.

## Contract 1 — the trigger

The Cujo GitHub App subscribes to `pull_request` events (`opened`,
`synchronize`). For each event the ingress service:

1. Verifies the `X-Hub-Signature-256` HMAC against the webhook secret. Rejects
   anything unsigned or mismatched.
2. Reads `requirements.txt` at the base and head SHAs (App installation token,
   Contents: read).
3. Diffs them to the specifiers that are **added or version-changed** (a new
   package name, or an existing one whose pin moved). Comments, blank lines, and
   unchanged pins are ignored.
4. If the set is non-empty, starts one TrueForge agent session named `cujo`,
   passing a single user message with: repo full name, PR number, head SHA, and
   the list of specifiers to detonate.

If the set is empty, ingress does nothing.

## Contract 2 — the `sniff.py` report

`sniff.py` runs inside the sandbox, takes one dependency specifier, and prints a
single JSON object to stdout. This is the only thing that crosses back out of
the sandbox. Schema:

```json
{
  "dependency": "humanize==4.9.0",
  "source": "pypi",
  "install_ok": true,
  "duration_s": 11.4,
  "egress": [
    { "host": "pypi.org", "port": 443, "bytes": 3200, "note": "index metadata" },
    { "host": "files.pythonhosted.org", "port": 443, "bytes": 1048576, "note": "wheel" }
  ],
  "files_read": [
    { "path": "~/.venv/pyvenv.cfg", "sensitive": false }
  ],
  "fs_changes": [
    { "path": "~/.venv/lib/python3.12/site-packages/humanize", "type": "created", "in_venv": true }
  ],
  "subprocesses": [
    { "argv": ["pip", "install", "humanize==4.9.0"], "exit": 0 }
  ],
  "secret_probe": {
    "decoy_read": false,
    "decoy_in_egress": false
  },
  "derived": {
    "egress_to_non_index": false,
    "wrote_outside_venv": false,
    "wrote_sensitive": false,
    "spawned_subprocess": false
  },
  "stdout_tail": "Successfully installed humanize-4.9.0"
}
```

How the observations are produced (three sensors, layered):

- **Python audit hook (primary).** A small `sitecustomize.py` is placed on
  `PYTHONPATH` before the install runs. It calls `sys.addaudithook` and records
  three event families: `open` (every file read — this is how `decoy_read` is
  caught), `socket.connect` (every outbound target), and `subprocess`/`os.exec`
  (every process spawned). pip runs `setup.py` in a Python subprocess, and the
  hook rides along via `PYTHONPATH`, so it observes whatever the payload does in
  Python — where supply-chain payloads live. No `strace`, no special container
  capability, no traffic decryption needed.
- **In-sandbox logging proxy.** `HTTP(S)_PROXY` and `pip --proxy` route the
  install through a proxy that records each host, port, and byte count. This
  gives hostnames and volume for the `egress` list. (Payload contents stay
  encrypted until TLS interception is added later; see the egress-depth
  decision.)
- **Filesystem diff (backstop).** A snapshot before and after flags anything
  created or modified outside the install venv (`in_venv: false`).

The decoy is a fake secret file seeded before install (`~/.aws/credentials` with
a bogus key). `decoy_read` comes from the audit hook seeing it opened.
`decoy_in_egress` stays `false` until TLS interception can confirm the value left
the box.

The `derived` block holds the booleans the rubric reads, computed from the raw
observations above.

## Contract 3 — the verdict rubric

A report maps to exactly one verdict: `cleared`, `warn`, or `denied`. Two layers
decide it, in order.

**Layer 1 — the hard override (deterministic, code).** If any critical signal is
present, the verdict is `denied` and the agent cannot change it:

- `secret_probe.decoy_read` or `secret_probe.decoy_in_egress` — the install read
  or leaked the seeded secret.
- `derived.wrote_sensitive` — a write landed in `~/.ssh`, a shell rc, cron, or a
  credentials path.

**Layer 2 — the agent judges the rest** against this rubric, carried as its
instructions (the `SKILL.md`):

- **`cleared`** — install succeeded; egress only to the package index
  (`pypi.org`, `files.pythonhosted.org`); nothing written outside the venv; no
  unexpected subprocess. A normal package.
- **`warn`** — nothing clearly malicious, but worth a human glance: a call to an
  unfamiliar but plausibly benign host, a cache write outside the venv, or an
  unexpected subprocess. Advisory, not blocking.
- **`denied`** — a suspicious combination the agent judges to cross the line even
  without a Layer 1 signal (for example, egress to a non-index host during
  install paired with a subprocess spawn).

Layer 1 protects the case that must never be reasoned away; Layer 2 is where the
agent's judgment does real work.

## Contract 4 — reviews and the approval model

Reviews mostly post automatically — that is the product's value. A human is
pulled in only for the consequential action. Two tool paths on `github-mcp`:

| Tool | Verdict | GitHub review | Gated? |
|------|---------|---------------|--------|
| `post_advisory_review` | `cleared` | COMMENT | No — posts automatically |
| `post_advisory_review` | `warn` | COMMENT | No — posts automatically |
| `post_blocking_review` | `denied` | REQUEST_CHANGES (blocks merge) | **Yes** — pauses for human approval |

Advisory results post as a COMMENT review, not an APPROVE: the bot never formally
approves, so it can never satisfy branch protection and wave a bad merge through.
(Posting a formal APPROVE on `cleared` for a green check is a later option if we
want the nicer UX.)

The gate is the harness's `require_approval_for_tools` on `post_blocking_review`
(and the tool is annotated `@destructive`). On a `denied` verdict the agent
calls that tool; the turn pauses with a `tool.approval_required` event; the
paused session appears in the TrueForge UI; a human reviews the forensic report
and clicks Allow; only then does the blocking review post as `cujo-guard[bot]`.

The review body carries the verdict, the signals behind it, and a link to the
evidence, so the human confirms a judgment rather than reconstructing it.

A REQUEST_CHANGES review only *blocks* a merge when the target repo's default
branch has branch protection requiring PR review. Without it, the review still
posts and shows as changes-requested, but does not gate the merge. So `orders-api`
needs branch protection enabled on `main` for the block to bite (a setup step on
that repo, done later).

## Contract 5 — one session per PR, no double-posting

- A PR maps to one Cujo session, keyed by repo and PR number.
- On `synchronize` (new commits), the session runs a fresh turn against the new
  head SHA rather than opening a new session.
- The idempotency check lives in **ingress**, not the agent or `github-mcp`.
  Before starting a session, ingress lists the PR's existing reviews with the
  installation token and drops any specifier already reviewed at the current head
  SHA. So a retried webhook or a re-run never produces a duplicate review, and
  `github-mcp` stays write-only (it posts; it does not read PR state).

## Stretch — remediation

If hackathon time allows, add a third gated tool `open_remediation_pr`: on
`denied`, the agent opens a fix PR that removes or pins the offending dependency.
The human approves opening it. This turns Cujo from a reviewer into a
gatekeeper that also proposes the fix — a stronger demonstration of an agent
taking a real, sensitive action under human oversight.
