# Contributing

## Docs change first

`docs/` is the design of record. The docs change in the same PR as the code, or
before it — code that contradicts the spec is a bug in one of the two, so say
which in the PR.

- [docs/architecture.md](docs/architecture.md) — the model and where each piece
  runs.
- [docs/spec.md](docs/spec.md) — the contracts the code follows.
- [docs/decisions.md](docs/decisions.md) — load-bearing choices; add an entry when
  you make one, reverse rather than delete when one changes.

## Every change is a pull request

No direct commits to `main`, including small and solo ones — a PR is the only thing
Qodo can review, and the review trail is part of what's judged.

- Keep PRs small: one concern each. A small PR gets a sharper Qodo review and costs
  little to open.
- Engage every Qodo comment — apply it, or reply with a one-line reason and resolve
  it.
- Let Qodo review before you merge; don't merge over an unaddressed comment without
  a stated reason.

Qodo runs on this repo only. The demo PRs on `orders-api` are reviewed by
`cujo-guard[bot]` itself, so a second bot there would muddy that story.

## Pull request descriptions

The description explains *why*, not what the diff already shows. A reviewer reads
it before the code, so it should answer what the change is for, what was
considered, and what is not done. The level of detail scales with the type of
change:

**`feat` / `fix`** — the heaviest. Say what was wrong or missing, why this
approach (and what was rejected when there is a real choice), what changed per
concern, how it was verified (test counts, manual steps), and what is known to
be incomplete or deferred. If the change touches the trust boundary, the deploy,
or the human gate, name the specific contract or decision it follows.

**`refactor`** — say what moved and why, confirm no behavior changed, and cite
CI or test results that prove it. A refactor that silently changes behavior is a
bug, and the description is where a reviewer checks.

**`docs`** — a short paragraph is enough: what was missing, why it matters now.
The commit body often covers it; the PR body can echo or extend that.

**`ci` / `build` / `chore`** — brief. What changed and why, any verification
that is not obvious from the diff.

**`test`** — what is now covered that was not, and why it was worth adding. If
the test exercises a specific contract or decision, name it.

## Standards

The standards Qodo checks and reviewers hold to. At code time they are mirrored
into Qodo's `best_practices.md` so the file and the bot check the same things.
The two copies are identical bullet for bullet. Only the link form differs: this
note and the reference style are the whole of the allowed divergence, because
CONTRIBUTING.md renders on GitHub and best_practices.md is read as plain text by
the bot.

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
  ([docs/decisions.md](docs/decisions.md) 36).
- Pin dependencies; an unpinned or `git+` spec needs a reason in the PR.
- Keep pull requests small and focused: one concern each.
- Run Python with `uv` in this repo (tests, tooling, scripts run on a developer
  machine or CI). The one exception is `sniff.py` inside the sandbox: it is
  stdlib-only and the rubric runs it with the sandbox's `python3`, because the
  sandbox image is not ours and does not carry `uv`.
- Never install `evil-package` outside the Daytona sandbox — it is an
  intentional malicious sample. Keep the name out of `apps/` and `packages/`
  entirely, tests included, so the tripwire stays a tripwire.
- A Discord server may receive a repo's reviews when the repo names it in
  `discord_guild` on its default branch, when the repo declares nothing and the
  server is `CUJO_DEFAULT_DISCORD_GUILD`, or when an operator allowed the pair
  over the Access-gated API. The repo's declaration is the normal path and is
  not a bypass: repo write access is the authority
  ([docs/decisions.md](docs/decisions.md) 31). Read it trusted-side through the
  GitHub App, never from the sandbox's copy. The default is one id and never a
  list, and never overrules a repo that named a server
  ([docs/decisions.md](docs/decisions.md) 40).
- Schema changes in `apps/cujo`: prefer a new table. To alter one that already
  exists in the deployed database, append to `MIGRATIONS` in `store/db.ts` —
  never edit a past entry, and never change a `CREATE TABLE` in place, which
  applies to a fresh database and silently not to a live one (see
  [docs/decisions.md](docs/decisions.md) 25 and 30).
- Merging deploys, so a change that couples a Coolify variable to the contents
  of `main` — a `main`-relative URL, most of all — must be valid both before and
  after the merge. Move the file in one PR while the old location still answers,
  then delete the old one in a follow-up. Updating the Coolify value first
  narrows the window but does not close it, because the running container keeps
  the old value until the deploy swaps it (see
  [docs/decisions.md](docs/decisions.md) 35).
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
- Log through `@cujo/log`, never `console.*` — `noConsole` enforces it. Pass the
  event name as a bare double-quoted literal, as in
  `log.info("run.superseded", { reason })`. Never a variable, a template
  literal, or a computed `log[level](name)` call: the guard test reads source
  text and can only see a literal first argument, so a computed call is
  invisible to it and its name is then reported as declared but never emitted.
  The legal names are declared in `packages/log/src/events.ts` and the compiler
  rejects any other, so a call site never needs to reach for that array. Fields
  are allowlisted scalars: adding one means declaring and classifying it in
  `packages/log/src/fields.ts`, and the build fails until you do. Never pass an
  `Error`, a config object, or any other object as a field value, and never
  interpolate an upstream response body into a message (see
  [docs/decisions.md](docs/decisions.md) 37).

## Tests

Tests mirror the source tree (`tests/` parallels `src/`), use `kebab-case.test.ts`,
are grouped with `describe`/`it`, and name the behavior, not the implementation.
Biome is the style authority (`pnpm lint`, `pnpm format`); source files are
`kebab-case.ts`.

Unit tests (`*.test.ts`, `pnpm test`) cover pure functions and state
transformations with synthetic inputs; mock the neighbors, not the module under
test. Contract tests (`*.contract.test.ts`, `make test-int`) verify that the fakes
the unit tests rely on match real TrueForge and MCP behavior. When a unit test
introduces a new mock assumption, consider whether it needs a contract-test
counterpart.

## Branches and commits

Branch off `main` with a short descriptive name, then open a PR.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): summary

Why the change is needed, not what the diff already shows.
```

- `type` is one of `feat`, `fix`, `docs`, `ci`, `build`, `chore`, `refactor`,
  `test`. Mark a breaking change with `!` after the type or a
  `BREAKING CHANGE:` footer.
- `scope` is optional and names the part touched: `cujo`, `github-mcp`,
  `gh-app-auth`, `sniff`, `compose`, `docs`, `brand`, `web`.
- The summary is imperative, lower-case, has no trailing period, and fits in
  72 characters. `feat(cujo): add HMAC check to the webhook`, not
  `Added HMAC checking.`
- Write a body when the reason is not obvious from the subject: what was wrong,
  why this fix, what was considered and rejected. Wrap at 72. When a commit
  closes a Qodo finding, say which one.

A good message lets a reader understand the change from `git log` alone,
without opening the diff.
