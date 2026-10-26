# Trust

The gate keeps the boundary Cujo already has (decision 32): a trusted side
that holds every credential, and a disposable sandbox that holds the pull
request's code and nothing else. What changes is who is assumed to be on the
other side of the pull request. In a software factory the author is an
agent, and an agent that can change what the gate checks, or read what the
gate holds back, will do so when it is the shortest path to green.

## What crosses

| Plugin kind | Into the sandbox | Out |
|---|---|---|
| `static` | nothing; runs on a checkout on the trusted side | `PluginOutput` |
| `exec` | the two trees, the plugin, `.cujo.yml`'s allowlist, the holdouts | `PluginOutput` |
| `proof` | the two trees and the plugin | `PluginOutput` |
| `judge` | nothing; the model reads on the trusted side | `PluginOutput` |

As today: no token, key, clone credential or hostname enters the sandbox,
and only JSON comes out. A `PluginOutput` is parsed with a strict schema and
nothing in it is executed or rendered as markup. The gate's signing key is
held by `apps/cujo` alone and is used after the fold, never near a plugin.

## Configuration is read at base

`.cujo.yml`, the plugin settings in it, and the policy are read from the
**base** commit, never from the head. `review/policy.ts` already does this
for the declared commands (decisions 13, 135, 161). The gate extends the rule
to everything that decides what runs and what blocks. A pull request cannot
turn off a plugin, lower a severity floor, allow a host, or opt itself into
anything. A change to `.cujo.yml` is reviewed under the old `.cujo.yml` and
takes effect for the next pull request.

A change to the tests, the assertions, a skip marker, a snapshot, a spec, or
the CI configuration is itself a finding: the pull request changed what
would have caught it. These plugins are deterministic and cost no tokens
([policy.md](policy.md)).

## Holdouts

A holdout is a check the author cannot see: a test file laid over the head
tree and run with the repository's declared command, or a scenario command
with an expected result. The owner stores them on the trusted side, through
the board, never in the repository. The gate copies them into the sandbox
for the run, and the pull request learns only the holdout's name and that it
failed. Its source, its assertion text and its full output appear only on
the owner's run page. An author who can read a holdout can write to it; an
author who cannot has to make the change work.

## Who lifts a block

A block is lifted by a dismissal, as today (decisions 44, 138): a human with
write access to the repository, who is not the author of the pull request,
and not a bot. An agent cannot dismiss, cannot approve, and cannot re-run a
plugin with different settings. An `indeterminate` verdict blocks until a
human dismisses it or a new push passes; the gate does not pass because it
could not run.

## Why the judge is advisory

The `judge` reads the diff, the trees, and the pull request's own title and
body. All of that is the author's text (decision 61), and a model that
reads an author's text can be talked to by it. So a `judge` finding is
`reading` evidence, which is `judged` coverage, which does not block unless
the repository said at base that it may. The executed evidence, which the
author cannot write, is what blocks.
