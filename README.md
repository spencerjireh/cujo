<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/readme/banner-dark.svg">
    <img alt="cujo" src="brand/readme/banner-light.svg" width="420">
  </picture>
</p>

<p align="center">
  A pull request reviewer that reads the diff, and runs the code when reading is not enough.<br>
  <a href="https://cujo.spencerjireh.com">Live board</a> &middot;
  <a href="docs/architecture.md">Architecture</a>
</p>

Cujo is a diff reviewer that can execute (decision 133). By default it reads
the pull request the way a careful colleague would — the diff, the
repository's own standards files, the previous review's findings — on a cheap
model with a token budget, and posts one advisory review. When the
repository asks for it, or when the change insists (a dependency manifest
changed, a bot opened the pull request), it clones the pull request into a
throwaway sandbox instead: runs the tests on base and head, probes the
changed code, boots the app, installs each new dependency in isolation, and
posts a review that cites what happened. A `critical` blocks the merge at
once through a check run nobody can dismiss; a maintainer lifts it on the
pull request.

<p align="center">
  <img alt="The board. Each star is one run, colour is the verdict, rings are checks, dots are findings." src="brand/readme/screenshot-board.jpg" width="800">
</p>

## Why

A diff shows what changed. It does not show what happens. Reading settles
most of a review — the naming, the missing case, the standard the repository
wrote down and the change ignored — and it settles it for a few cents. It
cannot settle whether the test that now fails is the test's fault, whether
the endpoint still answers, or what a new dependency does at install time.
Those are not opinions, so Cujo does not offer one: it runs the pull request
somewhere it can do no harm and reports what it measured. A block is a
measurement, never a reading.

## How it works

One pipeline, two depths. A repository picks its depth with `mode:` in
`.cujo.yml` — `diff` or `sandbox` — and the code holds two floors: a
dependency-manifest change or a Bot-authored pull request is always the
sandbox, whatever the file says.

1. **Receive.** The Cujo GitHub App gets the `pull_request` webhook.
   `apps/cujo` verifies the signature, reads the pull request, resolves the
   mode, writes a `cujo/guard` check run on the commit as *in progress*, and
   starts one agent turn with the PR context: repo, PR number, base and head
   SHAs, changed files.
2. **Read.** For a diff run the service compresses the diff, reads the
   repository's standards (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
   `.github/copilot-instructions.md`) at the base commit, and hands both to
   the agent on a session with no sandbox and a token budget. It posts one
   advisory review with findings of at most `warn`, because a block needs
   evidence only execution can give. The run ends here.
3. **Run.** For a sandbox run the agent provisions a sandbox, clones both
   SHAs, seeds a decoy secret, and starts a logging proxy. Then it spawns one
   subagent per check: `tests` (the suite on base and head), `probes`
   (agent-written scripts against the changed code), `smoke` (boot the app,
   hit it), and — when a dependency manifest changed — `detonation` (install
   each added dependency through `sniff.py` and record the hosts it contacts,
   the files it touches, and the processes it spawns).
4. **Fold.** Each subagent returns a JSON report. The agent folds them into
   findings with a severity: `info`, `warn`, or `critical`. Hard rules force
   `critical` on a regression, a decoy-secret read, a sensitive write, or
   unknown egress during an install; the agent cannot downgrade those, and
   `apps/cujo` re-derives them from the reports.
5. **Post, and block.** With no `critical` finding the review posts as a
   comment from `cujo-guard[bot]`: a summary of what ran plus inline
   comments, and the check succeeds. Any `critical` requests changes on
   Cujo's own authority and the `cujo/guard` check fails, which is what holds
   the merge under branch protection. Nobody is asked. A maintainer with
   write access lifts the block with `/cujo dismiss` on the pull request;
   the author cannot, and a bot account cannot (decision 138).

<p align="center">
  <img alt="A run page. Four checks on one time axis, then the findings, worst first." src="brand/readme/screenshot-run.jpg" width="800">
</p>

No secret ever enters the sandbox. PR code and dependency names go in; JSON
reports come out.

The board carries a user-facing manual at `/docs` — installing it, `.cujo.yml`,
what each check measures, blocking and the unlock, Discord, and running your
own instance.

Start with [docs/architecture.md](docs/architecture.md) for the mental model,
then [docs/spec.md](docs/spec.md) for the contracts the code follows. The docs
are canonical: a design change lands there first.

## The harness

