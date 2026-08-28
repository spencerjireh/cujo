# Best practices (Qodo review input)

Mirrors the "Standards" section of [CONTRIBUTING.md](CONTRIBUTING.md). Qodo reads
this file when reviewing pull requests; keep the two in sync.

- Secrets never enter the repo: no token, key, or `.env` in a commit. The GitHub
  App key (`*.pem`) and `.env` are gitignored; real values live in Coolify.
- Respect the trust boundary: nothing that runs on the server hands a secret to
  the sandbox. What goes in is the PR's code (a public, tokenless clone), the
  PR's own public metadata (number, SHAs, changed-file list, title, and
  description, which state the claims the probes test), dependency names, Cujo's
  own sensor script and check commands, and the run's own id when the repo is
  public; only JSON reports come out. No token, key, or clone credential ever
  enters. The run id is on this list because it is already public — it is the
  last path segment of a board page anyone can open — and because it names no
  host: the review footer's URL is built by `github-mcp`, so nothing the agent
  reads in a pull request can choose where the bot's evidence link points
  (`docs/decisions.md` 36).
- Pin dependencies; an unpinned or `git+` spec needs a reason in the PR.
- Keep pull requests small and focused: one concern each.
- Run Python with `uv` in this repo (tests, tooling, scripts run on a developer
  machine or CI). The one exception is `sniff.py` inside the sandbox: it is
  stdlib-only and the rubric runs it with the sandbox's `python3`, because the
  sandbox image is not ours and does not carry `uv`.
- Never install `evil-package` outside the Daytona sandbox — it is an intentional
  malicious sample. Keep the name out of `apps/` and `packages/` entirely, tests
  included, so the tripwire stays a tripwire.
- A Discord server may receive a repo's reviews when the repo names it in
  `discord_guild` on its default branch, or when an operator allowed the pair
  over the Access-gated API. The repo's declaration is the normal path and is
  not a bypass: repo write access is the authority (`docs/decisions.md` 31).
  Read it trusted-side through the GitHub App, never from the sandbox's copy.
- Schema changes in `apps/cujo`: prefer a new table. To alter one that already
  exists in the deployed database, append to `MIGRATIONS` in `store/db.ts` — never
  edit a past entry, and never change a `CREATE TABLE` in place, which applies
  to a fresh database and silently not to a live one
  (see `docs/decisions.md` 25 and 30).
- Merging deploys, so a change that couples a Coolify variable to the contents of
  `main` — a `main`-relative URL, most of all — must be valid both before and
  after the merge. Move the file in one PR while the old location still answers,
  then delete the old one in a follow-up. Updating the Coolify value first
  narrows the window but does not close it, because the running container keeps
  the old value until the deploy swaps it (see `docs/decisions.md` 35).
- Do not swallow errors: no empty `catch` blocks and no fire-and-forget promises
  without `.catch()`. A webhook or API handler that fails silently is a run that
  vanishes with no trace in the store.
- No `as any` or `@ts-ignore` without a comment saying why. Webhook payloads,
  MCP tool inputs, and TrueForge events are validated at the boundary before the
  type is trusted; the shape comes from the sender, not from us.
- A PR that changes behavior ships a test that covers the change, or states why
  it does not. Tests mirror the source tree in `tests/`, use `*.test.ts`, and
  follow the `describe`/`it` naming convention.
- A PR that changes how something works updates the relevant file in `docs/` in
  the same PR; a load-bearing choice gets an entry in `docs/decisions.md`.
- Use `console.error` and `console.warn` for errors and warnings that belong in
  container logs. A bare `console.log` added in a PR is usually leftover
  debugging — remove it or promote it to `console.info` with enough context to
  be useful to someone reading Coolify logs who is not you.
