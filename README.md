<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/readme/banner-dark.svg">
    <img alt="cujo" src="brand/readme/banner-light.svg" width="420">
  </picture>
</p>

<p align="center">
  A pull request reviewer that runs the code when reading is not enough.<br>
  <a href="https://cujo.spencerjireh.com/galaxy">Live board</a> &middot;
  <a href="https://cujo.spencerjireh.com/docs">Manual</a> &middot;
  <a href="docs/architecture.md">Architecture</a>
</p>

A diff shows what changed, not what happens. Cujo reads each pull request and
posts one review. When a repository asks for it, it also runs the code in a
disposable sandbox and cites what the code did.

<p align="center">
  <img alt="The board. Each star is one run, colour is the verdict, rings are checks, dots are findings." src="brand/readme/screenshot-board.jpg" width="800">
</p>

## How it works

1. A pull request opens; the GitHub App sends the webhook to Cujo.
2. A diff run reads the diff and the repository's standards files and posts findings of at most `warn`.
3. A sandbox run runs the tests on base and head, probes the changed code, boots the app, and installs each new dependency under sensors.
4. Hard rules force `critical` on a regression, a test-secret read, a sensitive write, or unknown network access during an install.
5. A `critical` fails the `cujo/guard` check; a maintainer lifts it with `/cujo dismiss` on the pull request.

The agent runs on Cujo's own harness, `apps/harness`, built on the
[pi coding agent SDK](https://github.com/badlogic/pi-mono)
([decision 123](docs/decisions.md#123-the-harness-is-ours-built-on-pi-and-the-contract-is-a-package)).
No secret enters the sandbox. The design is in [docs/](docs/README.md).

## Install

1. Install the App at <https://github.com/apps/cujo-guard>.
2. Open a pull request. Within seconds it gets a reaction and a `cujo/guard` check; a few minutes later, one review.
3. To make a block hold, require the `cujo/guard` status check on the target branch.

`.cujo.yml` sets the mode and the commands; the [manual](https://cujo.spencerjireh.com/docs/install) has the details.

## Run your own

```bash
cp .env.example .env   # GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
make up-local          # the board on :3000
```

Models are set on the board, not in the environment
([decision 174](docs/decisions.md#174-models-are-configured-on-the-board-the-environment-only-seeds-a-dev-stack)).
The read API has no credential
([decision 57](docs/decisions.md#57-the-operator-plane-is-deleted-every-route-is-signature-gated-or-anonymous)).
The [self-host page](https://cujo.spencerjireh.com/docs/self-host) has the App
permissions, OAuth sign-in and the rest.

## Tests

```bash
corepack enable && pnpm install
pnpm lint && pnpm typecheck && pnpm test
uv sync && uv run pytest
make test-int   # apps/cujo against a real harness
```

## License

MIT. See [LICENSE](LICENSE).
