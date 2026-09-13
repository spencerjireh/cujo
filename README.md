<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/readme/banner-dark.svg">
    <img alt="cujo" src="brand/readme/banner-light.svg" width="420">
  </picture>
</p>

<p align="center">
  A pull request reviewer that reads the diff and runs the code when reading is not enough.<br>
  <a href="https://cujo.spencerjireh.com">Live board</a> &middot;
  <a href="docs/architecture.md">Architecture</a>
</p>

By default Cujo reads the pull request: the diff, the repository's standards
files, the previous review's findings, on a cheap model with a token budget.
It posts one advisory review. When the repository asks for it in `.cujo.yml`,
or when a dependency manifest changed or a bot opened the pull request, it
clones the pull request into a throwaway sandbox instead, runs the tests on
base and head, probes the changed code, boots the app, installs each new
dependency in isolation, and posts a review that cites what happened. A
`critical` blocks the merge through a check run nobody can dismiss; a
maintainer lifts it on the pull request (decisions 133, 138).

<p align="center">
  <img alt="The board. Each star is one run, colour is the verdict, rings are checks, dots are findings." src="brand/readme/screenshot-board.jpg" width="800">
</p>

## Why

A diff shows what changed, not what happens. Reading finds the missing case
and the standard the change ignored, for a few cents. It cannot tell whether
the test that now fails is the test's fault, whether the endpoint still
answers, or what a new dependency does at install time, so for those Cujo
runs the pull request somewhere it can do no harm and reports what it
measured. Only a measurement blocks.

## How it works

1. **Receive.** The GitHub App gets the `pull_request` webhook. `apps/cujo`
   verifies the signature, resolves the mode, writes a `cujo/guard` check run
   on the commit as *in progress*, and starts one agent turn.
2. **Read.** A diff run compresses the diff, reads `AGENTS.md`, `CLAUDE.md`,
   `CONTRIBUTING.md` and `.github/copilot-instructions.md` at the base
   commit, and hands both to the agent on a session with no sandbox. It posts
   one advisory review with findings of at most `warn`, because a block needs
   evidence only execution gives. The run ends here.
3. **Run.** A sandbox run clones both SHAs into a sandbox, seeds a decoy
   secret, starts a logging proxy, and spawns one subagent per check:
   `tests` (the suite on base and head), `probes` (agent-written scripts
   against the changed code), `smoke` (boot the app, hit it), and, when a
   dependency manifest changed, `detonation` (install each added dependency
   through `sniff.py` and record the hosts, files and processes it touches).
4. **Fold.** Each subagent returns a JSON report. The agent folds them into
   `info`, `warn` and `critical` findings. Hard rules force `critical` on a
   regression, a decoy-secret read, a sensitive write, or unknown egress
   during an install; `apps/cujo` re-derives them from the reports, so the
   agent cannot downgrade one.
5. **Post.** With no `critical` the review posts as a comment from
   `cujo-guard[bot]` and the check succeeds. Any `critical` requests changes
   and fails the check, which holds the merge under branch protection. A
   maintainer with write access lifts it with `/cujo dismiss` on the pull
   request; the author and any bot account are refused.

<p align="center">
  <img alt="A run page. Four checks on one time axis, then the findings, worst first." src="brand/readme/screenshot-run.jpg" width="800">
</p>

No secret enters the sandbox: PR code and dependency names go in, JSON
reports come out. The board carries the manual at `/docs`. For the design,
read [docs/architecture.md](docs/architecture.md), then
[docs/spec.md](docs/spec.md); a design change lands there first.

## The harness

Cujo runs on its own agent harness, `apps/harness`, built on the
[pi coding agent SDK](https://github.com/badlogic/pi-mono) for the agent
loop, providers, retries and compaction. The harness adds sessions, turns, an
event log and the tool that spawns one sub-agent per check; the contract
between it and the rest of Cujo is `packages/harness-contract`
([decision 123](docs/decisions.md#123-the-harness-is-ours-built-on-pi-and-the-contract-is-a-package)).
`apps/cujo` is its only client, and the board in `apps/web` reads that
service, never the harness.

## Use it on your repository

1. Install the App on a public repository at
   <https://github.com/apps/cujo-guard>. The repository stays public because
   nothing in Cujo holds a clone credential.
2. Open a pull request. Within seconds it wears an eye reaction and a
   `cujo/guard` check in progress, and a few minutes later one review from
   `cujo-guard[bot]`. Checked on 2026-09-13 with a planted regression,
   [orders-api#43](https://github.com/spencerjireh/orders-api/pull/43): the
   check in progress 5 s after the pull request opened, `REQUEST_CHANGES` for
   the two broken tests at 5 m 10 s, the check failed at 5 m 18 s, and the
   author's `/cujo dismiss` refused.
3. Require the `cujo/guard` status check on the target branch if a block
   should hold. A review can be dismissed by anyone with write access; the
   check cannot.

Cujo infers the install, test and boot commands from the repository's build
files. `.cujo.yml` overrides what it got wrong, and a `cujo:skip` label or a
draft stops a run before a sandbox exists. The rest is at
<https://cujo.spencerjireh.com/docs/install>.

## Run your own

```bash
cp .env.example .env   # GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET,
                       # CUJO_MODEL and the MODEL_PROVIDER_* block are required
make up-local          # docker compose up with the local overlay
```

The overlay publishes each service on `127.0.0.1`: the board on 3000, the
harness on 8790, `cujo` on 8080, `github-mcp` on 8081, `sandbox-mcp` on 8082
(on Linux that loopback isolation needs Docker Engine `>= 28.0`). The deploy
uses `docker-compose.yml` alone; `make help` lists the other targets.

There is no credential ([decision 57](docs/decisions.md#57-the-operator-plane-is-deleted-every-route-is-signature-gated-or-anonymous)).
`cujo` dispatches on `Host`: `cujo-ingress.localhost:8080/webhook` receives
the webhook, and the read API answers on the internal name, where anything
outside `/public` is 404.

```bash
curl -s -H 'Host: cujo' http://localhost:8080/public/runs
```

A self-hosted instance needs its own GitHub App: Contents read, Metadata
read, Pull requests write, Checks write and Issues read; events
`pull_request`, `issue_comment`, `pull_request_review_comment` and
`repository`; the webhook posts to `/webhook` with `GITHUB_WEBHOOK_SECRET`.
On a laptop, `cloudflared tunnel --url http://localhost:8080` with the `Host`
set to the webhook hostname is enough. `.env.example` documents the model
provider, the review mode and the diff review's budget; Discord is optional
and bound from inside Discord with `/cujo watch`. The
[self-host page](https://cujo.spencerjireh.com/docs/self-host) has the rest.

## Tests

```bash
corepack enable && pnpm install
pnpm lint && pnpm typecheck && pnpm test   # every external boundary is faked
uv sync && uv run pytest                   # the sensor tests
make test-int                              # apps/cujo against a real harness
```

`make test-int` runs `apps/cujo` against a real harness from the compose file
with a stub model provider: turn ids, replay, chaining, cancel, the fold of
real events. `make test-int-down` stops it.

## License

MIT. See [LICENSE](LICENSE).
