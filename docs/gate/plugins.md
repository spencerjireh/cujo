# Plugins

Every check the gate runs is a plugin, and every plugin speaks one contract:
a manifest that says what it is, one JSON document in, one JSON document
out. The shapes are `PluginManifest`, `PluginInput` and `PluginOutput` in
`packages/gate-contract`; `contracts/plugin-output.example.json` is a
complete output.

## Four kinds

| Kind | What it does | Evidence it may report |
|---|---|---|
| `static` | runs a tool over a tree without executing the code | `sensor` |
| `exec` | executes something in the sandbox: tests, a boot, an install | `test`, `mutant`, `counterexample`, `sensor` |
| `proof` | runs a verifier the repository already uses | `proof` |
| `judge` | a model reads the diff and the trees | `reading` |

The kind is a claim about evidence. A `judge` that reports a `test` is
invalid output. Only executed evidence can block ([policy.md](policy.md)), so
a `judge` is advisory unless the repository says otherwise.

## Manifest

```
id             lowercase, <= 40 chars; the prefix of every rule code
version        semver
kind           static | exec | proof | judge
description    one sentence
rules[]        code, title, defaultSeverity, evidence: executed | reading
needs          trees: [base|head], sandbox: bool, network: bool (default false)
timeoutMs      <= 1 hour
settingsSchema optional JSON schema for the plugin's section of .cujo.yml
```

Every rule a plugin can emit is in its manifest, and every code starts with
the plugin's id. A rule code is stable: it is what an agent matches on to
fix a finding, and what a baseline matches on across pushes. Renaming one is
a new rule.

## Invocation

The gate starts the plugin, writes `PluginInput` to stdin, closes it, and
reads stdout until the process ends or the timeout fires. The exit code is
ignored; the document is the result. Stderr is kept as a log and never
parsed.

A plugin that needs a tree finds it checked out at `snapshot.trees.base` or
`.head`. A plugin that needs the sandbox runs inside it, as `sniff.py` does
today, and sees nothing but the trees, the sandbox's own tools, and what
`.cujo.yml` at base allows out ([trust.md](trust.md)).

## Input

```
schemaVersion  1
plugin         { id, version }         what the gate thinks it started
snapshot       repo, baseSha, headSha, prNumber?, changedFiles[], trees
settings       the plugin's section of .cujo.yml at base, as parsed
limits         timeoutMs, maxFindings (default 500), maxOutputBytes
```

`changedFiles[]` carries path, status (`added`, `modified`, `removed`,
`renamed`) and the line counts. A plugin that wants the diff itself reads it
from the two trees.

## Output

```
schemaVersion  1
plugin         { id, version }         must equal the input's
status         ok | error | timeout | skipped
findings[]     <= 500; each on one tree
coverage       { note } optional: what this run could not see
error          required unless status is ok (or skipped with a note)
durationMs     optional
```

A finding carries `rule`, `severity` (`info`, `warn`, `critical`), `title`,
an optional `message` and `location` (path, line, endLine, side), up to 20
pieces of `evidence`, the `tree` it was found on, and an optional
`fingerprint`. The fingerprint is SARIF's partial fingerprint: a string that
identifies the finding across the base and head trees so the fold can match
them. Without one, the fold matches on rule and path alone.

Evidence is typed by kind ([verdict.md](verdict.md)). A finding with no
evidence is allowed; it is a caveat about coverage, and it never blocks.

## Adapters

Two existing formats are accepted as output and translated by the gate, so a
linter or verifier that already speaks one of them plugs in unchanged:

| Format | Mapping |
|---|---|
| SARIF 2.1 | `ruleId` -> `rule` (prefixed with the plugin id), `level` -> `severity` (`error` -> `critical`, `warning` -> `warn`, `note` -> `info`), `locations[0]` -> `location`, `partialFingerprints` -> `fingerprint`, the message -> a `sensor` observation |
| reviewdog rdjson | `code.value` -> `rule`, `severity` -> `severity`, `location` -> `location`, the message -> a `sensor` observation |

An adapted finding has `sensor` evidence naming the tool. A manifest says
which format its plugin writes.

## Limits and breaches

| Breach | Plugin status | Verdict |
|---|---|---|
| no output before `timeoutMs` | `timeout` | `indeterminate` |
| stdout over `maxOutputBytes` | `error` (`gate.output_invalid`) | `indeterminate` |
| output fails the schema | `error` (`gate.output_invalid`) | `indeterminate` |
| planned but never started | `error` (`gate.plugin_missing`) | `indeterminate` |
| more than `maxFindings` | first `maxFindings` kept, a coverage note added | unchanged |

A plugin that does not finish is not a plugin that passed. The verdict says
so, the check fails closed, and a human decides ([policy.md](policy.md)).
