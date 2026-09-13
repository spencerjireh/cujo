<!--
Subject and body follow Conventional Commits (CONTRIBUTING.md). The
description explains why, not what the diff shows. Depth scales with type:
feat/fix fill every section; refactor states what moved and that behavior
did not change; docs/ci/build/chore/test can be a paragraph. Closes #N when
the PR resolves an issue.
-->

## What

<!-- One or two sentences on the change. -->

## Why

<!-- What was wrong or missing. Which approach and what was rejected when
there was a real choice. If this touches the trust boundary, the deploy, or
the human gate, name the contract or decision it follows. -->

## How it was verified

<!-- Test counts per workspace, manual steps, make test-int, a run id or
board link. A refactor cites what proves no behavior changed. -->

## Not in this PR

<!-- Known incomplete or deferred work, follow-ups, operator steps after
merge. "none" if none. -->

## Checklist

- [ ] One concern; the description says why
- [ ] `docs/` updated in this PR if behavior or design changed; a load-bearing choice has a `docs/decisions.md` entry
- [ ] Tests cover the change, or the description says why not
- [ ] No secret, key, or `.env` committed; nothing new crosses the sandbox boundary
- [ ] Dependencies pinned; an unpinned or `git+` spec, or a new `sandbox/` import, is justified above
- [ ] Check-report shape changes are additive and `docs/contracts/report.example.json` is updated
- [ ] CI is green
