# The verdict

The verdict is the gate's one output. It says whether the head passes, what
was found, how much of it was proven, and exactly what it is a function of.
`Verdict` in `packages/gate-contract` types it;
`contracts/verdict.example.json` is a complete one.

## Three statuses

| Status | Meaning | Check conclusion |
|---|---|---|
| `pass` | every plugin finished and nothing blocks | `success` |
| `fail` | at least one finding blocks | `failure` |
| `indeterminate` | a plugin did not finish, or nothing could be shown | `failure` |

`indeterminate` concludes as a failure on purpose: a required check that
GitHub counts as passed when the gate could not run is not a gate. A human
with write access dismisses it ([trust.md](trust.md)). A superseded head has
no verdict; its check is `skipped`, as today.

## Findings and evidence

A finding is a rule code, a severity, a title, an optional message and
location, and its evidence. Evidence is typed:

| Kind | Fields | Came from |
|---|---|---|
| `test` | tree, command, exit, excerpt, baseline exit | running a command |
| `counterexample` | property, input, output | a property-based test |
| `mutant` | path, line, mutation, `survived: true` | mutation testing |
| `proof` | goal, prover, `failed` or `unproven` | a verifier |
| `sensor` | sensor, observation, tree | a tool or an in-sandbox sensor |
| `reading` | excerpt, rationale | a model, or a person |

The first five are **executed** evidence: something ran and this is what it
printed. `reading` is not. The distinction is the whole policy
([policy.md](policy.md)).

## Coverage

Each finding has a coverage class the fold derives from its evidence, never
from the plugin's say-so:

- `proven` — at least one piece of executed evidence;
- `judged` — only `reading`;
- `needs_human` — no evidence; a caveat, such as a sensor that did not arm.

The verdict carries the counts and, per plugin, the status and duration. Its
`coverage.class` is the worst class among the blocking findings; with none,
`proven` if every plugin finished, else `needs_human`. A reader sees in one
field how much of the verdict was shown rather than said.

## Binding

A verdict is a pure function of its binding, and the binding is in it:

```
repo, baseSha, headSha, prNumber
plugins[]           id and version of every plugin that ran
configDigest        sha256 of .cujo.yml at base (of "" when absent)
sandboxImageDigest  sha256 of the image the exec plugins ran in, or null
gateVersion         the gate's own version
```

Two runs with the same binding should produce the same verdict; a different
verdict is a flake, and the binding is how one shows it. A new push is a new
`headSha` and a new verdict. A verdict is never edited after it is emitted;
a dismissal is a separate record (`by`, `at`, the verdict's digest) and not a
status.

## Attestation

The gate signs each verdict as an in-toto Statement (v1) inside a DSSE
envelope, the format supply-chain tooling already verifies:

```
_type          https://in-toto.io/Statement/v1
subject        [{ name: repo, digest: { gitCommit: headSha } }]
predicateType  https://cujo.dev/gate/verdict/v1
predicate      { verdict, evidence: { kind: "re-executed" }, signer: { keyid } }
```

`evidence.kind` is always `re-executed`: the gate ran the checks itself and
attests nothing a pull request reported about itself. The key is an ed25519
key the instance holds (`CUJO_GATE_SIGNING_KEY`, in the deploy's environment);
its public half is published with the instance. The key never enters the
sandbox and never leaves `apps/cujo` ([trust.md](trust.md)).

## Output

The check run's summary is one line on a `pass`. On a `fail` or
`indeterminate` it carries the findings, up to 50 line annotations per API
call, and the verdict JSON, so an agent that fixes until green reads rule
codes and locations rather than prose. The review comment is rendered from
the same verdict for a person: a headline, what blocks and why, what was
only judged, and what nobody checked.

## Today's shapes, mapped

Today's `Finding` (`apps/cujo/src/review/types.ts`) becomes a verdict finding
as follows. `source` disappears: it is the plugin id plus the evidence kind.

| Today | Verdict |
|---|---|
| `check` | `pluginId` (`diff` -> `judge`, build facts -> `build-facts`) |
| `severity`, `title` | the same words |
| `evidence` (a string) | one `test`, `sensor` or `reading` entry |
| `path`, `line`, `side` (`LEFT`/`RIGHT`) | `location` with `side` `base`/`head` |
| `rule` (a `HardRule`) | a rule code, below |

| Hard rule today | Rule code | Evidence | Effect |
|---|---|---|---|
| `tests_failed` | `tests.base_pass_head_fail` | `test` | blocks |
| `decoy_read` | `sensors.decoy_read` | `sensor` | blocks |
| `decoy_in_egress` | `sensors.decoy_in_egress` | `sensor` | blocks |
| `wrote_sensitive` | `sensors.wrote_sensitive` | `sensor` | blocks |
| `egress_to_unknown_host` | `detonation.egress_to_unknown_host` | `sensor` | blocks |
| `sensor_unarmed` | `sensors.unarmed` | none | `warn`, coverage caveat |
| `check_missing` | `gate.plugin_missing` | — | plugin status; verdict `indeterminate` |
| `report_invalid` | `gate.output_invalid` | — | plugin status; verdict `indeterminate` |
| an agent finding | `judge.<slug>` or `judge.observation` | `reading` | advisory unless opted in |
| `esm_bundle_without_require_shim` | `build-facts.esm_bundle_without_require_shim` | `reading` | `warn` |

Today's run statuses map as `clean` -> `pass`, `blocked` -> `fail`,
`unproven` and `error` -> `indeterminate`. `running` and `superseded` have no
verdict. `dismissed` is not a status but a record beside the verdict.
