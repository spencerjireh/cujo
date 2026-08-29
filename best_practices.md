# Best practices (Qodo review input)

Mirrors the "Standards" section of [CONTRIBUTING.md](CONTRIBUTING.md). Qodo
reads this file when reviewing pull requests; keep the two in sync. The two
copies are identical bullet for bullet. Only the link form differs: this note
and the reference style are the whole of the allowed divergence, because
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
  (`docs/decisions.md` 36).
- Pin dependencies; an unpinned or `git+` spec needs a reason in the PR.
- Keep pull requests small and focused: one concern each.
- Run Python with `uv` in this repo (tests, tooling, scripts run on a developer
  machine or CI). The one exception is what actually executes in the sandbox --
  `sandbox/sniff.py` and `sandbox/cujo_sniff/`: stdlib-only, imported from
  `sys.path[0]` with no install, run with the sandbox's `python3`, because the
  sandbox image is not ours and does not carry `uv`. `sandbox/tests/` is not
  covered by that rule and imports `pytest` like every other test in the repo;
  the archive carries it and the rubric drops it on arrival, so it never
  reaches the sandbox.
- Never install `evil-package` outside the Daytona sandbox — it is an
  intentional malicious sample. Keep the name out of `apps/` and `packages/`
  entirely, tests included, so the tripwire stays a tripwire.
- A Discord server may receive a repo's reviews when the repo names it in
  `discord_guild` on its default branch, when the repo declares nothing and the
  server is `CUJO_DEFAULT_DISCORD_GUILD`, or when an operator allowed the pair
  over the Access-gated API. The repo's declaration is the normal path and is
  not a bypass: repo write access is the authority (`docs/decisions.md` 31).
  Read it trusted-side through the GitHub App, never from the sandbox's copy.
  The default is one id and never a list, and never overrules a repo that named
  a server (`docs/decisions.md` 40).
- Schema changes in `apps/cujo`: prefer a new table. To alter one that already
  exists in the deployed database, append to `MIGRATIONS` in `store/db.ts` —
  never edit a past entry, and never change a `CREATE TABLE` in place, which
  applies to a fresh database and silently not to a live one (see
  `docs/decisions.md` 25 and 30).
- Merging deploys, so a change that couples a Coolify variable to the contents
  of `main` — a `main`-relative URL, most of all — must be valid both before and
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
- A change to the check-report shape is additive or value-only: no renames, no
  removals, and nothing that moves one of the sensor block's top-level keys.
  Nothing type-checks that shape -- `check.report` is `unknown` in both apps --
  so a rename breaks a consumer silently, and the sandbox fetches from `main` at
  turn time while `apps/cujo` runs the previous image until the deploy swaps, so
  the old consumer always meets the new report first. Update
  `docs/contracts/report.example.json` with the change; its three conformance
  tests are what make a field added on one side fail on the others (see
  `docs/decisions.md` 54).
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
  interpolate an upstream response body into a message (see `docs/decisions.md`
  37).
