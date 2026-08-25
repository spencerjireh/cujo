# Cujo

Cujo reviews the dependencies a pull request adds. It installs each new PyPI
package in a throwaway sandbox, records what the install does, and posts a
verdict on the PR — blocking a merge only after a human approves.

> "Cujo" is a working name and may change. It appears throughout as a
> find-replaceable string.

## Why

`pip install` runs a package's `setup.py` before any of your own code executes.
A pull request that adds a dependency is asking you to run a stranger's code,
and the diff shows none of what that code does. Cujo runs it first, somewhere it
can do no harm, and tells you what happened.

## How it works

1. A PR adds or bumps a dependency in `requirements.txt`. The Cujo GitHub App
   receives the `pull_request` webhook.
2. Ingress verifies the webhook, diffs out the changed specifiers, and starts one
   agent session with the PR context.
3. The agent provisions a Daytona sandbox and runs `sniff.py`, which installs the
   dependency behind a logging proxy and records the hosts it contacts, the files
   it touches, and the processes it spawns.
4. The agent scores that report against a rubric and reaches one verdict:
   `cleared`, `warn`, or `denied`.
5. A `cleared` or `warn` review posts automatically as `cujo-guard[bot]`. A
   `denied` verdict requests changes — and that one action pauses until a human
   approves it in the TrueForge UI.

No secret ever enters the sandbox. A dependency name goes in; a JSON report comes
out. That single narrow crossing is the property the whole design protects.

## Built on TrueForge

Cujo runs on [TrueForge](https://trueforge.dev), an open-source agent harness,
used as published — no fork. The harness supplies the model runtime, the Daytona
sandbox, the MCP tool the agent calls to post a review, and the human-approval
gate that holds the blocking review. Cujo is the agent, the review rubric, the
sandbox detonation script, and the webhook ingress built on top.

## Layout

| Path | What |
|------|------|
| `docs/` | Canonical spec. The code follows these docs; a design change lands here first. |
| `ingress/` | Webhook receiver that turns a PR event into an agent session. *(code time)* |
| `github-mcp/` | MCP server the agent calls to post a review as the GitHub App. *(code time)* |
| `sniff.py` | The in-sandbox detonation script. *(code time)* |

Start with [docs/architecture.md](docs/architecture.md) for the mental model, then
[docs/spec.md](docs/spec.md) for the contracts the code follows.

## Status

Pre-code. The harness is deployed and live; the docs are the design of record and
the demo repos (`orders-api`, `evil-package`) exist. The application code has not
landed yet.

## License

MIT. See [LICENSE](LICENSE).
