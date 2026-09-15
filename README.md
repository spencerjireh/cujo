<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/readme/banner-dark.svg">
    <img alt="cujo" src="brand/readme/banner-light.svg" width="420">
  </picture>
</p>

<p align="center">
  A pull request reviewer that reads the diff and runs the code when reading is not enough.<br>
  <a href="https://cujo.spencerjireh.com">Live board</a> &middot;
  <a href="https://cujo.spencerjireh.com/docs">Manual</a> &middot;
  <a href="docs/architecture.md">Architecture</a>
</p>

A diff shows what changed, not what happens. Cujo reads the pull request by
default, on a cheap model with a token budget, and posts one advisory
review. When the repository asks for it in `.cujo.yml`, or when a dependency
manifest changed or a bot opened the pull request, it runs the pull request
in a throwaway sandbox instead: tests on base and head, probes against the
changed code, a smoke boot, and each new dependency installed in isolation
behind a logging proxy. A `critical` blocks the merge through a `cujo/guard`
check run nobody can dismiss; a maintainer lifts it with `/cujo dismiss` on
the pull request. Only a measurement blocks (decisions 133, 138).

<p align="center">
  <img alt="The board. Each star is one run, colour is the verdict, rings are checks, dots are findings." src="brand/readme/screenshot-board.jpg" width="800">
</p>

## How it works

1. The GitHub App gets the `pull_request` webhook; `apps/cujo` verifies the
   signature, resolves the mode, writes `cujo/guard` as *in progress* on the
   commit, and starts one agent turn.
2. A diff run reads the diff and the repository's standards files
   (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
   `.github/copilot-instructions.md`) at the base commit and posts findings
   of at most `warn`, because a block needs evidence only execution gives.
3. A sandbox run spawns one subagent per check: `tests`, `probes`, `smoke`,
   and `detonation` when a manifest changed, which installs each added
   dependency through `sniff.py` and records the hosts, files and processes
   it touches. Each returns a JSON report.
4. The agent folds the reports into `info`, `warn` and `critical` findings.
   Hard rules force `critical` on a regression, a decoy-secret read, a
   sensitive write, or unknown egress during an install, and `apps/cujo`
   re-derives them so the agent cannot downgrade one.
5. With no `critical` the review posts as a comment from `cujo-guard[bot]`
   and the check succeeds. Any `critical` requests changes and fails the
   check, which holds the merge under branch protection until a maintainer
   with write access dismisses it; the author and any bot account are
   refused.

<p align="center">
  <img alt="A run page. Four checks on one time axis, then the findings, worst first." src="brand/readme/screenshot-run.jpg" width="800">
</p>

No secret enters the sandbox: PR code and dependency names go in, JSON
reports come out. The agent runs on Cujo's own harness, `apps/harness`,
built on the [pi coding agent SDK](https://github.com/badlogic/pi-mono)
([decision 123](docs/decisions.md#123-the-harness-is-ours-built-on-pi-and-the-contract-is-a-package));
`apps/cujo` is its only client and the board in `apps/web` reads that
service. The design lives in [docs/architecture.md](docs/architecture.md)
and [docs/spec.md](docs/spec.md), and changes there first.

## Use it on your repository

1. Install the App on a public repository at
   <https://github.com/apps/cujo-guard>. Nothing in Cujo holds a clone
   credential, so the repository stays public.
2. Open a pull request. Within seconds it wears an eye reaction and a
   `cujo/guard` check in progress; a few minutes later, one review. On
   2026-09-13, [orders-api#43](https://github.com/spencerjireh/orders-api/pull/43)
   with a planted regression: check in progress at 5 s, `REQUEST_CHANGES` at
   5 m 10 s, check failed at 5 m 18 s, the author's `/cujo dismiss` refused.
3. Require the `cujo/guard` status check on the target branch if a block
   should hold. A review can be dismissed by anyone with write access; the
   check cannot.

Cujo infers install, test and boot commands from the repository's build
files; `.cujo.yml` overrides what it got wrong, and a `cujo:skip` label or a
draft stops a run. The rest is in the
[manual](https://cujo.spencerjireh.com/docs/install).

## Run your own

```bash
cp .env.example .env   # GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET,
                       # CUJO_MODEL and the MODEL_PROVIDER_* block are required
make up-local          # docker compose up with the local overlay
```

The overlay publishes the board on 3000, the harness on 8790, `cujo` on
8080, `github-mcp` on 8081 and `sandbox-mcp` on 8082, all on `127.0.0.1`
(Docker Engine `>= 28.0` on Linux). `cujo` dispatches on `Host`:
`cujo-ingress.localhost:8080/webhook` receives the webhook, and the read API
answers on the internal name with nothing behind a credential
([decision 57](docs/decisions.md#57-the-operator-plane-is-deleted-every-route-is-signature-gated-or-anonymous)):

```bash
curl -s -H 'Host: cujo' http://localhost:8080/public/runs
```

You need your own GitHub App: Contents read, Metadata read, Pull requests
write, Checks write, Issues read; events `pull_request`, `issue_comment`,
`pull_request_review_comment`, `repository` (the `installation` events arrive
on their own); webhook to `/webhook` with
`GITHUB_WEBHOOK_SECRET`. For the board's sign-in, the App's own OAuth: set
its callback URL to `<board origin>/api/auth/callback`, generate a client
secret, and pass the client id and secret as `GITHUB_OAUTH_CLIENT_ID` and
`GITHUB_OAUTH_CLIENT_SECRET`; without them the board is read-only. On a laptop, `cloudflared tunnel --url
http://localhost:8080` is enough. `.env.example` documents the model
provider, the review mode, the diff budget and Discord; the
[self-host page](https://cujo.spencerjireh.com/docs/self-host) has the rest.

## Tests

```bash
corepack enable && pnpm install
pnpm lint && pnpm typecheck && pnpm test   # every external boundary is faked
uv sync && uv run pytest                   # the sensor tests
make test-int                              # apps/cujo against a real harness
```

## License

MIT. See [LICENSE](LICENSE).
