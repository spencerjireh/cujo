---
name: Issue
about: A bug, a feature, or a chore. One concern per issue.
title: ""
labels: ""
---

<!--
Title: one sentence, symptom and consequence, as the repo's issues do.
  "The turn watchdog re-arms on every restart, so a run can outlive
  CUJO_TURN_TIMEOUT_MS indefinitely"
Fill every section; write "none" rather than deleting one. An agent or a
person should be able to start from this issue alone.
-->

## Problem

<!-- What is wrong or missing, and what it costs. Observed vs expected for a
bug; the gap and who hits it for a feature. -->

## Where

<!-- Component and path. One or more of: apps/cujo, apps/harness, apps/web,
apps/github-mcp, apps/sandbox-mcp, packages/*, sandbox/, agent/SKILL.md,
docs/, deploy (compose, Coolify). Name files or symbols when known. -->

## Reproduce or evidence

<!-- Bug: exact steps, command, or request; the run id, PR link, or log
event name; what happened vs what should have. Feature: the case that
motivates it. -->

## Design of record

<!-- Which docs/ file or decision number this touches or contradicts. Say
which of the two is wrong when code and spec disagree. "none" if unknown. -->

## Done when

<!-- Observable outcome, not the implementation. A test that would pass, a
request that returns X, a review that reads Y. -->

## Constraints and non-goals

<!-- Trust-boundary rules that apply (nothing secret reaches the sandbox),
report-shape additivity, migration rules, and what is explicitly out of
scope. "none" if none. -->
