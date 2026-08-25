# Cujo

An agent that runs each new dependency a pull request adds inside an isolated
sandbox, records what the package actually does — files written, processes
spawned, network calls attempted — and posts a review to the PR only after a
human approves. Built on [TrueForge](https://github.com/truefoundry/trueforge),
TrueFoundry's open-source agent harness.

> Name is a placeholder.

## Why

A pull request that adds a dependency is a request to run a stranger's code on
your machine. A diff of the lockfile tells you nothing about what that code does
when installed. Cujo installs it in a sandbox that holds no credentials and has
no route to the internet except a proxy it controls, then reports what happened.
Posting the review is the one irreversible action, and the harness pauses for a
human before it.

## Stack (this milestone)

Stock TrueForge in hosted mode:

- `Dockerfile` — installs `@truefoundry/trueforge` from npm.
- `docker-compose.yml` — `postgres`, `redis`, and the `server` (API + UI on
  port 8790).

Model provider (Gemini) and sandbox provider (Daytona) are configured in the
TrueForge UI after first boot, not via env.

## Run it yourself

```bash
cp .env.example .env      # fill in POSTGRES_* and PUBLIC_BASE_URL
docker compose up --build # UI + API on port 8790
```

Then open the UI, and in Settings add a model provider key (Gemini works on the
free tier) and a Daytona sandbox key. Send a chat turn that runs a command in a
sandbox to confirm everything is wired.

## Roadmap

- Ingress: GitHub webhook → one TrueForge session per PR.
- `sniff.py`: install each new dependency in the sandbox behind a logging proxy,
  diff the filesystem and processes, emit a JSON report.
- A `SKILL.md` review rubric; the GitHub review posted after human approval.
- Two demo PRs (one clean, one hostile).

## License

MIT.
