# Best practices (Qodo review input)

Mirrors the "Standards" section of [CONTRIBUTING.md](CONTRIBUTING.md). Qodo reads
this file when reviewing pull requests; keep the two in sync.

- Secrets never enter the repo: no token, key, or `.env` in a commit. The GitHub
  App key (`*.pem`) and `.env` are gitignored; real values live in Coolify.
- Respect the trust boundary: nothing that runs on the server hands a secret to
  the sandbox. What goes in is the PR's code (a public, tokenless clone),
  dependency names, and Cujo's own sensor script and check commands; only JSON
  reports come out. No token, key, or clone credential ever enters.
- Pin dependencies; an unpinned or `git+` spec needs a reason in the PR.
- Keep pull requests small and focused: one concern each.
- Run Python with `uv`.
- Never install `evil-package` outside the Daytona sandbox — it is an intentional
  malicious sample.
