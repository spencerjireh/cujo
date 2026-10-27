# Policy

One function decides the status of a verdict. It reads the folded findings,
their coverage classes, and the policy section of `.cujo.yml` at base. It
lives in one file. Nothing else in the gate, and no plugin, decides whether
a pull request is blocked.

## The one rule

**A finding blocks only with executed evidence.** A failing test, a
counterexample, a surviving mutant, a failed proof, a sensor observation:
something ran, and this is what it printed. A finding whose only evidence is
a `reading` is advisory. A finding with no evidence is a caveat about what
the run could not see, and it never blocks.

This is the difference between the gate and a reviewer. A reviewer has an
opinion about the code; the gate has a record of what the code did.

## Indeterminate fails closed

A plugin that timed out, exceeded its caps, wrote invalid output, or never
started makes the verdict `indeterminate`, and the check concludes
`failure`. Today's `unproven` and `error` runs already do (decision 182):
a `neutral` conclusion counts as passing a required check, so the gate would
have passed every head it could not check. A human dismisses an
`indeterminate` verdict with `/cujo dismiss` or pushes again; the gate never
passes a head it did not check.

## What a repository can change

In `.cujo.yml` at base, under `gate:`:

```yaml
gate:
  judge_blocks: false   # a judge finding at or above the floor may block
  block_at: critical    # the severity floor for a block: warn | critical
  plugins:
    mutation: { enabled: false }
    tests: { command: "uv run pytest -q" }
```

- `judge_blocks` (default `false`) lets `judged` findings block. The verdict
  records that choice in `policy.llmBlocks` and `policy.source: base`, so a
  reader knows a block was a model's call and the repository asked for it.
- `block_at` (default `critical`) is the floor. A `proven` finding at or above
  it blocks; below it, it is reported and does not.
- Each plugin has its own section; its manifest's `settingsSchema` validates
  it.

What a repository cannot change: it cannot make a `proven` finding at the
floor advisory, cannot turn off the plugins the instance marks as required,
and cannot change any of this from the head.

## Today's hard rules

The hard rules (decisions 9, 21) are rule codes whose evidence is executed
and whose severity is `critical`, so they block under the default policy
exactly as they do today:

| Rule code | Blocks because |
|---|---|
| `tests.base_pass_head_fail` | a test passed on base and failed on head |
| `sensors.decoy_read` | the decoy secret was read |
| `sensors.decoy_in_egress` | the decoy secret left the sandbox |
| `sensors.wrote_sensitive` | a sensitive path was written |
| `detonation.egress_to_unknown_host` | an install reached a host not allowed |

The difference from today is where they live: in the policy's table, not in
a rubric and again in `review/findings.ts`.

## Weakening is a finding

An author who cannot change the gate can still change what the gate runs.
Three deterministic plugins watch for that, each `proven` by construction:

| Rule code | Observation |
|---|---|
| `tests.weakened` | a test file deleted, a test or assertion removed, a skip or expected-failure marker added, a snapshot rewritten, CI configuration changed |
| `spec.weakened` | a `sorry`, `admit`, `assume`, `axiom` or `external_body` added, a postcondition weaker than on base, an unwind bound raised |
| `mutation.survived` | a mutant of a changed line that no test kills |

These default to `warn`; a repository raises them to `critical` at base.

## Coverage caveats are always shown

A caveat such as `sensors.unarmed` never blocks and is never hidden. The
verdict's `coverage.class` and counts put it in the first line a reader sees,
so a pass that proved little reads as exactly that.
