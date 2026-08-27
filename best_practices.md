# Best practices (Qodo review input)

Mirrors the "Standards" section of [CONTRIBUTING.md](CONTRIBUTING.md). Qodo reads
this file when reviewing pull requests; keep the two in sync.

- Secrets never enter the repo: no token, key, or `.env` in a commit. The GitHub
  App key (`*.pem`) and `.env` are gitignored; real values live in Coolify.
- Respect the trust boundary: nothing that runs on the server hands a secret to
  the sandbox. What goes in is the PR's code (a public, tokenless clone), the
  PR's own public metadata (number, SHAs, changed-file list, title, and
  description, which state the claims the probes test), dependency names, and
  Cujo's own sensor script and check commands; only JSON reports come out. No
  token, key, or clone credential ever enters.
- Pin dependencies; an unpinned or `git+` spec needs a reason in the PR.
- Keep pull requests small and focused: one concern each.
- Run Python with `uv` in this repo (tests, tooling, scripts run on a developer
  machine or CI). The one exception is `sniff.py` inside the sandbox: it is
  stdlib-only and the rubric runs it with the sandbox's `python3`, because the
  sandbox image is not ours and does not carry `uv`.
- Never install `evil-package` outside the Daytona sandbox — it is an intentional
  malicious sample. Keep the name out of `apps/` and `packages/` entirely, tests
  included, so the tripwire stays a tripwire.
- Schema changes in `apps/cujo`: prefer a new table. To alter one that already
  exists in the deployed database, append to `MIGRATIONS` in `store.ts` — never
  edit a past entry, and never change a `CREATE TABLE` in place, which applies
  to a fresh database and silently not to a live one
  (see `docs/decisions.md` 25 and 29).
