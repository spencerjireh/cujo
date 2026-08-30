# Board UI review: clarity and navigation (issue #96)

The write-up issue #96 cites, with a status per item. The observations were
made against the board as of `92090fd`, reading it as a first-time user would:
a developer arriving from a GitHub review, or a maintainer checking why a pull
request was blocked. Statuses refer to the branch that closes the issue;
decisions 86 to 90 in `decisions.md` carry the reasoning for the load-bearing
ones.

Status words: **done** (as proposed), **done, differently** (the concern is
answered by another design, said why), **deferred** (with the reason).

## 1. Dashboard page (board)

### Chamber

| Observation | Status |
| --- | --- |
| No legend in the chamber; colour semantics undefined on the page | **Done, differently.** Hovering a star, or a record row, swaps the hero's readings for the key: the diagram and its four part lines (decision 87), and the star's own callout names each ring in the ring's colour with what it measures (decision 93). A permanent corner legend was rejected as a fourth block of type on a frame with three. A running run is green, so the one star doing something is findable (decision 92). |
| First-visit tooltip that dismisses on interaction | **Deferred.** Rejected in decision 87: remembered in local storage, so a second machine gets it again and an accidental dismiss is permanent. |

### Hero stats

| Observation | Status |
| --- | --- |
| Findings and critical count deserve the weight; repo and PR counts are context | **Done.** Findings with the critical note first, live now second, last run, then runs and repositories. |

### ReadoutRack

| Observation | Status |
| --- | --- |
| `n=2` is statistical notation | **Done.** "over 2 runs". |
| "not timed" is ambiguous | **Done.** "not run" when no run has seen the check; "not timed" only when it ran and carried no duration. |
| Panels are not interactive; clicking a severity does not filter | **Deferred.** The record's filter chips are the filter control; a second one on the rack needs a shared filter store. Follow-up if wanted. |

### Record table

| Observation | Status |
| --- | --- |
| "THE RECORD" is jargon | **Done, differently.** Title kept (the instrument vocabulary is the product's voice); a plain subtitle added: "Every pull request Cujo has reviewed, newest first. Click a row for the run." |
| Checks column has no legend or tooltip | **Done.** Each square is a keyboard-reachable tooltip naming the check, how it ended and how long it took. |
| Found column has no legend | **Done.** Counts spelled out beside the bar in their tones (`2c 1w 1i`). |
| Checks and Found are related but disconnected; unify into one Results column | **Done.** One "Results" cell: squares, bar, counts, and a disclosure that opens a row with all four checks and their sandbox share (decision 86). The prose form ("4 checks — 8 findings: ...") was rejected as less scannable. |
| Same PR at two commits has no relationship | **Done.** The newest run per pull request is marked `latest`; older ones `superseded` and dimmed. Derived on the client from repo, number and `created_at` (decision 90). |
| Head SHA is opaque as to current or stale | **Done** by the same mark. |
| (Added in review) Only the first cell is a link | **Done.** The whole row is one stretched link; controls in the results cell sit above it. |

## 2. Run detail page

### Run header

| Observation | Status |
| --- | --- |
| Verdict buried in prose; extract into a structured card | **Done.** Verdict card: status badge, severity chips with `0 critical` said outright, link to the review on GitHub. The prose summary stays beneath it (decision 89). |
| Operator metadata mixed with user-facing metadata | **Done.** Model and rubric leave the header; the collapsed block is titled "Operator details" and now also holds the cost ledger. |

### Checks timeline

| Observation | Status |
| --- | --- |
| Solid/light bar has no legend | **Done.** Two-item legend: "sandbox executing the code" / "agent deciding what to run". |
| Truncated labels | **Done, already.** Lane notes were status words before this branch (`checkVerdict`); the one remaining `truncate`, on the setup note, is removed. |
| "not run" has no reason | **Done, as far as the data allows.** The lane says the check's error text when there is one, else "skipped". The manifest-change reason does not reach the client; carrying it is an API change. |

### Findings list

| Observation | Status |
| --- | --- |
| Group by check with collapsible sections | **Done.** Groups in check order, all closed until asked (decision 91); the trigger row carries the counts. |
| Severity filter chips | **Done.** All / Critical / Warn / Info; group headers keep their full counts and say "(n shown)". |

### Review panel

| Observation | Status |
| --- | --- |
| "What ran" as a scannable table | **Done.** Four-row table above the review body: check, verdict, duration. |
| Collapsible severity sections; "0 critical" as an inline badge | **Done, differently.** The body is the review as it went to GitHub, composed by `github-mcp` (decision 74), and the page does not restructure it. "0 critical" is said in the verdict card. |

## 3. Expanded sensor reports

| Observation | Status |
| --- | --- |
| Strip common prefixes; show the base once | **Done.** Relative paths; "paths under /work/base/" once per table. |
| Collapse `__pycache__` and `.pytest_cache` entries | **Done.** Folded into one "N build artifacts" row that expands. |
| Highlight security-relevant entries | **Done.** Rows matching the sandbox's sensitive path lists (copied from `cujo_sniff/policy.py`) take the warn tone, in addition to rows the report already marks sensitive. |
| Probe runs repeat the sensor status seven times | **Done.** Sensor status once per report; multi-block reports collapse to "N probes, M passed, X–Y s" and open on demand, or by default when a block needs attention. |
| `exit -15` looks alarming | **Done.** "exit -15 (SIGTERM, expected)"; -9 and -2 named too. |
| Cost section uses LLM jargon; token counts have no context | **Done.** Per-check line reads "Model input N tokens · output N tokens · $X"; the run ledger is labelled "model input, tokens" and so on, and sits inside Operator details. Not removed from the public view: the run's cost is part of what the run is. |

## 4. Cross-cutting

| Theme | Status |
| --- | --- |
| Progressive disclosure (glance / scan / investigate) | **Done** by the above: verdict card (glance), grouped findings, timeline and what-ran table (scan), reports and operator details folded (investigate). Since decision 91 nothing at the investigate level opens on its own; a timeline pick opens its card. |
| Audience segmentation | **Done** by the operator fold. |
| Accessibility: badge contrast, sensor dot target size | **Partly.** The record's squares are now buttons with a 2×12 px visual and a tooltip; their hit target is the button, and a larger invisible target is a follow-up. Contrast was not re-measured on this branch. |

## Not in this branch

- Interactive filtering from the rack (item 15).
- File lists as tree views (item 16): a flat list with the base shown once and artifacts folded was judged enough.
- A first-visit overlay (item 14).
- A supersession field on the public API; the client derivation covers the board's own window.
