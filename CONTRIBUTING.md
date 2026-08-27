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
  malicious sample.

## Branches and commits

Branch off `main` with a short descriptive name, then open a PR. A one-line
imperative subject is enough (`add HMAC check to the cujo webhook`).
