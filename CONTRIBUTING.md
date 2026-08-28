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

## Standards

The standards Qodo checks and reviewers hold to. At code time they are mirrored
into Qodo's `best_practices.md` so the file and the bot check the same things.

- Secrets never enter the repo — no token, key, or `.env` in a commit. The App key
  (`*.pem`) and `.env` are gitignored; real values live in Coolify.
- Respect the trust boundary: nothing on the server hands a secret to the sandbox.
  What goes in is the PR's code and public metadata, dependency names, and Cujo's
  own sensor script and commands (see [docs/architecture.md](docs/architecture.md)).
- Pin dependencies; an unpinned or `git+` spec needs a reason in the PR.
- Run Python with `uv` in this repo. `sniff.py` inside the sandbox is the one
  exception: stdlib-only, run with the sandbox's `python3`.
- Never install `evil-package` outside the Daytona sandbox — it is an intentional
  malicious sample. Keep the name out of `apps/` and `packages/` entirely, tests
  included, so the tripwire stays a tripwire.
- Schema changes in `apps/cujo`: prefer a new table. To alter one that already
  exists in the deployed database, append to `MIGRATIONS` in `store.ts` — never
  edit a past entry, and never change a `CREATE TABLE` in place, which applies
  to a fresh database and silently not to a live one
  (see [docs/decisions.md](docs/decisions.md) 25 and 30).

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
