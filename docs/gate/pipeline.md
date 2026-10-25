# The pipeline

A pull request is two trees and a diff. The gate runs plugins against the
trees, keeps only what the pull request introduced, applies one policy, and
emits one verdict bound to the head commit. No model decides what runs, and
no model decides what blocks.

```
snapshot(base, head) -> plan -> run -> fold -> policy -> emit
```

## Snapshot

The input is fixed before anything runs: the repository, the base and head
SHAs, the list of changed files, and the gate's configuration as it stands
**at base**. The pull request cannot change the configuration it is judged
by ([trust.md](trust.md)). The snapshot also records the sandbox image
digest, because a verdict is a function of what ran it ([verdict.md](verdict.md)).

## Plan

The plan is a deterministic function of three things: the plugin manifests
the instance knows, the configuration at base, and the changed files. A
plugin runs when its manifest's file globs match a changed file and the
configuration does not turn it off. The plan names the plugins, their
versions, the trees each needs, and a timeout each. There is no model in
this stage; the same snapshot always yields the same plan.

## Run

Each plugin receives one JSON document on stdin and writes one on stdout
([plugins.md](plugins.md)). A plugin that needs a tree gets a checkout of it; a
plugin that needs the sandbox runs inside it, with no credentials and no path
back. Plugins run in parallel where their needs allow. A plugin that exceeds
its timeout, its output cap, or the schema is recorded with that status; its
findings, if any, are dropped. A plugin never talks to another plugin.

## Fold

The fold is baseline-relative. A plugin that ran on both trees reports
findings on each; a head finding with a matching base finding (same rule,
same path, same fingerprint) was already there and is dropped. What remains
is what the pull request introduced. `contracts/plugin-output.example.json`
is such a pair: two `lint.unused_import` findings share a fingerprint and the
head one folds away; the `lint.unused_variable` finding is head-only and
survives.

The fold also derives each finding's coverage class from its evidence:
`proven` when something ran, `judged` when something was only read,
`needs_human` when there is no evidence at all ([verdict.md](verdict.md)).

## Policy

One function reads the folded findings, their coverage, and the policy at
base, and returns a status: `pass`, `fail` or `indeterminate`
([policy.md](policy.md)). A finding blocks only with executed evidence, unless
the repository opted in at base to let a `judge` block. A plugin that did not
finish makes the verdict `indeterminate`, which concludes the check as a
failure. Nothing else in the pipeline decides.

## Emit

The verdict is written once and copied to each outlet:

- the `cujo/guard` check run: conclusion, a one-line summary on a pass, the
  findings and annotations on a fail, and the verdict JSON for an agent that
  fixes until green;
- one review comment, rendered from the verdict, for a person;
- a signed statement about the verdict, for whoever needs to show later that
  this head was gated and by what ([verdict.md](verdict.md)).

A newer head gets a new verdict. A verdict is never edited.

## Where today's code lands

| Today | In the gate |
|---|---|
| `review/execute.ts` running declared commands (decision 161) | the `tests` exec plugin |
| the diff reviewer and `agent/DIFF.md` (decision 133) | the `judge` plugin |
| the hard rules in `review/findings.ts` (decision 21) | rule codes in the policy |
| `sniff.py` sensors (decoy, egress, fs diff) | `sensor` evidence from exec plugins |
| `review/mode.ts` floors (decision 135) | the plan |
| `notify/checks.service.ts` | the check-run outlet of emit |
| the gather path, probes and check sub-agents | nothing; they are replaced |

Each row lands in its own pull request with its own decision, and the
replaced path is deleted then (decision 180).