Cujo runs on its own agent harness, `apps/harness`, built on the
[pi coding agent SDK](https://github.com/badlogic/pi-mono) for the agent loop,
the provider layer, retries and compaction. The harness itself is sessions,
turns, an event log, an approval gate no spec uses since decision 138, and the
tool that spawns one sub-agent per check; the contract between it and
the rest of Cujo is `packages/harness-contract`
([decision 123](docs/decisions.md#123-the-harness-is-ours-built-on-pi-and-the-contract-is-a-package)).
Cujo is the agent, the rubric, the in-sandbox sensor script, and the service
around them: `apps/cujo` is the harness's only client, and the board in
`apps/web` reads that service, never the harness.

## Use it on your repository

1. Install the App on a public repository at
   <https://github.com/apps/cujo-guard>. Nothing else needs configuring, and
   the repository stays public because nothing in Cujo holds a clone
   credential.
2. Open a pull request. Within seconds it wears an eye reaction and a
   `cujo/guard` check in progress, which prove delivery, and a few minutes
   later one review from `cujo-guard[bot]`. Checked on 2026-09-13 with a
   planted regression, [orders-api#43](https://github.com/spencerjireh/orders-api/pull/43):
   the check in progress 5 s after the pull request opened, a
   `REQUEST_CHANGES` review for the two broken tests at 5 m 10 s, the check
   failed at 5 m 18 s, and the author's `/cujo dismiss` refused.
3. Protect the branch if a block should hold: require the `cujo/guard`
   status check on the target branch. A review alone can be dismissed by
   anyone with write access; the check cannot.

Cujo infers the install, test and boot commands from the repository's own build
files. A `.cujo.yml` overrides what it got wrong, and a `cujo:skip` label or a
draft state stops a run before a sandbox is provisioned. The manual on the
board has the rest at <https://cujo.spencerjireh.com/docs/install>.

## Run your own

```bash
cp .env.example .env   # GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET,
                       # CUJO_MODEL and the MODEL_PROVIDER_* block are required
make up-local          # docker compose up with the local overlay
```

The overlay publishes each service on `127.0.0.1` — the board on 3000, the
harness on 8790, `cujo` on 8080, `github-mcp` on 8081, `sandbox-mcp` on 8082.
(On Linux that loopback isolation needs Docker Engine `>= 28.0`.) The deploy uses `docker-compose.yml` alone. `make help`
lists the other targets.

Nothing is behind a credential; there is none ([decision 57](docs/decisions.md#57-the-operator-plane-is-deleted-every-route-is-signature-gated-or-anonymous)). `cujo` dispatches
on `Host`: `cujo-ingress.localhost:8080/webhook` is the receiver, and the read
API answers on the internal name, where anything outside `/public` is 404.

```bash
curl -s -H 'Host: cujo' http://localhost:8080/public/runs
```

`MODEL_PROVIDER_*` names an OpenAI-compatible endpoint and the models on it;
`apps/cujo` registers it on the harness at start, and there is nowhere else to
configure one. `CUJO_REVIEW_MODE` is the review a repository gets when it
declares none, and `CUJO_DIFF_MODEL`, `CUJO_DIFF_BUDGET_TOKENS`,
`CUJO_DIFF_TIMEOUT_MS` and `CUJO_DIFF_BYTES` are the diff review's own model,
budget, ceiling and reading cap. A self-hosted instance needs
its own GitHub App, so that the private key is yours. Permissions are Contents
read, Metadata read, Pull requests write, Checks write and Issues read, events are
`pull_request`, `issue_comment`, `pull_request_review_comment` and
`repository`, and the webhook posts to `/webhook` with the secret from
`GITHUB_WEBHOOK_SECRET`. For a laptop, `cloudflared tunnel --url
http://localhost:8080` works, with the `Host` set to the webhook hostname. Then
open a PR where the App is installed. The board's
[self-host page](https://cujo.spencerjireh.com/docs/self-host) has the same in
more detail.

Discord notification is optional and bound from inside Discord: the repo names
its server in `.cujo.yml`, someone there with Manage Server runs `/cujo watch`,
and both halves are required. [docs/spec.md](docs/spec.md) Contract 8 and the
`DISCORD_*` entries in `.env.example` have the rest.

## Tests

```bash
corepack enable && pnpm install
pnpm lint && pnpm typecheck && pnpm test   # every external boundary is faked
uv sync && uv run pytest                   # the sensor tests
make test-int                              # apps/cujo against a real harness
```

`make test-int` runs `apps/cujo` against a real harness from the compose file
with a stub model provider, checking what the unit tests assume — turn ids,
replay, chaining, cancel, the fold of real events.
`make test-int-down` stops it.

## License

MIT. See [LICENSE](LICENSE).
