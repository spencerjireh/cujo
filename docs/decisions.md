# Decisions

Load-bearing choices and why they were made. Newest context wins. A decision
that is reversed after it was built or shown is noted here rather than deleted
(see 6); a design that was only ever on paper is rewritten in place. The index
says which entries a later one reversed, superseded, refined or amended, so a
reader can tell a live rule from a recorded one before opening it.

## Index

1. [Build on stock TrueForge — no fork](#1-build-on-stock-trueforge--no-fork) — reversed by 123
2. [Hosted mode on Hetzner via Coolify, gated by Cloudflare Access](#2-hosted-mode-on-hetzner-via-coolify-gated-by-cloudflare-access) — superseded in part by 34, 49 and 57, and the rest by 123
3. [In-sandbox logging proxy — not Daytona's `outboundProxyUrl`](#3-in-sandbox-logging-proxy--not-daytonas-outboundproxyurl)
4. [Bot identity is a GitHub App — `cujo-guard[bot]`](#4-bot-identity-is-a-github-app--cujo-guardbot)
5. [The agent posts the review via MCP, not the `apps/cujo` code](#5-the-agent-posts-the-review-via-mcp-not-the-appscujo-code)
6. [Reviews auto-post; the human gate is on the block](#6-reviews-auto-post-the-human-gate-is-on-the-block) — superseded by 42, and reversed by 138
7. [The webhook route is on a non-Access hostname](#7-the-webhook-route-is-on-a-non-access-hostname)
8. [A free-tier model provider for inference; hosted Daytona for the sandbox](#8-a-free-tier-model-provider-for-inference-hosted-daytona-for-the-sandbox)
9. [Code senses, the agent judges, hard rules guard the dangerous cases](#9-code-senses-the-agent-judges-hard-rules-guard-the-dangerous-cases)
10. [Sensors: language-agnostic base, Python audit hook on top, TLS later](#10-sensors-language-agnostic-base-python-audit-hook-on-top-tls-later)
11. [Cujo reviews the whole PR by running it; detonation is one check](#11-cujo-reviews-the-whole-pr-by-running-it-detonation-is-one-check) — narrowed by 133
12. [Findings with severity, not a single verdict](#12-findings-with-severity-not-a-single-verdict)
13. [Agent infers repo commands; `.cujo.yml` overrides](#13-agent-infers-repo-commands-cujoyml-overrides) — extended by 135
14. [One subagent per check](#14-one-subagent-per-check) — refined by 124
15. [No tests means one `warn` and stop](#15-no-tests-means-one-warn-and-stop) — refined by 87
16. [One session per PR; `apps/cujo` owns idempotency](#16-one-session-per-pr-appscujo-owns-idempotency) — refined by 47, excepted by 137
17. [Cujo owns the operator UI; TrueForge is a dependency, not a destination](#17-cujo-owns-the-operator-ui-trueforge-is-a-dependency-not-a-destination) — superseded by 27, and refined by 123
18. [`apps/cujo` is a projection of TrueForge, not a source of truth](#18-appscujo-is-a-projection-of-trueforge-not-a-source-of-truth) — refined by 123
19. [The sensor script reaches the sandbox by public URL, not by upload](#19-the-sensor-script-reaches-the-sandbox-by-public-url-not-by-upload) — superseded by 46
20. [One run, one turn chain; the newest head supersedes the rest](#20-one-run-one-turn-chain-the-newest-head-supersedes-the-rest) — superseded in part by 39
21. [The hard rules are re-derived in `apps/cujo`, not only in the rubric](#21-the-hard-rules-are-re-derived-in-appscujo-not-only-in-the-rubric) — amended by 140
22. [A brand system in `brand/`: guard dog, amber, dark and light](#22-a-brand-system-in-brand-guard-dog-amber-dark-and-light)
23. [Discord is notified by `apps/cujo`, not by the agent, and it notifies only](#23-discord-is-notified-by-appscujo-not-by-the-agent-and-it-notifies-only) — amended by 138
24. [The repo-to-channel binding lives in the store, not the environment](#24-the-repo-to-channel-binding-lives-in-the-store-not-the-environment) — superseded by 28, then by 31
25. [New tables, not new columns: the store has no migration path](#25-new-tables-not-new-columns-the-store-has-no-migration-path)
26. [Every Discord payload is treated as attacker-controlled](#26-every-discord-payload-is-treated-as-attacker-controlled)
27. [The operator UI is `apps/web`; `apps/cujo` becomes API-only](#27-the-operator-ui-is-appsweb-appscujo-becomes-api-only)
28. [Two tiers: an operator authorizes a server, the server configures itself](#28-two-tiers-an-operator-authorizes-a-server-the-server-configures-itself) — superseded by 31 and 49, amended by 138
29. [Slash commands over the HTTP interactions endpoint, registered per server](#29-slash-commands-over-the-http-interactions-endpoint-registered-per-server)
30. [The store gets a migration path, at the first change that needed one](#30-the-store-gets-a-migration-path-at-the-first-change-that-needed-one)
31. [The repo declares its Discord server; the operator route becomes an override](#31-the-repo-declares-its-discord-server-the-operator-route-becomes-an-override) — superseded in part by 57
32. [The file tree carries the trust boundary, not the layer](#32-the-file-tree-carries-the-trust-boundary-not-the-layer)
33. [The origin accepts Cloudflare only; the ACME path is bypassed to match](#33-the-origin-accepts-cloudflare-only-the-acme-path-is-bypassed-to-match)
34. [The run board is public and read-only; the operator surface moves hosts](#34-the-run-board-is-public-and-read-only-the-operator-surface-moves-hosts) — superseded in part by 57
35. [Merging is the deploy, so an env-coupled change is valid on both sides](#35-merging-is-the-deploy-so-an-env-coupled-change-is-valid-on-both-sides)
36. [The review links to its own evidence, and the bot wears the brand](#36-the-review-links-to-its-own-evidence-and-the-bot-wears-the-brand)
37. [Logging is a closed vocabulary on stdout, and readiness is not liveness](#37-logging-is-a-closed-vocabulary-on-stdout-and-readiness-is-not-liveness)
38. [`apps/cujo` may write a reaction; the gate is about reviews, not writes](#38-appscujo-may-write-a-reaction-the-gate-is-about-reviews-not-writes) — reversed in part by 138
39. [A superseded run answers its pending approval](#39-a-superseded-run-answers-its-pending-approval) — refined by 125, reversed by 138
40. [A single-server deploy may name its server, and skip the declaration](#40-a-single-server-deploy-may-name-its-server-and-skip-the-declaration)
41. [One sensed command at a time, and one audit log per command](#41-one-sensed-command-at-a-time-and-one-audit-log-per-command)
42. [The projection holds two reviews, and a blocking review can end a run](#42-the-projection-holds-two-reviews-and-a-blocking-review-can-end-a-run) — reversed by 138
43. [`apps/cujo` may reply on a pull request, because a person asked it to](#43-appscujo-may-reply-on-a-pull-request-because-a-person-asked-it-to)
44. [Repo write is the principal that may publish an accusation](#44-repo-write-is-the-principal-that-may-publish-an-accusation) — amended by 138
45. [The signature-gated plane may answer a held finding](#45-the-signature-gated-plane-may-answer-a-held-finding) — amended by 138
46. [The sensors are a package, delivered as a source archive](#46-the-sensors-are-a-package-delivered-as-a-source-archive) — reversed in part by 117
47. [Conversation runs in its own session, and the agent that answers cannot write](#47-conversation-runs-in-its-own-session-and-the-agent-that-answers-cannot-write)
48. [`sniff.py` is an entry point, and state lives beside the code](#48-sniffpy-is-an-entry-point-and-state-lives-beside-the-code)
49. [The operator plane swaps an email for a shared token, because it no longer decides anything](#49-the-operator-plane-swaps-an-email-for-a-shared-token-because-it-no-longer-decides-anything) — superseded by 57
50. [`issue_comment` costs the App a permission, and decision 43's check did not cover it](#50-issue_comment-costs-the-app-a-permission-and-decision-43s-check-did-not-cover-it)
51. [A shipped design document is deleted, and the log carries its own reversals](#51-a-shipped-design-document-is-deleted-and-the-log-carries-its-own-reversals)
52. [`apps/cujo` dismisses its own stale blocking reviews when a clean run supersedes them](#52-appscujo-dismisses-its-own-stale-blocking-reviews-when-a-clean-run-supersedes-them)
53. [Reasoning effort is a deployment setting, not a constant](#53-reasoning-effort-is-a-deployment-setting-not-a-constant)
54. [The report says what it could not observe](#54-the-report-says-what-it-could-not-observe)
55. [A card names both parties, and a login reaches a URL only through an allowlist](#55-a-card-names-both-parties-and-a-login-reaches-a-url-only-through-an-allowlist) — reversed by 86
56. [A provider must declare the reasoning efforts it will accept](#56-a-provider-must-declare-the-reasoning-efforts-it-will-accept) — reversed by 127
57. [The operator plane is deleted; every route is signature-gated or anonymous](#57-the-operator-plane-is-deleted-every-route-is-signature-gated-or-anonymous) — amended by 138
58. [A sensor may not read the tripwire it is watching](#58-a-sensor-may-not-read-the-tripwire-it-is-watching)
59. [The checks start together, because nothing was ever waiting](#59-the-checks-start-together-because-nothing-was-ever-waiting) — superseded in part by 73
60. [The prompt for a maintainer is written by the thing it instructs](#60-the-prompt-for-a-maintainer-is-written-by-the-thing-it-instructs) — reversed by 138
61. [The model is trusted; the pull request is not](#61-the-model-is-trusted-the-pull-request-is-not)
62. [The report validator may only add](#62-the-report-validator-may-only-add)
63. [`/cujo review` re-reviews the current head, on the same principal](#63-cujo-review-re-reviews-the-current-head-on-the-same-principal) — amended by 138
64. [Nothing says when a compaction happened, so Cujo does not](#64-nothing-says-when-a-compaction-happened-so-cujo-does-not) — reversed by 129
65. [A public list row carries what the checks measured, not only the verdict](#65-a-public-list-row-carries-what-the-checks-measured-not-only-the-verdict)
66. [The sandbox must never crash silently; sensor logs count what they lost](#66-the-sandbox-must-never-crash-silently-sensor-logs-count-what-they-lost)
67. [The setup window is measured, because guessing at it picks the wrong fix](#67-the-setup-window-is-measured-because-guessing-at-it-picks-the-wrong-fix)
68. [Nothing in the chamber exists that is not a measurement](#68-nothing-in-the-chamber-exists-that-is-not-a-measurement) — amended by 80
69. [Losing the stream is not a verdict; only the watchdog ends a turn](#69-losing-the-stream-is-not-a-verdict-only-the-watchdog-ends-a-turn) — refined by 124
70. [Probe scripts are captured by the sensor, not self-reported by the agent](#70-probe-scripts-are-captured-by-the-sensor-not-self-reported-by-the-agent)
71. [The mechanical half of setup is one command, because none of it is a decision](#71-the-mechanical-half-of-setup-is-one-command-because-none-of-it-is-a-decision) — extended by 134
72. [A length cap is spent on the escaped text, not on the text](#72-a-length-cap-is-spent-on-the-escaped-text-not-on-the-text)
73. [`detonation` starts during setup, and the install takes the lock so it can](#73-detonation-starts-during-setup-and-the-install-takes-the-lock-so-it-can)
74. [The server owns the review body, not only its footer](#74-the-server-owns-the-review-body-not-only-its-footer) — amended by 138
75. [The record is one field of a fixed length, and an empty one is armed](#75-the-record-is-one-field-of-a-fixed-length-and-an-empty-one-is-armed)
76. [Interpreter and index coverage is additive, not exhaustive](#76-interpreter-and-index-coverage-is-additive-not-exhaustive)
77. [Detonation covers every ecosystem `MANIFESTS` recognises](#77-detonation-covers-every-ecosystem-manifests-recognises)
78. [The Python suite runs in parallel, and a superseded run is cancelled](#78-the-python-suite-runs-in-parallel-and-a-superseded-run-is-cancelled)
79. [Entry selectivity: drafts, labels, and docs-only advisory](#79-entry-selectivity-drafts-labels-and-docs-only-advisory)
80. [The chamber may have air in it, and the air is two files](#80-the-chamber-may-have-air-in-it-and-the-air-is-two-files) — amended by 81 and 82
81. [Depth is time; across the volume means nothing, and says so](#81-depth-is-time-across-the-volume-means-nothing-and-says-so) — amended by 82
82. [The record is a galaxy, and a run is a star with orbits](#82-the-record-is-a-galaxy-and-a-run-is-a-star-with-orbits) — amended by 90 and 95
83. [A star's tilts are its own, the read walks the stars, and the copy is a caption](#83-a-stars-tilts-are-its-own-the-read-walks-the-stars-and-the-copy-is-a-caption) — amended by 95
84. [A lane says how bad, not what happened; the sentence is where the sentence fits](#84-a-lane-says-how-bad-not-what-happened-the-sentence-is-where-the-sentence-fits)
85. [An observed zero is a result; an unobserved one is not](#85-an-observed-zero-is-a-result-an-unobserved-one-is-not) — amended by 93
86. [The alert gets its own card, and the opener takes the author line](#86-the-alert-gets-its-own-card-and-the-opener-takes-the-author-line) — amended by 138
87. [Detonation runs even when no test suite can be inferred](#87-detonation-runs-even-when-no-test-suite-can-be-inferred)
88. [One results cell, and the whole row is the link](#88-one-results-cell-and-the-whole-row-is-the-link)
89. [The key comes to the pointer](#89-the-key-comes-to-the-pointer)
90. [Every star tumbles, and a live one tumbles fast](#90-every-star-tumbles-and-a-live-one-tumbles-fast)
91. [The verdict is a card; the operator's numbers fold away](#91-the-verdict-is-a-card-the-operators-numbers-fold-away)
92. [Latest and superseded, derived on the board](#92-latest-and-superseded-derived-on-the-board)
93. [Nothing on the run page opens itself](#93-nothing-on-the-run-page-opens-itself)
94. [Running is green](#94-running-is-green)
95. [The gates go, depth wanders, and the light beats the star it reads](#95-the-gates-go-depth-wanders-and-the-light-beats-the-star-it-reads)
96. [The envelope roll-up is the model's work, so the schema reads it leniently](#96-the-envelope-roll-up-is-the-models-work-so-the-schema-reads-it-leniently)
97. [The template tires the reader, not the model](#97-the-template-tires-the-reader-not-the-model)
98. [The board carries the manual, and it is the one thing indexed](#98-the-board-carries-the-manual-and-it-is-the-one-thing-indexed)
99. [The watchdog bounds the run, not the current process](#99-the-watchdog-bounds-the-run-not-the-current-process)
100. [Cujo leads the card, the opener closes it, and the sections breathe](#100-cujo-leads-the-card-the-opener-closes-it-and-the-sections-breathe)
101. [The page does not bounce](#101-the-page-does-not-bounce)
102. [The key waits for a stay](#102-the-key-waits-for-a-stay)
103. [The verdict card stops linking out](#103-the-verdict-card-stops-linking-out)
104. [Supersede, do not delete, on re-review](#104-supersede-do-not-delete-on-re-review)
105. [SessionEvents are validated at the boundary](#105-sessionevents-are-validated-at-the-boundary)
106. [Every expanded link carries the one branded still](#106-every-expanded-link-carries-the-one-branded-still)
107. [A run that proved nothing is `unproven`, not `clean`](#107-a-run-that-proved-nothing-is-unproven-not-clean)
108. [A failed check is respawned once, by the rubric, and the run records it](#108-a-failed-check-is-respawned-once-by-the-rubric-and-the-run-records-it) — amended by 143
109. [A timed-out run posts what it measured, as a comment and never a review](#109-a-timed-out-run-posts-what-it-measured-as-a-comment-and-never-a-review) — amended by 138
110. [Operational hard rules reach the author, as a follow-up comment](#110-operational-hard-rules-reach-the-author-as-a-follow-up-comment)
111. [Where a command runs and what the sensors call the workspace are two questions](#111-where-a-command-runs-and-what-the-sensors-call-the-workspace-are-two-questions)
112. [`sniff.py` assembles the envelope, because asking a model to did not work](#112-sniffpy-assembles-the-envelope-because-asking-a-model-to-did-not-work) — extended by 145, completed by 147
113. [The sandbox is an interface, reached through MCP and not through the harness](#113-the-sandbox-is-an-interface-reached-through-mcp-and-not-through-the-harness) — refined by 128
114. [`sandbox-mcp` cannot carry the hardening the other services do](#114-sandbox-mcp-cannot-carry-the-hardening-the-other-services-do)
115. [`provisioned_ms` replaces the `sandbox.created` event](#115-provisioned_ms-replaces-the-sandboxcreated-event)
116. [Egress is enforced outside the sandbox, and its allowlist is a crossing](#116-egress-is-enforced-outside-the-sandbox-and-its-allowlist-is-a-crossing) — refined by 121
117. [The sandbox image is ours, which reverses 46](#117-the-sandbox-image-is-ours-which-reverses-46)
118. [`sandbox-mcp` builds the images it runs, at boot, from contexts it carries](#118-sandbox-mcp-builds-the-images-it-runs-at-boot-from-contexts-it-carries)
119. [No review bot; `best_practices.md` goes with it](#119-no-review-bot-best_practicesmd-goes-with-it)
120. [`sandbox-mcp` says `requireApprovalForTools: []`, because absent means everything](#120-sandbox-mcp-says-requireapprovalfortools--because-absent-means-everything) — reversed in part by 128, amended by 138
121. [The gateway is the sandbox's router and resolver, which refines 116](#121-the-gateway-is-the-sandboxs-router-and-resolver-which-refines-116)
122. [The gateway's baseline is the sensor's known-host list](#122-the-gateways-baseline-is-the-sensors-known-host-list)
123. [The harness is ours, built on pi, and the contract is a package](#123-the-harness-is-ours-built-on-pi-and-the-contract-is-a-package)
124. [A sub-agent is a nested pi session, and its report is durable as it lands](#124-a-sub-agent-is-a-nested-pi-session-and-its-report-is-durable-as-it-lands)
125. [The gate holds the call; a new turn voids it; a restart is answered by a re-call](#125-the-gate-holds-the-call-a-new-turn-voids-it-a-restart-is-answered-by-a-re-call) — amended by 138
126. [A gated tool runs sequentially, so the observation posts before the pause](#126-a-gated-tool-runs-sequentially-so-the-observation-posts-before-the-pause) — amended by 138
127. [Reasoning effort is clamped by the harness, not declared by the provider](#127-reasoning-effort-is-clamped-by-the-harness-not-declared-by-the-provider)
128. [MCP tools are exposed by name, and only exact names are gated](#128-mcp-tools-are-exposed-by-name-and-only-exact-names-are-gated) — amended by 138
129. [Compaction is pi's context-window rule](#129-compaction-is-pis-context-window-rule)
130. [A harness restart ends a running turn as an error, so Cujo retries it once](#130-a-harness-restart-ends-a-running-turn-as-an-error-so-cujo-retries-it-once) — amended by 138 and 140
131. [A sensed command refuses to open a second window](#131-a-sensed-command-refuses-to-open-a-second-window)
132. [A token budget in the spec, enforced by the harness](#132-a-token-budget-in-the-spec-enforced-by-the-harness)
133. [Cujo is a diff reviewer that can execute; the sandbox is a tool and a floor](#133-cujo-is-a-diff-reviewer-that-can-execute-the-sandbox-is-a-tool-and-a-floor) — amended by 138
134. [The diff review's package is prepared in code](#134-the-diff-reviews-package-is-prepared-in-code)
135. [Review mode: deploy default, `.cujo.yml` from base, floors the code enforces](#135-review-mode-deploy-default-cujoyml-from-base-floors-the-code-enforces)
136. [A diff finding is at most `warn` and always advisory; a `critical` is a contradiction, not clamped](#136-a-diff-finding-is-at-most-warn-and-always-advisory-a-critical-is-a-contradiction-not-clamped) — amended by 138
137. [A diff run gets its own harness session](#137-a-diff-run-gets-its-own-harness-session)
138. [The block is a check run, and the human decision is the unlock](#138-the-block-is-a-check-run-and-the-human-decision-is-the-unlock)
139. [Seven run states; the gate's three are migrated](#139-seven-run-states-the-gates-three-are-migrated)
140. [A review is what posted, not what was called](#140-a-review-is-what-posted-not-what-was-called)
141. [The run keeps a token ledger per thread](#141-the-run-keeps-a-token-ledger-per-thread)
142. [Exec output is bounded at the tool, and the rest stays in the box](#142-exec-output-is-bounded-at-the-tool-and-the-rest-stays-in-the-box)
143. [A timeout is an answer, not a failure](#143-a-timeout-is-an-answer-not-a-failure)
144. [A push burst is one run](#144-a-push-burst-is-one-run)
145. [A pinned specifier is detonated once per instance per week](#145-a-pinned-specifier-is-detonated-once-per-instance-per-week) — amended by 148
146. [A report lists what the rules read, and a spawned check owes one](#146-a-report-lists-what-the-rules-read-and-a-spawned-check-owes-one)
147. [The report is the tool result, not the model's copy of it](#147-the-report-is-the-tool-result-not-the-models-copy-of-it)
148. [A cached detonation never crosses the model](#148-a-cached-detonation-never-crosses-the-model)
149. [Open Code Review runs beside a review and posts nothing](#149-open-code-review-runs-beside-a-review-and-posts-nothing)
150. [`/cujo review` starts a fresh session](#150-cujo-review-starts-a-fresh-session)
151. [A repository registry, fed by the installation events](#151-a-repository-registry-fed-by-the-installation-events)
152. [The models and the provider live in the store, seeded once from the environment](#152-the-models-and-the-provider-live-in-the-store-seeded-once-from-the-environment)
153. [The owner plane: GitHub sign-in on the App's own OAuth, any admin of the installation](#153-the-owner-plane-github-sign-in-on-the-apps-own-oauth-any-admin-of-the-installation)
154. [The run page is an evidence log](#154-the-run-page-is-an-evidence-log)
155. [Per-repository settings and instructions, the file winning](#155-per-repository-settings-and-instructions-the-file-winning)
156. [The owner's pages: repositories, one repository, and sign-in on the footer](#156-the-owners-pages-repositories-one-repository-and-sign-in-on-the-footer)
157. [The instance page, and the App as GitHub sees it](#157-the-instance-page-and-the-app-as-github-sees-it)

## 1. Build on stock TrueForge — no fork

**Reversed by 123.** The harness is `apps/harness`, built on the pi coding agent SDK; TrueForge is gone from the deploy.

Use the published `@truefoundry/trueforge` package as-is. The rubric rewards
using the harness well (real MCP tools, sandbox execution, human approvals), not
modifying it; no criterion rewards upstream contributions. A fork adds
maintenance and risk for no score. Everything Cujo needs is reachable through
configuration and the SDK.

## 2. Hosted mode on Hetzner via Coolify, gated by Cloudflare Access

**Superseded in part by 34, 49 and 57, and the rest by 123.** There is no
hosted-mode harness and no console left to gate: `apps/harness` is a
single-process service on a volume. The operator plane is gone
entirely, and its Access gate with it; the `cujo-harness` console gate
stands and is now the only one anywhere in this system.

TrueForge runs in hosted mode (Postgres + Redis) on one Hetzner server, deployed
by Coolify. Its bundled UI is reachable at `cujo-harness.spencerjireh.com` as an
operator console, behind Cloudflare Access (email OTP) because TrueForge's own
auth is disabled — without a gate, anyone reaching it would be admin. The
product surface, `cujo.spencerjireh.com`, is Cujo's own UI (see 17); it sits
behind the same Access policy. The Coolify control plane stays on a separate
host that never runs untrusted code. (Revised 2026-08-27: the first design put
the TrueForge UI on `cujo.spencerjireh.com` as the surface where a human
approved a block.)

## 3. In-sandbox logging proxy — not Daytona's `outboundProxyUrl`

Egress is observed by a proxy started *inside* the sandbox, with
`HTTP(S)_PROXY` exported for every process the checks spawn. Stock TrueForge's
Daytona create call passes no network options, so the sandbox's outbound proxy
cannot be set from outside without forking. Given decision 1, the in-sandbox
proxy is the way to see egress without patching the harness. It observes
processes that honour the proxy variables; a direct socket from non-Python
code is a known gap, closed later by a network-namespace or iptables redirect
inside the sandbox.

## 4. Bot identity is a GitHub App — `cujo-guard[bot]`

Cujo posts as a GitHub App, not a human account. The App receives the PR webhooks
and, through its private key, mints short-lived installation tokens the way
Dependabot and Qodo do — the canonical bot auth flow. It needs no second user
account, and it scopes permissions to the app rather than to a person. Bare
`cujo` is an existing GitHub account, so the App is **Cujo Guard** (slug
`cujo-guard`) and reviews post as `cujo-guard[bot]`.

## 5. The agent posts the review via MCP, not the `apps/cujo` code

The review is posted by the agent calling a `github-mcp` tool, not by
`apps/cujo` calling the GitHub API directly. Two reasons: real MCP tool use
is what the harness is for, and the human-approval gate should sit on the
*agent's* action. If plumbing posted the review, the "agent, gated by a human" story would
be hollow. `github-mcp` is a small server we own that authenticates as the App.

## 6. Reviews auto-post; the human gate is on the block

**Superseded by 42.** The gate no longer fires on any blocking review, only
on the accusation.

Gating every review post would turn an automation tool into a manual one and
destroy its value. Instead, advisory reviews post automatically, and the
human-approval gate fires only on a blocking review. This keeps the routine
case automatic and gives the human a real decision to make instead of a rubber
stamp. It also fits the rule "ask before a sensitive action" better: blocking a
merge is sensitive, whereas posting a comment is not. (Revised 2026-08-25 after
the first design gated all posts.)

## 7. The webhook route is on a non-Access hostname

GitHub cannot solve a Cloudflare Access OTP challenge, so the webhook endpoint
cannot sit behind Access. `apps/cujo` (see 17) serves two hostnames: its
webhook route is published at `cujo-ingress.spencerjireh.com` with no Access
policy, protected only by the webhook HMAC signature, and its UI and API at
`cujo.spencerjireh.com` behind Access. Both reach TrueForge over the internal
compose network. Hostnames are one level deep (`cujo-ingress`, not
`ingress.cujo`) because the zone's Universal SSL covers only
`*.spencerjireh.com`; a proxied two-level name needs Advanced Certificate
Manager, a paid add-on the zone does not have.

## 8. A free-tier model provider for inference; hosted Daytona for the sandbox

Inference runs on a model provider's free tier. The key is registered once on
the TrueForge server (through the operator console or a bootstrap call), and the
agent spec references the model by name, so the provider can change without
touching the repo. Hosted Daytona ($200 credit) is the sandbox
provider; self-hosted Daytona is a later stretch, not needed for the demo.

## 9. Code senses, the agent judges, hard rules guard the dangerous cases

The sandbox run emits raw signals with no judgment; the agent reasons over
them against the rubric to assign each finding a severity; and deterministic
rules force `critical` whenever a critical signal is present, which the agent
cannot override. The hard rules: a test that passes on base and fails on head;
the decoy secret read or seen leaving; a write to a sensitive path; egress to a
host that is neither a package index nor allowlisted, during an install. The
regression tripwire is the one the demo leans on: a diff can look like a tidy
refactor and still break a test, and the model must not be able to talk itself
out of that. This keeps real reasoning in the agent for the ambiguous majority
while making the genuinely dangerous cases impossible to reason away. Chosen
over a thin agent (code decides everything, weak harness story) and a thick
agent (model decides everything, unreliable on the security call).

## 10. Sensors: language-agnostic base, Python audit hook on top, TLS later

Three sensors work for any language: the in-sandbox proxy (egress hosts and
byte counts), a filesystem diff (writes outside the workspace and to sensitive
paths), and an inotify watcher on the decoy file (reads; chosen over
access-time comparison because `relatime` and `noatime` make `atime`
unreliable). When a check runs Python, a
`sys.addaudithook` hook injected via `sitecustomize.py` on `PYTHONPATH` is
layered on and gives richer file, socket, and subprocess detail; it rides into
every Python subprocess, including pip running `setup.py`. No `strace`, no
special capability, no traffic decryption. TLS interception (mitmproxy with a
trusted CA) is a later upgrade that turns "we saw the secret read" into "we saw
the secret leave" — not required for the first working demo.

## 11. Cujo reviews the whole PR by running it; detonation is one check

**Narrowed by 133.** Every pull request still gets a review; which one is its
mode. The argument below is the sandbox review's, and it still holds for every
pull request the floors send there.

The argument for the sandbox — the PR asks you to run a stranger's code —
applies to every line of a PR, not only a dependency's `setup.py`, and a review
that cites execution evidence (a test that fails on head, a probe that
contradicts the diff, an endpoint that errors) is what a diff-only reviewer
such as Qodo cannot produce. So every PR gets a run: `tests`, `probes`,
`smoke`, and `detonation` when a dependency manifest changed. The hostile demo
sample is never published to a public index; it arrives as a `git+https://`
line in a PR, so the payload stays under our control.

## 12. Findings with severity, not a single verdict

A code review is multi-dimensional; one word cannot carry a failing test and a
suspicious host at once. Each finding gets a severity (`info`, `warn`,
`critical`) and an optional line anchor. The block decision stays binary: any
`critical` finding routes to the gated `post_blocking_review`
(REQUEST_CHANGES); otherwise `post_advisory_review` posts a COMMENT with the
summary and inline comments. The bot never posts a formal APPROVE, so it can
never satisfy branch protection and wave a bad merge through.

## 13. Agent infers repo commands; `.cujo.yml` overrides

**Extended by 135.** `mode:` joins the keys, read from base like the rest, and
by the service rather than the agent.

No setup burden on the target repo: the agent reads `pyproject.toml`,
`package.json`, `Makefile`, and CI workflows to pick install, test, boot, and
smoke commands. A `.cujo.yml` (`install`, `test`, `boot`, `smoke`,
`allow_hosts`) pins any of them when a repo owner wants determinism. The file
is read from the base SHA, never from the PR: policy comes from the branch the
PR targets, so a PR cannot allowlist its own exfiltration host, and a PR that
edits `.cujo.yml` gets a `warn` finding instead of having the edit applied.
Chosen over a required config file (a repo without it would get no
execution-backed review) and over parsing CI workflows alone (tight coupling
to CI shape).

## 14. One subagent per check

**Refined by 124.** Still one per check; each is now a nested pi session in `apps/harness`, and its events are durable as they land.

Each check (`tests`, `probes`, `smoke`, `detonation`) runs in a TrueForge
dynamic subagent with fresh context; only its JSON report returns to the
parent. This keeps each check's context small and focused, keeps a noisy test
log from crowding out the detonation report, and lets a check fail on its
own without taking the others with it. The parent owns setup, the hard rules,
synthesis, and the post.

## 15. No tests means one `warn` and stop

**Refined by 87.** `detonation` now runs even when no suite is found; the
stop applies only to `tests`, `probes`, and `smoke`.

If the repo has no test suite and `.cujo.yml` names none, the parent posts a
single `warn` finding ("no test suite found") and runs nothing else. Without a
suite the regression tripwire cannot fire, so execution evidence would be
thin, and the missing suite is itself the most useful thing to say. Chosen
over falling back to probes and smoke (execution without a baseline) and over
a diff-only review (which Qodo already provides).

## 16. One session per PR; `apps/cujo` owns idempotency

**Excepted by 137.** A diff run gets a fresh session each time; the sandbox
review keeps its per-PR session.

**Refined by 47.** One session per pull request still holds for the review;
conversation runs in a second session of its own.

A PR maps to one TrueForge session keyed by repo and PR number; a
`synchronize` event runs a new turn in it, so the agent can see what it said
before. `apps/cujo` checks the PR's existing reviews before starting a turn and
skips it if `cujo-guard[bot]` already reviewed the current head SHA. That keeps
a retried webhook from double-posting and keeps `github-mcp` write-only.

## 17. Cujo owns the operator UI; TrueForge is a dependency, not a destination

**Superseded by 27, and refined by 123.** The operator UI is `apps/web`;
`apps/cujo` is API-only. There is no harness console at all any more, so the
rule that nobody approves in one holds by construction.

The human who approves a block does it in Cujo's own UI, not in TrueForge's
bundled chat. `apps/ingress` grows into `apps/cujo`: one service that receives
the webhook, starts the turn, consumes the turn's event stream, renders the
run, and resumes the paused turn when a human approves. It is TrueForge's only
client. TrueForge keeps every runtime job it had — the model loop, the Daytona
sandbox, the subagents, sessions, and the approval pause — and gives up one
thing: being the surface a person looks at.

Why: a customer of a PR review bot wants to see which PRs ran, what the checks
found, and one button to approve or reject the block, not an agent transcript.
The product is used through its UI, and one we did not build could not carry
the brand or the approval flow as designed. The harness loses nothing: it does
the same work, Cujo's UI is plainly a client of the harness API, and driving
the approval gate over the SDK uses the harness as infrastructure rather than
as a chat window. Decision 1 (stock TrueForge, no fork) holds; the SDK and
HTTP API are a published interface.

What was verified against the TrueForge source (SDK 0.1.3, read 2026-08-27):

- The pause is an event. `tool.approval_required` carries `thread_id` and
  `tool_calls[{id, source_event_id}]`; the turn ends with `turn.done` and
  `required_actions` (`packages/trueforge-core/src/core/events/schema.ts`).
- Resume is an SDK call. `sessions.createTurnStream(sessionId, {input:
  [{type: 'user.tool_approval', threadId, toolCallId, approval: {status:
  'allow' | 'deny'}}]})`. One send must answer every pending approval, and a
  second answer for the same call is rejected
  (`packages/trueforge-core/src/core/runtime/AgentThread.ts:350`).
- Subagent work is visible. Every event carries `thread_id`; `thread.created`
  has `parent.{thread_id, tool_call_id}` and a `title`; `thread.done` carries
  `state.output`, the subagent's final message. Child-thread `tool.response`
  events arrive in the same turn stream.
- A run can be rebuilt. `sessions.listEvents`, `listTurnEvents`, and
  `subscribeToTurn` exist, so `apps/cujo` keeps no event log of its own.
- The agent can be defined per session. `sessions.create({agent: {spec:
  {model, instructions, mcpServers, config, skills}}})`, so the rubric and
  hard rules live in the repo as code. MCP servers are referenced by the name
  they were registered under on the server.
- Auth is OIDC or nothing. With `OIDC_*` unset the server runs as a fixed local
  admin (`packages/trueforge/src/config.ts:242`). There is no API-key mode, so
  `apps/cujo` talks to TrueForge on the compose network and Cloudflare Access
  is what keeps strangers out of both UIs.
- The subagent spawn tool is not approval-gated
  (`packages/trueforge-core/src/core/capabilities/builtins/DynamicSubAgents.ts:142`),
  so checks run without pausing; only `post_blocking_review` pauses, on the
  `main` thread.

The operator-console rule: TrueForge's UI stays reachable behind Access for
reading transcripts, registering the model key and the `github-mcp` connector,
and debugging. Humans read there; they never click Allow or send a message
into a Cujo session there. Stock TrueForge cannot disable those controls
without a fork (decision 1), so the rule is a convention, and the design does
not depend on it holding: `apps/cujo` stays subscribed to the session after a
pause, so a resume started from the console is seen, the run still reaches
`blocked_posted` or `denied`, and the approver is recorded as `external` and
shown as such in the UI (Contract 6). A stray message is the worse case — it
appends a user turn the agent acts on — and is why the console is not the
product surface.

What does not change: the trust boundary, the sandbox contract, the hard rules,
the two review tools and their gate, and one session per PR.

## 18. `apps/cujo` is a projection of TrueForge, not a source of truth

**Refined by 123.** Still a projection; the event log it projects is now `apps/harness`'s SQLite table, read whole.

TrueForge keeps the event log. `apps/cujo` stores only what TrueForge cannot
know — the PR-to-session map, the derived run status, and who approved — and
rebuilds everything else from `listTurnEvents` after a restart. So there is no
second event store to drift out of sync, and no migration for event data. It is
one Node process (webhook route, stream consumer, API, static UI) with a SQLite
file on a volume; splitting it is a later problem. `github-mcp` stays a
separate container because it holds the GitHub App private key and is the
process TrueForge calls as a tool; folding it in would put the key in the
public-facing service. The approve route validates the Cloudflare Access JWT
(`Cf-Access-Jwt-Assertion`) so a direct request cannot skip the OTP, and
records the approver's email on the run as the human-oversight audit trail.

## 19. The sensor script reaches the sandbox by public URL, not by upload

**Superseded by 46.** The sensors are a package, delivered as a source
archive from `CUJO_SNIFF_TARBALL_URL`.

The agent fetches `sniff.py` with `curl` from `CUJO_SNIFF_URL`, the raw GitHub
URL of this repo's `main`, before any check runs. Nothing on the server pushes
the file in, so the trust boundary stays as decision 4 states it: the only
things that enter the sandbox are the PR's public clone and Cujo's own script
and commands, fetched without a credential. The cost is that a sandbox needs
egress to `raw.githubusercontent.com` at setup, which is on the known-host list
anyway. Pinning the URL to a commit instead of `main` is a one-variable change
when the script is stable; while the script is still changing, `main` keeps
the sandbox and the repo in step.

The harness's own Git-backed skills would carry the rubric the same way, and
are the natural next step: `agent/SKILL.md` is already in the skill format so
registering it as a skill later is a bootstrap call, not a rewrite.

## 20. One run, one turn chain; the newest head supersedes the rest

**Superseded in part by 39.** A superseded run answers its pending approval
before it cancels its turn.

Decision 16 puts every run on a PR in one session, so a run must know which
turns on that session are its own. It records the id of each turn it creates
(`createTurn`, then `subscribeToTurn`) before the first event, and Cujo's own
resume turns are persisted too; a turn another run recorded is never adopted,
and a run with no recorded turn after a restart ends in `error` rather than
guessing from timestamps. That errored, turnless run does not hold its head,
so a redelivery re-claims it. Chosen over deriving ownership from the event
stream (the first `turn.created` after the run's creation time), which folded
the next head's turn into a run that was still waiting on a human.

When GitHub's current head differs from a run's head, that run is
`superseded`: it stops following its turn, no decision can be made on it, and
a turn still running on the harness is cancelled so it cannot post a review
for a commit nobody is looking at. The webhook confirms the head with GitHub
rather than trusting delivery order, because a delayed delivery for an older
commit can arrive after the newer one. Chosen over keeping both runs live,
which would let a human approve a blocking review on a stale SHA.

Cancelling the turn turned out not to be enough for a run that was waiting on a
human: a superseded run answers its pending approval too, or the pull request
becomes unreviewable for good (decision 39).

## 21. The hard rules are re-derived in `apps/cujo`, not only in the rubric

Contract 3 calls Layer 1 "deterministic, code", but until this decision the
rules lived in two places that are both untrusted at the moment of judgment:
prose in `agent/SKILL.md` that the model applies, and `derived` booleans that
`sniff.py` computes inside the sandbox. `apps/cujo` now reads every check
report as its `thread.done` arrives and derives the hard-rule findings itself
(`apps/cujo/src/findings.ts`), so a `critical` the sensors recorded cannot be
reasoned away or dropped between the sandbox and the review. The agent's own
findings ride on the review tool call as `findings[]` and are merged after the
hard-rule ones.

What `apps/cujo` cannot do is stop the advisory review from posting:
`post_advisory_review` is deliberately ungated. So when the agent posts an
advisory review while a hard rule has tripped, the run ends `error` with the
rule named, not `clean`. Chosen over gating the advisory tool too (every review
would then wait for a human, which is the product's value lost) and over
re-posting a blocking review from `apps/cujo` (that would make `apps/cujo` a
second author of reviews and break "one review per turn"). The rubric still
carries the rules so the common case takes the blocking path on its own; the
trusted-side check is the tripwire behind the tripwire.

## 22. A brand system in `brand/`: guard dog, amber, dark and light

Cujo had no logo, palette, or type, and the UI is the surface the product is
judged on (see 17). One source of truth in `brand/` now feeds the UI and the
README, so they cannot drift apart. The
choices: keep the name and read it as a guard dog on a chain (loyal, watchful,
contained), which is what `cujo-guard[bot]` and the approval gate already say;
a flat geometric dog head with one amber eye as the mark; lowercase `cujo` in
Bricolage Grotesque with JetBrains Mono for evidence; warm near-black and warm
bone grounds with both themes built at once; amber as the brand accent and
`high`, red reserved for `critical` so the two never blur.

Rejected: renaming (the name is short, memorable, and already in every
handle); the rabid reading (it undercuts the restraint story); a cage-only or
detonation mark (abstract, loses the name); pixel and single-line styles (fail
at 16 px); red-orange as the accent (too close to critical). Five hand-authored
candidates stay in `brand/logo/candidates/` with prompts for a raster route, so
the mark can be swapped without redoing the system. The tagline is deliberately
unset. Wiring the tokens and favicon into `apps/cujo` was deferred to a separate
change; that operator plane is gone (decision 57), and the favicon now lives in
`apps/web` as `src/app/icon.svg` with `icon.png` beside it, copied from
`brand/logo/favicon.svg` and `favicon-32.png`. The PNG exists because Safari
does not use SVG favicons in tabs.

## 23. Discord is notified by `apps/cujo`, not by the agent, and it notifies only

The obvious way to tell a team about a review is to hand the agent a Discord
tool and let it announce its own progress. That makes notification a model
decision, and the facts worth announcing are not the agent's to know: "review
started" happens before the agent runs, `error` means the turn died, and
`superseded` means the turn was cancelled. The agent could also skip the call
or make it twice. `apps/cujo` already folds every one of those out of the
TrueForge event stream (Contract 6), so it notifies and the agent is not told
Discord exists. That also keeps the agent's toolset the two review tools and
nothing else.

A bot application rather than a channel webhook URL. A card that is edited in
place needs a message the poster owns; a webhook cannot read a channel, so a
binding could not be validated when it is written; and a webhook cannot host
interactions, so the button below would need the bot anyway. REST only, no
gateway and no `discord.js`: Cujo only writes, a WebSocket would be a second
always-on connection with its own reconnect state machine and nothing to
receive, `tsup` bundles with `noExternal` so a heavy dependency lands in the
image, and the interactions endpoint is HTTP too.

Notify-only, for now. A Discord interaction proves that whoever clicked is in
the channel. The Access JWT proves an email against a policy and is what
`approver` records, which is the audit trail decision 17 relies on. Approving
from Discord would quietly swap the first for the second, so the card links to
the run in Cujo instead. What is reserved for later: the unique index on
`run_discord_messages.message_id` gives the message-to-run lookup an
interaction needs, `custom_id` fits `cujo:approve:{runId}` inside its 100
characters, `approver` is free text so `discord:{userId}` needs no schema
change, and the endpoint belongs on the **webhook** host (Discord cannot solve
an Access challenge) verified with `node:crypto`'s Ed25519 against a separate
`DISCORD_PUBLIC_KEY`. Building it means deciding which Discord users may
approve, which is a change to the human gate and gets its own entry.

One card per run rather than one per pull request. A card is then one run, one
review, one approve link, and the mapping stays one-to-one. The cost is that a
pull request pushed to five times leaves five cards; that is paid down by
rewriting a superseded run's card and its ping to say so, rather than by
re-pointing a single card at whichever run is newest and losing the history of
the earlier heads.

## 24. The repo-to-channel binding lives in the store, not the environment

**Superseded by 28, then by 31.** The binding is no longer an operator's
errand behind a login.

An environment variable would need a redeploy to add a repo, could not be
validated, and has nowhere to put `notify_role_id`. The binding is operator
data, so it sits next to the runs and is written over the API behind Cloudflare
Access, which records who bound it. The write calls Discord with the bot token
first, so a mistyped channel id is a 400 at bind time instead of silence at the
first blocked run.

The token itself stays in the environment, because a secret is not operator
data. That split is also why this does not weaken decision 18: what the store
gains is a channel id and a message id, neither of which is a credential and
neither of which TrueForge could know.

## 25. New tables, not new columns: the store has no migration path

`apps/cujo`'s whole schema is one `CREATE TABLE IF NOT EXISTS` block in the
`Store` constructor. There is no `ALTER TABLE` anywhere and no migration
runner, so adding a column to `runs` would apply to a fresh database and
silently not to the deployed one, whose `runs` table already exists. Contract 7
therefore adds `discord_channels`, `run_discord_messages` and `run_pr_meta` as
separate tables, which `CREATE TABLE IF NOT EXISTS` genuinely does apply to a
live database. It also keeps `RunRecord` and the `/runs` responses untouched,
and makes removing the feature a `DROP TABLE` rather than a column rewrite.

This defers the problem, it does not solve it. The next change that genuinely
needs to alter an existing table should add the mechanism rather than contort
around it: `PRAGMA user_version` read in the constructor, an ordered list of
migration statements, each applied inside a transaction that bumps
`user_version` in the same transaction. That was not done here because a
migration runner is its own feature with its own failure mode — a half-applied
migration on a container Coolify restarts — and `best_practices.md` asks for
one concern per pull request.

## 26. Every Discord payload is treated as attacker-controlled

Nothing on a card is written by us. The pull request title comes from GitHub,
and the finding titles, the evidence, the summary and the error text were
written by a model that had just read the code in a stranger's pull request.
So mention suppression, markdown escaping, bidi and zero-width stripping, and
hard truncation in Contract 7 are not formatting hygiene: they are the reason a
hostile pull request cannot make Cujo `@everyone` a company Discord, post an
attacker-chosen link under Cujo's name, or render "not critical" as "critical".
Escaping alone does not do it — a bidi override survives escaping, so those
characters are removed — and the 6000-character embed budget is clamped rather
than hoped for, because exceeding it is a 400 that loses the card for the whole
run.

One consequence to revisit, not a bug today: a channel's membership is not the
Access policy's membership, so a card discloses finding titles and evidence to
a wider audience than the Cujo UI does. Private repos are a non-goal for this
milestone, so everything on a card is already public. That stops being true the
day private repos are in scope, and this is the entry to reopen.

## 27. The operator UI is `apps/web`; `apps/cujo` becomes API-only

Decision 17 said the human approves in Cujo's own UI. That UI is now a Next.js
app in `apps/web` with its own container, and it takes
`cujo.spencerjireh.com`. `apps/cujo` keeps the webhook host, the run store, the
TrueForge client, and the JSON API, and stops serving HTML; its placeholder
page is gone. `cujo-harness.spencerjireh.com` is untouched and still the
TrueForge operator console.

The API is same-origin with the UI, at `/api/*`, proxied server-side by
`apps/web`. That is not tidiness: Cloudflare Access injects
`Cf-Access-Jwt-Assertion` at the edge and browser code cannot forge it, and
native `EventSource` has no header API at all, so a cross-origin API would need
a second Access application, cross-site cookie handling, and a hand-rolled
replacement for the run stream. Same origin also means no CORS and no public
route for the run store or the approve endpoint. `apps/cujo` still verifies the
assertion itself; the proxy forwards rather than terminates the check.

Chosen over path-routing at the edge, which is also same-origin but puts the
rule in Coolify where CI cannot test it and a reviewer cannot see it, and would
still need a rewrite for `pnpm dev`, so dev and production would diverge.

One wrinkle forced a small change to `apps/cujo`. Node's `fetch` silently
ignores an attempt to set the `Host` header — verified, it always sends the
target's own authority — so the proxy cannot present the public hostname to a
service it reaches at `http://cujo:8080`, and Contract 6's host dispatch would
404 every call. `createApp` therefore accepts an `internalHost`
(`CUJO_INTERNAL_HOST`, default `cujo`) alongside the UI host, serving the same
Access-gated routes on it. Rejected: forwarding `Host` verbatim through
`node:http`, which works but gives up `fetch` and forces a manual Node-stream
to web-stream bridge for the SSE proxy; and setting `CUJO_UI_HOST` to the
service name, which costs no code but makes that variable mean the internal
name and its documentation misleading.

`CheckState` gained `startedAt` and `endedAt`, taken from each thread event's
own `createdAt` rather than the clock, so the fold stays pure and a rehydrated
run keeps its timing. The UI puts the four checks on one shared time axis with
them, because when a check went red relative to the others is the information a
grid of status cards throws away.

The stack is Next.js with TanStack Query for server state, Table for the run
list, Virtual for the unbounded sensor lists, Radix for interaction behaviour
only, and Tailwind reading `brand/tokens.css` through `@theme inline` so no hex
value is restated outside `brand/`. Storybook covers the states that are hard
to reach against a live stack and is deliberately not in CI, where its browser
download would roughly double the install.

## 28. Two tiers: an operator authorizes a server, the server configures itself

**Superseded by 31 and 49.** The repo declares its own server, and the
operator plane's principal is a shared token, not a policy-checked email.

Decision 24 put the repo-to-channel binding behind Cloudflare Access, which
made every routing change an operator's errand and put the choice behind a
login the people who care about the channel may not have. Moving it wholesale
into Discord would have replaced "an email that passes an Access policy" with
"a member of a Discord server", and those are not the same principal: a member
could point a repo at a channel only they are in and the team would quietly
stop hearing that reviews were blocked.

So the two questions are split. Which repos a server may reach is authorized by
an operator over the Access-gated API and recorded with their email. Which
channel and which role, inside that reach, is a `/cujo` command anyone with
Manage Server can run. The annoying part moves to the people who feel the
annoyance; the part worth an audit trail keeps one.

Rejected: Manage Server alone, with the repo restricted to the App's
installations. It is defensible today — Public Bot is off, so the only servers
holding the bot are ones the owner invited — but it rests on a fact nothing in
the system enforces or notices changing, and it would silently weaken the first
time the bot joined a second server. Also rejected: a guild allowlist in the
environment, which needs a redeploy per server and cannot express per-repo
reach.

Manage Server is enforced twice: Discord hides the command below that bar
through `default_member_permissions`, and the handler re-checks the
interaction's own `member.permissions`, because a server admin can change that
default and a check that lives only on the client is not a check.

What does not change: nobody approves a blocking review from Discord. The
interactions endpoint now exists, which makes an Approve button a small diff,
and that is exactly why Contract 8 says in writing that it must not be built
without its own entry here. An interaction proves channel membership; the
Access JWT proves an email against a policy and is what `approver` records
(decision 23).

## 29. Slash commands over the HTTP interactions endpoint, registered per server

Discord can be talked to two ways: a gateway WebSocket, or an interactions
endpoint it posts to. Decision 23 already rejected the gateway for
notifications — a second always-on connection with its own reconnect state
machine — and commands do not need it either: slash commands, autocomplete and
deferred replies are all HTTP callbacks. So `/cujo` is a route on the existing
Hono app, on the webhook host, verified with `node:crypto`'s Ed25519 and no new
dependency.

Registered per server rather than globally. A guild command appears the moment
it is written where a global one takes up to an hour to propagate, which is the
difference between a demo that works and one that does not. Registration is a
full replace on every start, so a definition cannot drift from the code across
deploys. The cost is that a server the bot joins later has no commands until the
next start; registering both ways would cover that, but Discord treats a global
and a guild command as separate, so `/cujo` would appear twice in the picker
with identical descriptions, and that confusion is worse than the gap.

## 30. The store gets a migration path, at the first change that needed one

Decision 25 chose new tables over new columns because `apps/cujo` had no way to
alter a table that already exists in a deployed database, and wrote down the
shape of the fix for whoever needed it first. Recording who bound a repo to a
channel is that change: `discord_channels` already ships, so `bound_by` had to
be a column on it or a second table existing only to hold one string.

The mechanism is the one that entry described. `PRAGMA user_version` — SQLite's
own four-byte slot, so it needs no table — is read in the constructor, and each
statement in an ordered, append-only list runs inside the transaction that
bumps the version. A container killed mid-migration comes back either before or
after a migration, never halfway. A fresh database creates the tables at their
original shape and then runs the same migrations a deployed one does, so the two
converge rather than drifting into two schemas that happen to match today.

Adding a table is still simpler and still preferred. This is for altering one
that is already out there.

## 31. The repo declares its Discord server; the operator route becomes an override

**Superseded in part by 57.** The declaration stands and is now the whole
authority; the override route and its table are deleted.

Decision 28 made a Cujo operator vouch that a Discord server may see a repo.
That was wrong in two ways at once. The authority was misplaced — a Cujo
operator is not necessarily anyone who owns the repo, so the check confirmed
the wrong fact — and it did not scale, because every repo needed a human with
an Access login to run a request by hand. In practice that meant a `curl`,
which is a fair thing to object to.

A repo now names its server itself:

```yaml
# .cujo.yml on the default branch
discord_guild: "222222222222222222"
```

The authority becomes repo write access, which is the thing that actually
correlates with owning a repo. It is self-serve for any number of repos, it is
auditable in git history like every other config change, and it is revoked by a
commit rather than by finding whoever holds a Cujo login. `.cujo.yml` was
already the repo's policy file, read from a ref the pull request cannot change,
so the file and the habit both existed.

The handshake stays two-sided, which is what stops abuse in both directions.
The repo's declaration alone would let anyone route a repo they do not own; the
server's `/cujo watch` alone would let anyone send a repo's reviews into a
server they do not belong to. Both are still required.

Cujo reads the file trusted-side, through the App, from the default branch.
Never the sandbox's copy: the sandbox holds the pull request's code, and code
that declares its own authorization is not an authorization. Reading the
default branch rather than the pull request's is also what makes the
declaration proof of control — it has to be merged.

The key is extracted with one strict pattern rather than parsed as YAML. It has
one shape, a snowflake at the top level, so anything else does not match and
the repo counts as undeclared; a YAML dependency for one scalar is not worth
the bundle or the parser's own surface. A wrong declaration is silent and never
costs a review: `/cujo watch` prints the exact line to add, and `/cujo status`
closes with it.

Revocation is checked on the delivery path, not only at bind time. A binding
written before a declaration was reverted would otherwise keep delivering
forever, which would make "revoked by a commit" a claim the code did not keep.
The cost is one cached read per notification; the alternative is a promise in
the docs that is false in the product. For the same reason `/cujo unwatch` is
ungated: the commit that revokes is exactly what makes a binding stale, so
gating cleanup behind the declaration would strand the channel.

An unreadable `.cujo.yml` is not a revocation. `declaredGuild` throws rather
than returning null on a failed read, so the two facts stay distinguishable,
and the delivery path keeps sending while a command refuses and asks for a
retry. Collapsing them would let a GitHub hiccup silence a team's reviews.

Autocomplete deliberately stopped narrowing to what a server may watch, because
that would be one `.cujo.yml` read per installed repo per keystroke against a
three-second budget. It offers everything the App is installed on, and the
refusal carries the fix.

What survives from 28: the operator route, now an override for moving a repo
between servers or for a repo whose `.cujo.yml` cannot be changed; Manage
Server, still checked twice; and the rule that nothing here approves a review.

Rejected: a claim-code flow (`/cujo claim` prints a code, someone pastes it
into a GitHub issue), which proves the same thing but is a stateful dance with
expiry and replay to get right and leaves no lasting record of the decision.
Also rejected, again, Manage Server alone — it still lets any server admin bind
any repo Cujo knows about.

## 32. The file tree carries the trust boundary, not the layer

`apps/cujo/src` was twenty flat files. Every load-bearing fact about the service
— two trust zones, two hostnames, one pure fold from events to a run — lived in
prose: `AGENTS.md`, `docs/architecture.md`, and a header comment on nearly every
file. None of it lived in the directory structure, so `webhook.ts` (reachable by
anyone on the internet, HMAC the only gate) sat indistinguishable from `api.ts`
(behind Cloudflare Access), and the distinction existed in exactly one place,
the host dispatch.

`src/` is now grouped by **trust plane and bounded context**: `http/ingress`,
`http/operator`, `review`, `notify`, `clients`, `store`, with `tests/` mirroring
it. Each directory carries a `README.md` stating its invariant, which GitHub
renders when you browse into it.

Rejected: `controllers/services/models`. It is the convention everyone already
knows, which is a real argument, and it was weighed on that basis. It loses
because layering sorts by technical role and trust zone is orthogonal to
technical role — a layered tree puts `webhook.controller.ts` beside
`runs.controller.ts` and deletes the one distinction most expensive to get
wrong. The `services/` bucket also destroys information here: `fold.ts` and
`findings.ts` are pure, `runner` and `notifier` are long-lived and stateful, and
the clients are IO; calling all of them "service" says none of that. And
`models/` implies authority, which is the opposite of what a projection is
(decision 18). Two of the four layers were kept under different names:
`clients/` is infrastructure, `store/` is repositories.

Naming: suffix only where the directory does not already say it. `store/runs.ts`
is obviously a repository and `clients/github.ts` is obviously a client, so
`.repository` and `.client` would be noise. Only `.service.ts` is used, on the
two objects that hold state across requests — `runner` and `notifier` — so its
*absence* means a file is safe to call from anywhere.

Invariants that were comments are now types. Splitting the store means the
`/cujo` command handlers hold a `NotificationStore`, which has no
`claimDecision`, so "Discord routes notifications and never approves a review"
(decision 28) is a compile error rather than a rule to remember. Splitting
`clients/` off means nothing there imports from the contexts it serves.

The duplicated rule that prompted this: "can the bot post an embed in that
channel" was written twice and had already drifted — the operator API turned a
failed permission lookup into a 400, the slash command let it reach a generic
"something went wrong". It is stated once in `notify/channel-check.ts`, which
returns a typed refusal so each caller keeps its own wording.

`sniff.py` moved to `sandbox/`, so the untrusted zone is visible at the repo
root. That changed `CUJO_SNIFF_URL`'s default; see the breaking-change note on
that commit, because the deployed value comes from Coolify and not from this
repo.

Paths named in decisions 1–31 refer to the pre-restructure tree. They are left
as written, per the rule that a decision is reversed rather than edited.

Deferred: splitting `runner.service.ts` into run lifecycle and TrueForge stream
transport. It is the largest test surface in the service and the split is a
behaviour risk, not a move.

## 33. The origin accepts Cloudflare only; the ACME path is bypassed to match

Cloudflare proxies all three hostnames, so until now the server's own address
was a path that skipped Access: fetching `https://cujo.spencerjireh.com/`
against the origin IP returned the operator UI with no login. Nothing leaked,
because `access.ts` re-checks the assertion on every request (Contract 6), so
`/api/*` answered `401` and only the empty shell rendered, which is the case
the second gate was written for. A Hetzner Cloud firewall now accepts ports 82
and 443, TCP and the UDP used by HTTP/3, only from Cloudflare's published
ranges. Port 22 stays open: the Coolify control plane deploys over it from
another host (see 2), its egress address is not fixed, and narrowing it would
risk every future deploy to close a door that already needs a key.

Locking the origin surfaced a second problem that predates it. Traefik answers
the Let's Encrypt HTTP-01 challenge and has no DNS challenge configured, but
Access sat in front of `/.well-known/acme-challenge` on
`cujo.spencerjireh.com`, so Let's Encrypt was served a login page instead of
the token and the certificate would have failed to renew on 2026-10-24,
expiring on 11-23. A
second Access application scoped to that path, holding one bypass policy, now
lets the challenge through; the path serves single-use random tokens and is
public by design. `cujo-ingress` was never affected, having no Access policy
(see 7), and `cujo-harness` uses a Cloudflare Origin CA certificate that does
not renew.

Chosen over an on-host `iptables` rule, which Docker's own chains bypass unless
it is written into `DOCKER-USER`, and which can lock the machine out with no
undo; the Hetzner firewall sits outside the server and detaches in one call.
Rejected: an Origin CA certificate for `cujo.spencerjireh.com` like the
console's, which ends the renewal dependency but puts a fifteen-year
certificate on the box and loses browser trust the moment the proxy is turned
off; and restricting port 22 to a guessed control-plane address.

## 34. The run board is public and read-only; the operator surface moves hosts

**Superseded in part by 57.** The board, the allowlist serializer, the
`is_public` stamping and the stream cap all stand. The second hostname and
everything that linked to it do not.

`cujo.spencerjireh.com` sat behind Cloudflare Access, so nobody could see what
Cujo does without being admitted one email at a time. The board is a projection
of *public* pull requests — the finding text and the review body describe code
that is already public. What is not public is who approved, and anything at all
about a repo that is not. So the board is now anonymous and read-only, and
everything an operator can act on moves to `cujo-admin.spencerjireh.com`, which
keeps the Access application. `cujo-harness` is untouched (see 2).

Access stays on the operator side because it is not only a lock, it is the
identity source: `approver` is an email taken from the assertion, and that
record is the whole point of the human gate (see 23 and 28). An API key would
make everyone who holds it the same principal, and a browser has nowhere safe
to keep one.

**The split is by path, not by a third hostname.** `apps/cujo` never receives
the public name — `apps/web` reaches it over the compose network and Node's
`fetch` overwrites `Host` with the target's own authority (see 27) — so a
fourth branch in the host dispatch would have to trust a forwarded header, and
a header a client can also send is not a boundary. `/public` is therefore a
route group, mounted on its own router *beside* the gated one rather than under
it. That last part is not styling: `operatorRoutes` applies its gate with
`app.use("*")`, which matches `/public/*` too, and before this the sibling
`/healthz` escaped only because Hono returns from the earlier matching handler
first — true, invisible to a reviewer, and one `await next()` from being false.

**The serializer is an allowlist.** Naming the fields to remove makes the next
field added to the projection public by default; naming the fields to keep
makes it private by default. Which one is right is decided entirely by what
happens when someone forgets, so the response is built field by field, nothing
in the public module may import from the operator one, and a compile-time
exhaustive test over both source types turns a new field into a red build until
it has been classified. A sentinel sweep covers the nested case the key checks
would miss.

**Visibility is stamped once and corrected twice.** `repository.private` on the
webhook is the fact at claim time and costs no API call. GitHub's `repository`
event carries a flip in seconds. A periodic sweep covers a delivery that never
arrived, a repo renamed out from under its stamp, and the rows that predate the
column — that last one is why it also runs at start, since without it the
fail-closed default leaves every existing run invisible and the board launches
empty. A row nobody has answered reads as private *in SQL*, so a route that
forgets the filter returns nothing rather than everything. The sweep marks a
404 private and leaves anything else alone: failing closed on a five-minute
GitHub outage would take the whole board dark while protecting nothing, because
the repo did not become private.

**The stream is bounded twice, and the two codes differ on purpose.**
Cloudflare rate-limits per address at the edge and answers 429; the process
caps concurrent public streams and answers 503 with `Retry-After`, because that
visitor sent one request and the limit is capacity, not abuse. Keeping them
apart is what lets a log say which bound bit. Operator streams are never
counted, so a busy board cannot cost somebody the approval page. The realistic
pressure is idle tabs rather than an attacker — a blocked run stays live for
hours — which is why the cap is 200 and why the page says so and falls back to
polling instead of freezing silently.

A Discord card links per run: the public board when the run is public, the
operator UI when it is not. A repo's channel holds its team, not Cujo's
operators, so pointing every card at the gated name would answer most of them
with a login page; the public run page carries its own link on to `cujo-admin`
when a decision is pending. `CUJO_UI_BASE_URL` follows `CUJO_UI_HOST` to the
admin name, which is easy to miss and would otherwise send every "needs a
human" ping to a page with no buttons.

Both hostnames are `noindex`. Cujo reviews public pull requests belonging to
people who never asked to be indexed here, and a link someone chooses to share
is a different thing from a result that surfaces beside their repository.

Chosen over a second, read-only deployment of `apps/web` against a replica of
the store, which is airtight and costs a second image and a replication story
for a demo. Rejected: redacting the operator serializer, which is
public-by-default; a fourth hostname in the router, which would trust a
forwarded header; path-scoped Access on one hostname, which answers XHR and
`EventSource` with an HTML login redirect; `NOT NULL DEFAULT 0` on the new
column, which collapses "never answered" into "private" and loses the ability
to say how many rows the sweep still owes; and two `web` containers differing
by one static variable, which is simpler and safer but doubles the deploy for a
boolean.

Known limit: `runs.repo` is a name, not an id, so a rename orphans the stamp
until the sweep's 404 rule catches up. Storing `repository.id` is the durable
fix and is not in this change.

## 35. Merging is the deploy, so an env-coupled change is valid on both sides

Coolify rebuilds on every push to `main`, so a merge is a release. Nothing in
the repo said so. That is not a documentation gap on its own — it is the reason
the wrong sequencing survived a review, so the mechanism is now in
[architecture.md](architecture.md) and the rule is in the Standards that Qodo
reads.

32 moved `sniff.py` to `sandbox/`, which changed `CUJO_SNIFF_URL`'s default
while the deployed value came from Coolify. The value was PATCHed to the new
path before the merge, on the reasoning that a variable applies at the next
deploy, so the new value and the new path would arrive together. **That
reasoning was wrong**, and it was written into the review thread as "no window
in either direction." The merge deletes the old path from `main` at once, but
the running container keeps the old value until the new one replaces it. The
health poll across that deploy shows the overlap directly: `200` after the
merge, then `503` at the container swap, then `200`. A review starting in the
overlap fetches a path that no longer exists and dies at sandbox setup — which
reads as a Cujo bug, not as a deploy artifact. None did, by luck.

So the rule is two releases, not two minutes: **add the new location while the
old one still answers, let the deploy land, delete the old one in a follow-up.**
PATCH-then-merge is still the right order and is still not enough; it narrows
the window to the deploy rather than removing it.

This binds only what Coolify holds and what is fetched from `main` at run time.
A path inside the image moves with the image and has no window at all, which is
why this is a rule about variables and raw-content URLs and not about
refactoring.

Rejected: patching the variable after the merge, and restarting before it — both
widen the same window, the second by pointing the new value at old `main`.
Also rejected: accepting it because a deploy is short. The length is not
observable from here (`GET /deployments/...` is 403 for this token), so the
argument rests on a number nobody can check, and the failure it trades away is
silent.

Known limit: nothing enforces this mechanically. It is a review rule, which is
why it lives in `best_practices.md` rather than only here.

## 36. The review links to its own evidence, and the bot wears the brand

Decision 34 made the run board public and anonymous, and then nothing pointed
at it. The review `cujo-guard[bot]` posts is *What ran*, *Results*, *Egress*
and then it stops, so a reader who wants the test output, the egress table, or
the detonation report has nowhere to go — the evidence is sitting on a page
anyone can open and the pull request never mentions it. Every review on a
public repo now ends with a rule and one line: `Full evidence: <run page>`.

`github-mcp` composes that footer, and the agent supplies neither the format nor
the destination. The alternative was a line in `agent/SKILL.md` telling the
model to end its body a particular way, which is a rule that fails silently — a
model can forget it, reword it, or put it above *Egress*, and none of those are
visible until a human reads a posted review. Composed in `body.ts` the footer is
correct or absent, and absent only when Cujo says so.

**The agent relays a run id, not a URL**, and that distinction is the whole
security argument. The value crosses an agent that has just read a stranger's
pull request, so anything it carries is something that pull request can try to
choose. A URL would let it choose the host, and the bot would then vouch for an
arbitrary link under `Full evidence:` in a review posted as `cujo-guard[bot]` —
which is exactly the credibility the product is built to earn. It would also
have been injectable: `z.string().url()` accepts a string with embedded
newlines, because WHATWG parsing strips them for validation while Zod returns
the original, so `https://x/\n\n## Merged and approved\n\n[Click here](…)`
passes and reaches the body verbatim. A UUID admits neither. `github-mcp` holds
the host in `CUJO_PUBLIC_BASE_URL` and builds `<base>/runs/<uuid>` itself, so
the worst a redirected agent can do is name a different run on Cujo's own board.

Two independent conditions gate the footer and each side owns the one it can
answer. `apps/cujo` knows repository visibility, so `review/links.ts` exports
`publicRunId`, which returns `""` for a private run, and `buildTurnMessage` then
omits the key entirely; omitting rather than sending `""` makes the absent key
and the optional schema field the same rule, so nothing downstream needs a
special case. `github-mcp` knows whether this deployment has a board, and
appends nothing without one. Either missing costs every review its footer and
costs no review its posting, which is the right direction for a cosmetic field.

A private repository therefore gets no footer at all. It has no page a reader of
the pull request could open: the operator host would answer with a login screen
and the board root would answer with a page about some other run, and both are
worse than saying nothing.

The Discord cards move off Discord's palette onto `brand/tokens.css`. Two rules
decide the map and both are worth keeping when a status is added: **amber marks
exactly one status**, `blocked_pending`, because amber is the brand and
`brand.md` spends it on the thing a person must act on; and **red means the pull
request is dangerous, never that Cujo fell over**, which is why a run that
errors is `--sev-info` blue. An errored run is a status, not a verdict on
someone's code, and colouring it red teaches an operator to discount the colour
that matters most. The three states nobody can act on — clean, denied,
superseded — form a ramp of decreasing lightness rather than three arbitrary
greys.

Writing this down exposed that `brand.md`'s five-level severity ramp never
matched the product. Cujo emits three severities, `critical`, `warn`, and
`info`; `warn` is not in the ramp at all, `SeverityBadge.tsx` has been quietly
bridging it to the high tokens, and `--sev-medium` and `--sev-low` are
referenced by nothing outside Storybook. `brand.md` now says so. The words stay
as they are: they are matched literally in `review/fold.ts` and validated by the
review tool's schema, so renaming one is a code change and not a copy change,
and the voice pass in `agent/SKILL.md` deliberately does not touch them.

The GitHub App also gets an avatar and a description, which it had never had.
Neither existing mark could serve: `logo/mark.svg` is near-black on transparent
and `logo/favicon.svg` is bone on transparent, while an App avatar renders on
both the light and the dark GitHub UI, so it has to carry its own ground.
`logo/avatar.svg` is the mark on a `--bg` dark tile with the clear-space rule
satisfied at 512.

On the trust boundary: `run_id` is the one field this adds to the turn payload,
and it is Cujo's own artifact identifier — the same category as the sensor
script URL already substituted into the rubric, and already public, since it is
the last path segment of a page anyone can open. It carries no secret, names no
host, and grants the sandbox nothing it could not read off the board. It is
deliberately the smallest thing that could have crossed: the URL it replaced
would have carried a hostname, which is precisely the part worth withholding.

Chosen over / Rejected: **a full `run_url` from the agent**, which hands the
pull request under review a say in where the bot's own evidence link points, and
which `z.string().url()` cannot even be made to sanitise properly; having
`github-mcp` verify repository visibility itself through the GitHub API, which
is more robust but adds an API call and a failure mode to every review and
widens a server whose comment says it "reads nothing but the PR's diff"; linking
a private repo's review to `cujo-admin`, which
sends most readers to a login screen for a page they will never be allowed to
see; linking to the board root, which loads for everyone and says nothing about
this pull request, so it reads as a broken link; adding a success green to the
brand ramp so `clean` could be positive, when `brand.md` already says a calm
review has almost no colour on the page and a passing run is quiet rather than
celebratory; keeping Discord's green for `clean` alone, which leaves two design
systems in one file; and putting the mark in the review body, which GitHub
renders small, adds a remote asset to every comment, and argues against the
terse and evidential voice the same pass was tightening.

Known limit: the footer is a permalink to a page whose visibility can change. A
repo made private after a review leaves a live GitHub comment pointing at a URL
that now 404s. That is the correct answer — the page is gone — but the link
stays in the comment, and nothing in this decision can retract it.

## 37. Logging is a closed vocabulary on stdout, and readiness is not liveness

The happy path used to be invisible in Coolify: every `console.error` covered a
failure and nothing recorded that a webhook arrived, a run was claimed, or a
turn reached a terminal status. Two changes fixed the visibility — a Standards
bullet saying to promote a stray `console.log` to `console.info`, and a pass
that added lifecycle lines across the critical path. That was the right instinct
at the wrong unit, and **this decision reverses that Standards bullet.** The
lines it produced are prose: `run abc123: status → clean`. Asking how many runs
blocked last week, or which delivery started this run, means a regular
expression over English that the next PR is free to reword. Everything that pass
made visible stays visible here; only the unit changes.

Logs are structured events on stdout, one JSON object per line, through
`@cujo/log`. No sink, no collector, no OpenTelemetry. Docker already captures
stdout and Coolify already shows it, and a collector is a service to run, back
up and secure for a system whose per-run detail is already durable — the fold
persists every projection and the UI renders it (18). What was missing was
service-level, not run-level, and stdout answers that.

**The message is an event name from a closed set.** `log.info` takes a name from
`EVENT_NAMES` and a bag of fields; there is no free-text argument. A name is
greppable and countable without parsing, which is what an audit trail needs, and
a closed set can be checked: a test scans the source for emit calls and fails on
a name that is not declared, *and* on a declared name that nothing emits, since a
vocabulary with dead entries is fiction. That test reads source files, the way
the public plane's import guard does and for the same reason — no linter
expresses the rule. `console` is then banned outright by `noConsole`, which is
what stops the vocabulary being bypassed by the older habit.

**Fields are an allowlist of scalars.** A name not in `FIELD_NAMES` is dropped at
emit and its name — never its value — is reported under `dropped_fields`, and
every name must be classified before it compiles. The value type is
`string | number | boolean | null`, so an object, an `Error`, or the `Config`
cannot be passed at all. That is the point: this process holds the App private
key, the webhook secret and the bot token, and the way a logger leaks is that
somebody spreads a wide object into a call. The same reasoning already shaped
`agent-spec.ts`, which takes the two fields it needs rather than a config, so a
future spread is a compile error instead of a leak. A pattern scrubber over every
string value is the second layer, not the first. `github-mcp` was interpolating
GitHub's raw response body into an error message that reached the logs; that is
the concrete form of the hazard, and fixing it belongs to this change.

Rejected: handing the logger the secrets to redact by exact match. It is more
precise than patterns, and it makes a bug in the logging path a total
disclosure. The logger is given nothing to lose.

**`/healthz` does not learn anything; `/readyz` is new.** The tempting fix was to
have the existing endpoint report whether the harness had bootstrapped, since a
green healthcheck sits today on a process whose webhook may have answered `503`
since boot. That would restart-loop the container. `/healthz` is the compose
healthcheck on a roughly sixty-second budget, `bootstrapUntilReady` backs off to
a minute and retries forever, and `web` starts only once `cujo` is healthy — so
readiness in `healthz` would kill the container exactly when the retry schedule
is being patient, and take the UI down with it. `/healthz` stays a liveness probe
with the body it already has; `/readyz` carries the same harness flag the
webhook itself gates on, a store ping, the public stream count, and a count of
the log lines the process could not write, and answers `503` when *either* of
the first two fails. The store belongs in that disjunction
rather than in the body alone: a delivery calls `getSession`, `putSession` and
`createRun` synchronously, so an unreachable store means no run can be claimed
however healthy the harness is. Only `cujo` gets one: `github-mcp` is stateless
per request, so its readiness *is* its liveness, and a second name for one fact
is how a health endpoint starts lying.

**A run carries the delivery that started it.** The correlation id is `ray` —
Cloudflare's `cf-ray`, or GitHub's `x-github-delivery` on the webhook plane,
which wins there because it is the value you redeliver from. But the request
answers `202` and returns while the run outlives it, and a rehydrate, a poll tick
and an approve have no request at all. So the delivery id is a column on `runs`
(appended to `MIGRATIONS`, per 25 and 30) and every run event carries it, across
restarts. It is a GitHub-side handle, so the public serializer withholds it
alongside `sessionId` and `turnIds`.

Rejected: correlating background work by run id alone. It works for a human with
a log search and breaks the moment anything wants to join a delivery to its
outcome, which is the one question the audit trail exists to answer.

The one place both ids belong on a single line is the approval, because two
different questions are being asked of it: which request decided, and which
delivery it decided about. `approve.requested` carries `ray` — the operator's
own request, bound by the middleware — beside `delivery_id`, read from the run
row and omitted when the run predates that column. `approve.applied` follows
from the run's own logger once the resume lands. They are two fields and not
one: bound fields beat call-site fields, so a handler cannot repoint `ray` at
the run without a child logger, and an earlier attempt that named the second
field `request_ray` set it from the same request ray the middleware had already
bound — one fact under two names, on the one line where the second fact
mattered.

Known limit: the vocabulary scan sees a literal first argument on a receiver
named `log` or `logger`, and nothing else. A computed name is already a type
error, since the parameter is a union of string literals, so the scan and the
compiler cover each other's gap — but neither alone is sufficient, and a third
way of reaching the logger would escape both.

## 38. `apps/cujo` may write a reaction; the gate is about reviews, not writes

A pull request gave no sign that Cujo had seen it. Everything Cujo says it says
elsewhere — a review at the end, a Discord card, a page on the board — so
between the push and the review the pull request is silent for as long as a
sandbox takes. That costs a reader an acknowledgement, and it costs an operator
the one cheap signal that would say *where* a silent run stopped: the ingress,
the signature, the session and the claim all happen before the agent does
anything, and all of them were invisible. `apps/cujo` now reacts on the pull
request as `cujo-guard[bot]` and moves that reaction with the run's status
(Contract 9).

**The invariant this appears to break is not the one that matters.** The rule
was that `apps/cujo` reads GitHub and every write goes through `github-mcp`,
where `post_blocking_review` is marked destructive and TrueForge's
`@destructive` selector pauses for a human. But the thing being protected is
that **nothing states a finding on a pull request without a human allowing it**.
A reaction states no finding, carries no text, names no file, and approves
nothing; the payload is one member of a closed set of eight emoji. Restated
honestly the rule is about reviews, and it survives intact. Kept literally, it
would have forced the acknowledgement onto the agent's own path — a third
`github-mcp` tool — where it could only fire after the agent was already
running, which is exactly the case nobody needs to debug.

**Three facts were checked against the live App before any of this was
designed**, and each one removed a piece of the build:

- **`pull_requests: write` is enough.** The endpoint is
  `POST /repos/{repo}/issues/{n}/reactions` and GitHub's docs name
  `issues: write`, but a pull request target is accepted with the permission
  the App already holds. So there is no permission change, and **no installation
  has to re-approve** — which would have left every repo unreacted until someone
  clicked, for a feature whose whole value is being immediate.
- **The POST is idempotent**: the same content twice answers 200 rather than
  201 and leaves one reaction. So "set the reaction" needs no read first and no
  stored reaction id, and a restart simply re-applies and converges. That is
  why this decision adds **no table and no migration** to a store that has to
  migrate by hand (decision 30).
- **Ours are identifiable from the list**, by `user.login` against the same
  `BOT_LOGIN` that `alreadyReviewed` already trusts, so nothing has to be
  remembered across a restart to know what to clear.

**The reactions describe what happened to the pull request, not what Cujo
concluded.** `denied` is a thumbs up: a human cleared the pull request to
proceed, even though the critical finding stands. The alternative read it as
Cujo's verdict and kept the thumbs down, which is more precise and less useful —
the audience for a reaction is whoever opened the pull request, and the board
and the Discord card both carry the precise version. `error` gets 😕 and shares
it with nothing, so one glance separates "Cujo blocked this" from "Cujo broke".

**One reaction, several runs: only a current run may write.** Reactions attach
to the pull request and not to a head SHA, so every run on a pull request is
writing to the same square inch, and delivery order is not commit order — the
stale-head guard in `start-run.ts` exists precisely because an older head's
delivery can arrive after a newer one's. The first draft acknowledged the run
before that guard and mapped `superseded` back to 👀, and the two together were
a hole: a delayed delivery for an older SHA would replace the current run's
posted verdict with 👀, then settle as `superseded` — 👀 again — and nothing
would ever restore it. The pull request would sit on a finished, clean review
wearing an eye forever. Both halves are now closed. The eye is placed only after
GitHub has confirmed this run's head is the pull request's head, and
`superseded` writes nothing at all, because the run that replaced it is about to
say what the pull request should show.

Placing the acknowledgement after that confirmation costs one GitHub read of
latency — a few hundred milliseconds — and buys back the property the whole
feature is for: 👀 still means the ingress, the signature, the session and the
claim all worked, and now means the PR read did too. It is a better signal, not
a weaker one.

**A failed call is retried, with backoff.** A terminal status is the last event
a run produces, so "the next status change will fix it" is not true where it
matters most: one transient GitHub failure on `clean` would leave the pull
request wearing 👀 indefinitely. Two retries, abandoned the moment a newer status
is queued behind — the ordering property doing its job rather than a second
mechanism. And what the reactor holds in memory to collapse the per-event storm
is bounded and evicts the least recently seen run: it lives as long as the
process and sees every run, so an unbounded map was a slow leak with no ceiling.

`CUJO_PR_REACTIONS=0` turns it off. This is the only thing `apps/cujo` writes
into somebody else's repository, and a switch that does not need a code change
is worth one line of config.

Chosen over / Rejected: **a Check Run** (`Cujo / review`, with in-progress and
completed states and a details link), which is the better product and stays on
the list — it needs `Checks: write`, which *is* a new permission every
installation must accept, and it is a much larger build than this; **a status
comment edited in place**, which is louder than a review deserves, sends a
notification on every status change, and clutters a thread Cujo is about to post
a review into; **a third `github-mcp` tool**, rejected above; **reacting before
either guard** in `start-run.ts`, covered above; and **keying the
de-duplication on the run status**, where the claim and the first fold both want
👀 and would make two identical calls — keying on the reaction set collapses
them, and two statuses that look the same on the pull request genuinely have
nothing to say to each other.

Known limit: a reaction is per pull request, so a pull request with two runs in
flight (a push landing mid-review) shows one state, the newer one. That is the
correct answer and it is still lossy; the board and the Discord card are where
per-run history lives. The residual case is narrow: a stale delivery whose
`pullRequest()` read *fails* ends in `error`, and 😕 will land over a current
run's verdict. It takes a delayed delivery and a transient GitHub failure at the
same moment, it self-corrects on the next push, and closing it would mean
teaching the reactor which run is newest for a pull request — a store query on
the fold path to buy back an emoji.

## 39. A superseded run answers its pending approval

**Refined by 125.** The stale deny is still sent, so the model hears why; the harness no longer refuses a new turn while an approval is pending, it voids the approval instead.

Decision 20 says a superseded run cancels its turn so it cannot post a review
for a commit nobody is looking at. That was not enough, and the gap made the
ordinary workflow fail: Cujo blocks a pull request, the author pushes the fix,
and the fix is never reviewed. Every head after the block failed to start with

```
422 thread main: user message cannot be sent while approvals or questions are pending
```

An approval is outstanding on the **session**, not on the turn that raised it.
`tool.approval_required` ends the turn it arrives in (Contract 4), so by the
time a newer head arrives there is nothing left to cancel, and `sessions.cancel`
was never the call that answers it. Decision 16 keys the session on the pull
request, so the wedge is permanent: that pull request can never be reviewed
again. Reproduced on `orders-api` PR 5, which had to be closed and reopened
before the run could complete.

So `supersede` now denies the approval before cancelling, with a reason of its
own. The operator's deny says a human rejected the block; here nobody rejected
anything, and the string reaches the model, which the rubric tells to end its
turn saying the block was denied. `STALE_DENY_REASON` says the commit was
replaced instead. The deny starts a turn, which is cancelled straight after:
that turn holds a review of a head nobody is looking at, and `supersede`'s
caller starts the newer head's turn as soon as it resolves. The deny turn is
recorded through `addCujoTurn`, so a replay can never read it as a resume sent
from outside and stamp the run `approver: external`. The run stays
`superseded`, never `denied` — `denied` means an operator said no.

The cancel is unconditional, and that is load-bearing. `claimDecision` sets the
approver without moving the status off `blocked_pending`, so an operator's
resume can be in flight and invisible to `supersede`. If that decision answered
the approval first, the deny fails — and the turn it started is reviewing a
commit nobody is looking at. Decision 20's cancel is what stops it posting, so a
failed deny falls through to it rather than returning.

That closes the one known cause. It does not heal a session already wedged, so
`Runner.start` retries once: on any `startTurn` failure it looks for an
approval left pending on the session (`pendingApproval` in `review/fold.ts`),
denies it, and tries again. `fold` cannot answer that question — it never
clears `approval`, and `decision` does not record which tool call it answered,
so a session holding one answered and one outstanding approval folds to both
fields set.

The heal refuses while any other run on the session is unfinished — `running`
included, not only `blocked_pending`. A run whose turn has already raised
`tool.approval_required` stays `running` until its own stream folds that event,
so an approval the server reports as pending can belong to a run that has not
reached the waiting state yet; a `blocked_pending`-only guard would answer for
that human. The check is repeated after `listEvents`, which is a round trip a
run can cross the line during. It costs nothing in the case that matters:
`startRun` supersedes every older run on the pull request before it starts a
turn, so by the time a heal is possible they are all terminal.

Chosen over / Rejected: **matching the 422 text** to decide whether to retry,
which pins Cujo to wording that belongs to TrueForge and fails silently when it
changes — `startTurn` failing at all is rare enough to afford one `listEvents`;
**a session per head SHA**, which reverses decision 16 and costs the agent its
memory of what it already said on the pull request, to fix a lifecycle bug;
**cancelling the approval without answering it**, which is what the code
already did and is the bug; **leaving the wedge and telling operators to reopen
the pull request**, which turns a Cujo defect into a manual step on the exact
path the product exists to serve; **denying whatever is pending with no guard
on the other runs**, which is simpler and would eventually answer for a human
mid-decision; and **an atomic store claim over the session** to serialise the
heal against an operator, which is the general answer but buys nothing the
unconditional cancel does not already cover.

Known limit: if the deny itself fails, the session stays wedged exactly as it
was. The next head retries it through `start`, so the wedge is no longer
permanent, but that head's run still ends in `error` first.

## 40. A single-server deploy may name its server, and skip the declaration

Decision 31 made a repo name its Discord server in `.cujo.yml`, so the
authority behind a binding is repo write access. That is right when a Cujo
deploy serves repos and servers belonging to different people. It costs a
commit and a merge per repo when the deploy serves exactly one server, and the
person adding the line is also the person who runs the server and owns the
repo. That is this deploy: one GitHub App installation over a hand-picked list
of one account's repos, one Discord server.

So `CUJO_DEFAULT_DISCORD_GUILD` names that server, and a repo that declares
nothing belongs to it. Setup becomes an environment variable set once and
`/cujo watch`, with nothing to merge.

This is not decision 28's rejected "guild allowlist in the environment", which
had to grow by a redeploy per server and could not express per-repo reach. It
is **one id**, and it answers "is this my own server?" rather than "is this any
server?". Public Bot is on and cannot be turned off without Discord's
verification, so anyone can invite the bot into a server they control — and
that server's id will not match, so it gets exactly the refusal it gets today.
The narrowing is what makes the default safe, not an assumption about who holds
the bot. That distinction is the whole entry: a list would be the rejected
design.

Neither half of decision 31's handshake is removed. `/cujo watch` still has to
be run by someone with Manage Server, still checked twice. A repo that names a
server still wins, including when it names a different one — the default is
consulted only after the declaration is read and found absent, so it can fill a
silence but never overrule a sentence.

Nor does it become a permanent grant. The default is checked on the delivery
path like a declaration, so unsetting the variable drops a binding it created,
exactly as reverting the commit drops a declared one. Revocation stays true of
delivery and not only of the bind.

An unreadable `.cujo.yml` is still `unknown` and the default does not rescue
it. The two callers want opposite things from that state — a command refuses
and asks for a retry, delivery keeps going — and deciding it here would decide
it for both. It also keeps the one case where the default could quietly
overrule a repo that had named someone else.

Rejected: **turning Public Bot off** and resting on "only servers the owner
invited hold the bot", which is decision 28's own rejected reasoning and is not
available anyway; **a channel webhook URL instead of the bot**, which is
genuinely simpler — the URL is a capability for one channel, and two of
decision 23's three reasons against it are wrong, since a webhook can edit its
own messages and can be validated through `GET /webhooks/{id}/{token}` — but
the URL is a secret, so configuring it goes back through the Access-gated API
that decisions 28 and 31 spent two entries escaping, and it deletes `/cujo`
along with Contract 8; **dropping the declaration entirely** for Manage Server
plus the App's installation list, which is the alternative rejected twice and
would be actively wrong while Public Bot is on.

## 41. One sensed command at a time, and one audit log per command

A check report is the slice of the shared sensor logs written while one command
ran, bounded by the byte offset `run_sensed` took before starting it. Every
check writes to the same `proxy.jsonl`, `audit.jsonl`, and `decoy.jsonl`, and
nothing in the rubric serialises the checks: `agent/SKILL.md` says to run
`tests` first and then `probes` and `smoke`, which does not stop two sub-agent
threads from wrapping a command at the same time. When they do, each report
carries the other's egress and file reads, and each filesystem snapshot diff
picks up the other's writes. The evidence is not merely noisy — it is
attributed to the wrong check, which is the one thing a report exists to get
right.

`sniff.py run` and `sniff.py detonate` now hold an exclusive `flock` on
`CUJO_DIR/sensed.lock` for the whole sensed window, so a second command waits.
A wait that exceeds fifteen minutes proceeds anyway and says so on stderr: a
review that blocks forever is not better than one that reports an overlapping
window, and the timeout is longer than any check should take.

The lock cannot fix attribution on its own, because a process a check leaves
running keeps appending after that check's window closes. So `run_sensed` also
gives each sensed command its own audit log, `CUJO_DIR/audit/<random>.jsonl`,
and points that command's `CUJO_AUDIT_LOG` at it. Attribution is then which
file a row landed in. A process an earlier check left running holds that
check's log and cannot write into this one; a command the agent runs with the
environment `setup` printed holds the shared `audit.jsonl`, which no report
reads. Previously those rows were claimed by whichever report came next.

**The first attempt tagged rows instead, and was wrong in the dangerous
direction.** `run_sensed` minted a run id, passed it as `CUJO_RUN_ID`, and
dropped rows carrying any other value. But the tag lives in the environment of
the process being measured, so a child that kept `CUJO_AUDIT_LOG` and dropped
`CUJO_RUN_ID` still wrote rows — and those rows were then filtered out of the
report. A sensor that can be silenced by unsetting a variable is worse than no
filter at all, because the report still reads as complete. Naming the file is
the same idea with the trust moved: the child cannot write into a log it was
never told about. Caught by Qodo on the pull request.

That change also removed a rule that had been added alongside the tag, which
treated every read under `CUJO_DIR` as sensor noise. With per-command logs the
wrapper's own reads of the sensor logs never reach a report anyway, so the rule
bought nothing — and it hid a command reading `decoy.backup`, which is where
`setup` parks the real credentials file the decoy displaced. Also Qodo's.

Chosen over **tagging the proxy and watcher rows the same way**, which cannot
work: those are long-lived daemons serving every check, and nothing in a
connection tells them which check opened it. Over **a proxy and a log file per
sensed run**, which is a port and two daemons per command and moves the same
ambiguity into the port allocation. Over **attributing by process tree**, which
the audit hook could nearly support (it records `pid`) but the proxy cannot.
And over **leaving it to the rubric** to serialise the checks, which is a
sentence of prose defending a correctness property, in the place where prose is
least reliable.

Known limit: the proxy rows are still bounded only by offsets. Under the lock
that is correct, and outside it — after a timeout — the report may carry
another command's hosts. The per-command log makes the audit rows exact in
both cases.

## 42. The projection holds two reviews, and a blocking review can end a run

Decision 6 said reviews auto-post and the gate fires on a blocking review.
Design 1 of the HITL design (removed in decision 51) narrows that gate to the
accusation, which needs two things the projection could not express.

**Two slots, not one.** A run on the malice path posts its observation as an
advisory review and holds its conclusion for a human, so it holds two reviews at
once. `Projection.review` was a single field the folder overwrote on every review
tool call, so the second call destroyed the record of the first: the operator UI
and the public board would both have shown the un-posted accusation and not the
advisory that was actually on the pull request. `review` now means *the ungated
call, which posted*, and `gatedReview` means *the accusation, drafted*. The
classification is by tool name, so it needs no `tool.response` bookkeeping and no
new state, and it keeps `review` under its own name — which matters, because
projections are read back with `JSON.parse` and no validation and a terminal run
is never refolded, so renaming it would blank the review body on every historical
row.

The findings list splits the same way and for a sharper reason. `p.findings`
reaches the anonymous board through `public/serialize.ts`, and the drafted
review's own `findings[]` is the accusation in list form. So the agent's findings
join only once `gatedResponseSeen` says the review is on the pull request. The
hard-rule hits are not held back: those are Cujo's own measurement, and
publishing the observation while the conclusion waits is the whole design.

**`blocked_unattended`.** With the gate on `post_gated_review`, an ungated
`post_blocking_review` raises no approval, so `gatedResponseSeen` is never set,
`blocked_posted` is unreachable, and the run fell through to `clean` — a green
board row, a 🎉 on the pull request and "No critical finding" on the Discord card
for a pull request carrying REQUEST_CHANGES. Reusing `blocked_posted` was the
other candidate and it fails differently: `approver` is null on that path, so an
operator could not tell "a maintainer confirmed this accusation" from "nobody was
ever asked", which is the exact distinction this whole change exists to draw.

The status is terminal and it is not unfinished. It is deliberately absent from
`listUnfinishedRuns`' SQL, from `isTerminal`'s live pair, from `claimDecision`'s
`WHERE`, and from `canDecide` — a run in it is done, has nothing to approve, and
must never be re-followed on restart or cancelled by a supersede. It shares 👎
with `blocked_posted` because Contract 9's vocabulary is eight emoji and what
happened to the pull request is identical.

**Verification is one-directional, and after the fact.** Which review is an
accusation is now a decision the model expresses by choosing a tool name, where
before it was safe by construction because every REQUEST_CHANGES paused.
`github-mcp` cannot catch a mistake — it is write-only by decision 5 and has no
access to the check reports — and `apps/cujo` is not on the posting path. So the
folder checks the one direction it can: a malice rule tripped and nothing was
held is under-gating, and ends the run `error` naming the rule, the same shape as
decision 21's existing tripwire. Over-gating is undetectable and costs only a
question nobody needed to answer. Neither is preventable: the review is already
public under the bot's name by the time the fold sees it. Accepted, because the
alternative is keeping every REQUEST_CHANGES gated, which is the ceremony this
change removes.

## 43. `apps/cujo` may reply on a pull request, because a person asked it to

**Corrected by 50.** Its conclusion that no installation has to re-approve
did not cover `issue_comment`, which costs the App `issues: read`.

Decision 38 let `apps/cujo` write a reaction, on the argument that the rule
being protected is that **nothing states a finding on a pull request without a
human allowing it** — and that a reaction states no finding, carries no text and
names no file. A comment does carry text, so that argument does not extend to
it, and this needs its own.

The argument is that a reply is **human-initiated by construction**. Every
caller of `createComment` is answering a person who addressed Cujo directly: a
maintainer who typed `/cujo confirm` and is owed the outcome, one whose command
was refused and is owed the reason, or one who asked `@cujo-guard` a question.
Cujo never opens a thread. The thing decision 38 protects is an *unprompted*
statement about someone's code, and a reply to a direct question is a different
act — the same distinction that makes answering the door not the same as
knocking on it.

Two properties keep that honest. The write lives in `apps/cujo`, not in
`github-mcp`, so the agent has no path to it and no tool that could be
prompt-injected into using one; the conversation agent in particular holds no
write authority at all, and its answer reaches the pull request only because the
trusted plane read it out of the turn and posted it. And the body is capped at
8000 characters here rather than at GitHub's 65536, because the text can be a
model's and a reply long enough to bury a thread is a worse answer than a short
one — the one call that must never fail with a 422 is the one explaining why
something was refused.

`GitHubReactions.addToComment` is a separate method rather than a parameter on
`set`, and the reason is not tidiness. `set` deletes every bot reaction on its
target that it did not ask for, and `PrReactor` caches by run id, so a reaction
cleared through that path would never be restored: acknowledging a comment
through the pull request's reaction endpoint would silently strip the run's
verdict off the pull request for the rest of its life. The comment method is
add-only, because there is nothing to reconcile — a comment does not change
state, and "seen" is said once.

**Checked against the live App, not read off the docs**, because decision 38
already found that the docs are wrong about this family of endpoints — they name
`issues: write` for a target that a pull request permission reaches. The
installation on `spencerjireh/orders-api` holds exactly `contents: read`,
`metadata: read`, `pull_requests: write`, and with that token:

- `POST /repos/{repo}/issues/{n}/comments` — created, and deleted again.
- `POST /repos/{repo}/issues/comments/{id}/reactions` — 201.
- `GET /repos/{repo}/collaborators/{user}/permission` — 200, `permission: admin`.
  Included here because Design 2's authorization rests on it and it is the one
  most likely to have needed a grant; GitHub's own documentation states no
  permission requirement for it at all. It is reachable with `metadata: read`.

So no installation has to re-approve, which is the bar decision 38 set when it
rejected a Check Run for needing `checks: write`. The script that established
this is worth re-running if the App's permissions are ever narrowed.

*Corrected by decision 50: that held for the API calls tested here, and not for
the event subscription the same design needs. The App now also holds
`issues: read`, and the installation did have to re-approve.*

## 44. Repo write is the principal that may publish an accusation

The HITL design (removed in decision 51) ended by naming the question it did not
answer: *who, exactly, is the principal that may publish a public accusation
naming a third party, and is repo write access that principal?* Design 2 rests
entirely on the answer. It is yes, with one exception.

Repo write is **broader** than the policy-verified email decision 34 kept Access
for, not narrower. It includes the pull request's author, every bot with write
access, and everyone a repo admin has ever added. Decision 28 rejected a
downward swap of principal once already — Discord channel membership for an
Access email — so the swap needs an argument rather than a shrug.

The argument is that this is a different swap. Decision 28's was *sideways into
a different system*: being in a Discord channel says nothing about a repository,
so the two principals were not comparable and the weaker one was being
substituted for convenience. Repo write is the authority that actually
corresponds to the thing being decided. The claim is about code in a repository,
the consequence lands on that repository's pull request, and the people who
carry that consequence are the people who can merge to it. It is also
self-serve, auditable in GitHub's own audit log, and revoked by removing
someone — where an Access email is revoked by finding whoever holds a Cujo login.
That is decision 31's argument for `.cujo.yml`, applied to a decision rather than
a declaration.

**The author exception is not optional.** The scenario this product exists for is
hostile code in a pull request, and repo write includes whoever opened it. A
denied gate posts nothing (`SKILL.md`), so `dismiss` is the direction that buries
an accusation against one's own change, and the author is refused it by name.
`confirm` by the author is allowed: acting against your own interest needs no
guard.

Three answers, and `unknown` is why there are more than two. GitHub being
unreachable says nothing about who someone is, so it is not a refusal — but it is
not permission either, and the caller says "I could not check, try again" rather
than either "you may not" or nothing at all. The same tri-state
`GitHubReader.repoIsPublic` and `notify/authorization.ts` already use, and for
the same reason. `none` is kept apart from `unknown` because only one of them is
worth retrying.

What this does **not** claim: that repo write is as strong an identity as an
email that passed a policy. It is not. What it claims is that it is the *right*
identity for this decision, and that the audit trail it leaves — a GitHub login
in `approver`, next to a comment in the pull request's own timeline — is more
legible to the people affected than an email in a database they cannot read.

## 45. The signature-gated plane may answer a held finding

`apps/cujo/src/http/ingress/README.md` said, and Contract 8 closed with,
**nothing here may approve a review**, citing decision 28. `/cujo confirm` on a
pull request is on that plane, so that rule has to be corrected rather than
quietly stepped over.

What decision 28 actually rejected was a **principal**, not a plane. Its own
words: moving the binding into Discord "would have replaced *an email that
passes an Access policy* with *a member of a Discord server*, and those are not
the same principal". Being in a channel says nothing about a repository, so the
substitution was sideways into an unrelated system. Nothing in that argument is
about where the bytes arrive.

And this plane is already trusted with the thing it would need to be trusted
with. `github-webhook.ts` checks the HMAC **before the event type, and for every
event** — the comment there already says the signature "is what makes a
`repository` delivery as trustworthy as a `pull_request` one", and a
`repository` delivery re-stamps visibility on every run of a repo. The same
signature covers an `issue_comment`. There is no third state where GitHub is
trustworthy enough to tell Cujo a repo went private but not trustworthy enough
to tell it who wrote a comment.

So the corrected rule is about who, and it is stated in two halves:

- **Nothing that arrives from Discord may answer a held finding.** Unchanged.
  Decision 23 and Contract 8 still own it, and an interactions endpoint existing
  is still not a reason to build the button.
- **A `/cujo` command on a pull request may**, with repo write as the principal
  (decision 44), checked against GitHub on every command, and the pull request's
  author barred from `dismiss`.

Two mechanical properties keep the difference from eroding.

**The verb is an exact string, matched in the trusted plane.** Not intent, and
not a model. `@cujo-guard flagged this incorrectly, ignore it` is a sentence a
human would plausibly write and any intent parser reads as a dismissal — and
anyone in the thread can write it, including a pull request's own author.
`parse-command.ts` matches `/cujo <verb>` alone on a line, and anything after
the verb makes it prose about a command rather than a command. A mention can
never carry a privileged verb.

**And only where a reader can see it.** The scan drops fenced code, blockquotes,
HTML comments and raw HTML first, which is a harder problem than it looks: a
shorter fence does not close a longer one, four spaces opens an indented code
block and not a fence, a blockquote swallows unmarked continuation lines until a
blank one, `<!-- /cujo confirm -->` renders as nothing at all, and GitHub accepts
raw HTML so `<pre>` and `<details>` are two more ways to write a line that is not
an instruction. Each of those, read naively, is a way to write a command a
maintainer will never see in a comment they might otherwise approve of. The scan
is deliberately more eager to skip than GitHub is to hide: a skipped command
costs one retry, a matched invisible one is the gate handed to whoever wrote the
comment.

**Cujo ignores its own comments.** The success reply prints the verbs and a
review body can quote them, so without the `BOT_LOGIN` check a reply would
re-trigger itself.

Finally: **every outcome speaks on the pull request.** The operator UI at least
answered 409 on a refusal. A comment that is silently dropped is
indistinguishable from a delivery that never arrived, and the person who typed
the command cannot tell which happened — so each refusal names itself and says
what to do instead, the way `notify/authorization.ts` already does for Discord.
That is why there is a sentence for each of `no_such_run`,
`not_blocked_pending`, `already_decided` and `resume_failed`, and for a stale
head, an author's dismissal, a missing run, and a permission GitHub would not
confirm.

**A push does not discard an answer somebody gave.** `claimDecision` sets the
approver without moving the status off `blocked_pending`, so an allow in flight
is invisible to `supersede`'s status check. `supersede` first tries to deny the
stale approval; when that deny finds the call already answered *and* `approver`
is set, it now leaves the run alone instead of cancelling. The alternative was
worse in both directions: the cancel kills the turn that decision started, while
the row and the reply already on the pull request both record the person as
having decided. Posting a verdict about a commit that has since been pushed past
is defensible — the finding was real on the commit they read, the observation
half is public either way, and the new head gets its own run that re-derives
it. Telling somebody their decision worked and then throwing it away is not.

The window itself is narrowed rather than closed. The current head is read from
GitHub as the last call before the claim, and it selects the run by commit
rather than by insertion order — local delivery order is not commit order, and a
late delivery for an older head would otherwise be the newest row. Two systems
with no shared transaction cannot do better than that.

## 46. The sensors are a package, delivered as a source archive

**Reversed in part by 117.** The sandbox image is ours now, so the sensors ship
in a layer, there is an install step, and the stdlib-only rule is a default rather
than a constraint. What holds is that state lives outside the code directory.

`sandbox/sniff.py` had grown to a thousand lines holding five sensors, four
subcommands, two daemons, and the tables that decide what counts as malicious.
It is the file every hard rule's evidence comes from and it was past the length
anyone reads before changing. It is now `sandbox/cujo_sniff/`, a package of
small modules on a one-way import chain: paths, then policy, then context, then
the sensors, then the report, then the runner and the commands.

Two properties of that split are load-bearing rather than cosmetic. **Nothing
under `sensors/` imports the context**: a sensor takes the paths it writes to
as arguments, which is what lets the proxy and the watcher run as bare daemons
that read nothing from the environment. And **`Context` replaced the two
import-time constants** `CUJO_DIR` and `ENVS_DIR`. Those could only be changed
in a test by patching the module attribute, which patched the test process
while the code under test ran in subprocesses that re-read the environment — so
the tests and the thing they tested disagreed about where state lived.

Delivery changed with it, because a package is not one `curl`. The rubric now
fetches a source archive of this repo from `CUJO_SNIFF_TARBALL_URL`, strips the
archive's top directory, and moves `sandbox/` into place as `/tmp/cujo`, so
`sniff.py` and `cujo_sniff/` land as siblings. That is the whole import mechanism: running
`python3 /tmp/cujo/sniff.py` puts `/tmp/cujo` on `sys.path[0]`, and the package
is found with no install, no `PYTHONPATH`, and no third-party dependency. The
daemons re-execute as `python3 -m cujo_sniff` with the working directory set to
that same directory, for the same reason; re-executing `__file__` would put
`cujo_sniff/` itself on the path and break every import.

`--strip-components=1` and a plain `mv`, rather than `tar --wildcards`, because
`--wildcards` is GNU-only and would make a local rehearsal on macOS need
`gtar`. Stripping one component also means nothing has to know the archive's
top directory is called `cujo-main`, which changes with the branch. `mv` and
not `cp` because it replaces the directory instead of merging into it: a
module deleted upstream would otherwise survive in `/tmp/cujo` from an earlier
extraction and still be importable. The whole fetch is one `&&` chain for the
neighbouring reason — a failed download must not leave a stale tree behind for
the next step to use as though it were fresh.

This amends **decision 19**, which stands otherwise: the fetch is still one
public, credential-free request, nothing on the server pushes anything in, and
the trust boundary is where decision 4 puts it. Two corrections to 19 while it
is being amended. Its claim that the fetch host "is on the known-host list
anyway" was wrong — `KNOWN_INDEX_HOSTS` carries `codeload.github.com` but never
carried `raw.githubusercontent.com`, so the new URL is the one that was always
covered and the old one was the exception. And the URL is still `main`-relative
rather than pinned to a commit, for the reason 19 gives.

`CUJO_SNIFF_TARBALL_URL` is a **new key**, not a new value for the old one.
Merging is the deploy and the running container keeps its environment until the
swap (decision 35), so changing `CUJO_SNIFF_URL` would open a window in which
some container fetched a path that did not exist on the side of the merge it
was on. A new key with a repo default needs no Coolify change at all: the old
key still answers for containers that predate the deploy, and the new one
applies from the first container that follows. `sniffUrl` stays in the config,
unread, and is deleted in a later release once nothing runs that reads it.

Rejected: **vendoring the package into one generated file** at build time,
which keeps the single `curl` but makes the artefact in the sandbox different
from the source in the repo, so a stack trace names a line nobody can open.
And **fetching each module with its own `curl`**, which is a list of filenames
in the rubric that goes stale silently the first time a module is added.

## 47. Conversation runs in its own session, and the agent that answers cannot write

Decision 38 allowed `apps/cujo` a reaction on the pull request, on the argument
that "nothing states a finding on a pull request without a human allowing it — a
reaction states no finding, carries no text, names no file". Decision 43 then
allowed a reply, on the narrower argument that a reply is human-initiated by
construction: a maintainer with write access asked a direct question, and the
answer goes to them.

`@cujo-guard <anything>` is that argument taken to its end. It is the feature the
sandbox makes possible and no other reviewer has — a maintainer says "that route
needs orders to exist, seed the database first", and the answer is a new
measurement rather than a rephrasing of the old one. Qodo and CodeRabbit can
re-read the diff; only Cujo still has the recipe.

It is also the first place a comment written by anyone provisions compute and
becomes model input. Two properties carry that, and both are structural.

**Its own TrueForge session, always.** The obvious implementation —
`startTurn` on the run's own session — does not work, for three independent
reasons rather than one:

1. **It cancels a live review, silently.** Creating a turn while one runs
   cancels the old one, and a subscriber to the cancelled turn is never told; the
   drain loop never sees `turn.done`, the stream does not drop, and the only
   thing that fires is the thirty-minute watchdog. One comment throws away a
   whole sandbox run, and ungated that is a one-comment denial of review against
   every pull request in every installed repository.
2. **It is refused in the state where it is wanted.** `422 thread main: user
   message cannot be sent while approvals or questions are pending` — and an
   approval is outstanding on the *session*, not the turn. While a run is
   `blocked_pending`, which is the exact moment a maintainer wants to say "seed
   the db first", the message is rejected.
3. **It corrupts the projection.** `fold` is one accumulator over a run's whole
   event list. A re-run spawns a second thread titled `tests`, and `p.checks`
   dedupes by thread id rather than title, so the same critical is emitted twice
   and a successful re-run can never clear the finding it was meant to correct.

All three are properties of *sharing*, not of conversation, so conversation gets
its own session keyed by pull request — a second table, because `sessions` is
keyed by the pull request and already holds the review's.

For the same reason it does not go through `Runner`. `refold` writes run status
unconditionally and emits on `changes`, which drives the pull request reaction
and the Discord card; a conversation turn routed through it could move a `clean`
run to `error` and repaint a verdict nobody changed. The harness client is the
only thing shared with the reviewer.

**The agent has no write tool, and `apps/cujo` posts the reply.** The spec
carries `mcpServers: []`, so there is nothing to inject *into*: the worst a
prompt injection through a stranger's comment achieves is a wasted sandbox. The
alternative — giving the agent a reply tool — was rejected twice over. It is the
exact negation of decision 38's argument, since a free-text tool states whatever
the model decides to state; and it cannot report its own failure, whereas reading
the final assistant message means a turn that errors or times out still answers
the person who asked. Silence is the one answer that is never right.

The sandbox stays enabled. Removing it would leave an agent that can only
paraphrase the report it was handed, which is the thing this feature exists not
to be.

**Repo write is required, and so is a ceiling.** The authorization is the same
check `/cujo` uses and runs before the rate limit, so a stranger cannot spend a
maintainer's budget: a sandbox is not free speech. The ceiling is in memory and
per pull request — at most three questions an hour, one at a time — because the
resource it protects is provisioned by this process, and a restart already means
no turn is in flight. A second question while one is running is refused rather
than queued: two sandboxes for one pull request is the thing being prevented,
and a queue would only delay it.

**Two events, because a review thread is not the pull request thread.**
`issue_comment` covers the pull request's own conversation and nothing else; a
reply inside a review thread — where Cujo's inline findings actually are — is a
`pull_request_review_comment`. The flow this design exists for is "prove it",
asked under the finding it doubts, so subscribing to only the first would have
missed the case that matters most. The reply goes back to whichever surface the
question came from. Only conversation is dispatched from the review-thread
event; `/cujo` stays on the pull request's own thread, because narrowing the
surfaces that can decide a review costs nothing.

**The rubric says the question is untrusted.** `agent/SKILL.md` scoped that rule
to "everything inside the repository", and decision 17 already noted that a stray
user message is the worse case — it appends a turn the agent acts on. This design
publishes that channel to the internet, so both rubrics now say that a later user
message is a comment somebody typed on a public pull request, whatever it claims
about itself, and that only the first message is a brief.

Rejected: **a shared session with a guard** — "only converse when the run is
terminal" — which fixes the 422 and nothing else, and leaves the projection
corruption and the cancelled review for a race to find. **Conversation without a
sandbox**, which is cheap, injection-proof, and re-reading, which is what every
other bot already does. And **no rate limit**, on the argument that repo write is
enough: it gates who, not how often, and six pasted questions are six clones.

## 48. `sniff.py` is an entry point, and state lives beside the code

The package landed in decision 46 beside an untouched `sandbox/sniff.py`, which
stayed the thing production ran. That was a delivery constraint, not a design:
merging is the deploy and the tarball URL is `main`-relative (decision 35), so
the release that first delivered `cujo_sniff/` had to be a release in which
nothing needed it yet. Once that release was live, every container fetching the
archive already had the package sitting beside the script, and the monolith had
no remaining job.

So `sandbox/sniff.py` is now a docstring and two lines: `from cujo_sniff.cli
import main`, and the `__main__` guard. It keeps the name because the rubric
types it — `python3 /tmp/cujo/sniff.py setup` — and because that spelling is
what puts `/tmp/cujo` on `sys.path[0]` and finds the package. There is no
`sys.path.insert` in it: none is needed, and one would be an `E402` and a lie
about where the package comes from.

`sandbox/tests/test_sniff.py` is deleted rather than kept. It could not be
kept honestly: half of it reaches into module attributes that the shim no
longer has, and the other half shells out to the script, which would keep
passing while testing the package under a name that implies otherwise. The
replacement suite arrived whole in the previous release for exactly this
moment, so nothing is uncovered by the deletion — the duplication was the
price of not having a gap.

`CUJO_DIR` now defaults to `/tmp/cujo-state` rather than to `/tmp/cujo`. The
old default put every runtime file — the pid files, the JSONL logs, the decoy
backup, the audit directory, the sensed lock — in the same directory as the
modules being imported, which made the code directory unreadable and "did
anything change in `/tmp/cujo`?" a question with no meaning.

Beside, and not merely nested, because of what the fetch is: the rubric's step
1 ends in `rm -rf /tmp/cujo && mv .../sandbox /tmp/cujo`, which replaces that
directory **wholesale**. Anything written underneath it is destroyed by a
refetch while the thing it describes survives — `proxy.pid` and `watcher.pid`
would go while the daemons they name kept running and kept holding the proxy
port, so the next `setup` could neither stop them nor bind; and `decoy.backup`
would go while it was still the only copy of the real credentials file `setup`
displaced, which is data loss in the one direction Cujo must never cause. The
same hazard was there under the old default — `/tmp/cujo` *is* the replaced
directory — so this fixes it rather than introducing it. Nesting the state one
level down would have moved it without fixing anything. State that outlives
the code it was written by has to sit outside the code.

Nothing outside the process observes the move: the rubric never names the state
directory, it reads every path it needs out of `setup`'s JSON, and
`CUJO_ENVS_DIR` keeps deriving from whatever `CUJO_DIR` is — so this is a
defaults-only change and an operator who set either variable is unaffected.

`envs_dir` stays *beside* the state directory and not inside it, at
`/tmp/cujo-state-envs`. The snapshot prunes the state directory because our own
logs change on every check; a detonation environment must stay visible, because
what an install writes into it is the evidence.

This does not touch the state directory's other property, recorded with
decision 41: reads under it are deliberately **not** filtered as sensor noise,
because `decoy.backup` holds the real credentials file the decoy displaced and
a command reading it is exactly the thing worth seeing.

## 49. The operator plane swaps an email for a shared token, because it no longer decides anything

**Superseded by 57.** The token is deleted with the plane it gated.

**This is the downward swap of principal decision 28 refused**, and the entry
has to say so first rather than last. Decision 28 rejected Discord channel
membership as a principal because "a Cloudflare Access email is a policy-checked
identity and channel membership is not", and it built Contract 8's two-half
model around exactly that. Decision 31 then narrowed it and said so plainly.
This one goes further: it replaces the email with a shared token that names
nobody.

The reason that is acceptable is not that the token is stronger. It is not. The
action that justified the email no longer lives here.

Every version of that argument turned on **publishing an accusation**: an
irreversible public claim about a person's code, made under the bot's name, and
therefore something that had to be attributable to a human being. Decision 44
moved that action to the pull request, where the principal is repo write —
checked against GitHub on every command — and the audit trail is a GitHub login
in `approver`. So the plane that used to hold the one attributable action now
holds none.

What is left on it is reads, and Discord bindings. A binding decides where cards
go and which server may see which repo. That is real, and it is why the plane
keeps a gate rather than becoming public: this is not "delete the login", it is
"the login was carrying a claim it no longer has to carry". `authorized_by` and
`bound_by` record the fixed string `operator`, which is honest — an email there
would assert a policy check nothing performs any more.

**`POST /runs/:id/approve` is deleted, not left working.** Two ways to answer
one finding is one audit trail too many, and the one that would rot is the one
nobody uses. `ApproveBar` becomes a panel that says a maintainer is being waited
on and prints the two commands; `canDecide` survives with its meaning corrected
from "this page may decide" to "a decision is outstanding".

**The token never enters JavaScript.** `apps/web` takes it once at `/login` and
keeps it in an httpOnly cookie on its own origin, then turns it into an
`Authorization: Bearer` header server-side. A value a page can read is a value a
script injected into that page can read, and this token gates every write on the
plane. That is also why `/login` is not served on the public host: a sign-in
form on an anonymous board is an invitation to phish one.

The comparison is constant time. A shared secret checked with `===` leaks its
prefix to anyone who can time the answer; lengths are compared first, because
`timingSafeEqual` throws on a mismatch and a length is not the secret.

**Both credentials are accepted for one release.** Merging is the deploy
(decision 35), so a gate that accepts only the credential nobody has issued yet
locks the operator out of their own board — and the ordering is genuinely
two-sided here: the token has to reach the environment, and the Cloudflare
Access application has to be removed, and neither is this repository's to
sequence. So the token is checked first and the assertion still works, and the
`CF_ACCESS_*` pair becomes required only while the token is unset. A *wrong*
token is refused rather than falling through, because whoever sent one meant to
use that gate, and falling through would let a request carrying a bad token and
a good assertion in while reading as though the token had worked.

The `cujo-harness` Access application stays regardless. That console has its own
authentication disabled, and an OTP in front of it is exactly what it is for.

Rejected: **keeping the approve route behind the token**, which preserves a
second way to publish an accusation with a shared identity — the precise thing
decision 44 moved away from. **Holding the token in `apps/web`'s own
environment** and injecting it server-side on every call, which is nearly free
and gates nothing: anyone reaching the operator hostname would get the board and
the Discord admin forms. And **making the whole plane public**, which is
tempting now that `approver` is a GitHub login already visible on the pull
request, but publishes `session_id`, `turn_ids` and `delivery_id` and hands the
Discord bindings to anyone.

## 50. `issue_comment` costs the App a permission, and decision 43's check did not cover it

Decision 43 established, against the live App rather than the documentation,
that `apps/cujo` could comment and react on a pull request with the permissions
it already held, and concluded: "So no installation has to re-approve, which is
the bar decision 38 set." That conclusion was correct about what it tested and
wrong about what it implied.

It tested **API calls**. Subscribing to an **event** is a separate gate, and
GitHub applies it separately. `issue_comment` is released by the `issues`
permission and by nothing else — including for a comment on a pull request,
which is the only kind Cujo acts on. The App settings page will not even render
the checkbox while `issues` is `none`, and a form that carries the value anyway
is rejected server-side. There is no REST route for the subscription either, so
this is the one piece of Cujo's configuration that cannot be scripted.

So the App now holds `issues: read`, and the installation was asked to accept it
on 2026-08-29. The bar decision 38 set was cleared for the wrong reason and then
crossed anyway; the honest reading is that decision 38's rule — a new permission
is a real cost, weigh it against the feature — applies here and the feature
wins, because `/cujo confirm` *is* the human gate (decision 44) and a gate that
never receives its event is not a gate.

Read-only, and it grants nothing the review needs: nothing in `apps/cujo` or the
agent reads an issue. It exists to make one webhook arrive.

`pull_request_review_comment` needed no such grant — it is released by
`pull_requests`, which the App already held for the review itself.

The rejected alternative was **`author_association` from the payload**, which
arrives free and needs no permission. The HITL design had already ruled it out
for authorization, and it is ruled out here for the same reason: `COLLABORATOR` does
not distinguish triage from push, so it is not the repo-write check decision 44
requires. Trading the accuracy of the principal for a permission grant is the
wrong side of that trade.

## 51. A shipped design document is deleted, and the log carries its own reversals

`docs/hitl.md` was written before designs 1, 2, 3 and 5 were built. Once they
shipped it stopped being a plan and became a second, competing description of
the running system — and a wrong one. It opened "A design that is not built
yet". It said "the last decision is **41**; new entries start at **42**" while
this file was at 50. Its "Documentation this changes" table was a to-do list of
edits already applied. Its "Still open" items had been answered by 47 and by
Contract 6, and the question it says it does not answer was answered by 44.

That is not staleness anyone can read past. A design document and a spec that
disagree do not average out; the reader believes whichever they opened, and this
one was linked from `docs/README.md` as current. Deleting it is the correction.

**Design 4 survives as [issue #56](https://github.com/spencerjireh/cujo/issues/56).**
It was the only part never built, and it is worth building: a maintainer says a
host is theirs, Cujo opens a `.cujo.yml` pull request, and merging it is the
authorization. The issue re-derives every citation, because the document's had
rotted — it claimed `findings.ts` honours a `known` flag on egress rows, and
that suppression moved into `sandbox/cujo_sniff/report.py` at 46 and 48. It also
records the blocker the document could not know about: the conversation agent
that would hear the request has no write tool, by 47.

**The six user flows move to `docs/architecture.md`.** They describe how the
shipped system behaves end to end and existed nowhere else. Flow E is marked
unbuilt and points at the issue.

**This file gains an index and superseded banners.** Append-only was the right
rule and it is unchanged; what was missing is that a reversed entry gave no sign
it had been reversed, so a top-down read produced confident wrong answers about
Access (2), the gate's scope (6), where the operator UI lives (17), how the
sensors reach the sandbox (19), and the Discord binding's principal (24, 28)
until the reversal turned up hundreds of lines later. Each such entry now names
its successor in one line under its heading. Only the superseded side needed it:
by house style a superseding entry already opens by saying what it corrects.

Two entries that look reversed and are not, recorded so nobody "fixes" them: 16
stands — "a session per head SHA, which reverses decision 16" appears inside 39
as a *rejected* alternative, and 47's second session refines 16 rather than
replacing it. And 38 → 43 → 47 is one rule widening under a constant argument,
not a reversal.

Rejected: **keeping `hitl.md` as a dated tombstone**, which leaves rotted
line-number citations a reader cannot tell from live ones, and leaves the
document still linked from the index. **Rewriting it into past tense**, which
buys a second narration of what `spec.md` and this file already hold, and
guarantees a third contradiction later. **Leaving the reversals unmarked and
relying on "newest context wins"**, which is a rule about how to resolve a
conflict, not a way to notice there is one.

## 52. `apps/cujo` dismisses its own stale blocking reviews when a clean run supersedes them

A `REQUEST_CHANGES` review from an earlier commit stays on the pull request when
the author pushes a fix and the new run completes clean. GitHub branch
protection treats it as still blocking, so the author or a maintainer must
dismiss it by hand — a manual step that the system has enough information to
perform on its own.

When a run reaches `clean`, `apps/cujo` now lists the bot's own reviews on the
pull request, finds any `REQUEST_CHANGES` whose `commit_id` differs from the
current head, and calls `PUT .../reviews/{id}/dismissals` with a fixed
template: `"Superseded by a clean run on <sha>."` The text is never agent
prose, never quotes a model, and never states a finding — it only removes an
action the bot took earlier. Each dismissal is logged as
`review.stale.dismissed`; a failure is `review.stale.dismiss.failed` and does
not affect the run's own status.

**Why `clean` is the only trigger.** A run that ends `blocked_*` or `error`
has not demonstrated that the original findings are gone, so the old review is
left standing. The evidence is the run's own result, not a diff of findings:
the simplest proof that the blocking condition is resolved is that the new run
found nothing to block.

**Precedent for the write.** Decision 38 originally held that the one write
`apps/cujo` makes to GitHub is content-free (the reaction). Decision 43 later
added `createComment` and `replyToReviewComment` to `GitHubReader` for the
conversation feature, establishing that the trusted plane may make
content-bearing writes when answering a human-initiated action. This dismissal
extends the same pattern: it removes the bot's own earlier block, it carries no
finding, and it fires only when the run's evidence justifies it.

**Head-freshness guard.** The dismissal runs asynchronously after the clean
status is persisted. If the PR advances while the task is in flight, a newer
run's blocking review must not be dismissed by the clean run that preceded it.
Before listing reviews, `dismissStaleReviews` reads the PR's current head from
GitHub; if it differs from the run's `headSha`, the dismissal is skipped and
logged as `review.stale.skipped` with `reason: "head_moved"`. The remaining
TOCTOU window between the head check and the dismiss call is negligible, and a
newer clean run would re-attempt its own dismissals regardless.

**Not in `github-mcp`.** The dismissal is a service-level action driven by the
run projection, not a tool the agent calls. `github-mcp` stays write-only and
PR-state-blind (decision 5). `apps/cujo` already reads review state for the
idempotency check (Contract 5, `alreadyReviewed`), so listing reviews is an
existing capability, and dismissing them is a narrow extension of it.

The rejected alternative was **manual-only dismissal**, which `hitl.md` Design 2
treated as acceptable because "anyone with write access dismisses a
`REQUEST_CHANGES` in one click." That is true and remains available, but a
system that blocks a merge and then requires a human to undo the block after the
system itself confirmed the fix is a friction the system can remove.

## 53. Reasoning effort is a deployment setting, not a constant

`agent-spec.ts` sent `model: { name }` and nothing else, so every turn ran at
whatever effort the provider defaults to. That was fine while the model was
fixed. It stopped being fine the first time a review had to be moved to a
different model to make it finish.

The evidence: on `glm-flash`, a fresh session reviewing a pull request with a
malice finding spent eleven minutes before spawning a single check, ran two of
the four, spawned a thread that produced no report, and hit the thirty-minute
turn timeout without calling any review tool. The sensors were not at fault —
detonation installed the dependency, caught the decoy read, and the hard rule
fired. The parent agent simply never got to the end.

So `CUJO_MODEL_REASONING_EFFORT` joins `CUJO_MODEL` as a deployment setting,
passed through as `model.params.reasoningEffort`. The values are the provider's:
`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

**Unset means the key is absent, not empty.** Every entry in `params` is
forwarded to the provider as-is, so an empty string is a request to reason with
no effort named, and a model that does not reason at all answers that with an
error rather than a default. Absent is the only safe spelling of "do not ask".

**One setting for both agents.** The reviewer and the `@cujo-guard`
conversation share it, because a conversation that reasons less than the review
it is explaining would contradict that review for no reason a reader could see —
and `converse` re-runs the code, so it is answering from the same evidence.

This does not make effort a per-run choice, and it deliberately stops short of
that. A run that needs more thought than the deployment allows is a run whose
rubric is too hard, and letting the agent raise its own effort would put the
cost of a review in the hands of whoever opened the pull request.

**It reaches an existing pull request only through a new one.** The spec is
pinned when the session is created, so `CUJO_MODEL_REASONING_EFFORT` — like
`CUJO_MODEL` and like `agent/SKILL.md` before it — changes nothing for a pull
request that has already been reviewed once. Verifying a change to any of the
three means opening a new pull request, not pushing to an old one.

## 54. The report says what it could not observe

`agent/SKILL.md` has always ended the hard rules with one honest sentence: "the
rules are tripwires, not proofs of absence: `false` means 'not observed'." The
report had no way to say the rest of it. `decoy_read: false` is what a report
says when nobody touched the decoy, and it is equally what a report says when
the watcher died in its first second — and nothing in a check report told the
two apart. Four sensors, four ways to be quiet for the wrong reason:

- The decoy watcher chooses inotify or an atime poll at startup and announces
  the choice in one log row that no report could ever reach: `run_sensed` takes
  its log offset after that row was written. Which backend armed is not a
  detail — the atime fallback is close to useless under `relatime`, which this
  spec already said and no reader of a report could see.
- `cmd_setup`'s `ok` covered the proxy alone; the watcher's pid was discarded.
  Neither was re-checked afterwards, so a proxy that died during the first
  check left the three that followed with an empty `egress` and a clean
  `egress_to_unknown_host` — a clean bill of health from a blind sensor.
- The Python audit hook produced an empty log both when it never loaded and
  when the command did nothing. `sensors/pyhook.py` named this gap in its own
  docstring and pointed at a block that did not exist.
- `secret_probe.decoy_in_egress` was hardcoded `false` and nothing has ever
  computed it. The proxy counts bytes and never reads a payload.

So every report now carries `sensors`: one `{armed, detail}` per sensor, with
the daemons re-checked per command rather than taken on `setup`'s word, and the
hook writing an `armed` row as it installs itself. `decoy_in_egress` becomes
`null`. And `apps/cujo` turns an unarmed proxy or watcher into one `warn`
(`sensor_unarmed`) alongside the rules it already re-derives (decision 21).

**A `warn` and not a `critical`, and not a gate.** The rule says the evidence is
thin, not that the code did anything, so it stays out of `MALICE_RULES` and
cannot put a review through the human gate.

That the block is forgeable is not an objection to it. The code being measured
runs as the sensors' own user and can write the pid files, the audit log, and
`proxy.jsonl` alike; this block is evidence at the same level as every row it
describes, and it closes the accident rather than the adversary. The direction
is what matters: every rule fires on a sensor reporting *false*, so forging
health suppresses a warn and cannot invent a finding against anyone. Only the two long-running daemons
are ruled on at all: a check that runs `npm test` has no Python process to hook,
so warning on an unarmed `audit` would fire on every JavaScript repository, and
`fs_diff` is never off, only short — which is what `truncated` is for. Those two
are reported and the agent weighs them. Code senses, the agent judges.

Three smaller things ride along, all of the same kind — a report that was
quietly claiming more than it knew.

**`truncated`.** Four caps cut a report short and none of them left a mark. A
`files_read` of two hundred read as a command that touched two hundred files.
Worse, `MAX_SNAPSHOT_FILES` stopped the two filesystem walks in different
places, and every path the second walk never reached became a `deleted` row —
invented evidence, on the sensor with no way to be argued with.

The rule that replaced it took two goes, and the first was wrong in the other
direction: suppressing every absence whenever *either* walk was capped also
threw away real deletions from a command that shrinks a tree past the cap. The
two flags are not interchangeable. A `created` row reads the before walk's
silence, so it needs that walk complete; a `deleted` row reads the after walk's,
so it needs the other one. A path both walks hold is always compared, because no
absence is being read.

**Escaping.** Every string in a report is written by the code under review, and
it is read by the parent agent, quoted into a review, and rendered in a browser.
`errors="replace"` on the subprocess capture was the only defensive step in the
whole pipeline; terminal escapes, carriage returns, and bidirectional overrides
reached the prompt untouched, in output, in `argv`, and in filenames the author
chose. They are escaped now as visible `\xNN` and `\uNNNN` — escaped, not
stripped, because a dropped byte quietly rewrites the record and an escape is
its own account of itself. `subprocesses[].argv` is also coerced and capped: it
came off a file the audited process can write to, so `json.loads` will hand back
whatever is in there.

**Content hashing, scoped.** A file was identified by `(mtime_ns, size)`, which
`os.utime` defeats: overwrite a key with another key of the same length, restore
the timestamp, and two `lstat` calls agree. A SHA-256 digest closes it, but
hashing all of `$HOME` would make each snapshot a full read of it, so the digest
is spent where a silent edit is the whole attack — the credential locations and
`/etc`.

Four details in that decide whether it works at all, and all four are the same
mistake: a digest that was not taken must never be mistaken for one that
matched — and, in the last of them, must not be mistaken for a mismatch either. A read that failed is recorded as its own value rather than as "no
digest here", or the evasion closes back up — restore the timestamp, then
`chmod 000`, and a failed digest read as out-of-scope falls back to the metadata
that was just forged. A file over the size cap is a third value again, counted
by the walk and declared as `truncated.hashes`, because a cap that silently
turns the comparison off is the same hole wearing a limit; the cap itself sits
well past any real credential. And the hash opens with `O_NOFOLLOW | O_NONBLOCK`
and checks the descriptor rather than the name — the command under test owns
this tree, and a FIFO dropped in between the `lstat` and the open would block
the snapshot, and with it the check, for as long as nobody writes to it; the
descriptor's device and inode are checked against the measurement for the same
reason, since a file swapped in only for the duration of the open would pair an
innocent digest with the metadata of whatever replaced it.

The fourth runs the other way, and is the one place this design declines to
tighten. Where *neither* snapshot could hash a file, the comparison falls back
to metadata rather than declaring a change. Much of `/etc` is root-owned and
unreadable to the sensors from one run to the next, and `wrote_sensitive` is a
`critical` the agent may not lower — so "unreadable twice means modified" would
put a non-lowerable accusation on every check of every repository, which is a
worse failure than the one it closes.

Nor does it flag them. The first version of this counted every file without a
digest into `truncated.hashes`, and CI is what showed that up: on any Linux box
`/etc/shadow` is unreadable to the sensors, so the flag was true on every run
ever. A flag that is always true is not evidence, it is furniture. So the count
is the files this walk *could* have compared and did not — past the size cap, or
swapped under it — and a file the sensors have never been able to read is
treated as what it is: outside their reach, like a directory the walk cannot
descend into and has always skipped in silence.

That leaves one thing genuinely missed, and Contract 2 says so out loud rather
than leaving it implied: a file held unreadable across both snapshots and edited
in between, with size and timestamp restored. It is not observable from inside
the sandbox in either direction. Saying which measurement did not happen is this
decision's whole thesis, and the boundary of the thesis is that some of them
cannot be measured *or* usefully flagged — at which point the honest move is to
write the gap down where a reader will find it.

The sensitive set grew at the same time and for the same reason: it held nine
`$HOME` paths and `/etc/cron`, so a write to `/etc/sudoers.d/` or
`~/.kube/config` was `sensitive: false`. Every path added is one no benign
installer writes — and each is matched as itself or as a directory above the
path in question, never as a string prefix, because `/etc/passwd` and
`/etc/passwd_backup` share eight characters and nothing else.

### Additive only, which is what let this be one pull request

`schema_version` is new, and it is the smaller half of the compatibility story.
The larger half is a rule this change had to obey to ship at all: **no renames,
no removals, and no nesting of the six existing sensor keys.**

Two things force it. There is no schema — `check.report` is `unknown` in both
apps and every consumer duck-types — so a shape change raises no compile error
anywhere; it produces fewer findings and emptier tables, silently.
`apps/web/src/lib/api/report.ts` decides "is this a sensor block?" from those
six key names, so nesting them under `sensors` would have dropped the entire
forensic view to a raw JSON dump with nothing going red. And merging is the
deploy while the tarball is `main`-relative (decision 35): the sandbox is
`main`-fresh at turn time while `apps/cujo` keeps its old image until the swap,
so between merge and deploy the *old* consumer reads the *new* report. Additive
changes make that window a non-event, and the reverse direction cannot happen.

`decoy_in_egress` is the case that proves it. Deleting the field would have been
tidier and is exactly what the rule forbids; `null` reads identically to `false`
through `bool(x) === true`, so the pre-deploy container is untouched. The hard
rule stays too, firing on a `true` nothing emits, so a later sandbox that can
measure it needs no change on the trusted side.

`docs/contracts/report.example.json` is the other half of not having a schema.
One file carries the whole shape, and each of the three consumers has a test
that loads it, so a field added on one side and forgotten on another fails
somewhere. The six hand-written fixtures in the two apps stay: several of them
are deliberately partial, and what they prove — that the parser and the rules
degrade gracefully on a shape nobody promised — is load-bearing, because an LLM
writes the envelope.

Rejected: **`armed: false` as a `critical`**, which makes a sandbox flake into
an accusation against a pull request. **Warning on all four sensors**, which
fires on every repository that runs no Python. **Stripping the control
characters** instead of escaping them, which hides from the reviewer what the
code actually did. **Hashing every file in the walk**, which turns each of the
two snapshots per command into a full read of `$HOME`. And **holding the
contract change back for a second release** the way decision 46 had to: that
sequencing exists because a `main`-relative URL is read by a container that has
not deployed yet, and it buys nothing once every field is additive.

## 55. A card names both parties, and a login reaches a URL only through an allowlist

**Reversed by 86.** The allocation below gave the author line to Cujo and the
person a field plus the footer icon; 86 gives the author line to the person
and the footer icon to the Cujo mark, on this decision's own premise. The two
URL allowlists in the second half stand unchanged.

A Discord card said `spencerjireh/orders-api #7 — Add refund endpoint` and
nothing else identified either side of it. Cujo appeared only as the bot avatar
above the embed, and the person who opened the pull request was not named at
all — so a channel watching four repos read a wall of near-identical grey
blocks, and answering "whose is this" meant opening GitHub.

**Cujo takes the embed's author line; the pull request's author takes a field
and the footer icon.** An embed has one author slot, and it goes to the fixed
party rather than the variable one, because the alternative spends the only
avatar affordance on an identity already visible in the message header. That
leaves the person a field — `Opened by`, second so it renders inline beside
`Head` — and the footer icon, which is the one image slot left once the author
line is spent. A field value cannot carry an image, which is the whole reason
the two are split across three slots rather than one.

Both are on every status, `running` and `superseded` included. The rule that
keeps those two cards sparse is that the card is rewritten only on a status
change, so anything that moves under it would freeze and then lie. Who opened a
pull request does not move.

**The mark is served from this repository, not from `apps/web`.** Discord's
media proxy fetches the icon anonymously, and the operator hostname is gated
while the public one is deploy configuration this process cannot depend on.
`raw.githubusercontent.com` is neither. That needs a committed PNG —
`brand/logo/png/` is gitignored — so `brand/tools/render.mjs` now also writes
`brand/logo/avatar-64.png` beside the SVG, and a mark change cannot leave the
icon stale. It renders `avatar.svg` and not `mark.svg`: the mark is
`currentColor` on transparent, which disappears on one of Discord's two themes,
while the avatar carries its own dark ground.

**Contract 7's rule 7 is amended, not dropped.** It said no derived string is
ever written into an embed URL field. It now says none reaches one without
passing a strict allowlist first, and there are exactly two:

- The avatar is `https://avatars.githubusercontent.com/u/<id>?s=64`, built from
  the numeric account id. A login is a string somebody else chose; an id is not.
- The profile link is built only from a login matching
  `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`. GitHub cannot issue a login outside
  that set, so the check should never fire — it is there so the rule is enforced
  by code rather than assumed. A bot login (`dependabot[bot]`) fails it by
  design: its profile is at `/apps/<name>`, a second URL shape nothing else
  needs, so a bot is named with its avatar and no link.

The field value is assembled rather than escaped whole, because `clean()`
defangs `://` — that is its job. The login goes through the escape pass and the
URL is concatenated after it.

**The store joins, rather than the caller looking up.** The title already lived
in `run_pr_meta`, read by one explicit call in the notifier. The author needed
to reach the card *and* two serializers *and* the SSE stream, so instead of
three more lookups every run read is now a `LEFT JOIN` and `RunRecord` carries
`prTitle`, `prAuthorLogin` and `prAuthorId`. That also buys the public plane's
allowlist test for free: a field on `RunRecord` is a red build until somebody
classifies it (decision 34). Two migrations, both nullable with no default, for
the same reason 2 and 3 were — a run recorded before them has no author, and a
deleted account has none either, neither of which is an empty string.

**The public board now names one kind of person.** It publishes `pr_title`,
`pr_author_login` and `pr_author_id`, and the run page renders the author with
their avatar. Every row that plane serves is one where `is_public` is true, so
all three are already world-readable on the pull request itself — a different
fact from `approver`, which names a Cujo operator and appears nowhere else and
stays withheld. The summary carries only the title: a list row names a pull
request, not a person.

**The web app loads avatars through `next/image`.** They are fetched and
resized by the Next server, so opening a run on the anonymous board does not
make a request to github.com carrying the visitor's address. That costs a pinned
`sharp` dependency, which the standalone build traces. A plain `<img>` would
have cost nothing and leaked exactly that.

Rejected: **the author line for Cujo *and* a thumbnail for the person**, which
puts a large image on every card and squeezes the fields on a narrow client.
**Naming the person in the footer text**, which reads better but cannot carry
the link, since Discord renders no markdown in a footer. **Falling back to the
Cujo mark when there is no author avatar**, which puts the same icon on one card
twice and reads as a bug rather than as an absence. **An `Author` column on the
runs list**, which repeats a face down a table that is scanned for status.

## 56. A provider must declare the reasoning efforts it will accept

**Reversed by 127.** The harness clamps an effort against what the model declares; nothing is announced to the provider and nothing refuses boot over it.

Decision 53 added `CUJO_MODEL_REASONING_EFFORT` and shipped it unusable. Setting
it to `low` made **every** pull request webhook answer 502 —
`createSession` throwing with `reason: "session_create_failed"` — and no review
started on any repository. It did that twice in one afternoon.

The cause was one line. `clients/trueforge.ts` registered every model with
`properties: {}`, and `ModelProperties` carries `reasoningEfforts`. So the
server was told each model supports no reasoning effort at all, and then refused
any session spec that named one. Decision 53 named the seven values correctly
and never said who had to declare them.

**The provider was never the problem, and this was measured.** Calling
OpenRouter directly with the deploy's own key: `z-ai/glm-5.3-flash` answers 200
with `reasoning_tokens: 11`, and the same call with `reasoning: {effort: "low"}`
answers 200 with `reasoning_tokens: 0`. Low effort works, and does the thing it
was wanted for. The model call simply never happened, because validation failed
first.

So `MODEL_PROVIDER_REASONING_EFFORTS` joins `MODEL_PROVIDER_MODELS`, and every
model this process registers carries it.

**One list, fanned out per model.** There is no provider-level field:
`CustomModelProvider` has only `auth`, `baseUrl`, `models`, `name` and `type`,
and the declaration lives on each `ConfiguredModel.properties`. The catalog's
`supportedReasoningEfforts` reads like the right field and is not — it is
read-only, carries no models, and cannot be sent. A per-model syntax was
rejected in favour of one list because `MODEL_PROVIDER_MODELS` is parsed by one
`indexOf("=")` and is a value the deployment cannot read back to check.

**An undeclared effort now stops the process, not the reviews.** This is the
half that matters more than the fix. Nothing failed at boot: bootstrap
succeeded, `/readyz` reported `harness: ready`, both hostnames answered 200, and
the only evidence anywhere was the GitHub App's delivery log — which nobody
watches, and which GitHub does not retry from. A configuration error that
silently stops all work while every health signal stays green is worse than a
crash, so `loadConfig` now refuses.

It refuses **only when this process is the one registering the provider**. With
the provider configured in the operator console instead, Cujo cannot know what
it declares, and blocking a working deploy on a guess would be the same mistake
in the other direction.

**The values are checked against the SDK's own enum, not just against each
other.** A first cut compared the chosen effort only to the declared list, which
a typo in both variables satisfies by agreeing with itself; the bad value then
reached the server, which rejects the *provider*, and `bootstrapUntilReady`
retries that forever. The webhook would have answered 503 for good — the same
silent outage, moved one step earlier. `Object.values(ReasoningEffort)` is the
source of truth so the list cannot drift from the server validating against it.

**The contract test now asks for an effort.** It created a session with
`model: { name }` and no `params`, so the one job it exists for — catching a
spec the real server rejects — did not cover the field that broke production.
CI was green throughout. That gap, not the missing declaration, is why this
reached a deploy.

## 57. The operator plane is deleted; every route is signature-gated or anonymous

`cujo-admin.spencerjireh.com`, the operator API behind it, the shared token
that gated it, the Cloudflare Access verifier still accepted beside it, and the
`.cujo.yml` authorization override that had no other write path — all gone.
`apps/cujo` now has **no authenticated route at all**: the ingress host takes
requests whose HMAC or Ed25519 signature verifies, the internal compose name
serves the anonymous board, and everything else is 404. Cujo publishes three
hostnames, and the only gate a person passes anywhere in the system is the
Access application on `cujo-harness`, which is untouched (see 2).

**Both of the plane's premises had already been retired, one entry at a time.**
Decision 44 moved the decision to the pull request, where the principal is repo
write and the trail is a GitHub login. Decision 49 deleted `POST
/runs/:id/approve` outright and replaced the Access email with a token that
names nobody, on the reasoning that the plane "now holds none" of the
attributable actions. What was left was reads the public plane already served
in redacted form, plus a `/discord/*` API with no UI in front of it. A gate
over that is not protecting a decision; it is a second surface to keep correct.

**This executes decision 49's own rejected alternative, and has to say so.**
That entry rejected "making the whole plane public" because it "publishes
`session_id`, `turn_ids` and `delivery_id` and hands the Discord bindings to
anyone". Both halves are answered rather than ignored. The bindings move to
`/cujo watch`, which gates on Manage Server in the Discord server *and* on the
repo's own `.cujo.yml` — two independent facts about the two parties involved,
which is a stronger check than one shared secret. The handles are published
deliberately, below. Naming the alternative is what stops this log reading as
if 49 were simply forgotten.

**404, not 401, outside `/public`.** A 401 would leave a route that somebody
could still reach with the right header, and would mean the gate had been
inverted rather than removed. The absence is the point, and the router test
pins it: a request carrying a bearer token, one carrying an Access assertion,
and one carrying neither get byte-identical answers.

**The four handles are published.** `session_id`, `turn_ids`, `external_resume`
and `delivery_id` move into the public projection. They authorize nothing on
their own — `cujo-harness` keeps its Access application, which is what stands
between a reader and a session — and `delivery_id` is what lets a reader
correlate a board page with a log line. The known cost, recorded once: decision
33 records an origin that turned out to be reachable in a way it was not meant
to be, and these are the identifiers that would make such reachability
immediately useful. That is a real limit of the change, not a reason it was not
made.

**What does not change, because a reader will assume it went with the plane.**
`approver` and `decided_at` stay withheld: the board still names nobody, and
the confirming `/cujo confirm` comment is on the pull request for anyone to
read, so nothing is hidden that a reader cannot find. The `is_public` filter
and the fifteen-minute visibility recheck stay, which makes them the *sole*
thing keeping a private repo off the board — worth stating plainly, since there
is no longer a second plane behind which a private run could be read. The
allowlist in `http/public/serialize.ts` stays, and adding a field to
`Projection` still fails its test until it is classified. `publicRunId`'s rule
(see 36) is unchanged, and `runUrl` has now converged on it.

**Deleting the override left a repo unable to move, so `watch` gained the move
itself.** The override was how a repo changed servers. Without it, `unwatch`
lets only the *holder* release a binding, so a server that had gone quiet could
have kept a repo forever and the refusal would have pointed at a `.cujo.yml`
edit that changed nothing — a message that lies. So `watch` now re-reads the
holder's authorization `fresh` and replaces a binding whose holder the
declaration no longer names. A holder that is still named keeps it, which is
the race the fresh read exists for; a read that fails is refused rather than
guessed, because taking a binding from another server on a guess is the one
mistake here that does not correct itself. `unwatch` is unchanged and still
refuses, since it is reachable without authorization and must not become the
way one server silences another.

**A private run has no page at all, so its Discord card carries no link.**
`runUrl` used to fall back to the gated hostname for a private run; there is
nothing to fall back to. The embed omits the `url` key rather than setting it
to null, which Discord refuses, so the title still renders and is simply not a
hyperlink.

**`CUJO_UI_HOST` is deleted rather than repointed**, which answers decision
27's note that setting it to the service name "makes that variable mean the
internal name and its documentation misleading". The objection is moot once the
variable does not exist: there is one host variable for this plane and it is
honestly named `CUJO_INTERNAL_HOST`. It was already matched by zero production
requests, because `apps/web` reaches this process at `http://cujo:8080` and
Node's `fetch` overwrites `Host` with the target's own authority.

**Decision 7 is generalized, not reversed.** It put the webhook on a non-Access
hostname as an exception to a system that was otherwise gated. That is now the
whole rule: no hostname this process serves has an Access policy.

**The override table is dropped by a migration, not merely removed from the
schema.** Every statement in `SCHEMA` is `IF NOT EXISTS`, so deleting the
`CREATE` would leave the deployed volume holding `discord_guild_repos` forever,
and the next person to find rows in it would conclude the override still works.
Migration index 3 is `DROP TABLE IF EXISTS`, and `IF EXISTS` because a fresh
database never created it and index 3 has to be a no-op there rather than an
error that rolls back the version bump.

**Sequencing.** Merging is the deploy (see 35), and this one is easy in a way
49's was not: the new code simply stops reading `CUJO_UI_HOST`,
`CUJO_UI_BASE_URL`, `CUJO_OPERATOR_TOKEN`, `CF_ACCESS_*`, `CUJO_PUBLIC_HOST`,
`CUJO_ADMIN_BASE_URL` and `CUJO_DEV_NO_ACCESS`. Leftover values are inert, so
no variable has to be removed before the merge. One value does have to be right
beforehand: `CUJO_PUBLIC_BASE_URL`, which used to fall back to
`CUJO_UI_BASE_URL` when empty and now means "no card carries a link". The
`cujo-admin` DNS record and its entry in the ACME bypass application (see 33)
are removed after the deploy is confirmed, in that order, so a name that is
about to stop resolving is not left with Traefik attempting HTTP-01 renewal for
it.

Rejected: **keeping the plane behind the token and deleting only the
hostname**, which is a gate with nothing behind it and one more surface to keep
correct. **Moving `/public` to the router root** now that it is the only plane
— the prefix is a live URL contract on both sides of the proxy, it is still the
discriminator the request log files a line under, and the mount was moved to
its own router precisely so handler ordering could not decide a boundary;
undoing that to save a word is churn against the reason it exists. **Keeping
the override table for one release**, which is exactly the orphan the migration
exists to prevent. **Linking a private run's card to the pull request instead
of nothing**, which is defensible — `https://github.com/$repo/pull/$number` is
derivable from two structural values — and was left out because a card that
names a private repo's run should not also advertise a route into it; the
channel's members already know where the pull request is.

## 58. A sensor may not read the tripwire it is watching

`secret_probe.decoy_read` came back `true` on every sensed command of every
check — on the unmodified base commit too, which cannot have read anything. It
is a hard rule and a malice claim (see 21), so Cujo accused every pull request
of a supply-chain attack, and drove every run into the gated path where a human
has to answer for it. Not intermittent: 100% of runs, from the moment it
shipped.

The cause was two sensors meeting. Decision 54 added a SHA-256 digest to the
filesystem snapshot for the paths where a silent edit is the whole attack — the
credential locations — because `(mtime_ns, size)` alone is defeated by a
restored timestamp. `~/.aws/credentials` is a credential location. It is also
the decoy. So the snapshot opened and read it, twice per command, at both ends
of the sensed window; the inotify watch armed on that inode logged both opens;
and the report counted them as the command's, because the window's offsets are
taken before the first snapshot.

`should_hash` now excludes the decoy, and it is the exclusion rather than the
digest that has to be argued for. Nothing is lost: the entry still carries
metadata, the `decoy` health check follows the inode, and a command that
overwrites the decoy has to open it — the same event by another route. What
would be lost by keeping the digest is the sensor's only claim on the value of
its own evidence, since a signal that fires on every input is not a signal.

**The exclusion is the watched file, not every name that reaches it.** A
symlink is digested by `os.readlink`, which never opens what it points at, so a
link that merely resolves to the decoy trips nothing and is hashed like any
other — which is why `should_hash` takes the caller's `lstat` verdict rather
than deciding from the path alone. Skipping links too would have handed back the
retargeted link: aim it at another target of the same length, restore the
timestamp, and `lstat` sees nothing, since a link's `st_size` is the length of
its target string. That is the case decision 54's digest was added to close, and
it would have been given up for no gain at all.

**The tests said it was fine.** Every end-to-end test of the decoy asserted
`decoy_read is True`; the only `False` assertions were pure unit tests that
hand-wrote an empty `decoy_rows`, which is the one arrangement in which no
sensor can trip itself. One harness test even ran a no-op command through the
real daemons and never looked at the field. The negative case — a command that
touches nothing reports nothing — is now a harness test, and it is the shape of
every clean pull request.

Rejected: **narrowing the sensed window** so the offsets are taken after the
`before` snapshot and the rows are read before the `after` one. It fixes the
same bug and fixes it more generally — no sensor work of any kind would be
attributed to the command — but it needs a settle delay to cover the watcher's
flush and the atime backend's poll interval, which makes a timing constant
load-bearing where a predicate is exact. Worth revisiting if a second sensor
ever reads a watched path. **Dropping `.aws` from the sensitive list**, which
would stop the hashing and also stop `wrote_sensitive` firing on a real
credentials write. **Filtering the decoy's rows by which process caused them**,
which inotify does not report.

## 59. The checks start together, because nothing was ever waiting

**Superseded in part by 73.** Three of the four still start together. The
reasoning here is unchanged and is what 69 is built on; only the claim that one
moment is the earliest for all four is wrong, and it was wrong because the
install was not in this entry's frame.

A measured run: **17.8 seconds of sandbox commands inside about 800 seconds of
wall clock**, with 156 of those seconds spent before the first check started.
The sandbox is not the cost; the model's own turns are. And the largest
recoverable slice of them was that the four checks were taken one at a time —
`tests` alone, a long gap, then the rest — for about 257 seconds of the 800.

The cause was three sentences of rubric: "Run `tests` first. Run `probes` and
`smoke` after it." Nothing depended on that order. No check reads another's
report, and both facts that decide which checks run at all — whether a test
command could be inferred, and whether the manifest changed — are settled during
setup, before any sub-agent exists. The `tests` gate is a gate on the
*inference*, not on the report, and had been written as though it were the
report.

Decision 41 had already answered the safety question and answered it the other
way round: it put an exclusive lock on the sensors precisely because "nothing in
the rubric serialises the checks", and rejected "leaving it to the rubric" as a
sentence of prose defending a correctness property. So concurrent checks were
always meant to be safe. The rubric simply never stopped reading as if they
were not. The wrapped commands still run one at a time — 17.8 seconds of them —
and a window that does overlap says so as `window_exclusive`.

**This reaches only new pull requests.** One session per pull request (see 16),
and the spec — rubric included — is set when that session is created, so an
existing pull request keeps the wording it started with and a push to one proves
nothing about this change.

Rejected: **spawning three and keeping `detonation` last**, on the theory that
an install is the one check that should not compete — the lock already makes
that a queueing question rather than a correctness one, and detonation is the
slowest check, so starting it last is the worst possible order for it.
**Raising `SENSED_LOCK_TIMEOUT_S`** in anticipation of contention: 900 seconds
already exceeds any check by two orders of magnitude, and a timeout is not the
thing to tune before there is a queue to measure.

## 60. The prompt for a maintainer is written by the thing it instructs

The first run to complete design 1 end to end published an accusation that ended
by asking for a confirmation it had already received:

> This matches a supply-chain pattern. Cujo will not publish that conclusion
> until a maintainer confirms. Reply `/cujo confirm` or `/cujo dismiss`.

On the observation that sentence is true and load-bearing. On the accusation it
is false at the moment anybody reads it: `post_gated_review` is the only tool in
`requireApprovalForTools`, so the approval is what let that call run at all. It
went out on a public review, under the bot's name, naming a third party's
package as malicious.

The rubric had quoted the sentence for the agent to reproduce, and told it to
end "that first body" with it. Nothing said the second body must not carry it
too, and nothing tested for it — `grep "supply-chain pattern"` across this
repository hit exactly one file, the rubric itself. Given a fixed string to
reproduce, the model reproduced it twice.

Decision 36 had already made this argument and won it, one function away.
`body.ts` composes the `Full evidence:` footer precisely because "a model asked
to end its body with a particular line can forget it, reword it, or put it above
the Egress section". So the prompt joins it: `github-mcp` holds the wording, and
the agent is told not to write it.

**The flag exists on two tools and not the third, and that is the whole
guarantee.** `post_advisory_review` and `post_blocking_review` take
`accusation_follows`; `post_gated_review` is registered with the bare shape, so
the prompt cannot be requested on the one call where it would be false. Zod
strips a key it does not declare, so a model that sends it anyway is ignored.
Nothing has to check the tool name at the point of use, which matters because
`postReview` serves all three and decision 5 leaves this server unable to tell
an accusation from a broken test on its own.

It has to be a flag rather than an inference for that same reason: `github-mcp`
is write-only, has no access to the check reports, and cannot see that a gated
call follows. A model that forgets the flag leaves the prompt off an
observation — the same "correct or absent" failure the run footer already
accepts, and a much smaller one than the duplicate.

Rejected: **a rule in the rubric** saying the gated body must not repeat the
prompt, which is prose defending a property, in the place decision 41 already
called the least reliable one for that. **Stripping the sentence from a gated
body that contains it anyway**, which would reach the pull requests whose
sessions are pinned to the old rubric, but only by string-matching model prose,
and a paraphrase defeats it.
## 61. The model is trusted; the pull request is not

Decision 21 re-derives the hard rules inside `apps/cujo` so the trusted zone
enforces them rather than taking the agent's word. That is worth having, and it
is worth being precise about what it buys, because the sentence "the trusted
side enforces the rules" is easy to read as more than it is.

**The rules are re-derived from text the model wrote.** A check report reaches
`findings.ts` as the JSON block a sub-agent put at the end of its final message.
Nothing signs it, nothing counts it, and nothing ties it to a command that
actually ran. A model that fabricates a clean report — or one an injected
instruction in the pull request persuades to fabricate one — defeats every hard
rule at once, and it defeats them silently, because a clean report and an absent
finding look identical from here.

So the trust boundary is the sandbox, and not the agent loop. The untrusted
party is the code in the pull request: it runs in a disposable box, behind a
proxy, watched by sensors it does not control, and only JSON comes back out. The
model reading that JSON is trusted, along with TrueForge and the provider behind
it. Accepted deliberately, written down here because it is load bearing and was
previously only implied.

What follows from it: the sensor design is a defence against hostile *code*, not
against a hostile or broken *model*, and a claim like "the hard rules cannot be
bypassed" is true of the agent's judgment and false of the agent's honesty. The
rules stop a model from *reasoning* its way past a finding, which is the failure
that actually happens.

Rejected: **signing reports inside the sandbox**, which needs a key in the
sandbox, and the one rule that has never bent is that no secret goes in. **A
per-run nonce echoed through the report**, which raises the cost of fabrication
from nothing to almost nothing — the nonce is in the sandbox too, and a model
copying reports is a model copying the nonce. **Having the parent re-read the
raw `sniff.py` output**, which is another model reading another string. The
honest fix is out of the sandbox entirely: `apps/cujo` reading the reports
directly, which means a credentialed channel from the trusted zone into the
untrusted one, and that is a larger hole than the one it closes.

## 62. The report validator may only add

Decision 54 made the check report additive-only and said what a report could not
observe. It did not say what happens when a report is not the shape a report is,
and the answer was nothing: `check.report` is `unknown`, and `findings.ts` reads
every field through helpers where a missing or renamed key means "not observed",
which the rules read as "no hit". A field the sandbox renames therefore fails
nothing. It quietly stops a tripwire from firing, and the run folds clean.

`report-schema.ts` closes that, and the whole design is in one rule: **the
validator may only add.** `invalidReportFindings` is a separate pass from
`hardRuleFindings`, which never learns whether it passed.

The alternative — treating a report that failed validation as no report — is the
obvious reading of "invalid" and it is wrong here. A sub-agent that gets one
roll-up field wrong would turn a `decoy_read: true` sitting in plain sight
inside `runs[]` into a `warn` about formatting: a strict loss against reading the
report leniently, which is what this codebase already does everywhere. Keeping
the two passes in separate functions is what makes that impossible to
reintroduce later; a branch inside the rules would not be.

So a report that fails produces one `warn`, `report_invalid`, beside
`check_missing` and `sensor_unarmed` in the family of findings that describe the
evidence rather than the code. The run's status does not move, and no review is
withheld.

What the schema requires is what the rubric asks for, and no more. A session
pins its rubric at creation (decision 16), so every pull request open when this
shipped keeps the older wording — and requiring a field that wording never named
would have put a warn on every in-flight review for nothing.

Rejected: **rejecting an unrecognised `schema_version`**, which Contract 2
already forbids and which would break the deploy ordering decision 54 exists to
protect — the sandbox is always newer than the container reading it. **Failing
the run**, which turns a formatting slip into a pull request with no review.
**A strict schema that refuses unknown fields**, which is decision 54 reversed.

## 63. `/cujo review` re-reviews the current head, on the same principal

A run that ended badly had no way back. The automatic retry covers a turn that
failed on its own; nothing covered a review somebody simply wants run again —
after fixing what it complained about, on a pull request opened before the App
was installed, or on one whose run the already-reviewed guard deleted. The only
lever was pushing a commit.

A third verb, and it takes repo write like the other two. Not because it decides
anything — it decides nothing — but because it provisions a Daytona sandbox and
a model turn, and that is a cost a stranger should not be able to impose on
somebody else's repository from a comment box. Decision 44's principal, for a
different reason than decision 44 had.

The author guard does not apply. `dismiss` is barred to the pull request's
author because a denied gate posts nothing, so dismissing is the direction that
buries an accusation against one's own change (decision 45). Asking to be looked
at again buries nothing, so the author may use this exactly as they may
`confirm`.

Two rules the other verbs live by are skipped, and both are deliberate. There is
no `no_run` refusal: the pull request Cujo has never seen is this verb's main
case. And there is no `stale_head` refusal: that rule exists to stop somebody
answering an old commit's finding, while this verb targets whatever the head is
now — being out of date is the reason to run it.

Claiming costs something the reply states out loud. `runs_head` is UNIQUE on
`(repo, pr_number, head_sha)`, so a second run for a head needs the first one
gone; `reclaimRunForHead` deletes it, and `deleteRun` takes its projection, its
board page and its Discord message rows with it. The old evidence page stops
resolving and a fresh card is posted.

**A run still in flight is superseded before its row is deleted, never
alongside it.** Deleting the row does not stop the turn: the harness keeps
running it, `refold` keeps folding it into a row that is no longer there, and it
can still post a review for the very head the new run is about to review.
`supersede` cancels the turn first, which is what the webhook path has always
done for an older head and what this path was missing on its first pass.

**It refuses whenever the stop is not confirmed**, which is a wider set than it
first looks. `supersede` swallows a failed `cancelTurn` on purpose — an
unreachable harness is not worth failing a supersession over — so a resolved
call is not evidence the turn stopped. It therefore reports the answer, and this
path reads it. Three cases say no: the harness refused the cancel, a human's
`/cujo confirm` is landing on the run (`claimDecision` has set `approver` while
the status is still `blocked_pending`, and cancelling would kill the turn that
decision started), or somebody else superseded it first and this call cannot see
whether their cancel landed. In all three the row is left alone and the reply
asks for the command again.

**The old run is deleted by id, never by head.** Two concurrent `/cujo review`
commands both snapshot the same run and both wait on its supersession; a delete
that re-queried the head would have the slower one delete the *replacement* the
faster one had just created, leaving that replacement's `startRun` working
against a row that no longer exists. Deleting the snapshot is idempotent, and
the `runs_head` unique index arbitrates the insert that follows: exactly one
command wins and the other says a run for this commit is already starting.

Rejected: **a mention** (`@cujo-guard review this again`), which decision 45
already settled — a mention is a sentence, and a sentence can never carry a
privileged verb. **Letting anyone who can comment ask**, which puts the cost of
a sandbox in the hands of whoever opened the pull request, the concern
decisions 44 and 47 both weighed. **Refusing whenever a run is in flight**, which
would leave a wedged run with no way to clear it, since clearing one is exactly
what somebody would reach for this to do — cancelling it first gets the same
safety without that cost, and only a decision already landing is worth refusing
for.

## 64. Nothing says when a compaction happened, so Cujo does not

**Reversed by 129.** Compaction is pi's context-window rule and the harness logs each one; the threshold knob is gone.

`contextManagement` was unset, so the review agent compacted at TrueForge's
default of 50,000 tokens. The parent collects four full check reports and then
writes its review body from them, so a compaction in that window produces a
review argued from a summary of the evidence rather than from the evidence. The
hard rules survive it — Cujo re-derives those from the reports on its own side —
but the prose and the agent's own findings do not. The threshold is raised, and
configurable.

The second half was meant to be a `compacted` flag on the projection, so a
summarised review would be visible rather than silent. It is not there, because
it cannot be honest.

**TrueForge emits no compaction event.** The SDK's event vocabulary is
`mcp.auth_required`, `mcp.initialize`, `model.message`, `model.message.delta`,
`sandbox.created`, `thread.created`, `thread.done`, `tool.approval_required`,
`tool.response`, `tool.response_required`, `turn.created` and `turn.done`.
Compaction exists only as configuration. The nearest available signal is
`usage.inputTokensBreakdown.messages` falling between two messages on one
thread, which is an inference — and one that fires for a large tool response
being offloaded to a file as well.

Publishing that inference as an observation is exactly the pattern decision 54
exists to forbid: a report that says what it did not measure. The per-check token
counts are published, and a reader can see the drop for themselves and draw
their own conclusion, which is the difference between showing evidence and
making a claim.

Rejected: **inferring it from the token drop and calling the field
`compacted`**, for the reason above. **Disabling compaction on the review
agent**, which trades a review argued from a summary for a run that fails
outright when the context fills — the wrong direction, since the hard rules
survive a compaction and nothing survives a failed turn. **Leaving the threshold
at the default and adding nothing**, which keeps a known hazard for no reason
now that the setting is one line.
## 65. A public list row carries what the checks measured, not only the verdict

`GET /public/runs` served eight scalars per run: the pull request, the SHA, a
status word and two timestamps. Everything that makes Cujo different from a
linter — that four sensors watched code execute, for this long, and one of them
is why the run is blocked — lived only on the detail route, one request per run.
The board could therefore say a run was `blocked` and could not say by what.

The list now also carries `digest`: `checks` keyed by check name with each one's
status and duration, `findings` as counts by severity, and `durationMs`.

**This discloses nothing new.** Every value is a reduction of `checks` or
`findings`, which `GET /public/runs/:id` already serves in full to the same
anonymous caller. Decision 34's allowlist is what makes that claim checkable
rather than asserted: `RunDigest` gets its own classification list
(`PUBLIC_DIGEST_FIELDS`) with the same `Record<keyof T, true>` compile guard as
`RunRecord` and `Projection`, so a future field on it that is *not* such a
reduction goes red before it can ship. It is a third list and not a third arm of
`SourceField` because `checks` and `findings` are already keys of `Projection`,
and the no-duplicate assertion could not otherwise be stated.

**It is stored, not computed per request.** A `Projection` holds every sensor
report in full — the thing Contract 2 truncates in-sandbox precisely because it
is large. Deriving the digest on read would parse one of those per row, up to a
hundred, on a list the board polls every five seconds. `deriveDigest` runs once
inside `putProjection`, in the same method as the write it describes, so the two
cannot drift; `run_digests` is a new table rather than a column, which reaches a
deployed database on open and needs no rung on the migration ladder
(decision 25).

**A run folded before that table existed is backfilled on read.** A terminal run
never refolds, so the digest would otherwise be null forever on exactly the runs
already on the board. `listPublicRuns` derives and stores the missing one from
the run's stored projection. Bounded by the list's own limit, paid once per run.

**Absence is a fact, never a zero.** A check name missing from `checks` never
appeared, which the hard rule `check_missing` exists because it differs from a
check that failed. `ms` and `durationMs` are null while a check runs rather than
measured against now, and `digest` is null for a run claimed but never folded —
not an empty digest, which a board would draw as four checks that reported
nothing. `durationMs` is the envelope across the checks and deliberately not
`updated_at − created_at`, which on a `blocked_pending` run measures how long a
person took to answer.

The field is nested under one key rather than spread across three, because
`checks` at the top level would be the same word for a different shape than the
detail route's `checks` — an array of what each check said, against a reduction
of how each one ended.

Rejected: **fanning out detail requests from the browser** to aggregate
client-side, which is up to a hundred requests for a page load and goes stale
silently, since detail queries have an infinite `staleTime` and no poll.
**Putting the reduction on the detail route too**, which would be a second copy
of a fact already there in full. **An aggregate endpoint** returning counts
across all runs, which answers one page's question and not the next one's, and
which the board does not need while the whole list fits in one response.

## 66. The sandbox must never crash silently; sensor logs count what they lost

**Status:** active — introduced with the exception guard, the proxy failure
logging, and the `sensor_logs` truncation flag.

**Context.** Three pieces of evidence can disappear without anyone noticing:

1. An unhandled exception in `cli.py:main()` prints a Python traceback to stderr,
   which TrueForge captures as the subagent's output. The trusted side receives
   no JSON, concludes the report is missing, and fires the `check_missing` hard
   rule — but the *reason* is invisible because nothing structured says what
   went wrong.
2. When the proxy cannot connect upstream it returns a `502 Bad Gateway` to the
   client but logs nothing, so a host that rejects connections appears in no
   sensor data at all.
3. When a daemon is killed mid-write it leaves a torn JSONL line. `read_jsonl`
   silently skips it, which is correct for the reader, but nothing tells the
   report consumer that evidence was lost.

**Decision.**

- `cli.py:main()` wraps every operator command in a `try/except Exception` and
  prints `{"ok": false, "error": "…", "traceback": "…"}` as valid JSON.
  `KeyboardInterrupt` is not caught.
- The proxy's `except OSError` branch now appends a row with
  `"error": "connect_failed"` and `"bytes": 0` so the failure appears in the
  report's `egress[]` list.
- `read_jsonl` returns a `JsonlResult` carrying `rows` and a `dropped` count.
  The runner sums the three sensor logs' dropped counts into
  `truncated.sensor_logs`, a boolean that is true whenever any line could not
  be parsed.

**Consequences.** A silent crash becomes a parseable failure. A blocked
connection becomes visible egress. A torn log line becomes a truncation flag
the hard rules can read. None of the three changes alters a report's shape in
a way that breaks an older consumer, because `truncated` uses `.passthrough()`
(decision 62).


## 67. The setup window is measured, because guessing at it picks the wrong fix

Three runs on `orders-api`, read off the public API after decision 59 landed:

| run | total | claim → first check | checks | tail | sensed |
|---|---|---|---|---|---|
| PR 17 | 526s | **85s** | 151s | 291s | 28s |
| PR 16 | 633s | **109s** | 122s | 402s | 17s |
| PR 15 | 1452s | **156s** | 653s | 643s | 18s |

PR 15 predates decision 59 and is the serialised-checks shape that decision
fixed; the other two are the current one. **A run does 17 to 28 seconds of
actual execution inside 500 to 630 seconds of wall clock.** Cujo is not slow
because it runs code. Decision 59 said this and removed the largest recoverable
slice. The window before the first check is what is left, and it is the same
156 seconds that entry named without being able to break down.

**Nothing measured it, and the two candidate causes have opposite fixes.**
`timings.ts` splits a check into `sandboxMs` and `modelMs`, but the parent runs
on thread `main`, which never emits `thread.created`, so it has no stamp in the
projection at all. If the 85 seconds is Daytona provisioning a box, the rubric
is irrelevant and the answer is upstream. If it is the parent taking a dozen
round trips to clone a repository and read a manifest, the rubric is the whole
answer. Acting without knowing which would have been a guess dressed as a fix.

**`sandbox.created` was already on the wire and unread.** Decision 64 wrote out
the SDK's entire event vocabulary in order to prove that compaction has no
event; `sandbox.created` is in that list, carries a required `createdAt`, and
appears in both `SessionEvent` and `TurnStreamingEvent`. The fold has been
dropping it into `default` since the fold existed. So provisioning is measured
now rather than inferred, and no new subscription was needed to do it.

Four stamps, not one duration: `turnCreatedAt`, `sandboxCreatedAt`,
`agentStartedAt`, `firstCheckAt`, plus `messages` — the parent's own message
count before the first check. Two of the useful spans end outside the object
(the claim is `createdAt` on the run), so storing spans would have picked the
subtractions for a reader. `messages` is the field a rubric change can actually
move: every mechanical step the parent runs as its own command is one more
round trip, and the count says how many there were without anybody counting
commands by eye.

**`sandboxCreatedAt` is null on a re-run, and that is the measurement.** The
event is session-scoped, and `hydrate` scopes a fold to its own run's turns
(`foreignTurnIds`), so a second run on one pull request sees none. Null there
says the sandbox already existed — which is why a re-run is faster. A zero
would have said the opposite. Absence is a fact, never a zero (decisions 54
and 65).

Nothing here reads a clock: every input is an event timestamp, so a rehydrated
run computes what the live one did, which is the rule `timings.ts` already
kept. `ms` is omitted rather than guessed whenever either end is missing, and
also when the subtraction runs backwards — the ordering guard is not a rounding
guard here, because unlike `modelMs` both of these stamps come off one clock and
there is no honest way for it to go negative. If it does, the events are not
what this code believes and no number is the right answer.

Published on the run's detail route only, not on the list row's digest. A
number a reader consults when asking why one run was slow is not a column on a
table of a hundred runs, and keeping it off the digest is what lets this ship
without touching `apps/web` at all.

Rejected: **inferring provisioning from the first parent message**, which was
the plan until `sandbox.created` turned up in decision 64's own list — it
conflates provisioning with the first generation, and there is no reason to
infer what is measured. **Closing the window on any `thread.created`**, which a
helper subagent spawned mid-setup would end early, reporting a setup that never
happened; it closes on the first thread the rubric *named* for a check.
**Storing the spans instead of the stamps**, which fixes the arithmetic at write
time and loses the two spans whose other end is on the run record.

## 68. Nothing in the chamber exists that is not a measurement

**Amended by 80**, which narrows this rule to geometry and admits one named
decorative layer, **and by 82**, which deletes the room — the floor ticks, the
wall ribs, the shell and the chain — and keeps the rule: one gate per layer
that holds a run is what the occupancy strip becomes. Not reversed: everything
below still holds of every object that carries a fact.

The board drew every run as a specimen and drew the room around it out of
nothing: the floor grid repeated at a fixed pitch, the chain ran the length of
the box whatever the record held, and the scan plane swept on an eleven-second
timer. Four of the scene's seven objects were scenery in a file whose own header
claims it is "a diagram rather than an ornament". This adds the rule that
settles it, stated beside the three already there, and every scene change is a
consequence of it.

The floor's cross-ticks are now one per **occupied** slot, so the floor is an
occupancy strip; the verticals on the side walls are one per slot the volume
has, so they are the axis the ticks sit on. The chain ends where the record
ends, so a three-run board has a short chain — except on an empty board, where
there is no record to bound it and it runs the volume, because an instrument
holding nothing is a different picture from an instrument that is absent. Every
specimen gains a tether to the floor and a dim shadow in its own tone at the
foot of it, which is the run's position on the time axis and, incidentally, the
strongest depth cue available to a scene with no lights in it.

**The sweep is the poll.** It leaves the back wall when `GET /public/runs`
returns and reaches the front as the next request is due — five seconds while
anything is live, thirty when the board is quiet. The interval is exported from
`queries.ts` and handed to the scene rather than restated in it, so the plane
cannot claim to be the instrument reading while running on a timer of its own.
A `run` that changed nothing still starts a sweep, because what is being drawn
is the read and not the change.

Rejected: **spacing the specimens by real elapsed time**, which is the more
literal reading of "depth is time" and makes a board with one quiet weekend in
it mostly empty room; the floor ticks carry occupancy instead. **A second hue
for the sandbox share of a check**, and for the running-check arm — the chamber
already spends blue on a verdict and amber on the one thing waiting on a
person, and a drawing where one hue says two things is the mistake those rules
exist to prevent. Both are drawn as strength instead.

### `digest.findings` reaches the drawing, and the detail metrics reach the page

Decision 65 put `findings` on every list row as counts by severity, and
`apps/web` read `checks` and `durationMs` and ignored it. It now decides two
things about a specimen — the marks strung on its drop line, worst nearest the
core, and the size of the core itself — and it fills a fifth panel on the rack
and a column on the record. Size and not only hue, because fog takes the colour
out of a distant specimen long before it takes the silhouette.

The marks cap at six and the core's size steps by worst severity rather than
scaling with the count. A run with three criticals is not three times as
dangerous as a run with one, and past six marks the drop line reads as "several"
rather than as a number — at which point drawing more claims a precision the
drawing has lost. The count survives in full on the callout and the row.

Commit `513d35f` published `usage`, `checks[].timings`, `model` and
`rubric_sha256`, and `apps/web/src/lib/api/types.ts` did not declare any of
them. All four are detail-route fields and all four land on the run page: the
cost as one proportion bar, the provenance beside the head SHA, and — the one
worth the most — `sandboxMs` against `wallMs` as a split in each lane of the
checks timeline. That division is the single claim this product makes that a
linter cannot, and nothing drew it. `contract.test.ts` classifies the four the
way it classifies every other field, so the hand-written mirror stays honest.

**Absent, never zeroed.** A run with no `usage` renders no cost section rather
than four empty bars; a check with no `timings` draws one undivided lane rather
than a lane that is all model; a run with no digest shows an em dash in the
findings column rather than "none". Decision 54's rule, applied to four more
fields.

### A click in the chamber does not leave the board

Clicking a specimen used to `router.push` to the run page, which threw away the
one thing the two drawings are on a page together for. It now scrolls the
record to that run's row, marks it with an accent rule, and **moves focus to
the row's link** — the canvas is `aria-hidden`, so a scroll on its own is a
change nobody on a keyboard or a screen reader is told about, and the row link
is still the way to the run. A filter that would hide the picked run is cleared
rather than obeyed: the click said which run, and "no runs match this filter"
answers the wrong end of it. Escape puts the record back.

Hover keeps its callout and the callout is now anchored to the specimen it
names, projected from the scene each frame and written straight to the element —
never through React state, which at sixty frames a second is the cost
`focusStore` exists to avoid. `focusStore` gains a second field for exactly one
reason: a hover is transient and a pick is a decision, and collapsing them made
leaving the canvas erase the selection at the moment the reader was looking at
the row it had scrolled to.

### An empty board is a page, not a hole

`ReadoutRack` returned `null` at zero runs, the record was one grey sentence,
and the space between the chamber and the footer was the middle of the page
missing. The rack now renders all five panels disarmed — each axis drawn at the
floor with one line saying what will fill it — the record's empty state is a
block with height that says what to do next, and the hero swaps its statistics
for the three steps that put a run on the board. Numbered markers appear there
and nowhere else on the page, because that is the only content on it that is
genuinely a sequence.

Short records are given room rather than left to sit against what follows: the
table continues its rule lines past the last row up to five, the activity strip
pads its axis to twelve slots, and the chamber's camera comes in below five
specimens so the volume frames what is in it. All three are spacing and none of
them invents a row, a bucket or a run.

The one-line footer becomes four columns, and a new closing section is the key
to the chamber — one specimen drawn large with its parts named, and the verdict
and severity vocabularies listed from `RUN_STATUSES`, `SEVERITIES` and the tone
maps rather than from prose, so a status added in `apps/cujo` appears there
without anyone remembering to add it.

The footer's fourth column is the source: Cujo, TrueForge and Daytona, each
linked to its repository. All three are named in the prose beside it already,
and a product whose whole claim is that it executes what it reviews should let a
reader check the reviewer, the harness it runs on, and the sandbox the pull
request is executed in. `README.md` already carried the TrueForge link;
`https://github.com/spencerjireh/cujo` is this repository's own `origin`, and
`https://github.com/daytonaio/daytona` is the sandbox named in `config.ts` —
none of the three is guessed.

### The theme control appears twice, so the choice leaves the component

The footer carries a second `ThemeToggle` beside the scope line. Two controls
for one document property, and `ThemeToggle` held the selected choice in its own
`useState`: the second instance rendered whatever the first had left, so
switching to dark in the footer scrolled up to a header still claiming "system".

The choice, the persistence warning, and whether the stored value has been read
back move to `lib/theme-store.ts` — the same `@tanstack/react-store` pattern
`lib/board/store.ts` already uses. `lib/theme.ts` stays what it was: the
vocabulary plus the two functions that write `data-theme` and `localStorage`,
pure enough for its own unit test. Only the *animation* suppression stays per
instance, because a toggle mounted later still starts from the position the
server rendered and must not slide from it.


## 69. Losing the stream is not a verdict; only the watchdog ends a turn

**Refined by 124.** The watchdog rule stands. The four facts below about a wedged session were facts about TrueForge: under `apps/harness` a cancel ends the children with the parent, and a new turn supersedes cleanly.

A run on `orders-api#18` lost its SSE stream. `Runner.consume` spent its three
resubscribes over twenty-two seconds, injected a synthetic `turn.done`, and the
run ended `error: "turn stream lost"`. The turn was not dead. Its sub-agents
were still running, and the next run on the pull request could not start:

```
422 Cannot process user messages while sub agents are running
```

The first fix proposed for that 422 was to find the live turn and cancel it.
A contract test against a real TrueForge (`trueforge.contract.test.ts`) says
neither half of that works. Four facts, none of them what we assumed:

- a *running turn* does not wedge a session at all — starting a second turn
  supersedes it, which the neighbouring test has always shown. Running
  **sub-agents** are what TrueForge refuses to interrupt;
- the refused `startTurn` **cancels the turn on its way out**, so by the time
  any heal looks, the turn reads `cancelled` and the wedge is invisible;
- **`cancelTurn` does not release the session**. The sub-agents outlive it, and
  the retry after a cancel is refused exactly as the first attempt was;
- only an empty-input turn is accepted, which is what the 422 text advises.

So the 422 is not a defect to route around. TrueForge is refusing to interrupt
work in progress, correctly. The defect is upstream: Cujo abandoned a turn that
was still working and published a verdict about it.

That verdict was wrong three ways over. It claims an observation Cujo never
made, which is the one thing decision 54 exists to forbid — the code said so
itself, in a comment admitting the error was "indistinguishable from a turn that
genuinely failed on its merits". It can be contradicted by reality, because the
abandoned turn still holds `github-mcp` and can post its review afterwards. And
it caused the 422: `error` hides a run from `listUnfinishedRuns`, so `startRun`
stopped superseding it, so its turn was never cancelled, so the next head landed
on a busy session. Failing fast created the bug it looked like it was avoiding.

The rule now is that a failure is reported only when it is observed. When the
resubscribes are spent, the run watches the turn through `listTurns` and folds
the verdict it really reached from the persisted events, the same way a restart
rebuilds one. A read that fails is not a verdict either; it is retried. The
thirty-minute watchdog is unchanged and is now the only place a run ends without
a terminal event — and because that *is* a decision rather than a guess, it
cancels the turn it ends, which is the cleanup no path had before.

Note this is what `docs/spec.md` already said: the `error` row has always read
"the stream was lost and the replayed turns show no terminal event **after the
turn timeout**". The code was failing at twenty-two seconds against a
thirty-minute budget. This brings the two back into line rather than changing
the contract.

Chosen over / Rejected: **detecting a running turn and cancelling it**, ruled
out by the second and third facts above — there is nothing left to detect and
the cancel does not work; **sending empty input to unstick the session**, the
only call TrueForge still accepts, but a remedy for a state Cujo should not
reach, and it asks a run to wait an unbounded time on work it already abandoned;
**a second liveness check in `startReview` before it claims a head**, which
duplicates `Runner.start`'s job by different means — `start` is the choke point
both the webhook and `/cujo review` pass through, and that kind of duplication
is what put two bugs in review on PR #72; **cancelling the turn where the stream
is given up on**, which looks like the root-cause fix but destroys evidence: a
turn whose subscriber died may still finish and post a real review, and
cancelling guarantees it cannot; and **keeping the synthetic terminal but
cancelling beside it**, which leaves the false verdict in place and only tidies
up after it.

This does not reverse decision 39's rejection of *matching the 422 text*.
Nothing here reads an error message; the turn's state is read from `listTurns`
and the verdict from the events.

Known limit: a run whose stream dies now sits `running` — the reaction on
"eyes", the board in progress — until the turn really ends, where before it
flipped to `error` inside a minute. That feedback was wrong whenever it fired,
but it was faster. If thirty minutes is too long to leave a pull request author
waiting, the lever is `CUJO_TURN_TIMEOUT_MS`, which is a real bound, and not a
fabricated verdict at twenty-two seconds. A second limit: dropping the synthetic
terminal from this path also drops the flag that made a stream-lost run
ineligible for `retryTurn`, so a turn that genuinely ended in error and posted
nothing now gets the one retry every other error already got. That is the flag
working as intended — it existed to stop Cujo retrying its own fabrication — but
it is a behaviour change, and the watchdog keeps the flag so a timeout still
never doubles its own budget.


## 70. Probe scripts are captured by the sensor, not self-reported by the agent

**Status:** active — introduced with `script_content` in `run_sensed`.

**Context.** The rubric asks the agent to include `{script, expectation,
outcome}` for every probe it runs, and the agent does include them in its
review text. But this is self-reported: the agent could hallucinate a script
or omit an inconvenient one, and the trusted side has no way to verify
because by the time the review is written the sandbox is gone.

**Decision.** `run_sensed` captures the script file *before* the subprocess
starts. When `argv[0]` resolves to a known interpreter name (`python3`,
`node`, `bash`, `sh`, and versioned Python names) and the first positional
argument is a readable file, the file is read, scrubbed through `scrub()`,
and capped at `MAX_SCRIPT_CHARS` (8 000 characters). The result is stored
as `script_content` (string or `null`) on the per-run dict alongside `argv`.
`truncated.script_content` is true when the cap cut the file short.

`null` means no script was identified — either the command was not an
interpreter invocation (e.g. `npm test`) or the argument was not a file
(e.g. `python3 -m pytest`). It does *not* mean the capture failed.

**Consequences.** Probe transparency no longer depends on agent honesty.
The trusted side and the review reader can diff the agent's claimed script
against what the sensor actually saw. The cap and scrub prevent a large
generated file from inflating the report or leaking decoy material. The
field is nullable and optional in the Zod schema, so older reports that
lack it pass validation unchanged (decision 62 passthrough).

## 71. The mechanical half of setup is one command, because none of it is a decision

**Extended by 134.** The same principle, applied to the diff review's reading:
what the model is handed is gathered by code on the trusted side.

Rubric steps 2 through 4 were `git clone`, `git checkout`, `git worktree add`,
and `cat .cujo.yml`, followed by however many reads it took to find a `test`
command in `pyproject.toml`, `package.json`, a `Makefile` or a CI workflow.
Every one of them was its own command and therefore its own model round trip,
and not one depends on what the model made of the one before. They were separate
because the rubric numbered them separately.

`sniff.py prepare` does all of it and returns `cujo_yml` — the base copy — with
`files`, the head's build files. The parent settles policy and infers the
commands from one result. Setup becomes: fetch the tarball, `prepare`, `setup`,
install.

**It parses no YAML, and that is the floor.** Decision 46 leaves nothing under
`sandbox/` able to import a third-party module, so `allow_hosts` would have to
come out of a hand-rolled reader. Hand-rolling YAML to save one round trip is a
bad trade in a file whose whole purpose is to be believed, so the raw text goes
back and the parent still composes its own `--allow-host` list. Two commands is
therefore the minimum without a YAML parser, and two is enough.

**In Python rather than as a longer `&&` chain**, which was the obvious cheaper
answer. Three things follow from the choice and none would from the chain.
`sandbox/tests/` covers it — fifty cases, hermetic, cloning a repository
built in `tmp_path` — where rubric prose is covered by nothing, which is the
argument decision 41 already made about serialising the checks. The output is
one JSON object with `steps[]`, so a failure names the git call that failed
instead of arriving as a shell transcript. And it is a place to put a refusal:

**And it refuses a clone URL whose host is not one Cujo reviews.** The URL is
supposed to arrive from `apps/cujo`, which reads it from the GitHub API — but it
reaches the sandbox in a turn message that also carries the pull request's own
title and body, and the model composes the argv. "It comes from the API"
describes where the value starts, not where it must have come from, so a pull
request that talked the model into a different `--clone-url` would have this box
clone and report on somebody else's code, under this pull request's name.
`api.github.com` is already hardcoded in `clients/github.ts`, so naming the same
host here narrows nothing that works today; it is a list because a GitHub
Enterprise deployment would add to it, and that day the trusted side changes too.

The host alone was not enough, which took a second pass to see: every public
repository on GitHub shares it, so the check refused an attacker's *server* and
allowed an attacker's *repository*. The URL now has to name the repository the
run is for, compared against `--repo` from the same turn message, folded for
case because GitHub resolves owners and names that way.

**`prepare` refuses a clone URL carrying a credential.** `AGENTS.md` has always
said no token, key or clone credential may reach the sandbox, and nothing
enforced it — the rule held because private repositories are a non-goal, so no
credential existed. That is a fact about today's callers, not a property of the
box. The scheme check (`http`/`https` only) also refuses `ssh://`, the scp-like
`git@host:path`, and anything starting with `-` that git would read as an
option; a query string or fragment is refused outright, because that is where a
signed URL puts its token and deciding which parameters are secret is a guessing
game; the refusal never echoes the URL back, and the clone URL is redacted from
the recorded `steps[].argv` as a second line. The SHAs are checked against
`[0-9a-fA-F]{7,40}` before git runs, for the same reason.

**It never deletes a directory it did not create.** The first version
`rmtree`d whatever `--head` and `--base` pointed at. Those arrive on argv, argv
is composed by the model, and the model has just finished reading a pull
request — so "the caller would not pass `/`" is a statement about today's prompt
and not a property of this command. A path is replaced only when it is absent,
or when a marker this command wrote sits beside it; anything else is somebody's
data and is refused before git runs.

The marker is the second version. The first asked whether the directory held a
`.git`, which is true of every checkout on the machine — so it enforced "never
delete a directory that is not a git repository" while the heading above claimed
"never delete a directory it did not create". A weaker property wearing the
stronger one's name is worse than no property, because it is the heading people
read, and with `--head` model-composed the gap between the two was reachable.
The marker is a sibling and not a file inside, because `git clone` and
`git worktree add` both want a target that does not exist yet, and it is written
before anything is removed, so a run that dies halfway leaves a state the next
run still recognises as its own.

The alternative was requiring both paths under `/work`. It was rejected because
the tests point at `tmp_path` and would then have needed a container to run at
all — and a rule that can only be tested in production is the kind that stops
being true.

**It reads only real files inside the checkout.** A build file's name is the
pull request's to choose, and so is whether that name is a symlink:
`pyproject.toml -> /etc/shadow` would otherwise turn a manifest reader into an
arbitrary-file reader aimed at the box the sensors run in, and hand the result
back as JSON. Every candidate must be a non-symlink resolving under the clone
root, and the walk does not follow directory symlinks.

**The cap bounds the read and not just the output.** Reading a file whole and
trimming afterwards means a hundred-megabyte manifest costs a hundred megabytes
to discover it was too long, and the file is written by the pull request, which
makes that a lever rather than a curiosity. At most four bytes per permitted
character are read — UTF-8's worst case — plus one to tell a file that exactly
fits from one that does not.

**And the budget is spent on the escaped text, not the text.** This one was
wrong first. Escaping is an expansion — `\x1b` is four characters for one,
`\u202e` is six — so capping the input and calling `scrub` afterwards is a cap
on the wrong quantity: four thousand permitted characters of right-to-left
override leave as twenty-four thousand, and across forty files that is a
megabyte of prompt where the documented budget is a hundred and sixty kilobytes.
The file is chosen by the pull request, so the gap is a lever on exactly the
thing the budget exists to protect. `scrub_head` and `scrub_tail` therefore
escape and measure in one pass, spending the budget one whole character at a
time: escaping everything first and slicing the result would fix the size and
cut `\u202e` into `\u20`, which is text the file never contained. A kept
newline still costs one, so the ordinary manifest is not charged for the
hostile one's defence.

**`.cujo.yml` is never truncated, and never in `truncated`.** This was the
sharpest of the review findings, because the bug was assembled out of two
correct pieces. `truncated` names what came back capped so the model can re-read
it — from `/work/head`, which is right for a build file and is the whole point
of reading them. Putting the base policy file in that same list pointed that
sentence at the pull request's own copy, so a `.cujo.yml` long enough to cap
would have let a pull request supply its own `allow_hosts`. The trust boundary
was drawn correctly and then routed around by a list that meant something else.

So policy gets its own budget, four times larger and separate, and its own
`cujo_yml_error` field. Past the budget it is **unreadable**, not partial: half a
policy is worse than none, because the half that did not fit may be the
allowlist, and a reviewer that reads `test:` and misses the hosts proceeds
confidently with the wrong permissions. Absent and unreadable stay distinguishable,
which is decision 54's rule applied to two absences that are not the same fact.

**"I could not look" is never reported as "there is nothing there."** Both
started as silence, and both silences were load-bearing. `_read` answers None
for a path it refuses and for a path that will not open, and collapsing that
into a null `cujo_yml` told the rubric the repository has no policy — so a
`.cujo.yml` that was a symlink out of the tree would have started a run with no
`allow_hosts` and nothing said. The same shape sat in `_collect`, where a
refused manifest vanished from `files` without appearing in `truncated` or
`omitted`, and a repository whose only test command lived in that file reviewed
as a repository with no test suite. Both now say so: `cujo_yml_error` covers
unreadable as well as oversized, and `unreadable[]` names the build files that
matched and could not be read.

This is the same rule three times over — a cap that was not applied, a file that
was not read, a comparison that was not made are all facts to report, never
absences to imply (decision 54). The symlink guard was right and the reporting
of it was not, which is the more interesting half: a refusal that is silent is a
refusal an attacker can aim.

`is_symlink()` is asked before `exists()`, because `exists()` follows a link and
a dangling one would otherwise land back in "the repository has no policy" — the
exact case the check exists for.

**And reporting it was not enough: the rubric was told what to do about it.**
The first version of that fix said to go and read the file directly, which is
the one answer that cannot be given. A path is in `unreadable` *because* `_read`
would not touch it — nearly always a symlink out of the checkout — so telling
the parent to open it walks straight around the containment guard and hands the
pull request whatever it aimed the link at. Reporting a refusal and then
instructing the reader to undo it is worse than not reporting it, because it
launders the refusal into permission.

So the outcome is four values and not a nullable string: `read`, `absent`,
`too_large`, `unreadable`. `too_large` is an ordinary file inside the checkout
and the parent may open it. `unreadable` stops the run. A sentence explaining
why the field is null is not something a rubric can branch on, and this needed
branching.

And the rubric treats an unreadable policy as **blocking**, not as a note. The
first wording said to read it from `/work/base` "if you need it", which asks the
parent a question it cannot answer: the part it did not get is exactly the part
that would have changed its mind. `allow_hosts` appears in no build file, and a
policy `test` overrides whatever was inferred, so proceeding on inference is
proceeding with the wrong permissions and calling it a clean read.

Everything else read is written by the pull request, so it goes back through the
escape and the cap like any other untrusted string, and anything capped is named
in `truncated` rather than silently shortened (decision 54). The cap takes the
**head** of a file where the tail form takes the end: a command's failure is at
the bottom of its output, and a manifest declares its dependencies at the top.
Lock files are not read at all — hundreds of kilobytes that say nothing about how
to run anything, and they would crowd out the files that do.

The same cap-then-escape shape was live in `runner.py`'s `stdout_tail` and
`stderr_tail`, where it predated this change and bounded every check report.
Decision 69 fixes it, in its own PR because it changes what shipped reports
contain and deserves its own attribution.

**The head commit is fetched by pull ref, which is what makes a fork
reviewable.** `apps/cujo` sends `pr.base.repo.clone_url` and no credential, so
for a pull request opened from a fork the head commit lives in a repository the
sandbox never sees, and the old rubric's `git clone && git checkout <sha>` would
have failed at the checkout with no check run at all. Nobody noticed because
every demo pull request is a branch on the target repository. GitHub publishes
each pull request's head on the *base* repository as `refs/pull/<n>/head`,
publicly, so one extra fetch reaches it with no token and no second host at the
boundary. The PR number is already in the turn message and already listed as
permitted public metadata, so this adds no crossing.

Fetched **always**, and not as a fallback for when the checkout fails. The ref
exists for a same-repository pull request too, so one path serves both — and a
fallback would put the fork case on the branch least likely to be exercised,
which is the same reasoning that keeps the sensor lock uniform in decision 41.

**And it refuses when the ref has moved.** `refs/pull/<n>/head` tracks the pull
request, so between the webhook and the clone it can advance past `--head-sha`.
Reviewing the newer commit would attach every finding to a SHA the run does not
claim, on a page that names the old one. `prepare` stops and names both;
`supersede` is the mechanism that already handles a new push, and refusing is
what lets it.

**A walk, not a list of root-relative names, and the omissions are counted.**
The repository under review need not be one project at its own root: the demo
target holds six services under `services/<name>/` and has no root manifest at
all, so a root-only reader would return nothing and the parent would go back to
opening files one at a time — the round trip this exists to remove. Two
directories deep, skipping `node_modules` and its kin, shallowest first when the
file cap bites, and `omitted` counts what the cap dropped. That count is
load-bearing downstream: "no test suite found" skips every check and becomes the
entire review, so it has to mean the repository has none and never that one
capped result failed to name one. The rubric says so, and the manifest set
covers every language the reviewer might meet rather than the ones we thought of
first — the demo target alone is C++, Go, Node, PHP, Python and Rust.

**The deploy ordering is safe in the one direction it has to be.** The tarball
is `main`-relative and updates the moment this merges, while `apps/cujo` serves
the old rubric until the image swaps, so the window holds a new tarball beside
an old rubric — and the old rubric never calls `prepare`. The dangerous
direction, an old tarball meeting a new rubric, cannot occur (`CONTRIBUTING.md`,
"Merging deploys").

Rejected: **requiring `/work`** for the checkout paths, above. **Cloning the
fork's own repository**, which avoids the ref trick and adds a second untrusted
host to the crossings table for nothing. **Reviewing whatever the pull ref
points at**, which would keep the run moving and make its recorded `head_sha` a
lie. **One longer `&&` chain**, for the three reasons above. **Teaching
`prepare` to parse `.cujo.yml`**, which buys one round trip for a hand-written
YAML reader in the sandbox. **Reading the lock files too**, which is where the
resolved versions are — but detonation gets those from the manifest diff, which
is the check that needs them. **A shallow clone**, which would be faster and
would then not have the base commit to make a worktree from.

## 72. A length cap is spent on the escaped text, not on the text

`stdout_tail` and `stderr_tail` were built as `scrub(tail(out))`: take the last
`TAIL_CHARS` characters, then escape them. Escaping is an expansion — `\x1b` is
four characters for one, `\u202e` is six — so the cap was measured on the wrong
quantity. A check whose output was four thousand right-to-left overrides
returned twenty-four thousand characters against a four-thousand-character
budget, and every one of the four checks has two of these tails.

The output is written by the code under review. That is what makes this a lever
rather than an arithmetic curiosity: the budget exists so a pull request cannot
crowd the parent's turn with its own text, and the way to spend six times the
budget was to print characters that escape. Nothing had to be exploited — a
repository that legitimately prints a byte-order mark pays the same six-fold
rate by accident.

`scrub_head` and `scrub_tail` escape and measure in one pass, spending the
budget one whole character at a time. The obvious alternative — escape
everything, then slice the result — fixes the size and introduces a worse
problem: it cuts `\u202e` into `\u20`, which is text the command never printed,
in a report whose entire purpose is to say what the command did. A cap that
fabricates evidence is not a cap worth having.

**Every capped report string, including the ones that arrive later.**
`script_content` landed on `main` from decision 70 while this was in review, and
it came with the mirror-image of the same bug: escape first, slice the result,
which bounds the size and cuts `\u202e` into `\u20`. In a field that exists so a
reader can diff what the agent claimed against what the sensor saw, inventing
two characters of evidence is the worst possible way to save space. It moves
onto the same helper here. That is the argument for writing this down as a shape
rather than as a list of fixed call sites: the shape is what the next person
reaches for.

**Every capped report string, and not only the two tails.** `scrub_argv` had
the same shape — the audit hook records the arguments a process was started
with, and a subprocess spawned with a thousand bidirectional overrides in one
argument arrived as six thousand characters against a two-thousand budget. The
CLI's error and traceback fields had the mirror image, escaping first and
slicing the result, which bounds the size and cuts `\u202e` into `\u20` — text
nothing raised, in the field a reader trusts most because it is all that is
left. Both move onto the same two helpers. The alternative was to narrow the
claim in the spec to the fields that honour it, which documents the bug instead
of removing it and leaves the next person to find the same shape a third time.

The truncation flag now means *either* the raw output or its escaped form was
cut. Both are the same fact to a reader ("there was more"), and reporting only
the raw overflow would have called a report complete when a third of it was
dropped by the escape.

`keep` characters cost one, so the ordinary repository is not charged for the
hostile one's defence: a manifest full of newlines and tabs is unchanged.

Found by Qodo on the `prepare` PR, in code written the same week. The
pre-existing instances — `runner.py`'s tails, `scrub_argv`, the CLI envelope —
were found by looking for the shape rather than by review, which is the argument
for writing the finding down as a shape and not as one fix. `prepare`'s own is
in decision 68 with the command it belongs to; the three that alter what shipped
reports contain are here, together, so the claim and the code become true in one
step.

**Two of the tests for this were vacuous before they were right**, and both
failure modes are worth recording. The first capped the input rather than the
output, so it passed against the bug. The second raised an exception whose
message happened to be a whole multiple of six characters long, so the slice
landed exactly on an escape boundary and the old code passed too — one message
in six does. The test now asserts the property at every alignment, because a
single offset decides nothing when the expansion factor is six.

Rejected: **escape then slice**, above — it invents text. **Raising `TAIL_CHARS`
to cover the worst case**, which would make the common report six times larger to
bound a rare one. **Refusing to escape inside a tail**, which was never on the
table: the escape is the whole reason the text is safe to put in front of a
model (decision 26's argument, one boundary over).

## 73. `detonation` starts during setup, and the install takes the lock so it can

This corrects **decision 59**, which stands in every other respect and is the
argument this is built on. 59 established that no check waits on another and
moved all four to one spawn. Three of the four still start together. What 59 got
wrong is that one moment is the earliest moment for all four, and it got it
wrong because the repository's install was not in its frame: it reasoned about
the checks and the lock, and the install is neither.

`detonation` needs the two trees and the armed sensors. It does not need an
installed repository — it installs each added specifier into its **own** fresh
environment, which is the entire point of the check. So it can start before the
install rather than after it, and on the measured run that mattered: on
`orders-api` PR 17 detonation was the longest check at 151 seconds, of which
18 were its wrapped command. The other 133 were reading a manifest diff and
deciding specifiers, and that reading is free while an install runs.

**The size of the gain is unmeasured, and this ships anyway.** What overlaps is
detonation's thinking with the installs, so the gain is bounded by how long the
installs take — and no run has ever reported that number, because the parent's
installs were unwrapped and therefore unsensed. The 133 seconds above says how
much thinking there is to overlap, not how much of it fits.

The measurement now exists: wrapping the install makes it a sensed command with
its own `duration_s`, and decision 67's `setup` window gives the whole span it
sits inside. So the first run after this merges reports the number that decides
whether the change was worth making, which is the honest order — the alternative
was holding the PR to gather evidence its own merge is what produces.

It ships on the second argument rather than the first. Wrapping the install is
correct on its own: an unwrapped install runs beside the checks holding no lock,
and decision 41's whole claim is that a report is the slice written while one
command ran. That was true before this PR and the wrap fixes it either way. If
the install span comes back small, the reordering is worth reversing and the
wrap is not.

**59 explicitly rejected moving `detonation`, and that rejection is not this
one.** It rejected spawning three and keeping detonation **last**, on the ground
that the slowest check is the worst one to start last. This is the opposite
change and 59's reasoning supports it.

**The install has to take the sensor lock, or this is a false-positive
generator.** `runner.sensed_window` says why in its own docstring: the proxy and
decoy logs are shared by every check and a report is the slice written while one
command ran. The per-command audit log makes `files_read` and `subprocesses`
safe, but `proxy_log` and `decoy_log` are global and sliced by byte offset. The
parent's install was unwrapped, so it held no lock — put a live `pip install`
beside a spawned `detonation` and detonation's report claims the install's
egress and any decoy read it caused. Those feed `egress_to_unknown_host`
(scoped to `detonation`) and `decoy_read` (any check), both hard rules, both
`critical`. That is the exact failure decision 58 removed, rebuilt on the other
side.

So the rubric wraps the install in `sniff.py run --check setup`. The windows
then queue instead of overlapping, which is what decision 41's lock is for, and
detonation's own wrapped command waits for the install exactly as any second
sensed command waits — that wait was always expected and is not the part that
was overlapping.

**Wrapping the install is not the parent running a check.** `--check setup` is
not one of the four names; the fold builds a `CheckState` only from
`thread.created`, so a report printed on the parent thread is folded by nothing
and reaches no hard rule. The rubric's "you, the parent, never run a check
yourself" needed the distinction spelled out, because it now runs a sensed
command and that rule reads as though it forbade one. It forbids producing
evidence, and this produces none.

**The gain is bounded by the install, and decision 67 measures it.** If the
installs turn out to be short, this bought little for a rubric that is harder to
read — which is why it lands after the measurement rather than before it.

Rejected: **leaving the install unwrapped and accepting the overlap**, which is
a hard rule firing on a check that did nothing. **Wrapping the install and
reporting it as a fifth check**, which puts the whole dependency tree's install
in front of the hard rules — detonation already covers the added dependencies,
deliberately and one at a time, and a `critical` sourced from a check the rubric
never named is worse than no check. **Spawning all four during setup**, which
puts `tests`, `probes` and `smoke` to work against a tree that is not installed
yet.

## 74. The server owns the review body, not only its footer

Decision 36 moved the evidence footer out of the rubric and into `body.ts`, on
the argument that a rule telling a model to end its body a particular way is a
rule that fails silently. Everything above the footer was left to the model, and
the posted reviews show what that bought. On spencerjireh/orders-api #8 and #19
the verdict is nowhere near the top — #19 opens with four provenance bullets and
the reader reaches line 12 before learning anything decided; a sensor field name
is used as a claim, `secret_probe.decoy_read: true`; the coverage caveat is a
parenthesis reading "Other five services not run", when Cujo had executed one of
six services; an `info` finding and a credential read are set in the same
weight; there is not one inline comment, because every anchor was rejected and
dumped into a section called "Findings without a diff anchor"; and there is
nothing an agent reading the pull request could parse. Each of those is the
failure decision 36 named, one layer up.

**The review body is composed by `github-mcp` from structured input.** The model
supplies findings and judgment; `render.ts` owns the headline, the ordering, the
sections and the folds. `body` stays required and becomes one sentence — the
verdict in plain language — and everything around it is built from `findings[]`,
`coverage` and `egress`. What a review looks like is now testable prose with two
golden cases, rather than a rule somebody hopes a model followed.

**It reaches every session at once, which is why it is worth doing here rather
than in the rubric.** A session pins its rubric at creation (decision 16), so a
rubric edit only ever reaches new pull requests. `github-mcp` is stateless with a
fresh server per request, so the rendering change applies to the next review on
every open pull request, including ones created months before it shipped.

**The verdict word comes from the tool, never from the model.** `Advisory`,
`Blocked` and `Accusation, pending confirmation` are functions of which tool was
called; `accusation_follows` adds the held count and the held markers and
nothing else. A model cannot write "blocked" onto an advisory review, because
the word is not a thing it supplies.

**`comments[]` is deprecated and derived from the findings.** It was always a
second copy of an anchor the finding already carried (`path`, `line`, `side` —
Contract 3), and keeping two copies is what let #8 post a critical finding in
the body with no comment on any line. One rule, one place: a finding with a
usable anchor is an inline comment. The parameter is *deprecated* rather than
deleted, and that distinction was a review finding: deleting it from the schema
did not stop old sessions sending one, it made Zod strip it, so a legacy review
would have posted whatever its findings happened to anchor and dropped the
model's own comment text in silence. It stays, unasked-for and preferred when
present, until no session predating this entry can still be running. The
`### Findings without a diff anchor` section goes with it. That section existed so a rejected comment would
not vanish, and no comment can vanish when every finding is already printed in
the body — so a rejected anchor is now marked on the finding in place, and
`review.anchor.moved` still logs which of the three rejections it was
(decision 37). `bad_line` becomes unreachable through the derived path and the
branch stays anyway, because `validateAnchors` is a public function with its own
contract.

**A held finding says that it is held.** On a review passing
`accusation_follows`, the malice observations render as `warn · held` under one
line saying Cujo is not publishing a conclusion until a maintainer answers.
Before this, "changed code no test covers" and "this dependency read the decoy"
were the same word in the same weight, which is precisely the reading the
two-call design exists to prevent. Which findings are held is a boolean the
rubric sets, not something the server infers: `github-mcp` has no reports
(decision 5), and matching a title is the thing this entry is deleting.

**The renderer rewrites a title that is still a field name.** A title matching a
Contract 2 field pattern *in full* — `secret_probe.decoy_read`,
`derived.wrote_sensitive`, `base_pass_head_fail` — is replaced with the sentence
it means, and the raw expression moves into the evidence where it belongs. It
never fires on the hard-rule findings, which have carried plain titles since
they were written and keep their jargon in `evidence`; it fires on the model's
own findings, which is where #19's jargon came from. An unrecognised dotted key
is returned unchanged, because inventing a sentence for it would be the renderer
making a claim about somebody's pull request. Contract 3 already says a rule's
identity is matched on an id and never on the wording of a title; this is that
rule pointed the other way.

**A collapsed JSON block makes the review readable by an agent.** Fenced, one
line, `schema_version` first, carrying the verdict, the counts, the coverage,
the egress, the findings and the run URL. It is additive-only in the sense
decision 54 gives that phrase: a key may be added, never renamed or removed, and
absent input is `null` rather than a missing key. It sits in a fold because the
audience for it is not the maintainer. `runUrl` was extracted from
`appendRunFooter` so the URL in that block and the URL in the footer cannot come
to disagree.

**Legacy input still renders, and had to.** Every pull request open when this
deploys keeps sending a prose body and a `comments[]` array until its session is
replaced, and both shapes arrive on the same deploy. A prose body is detected —
conservatively, on a newline, since a lede has none — and folded under
`### Notes` with its headings demoted two levels so they cannot outrank the
composed ones; the headline and findings are composed from `findings[]` as
usual; coverage and egress are simply absent. The anchors survive the removal of
`comments[]` on both sides: the old rubric already required them on the findings
too, and `apps/cujo` reads the model's raw tool-call arguments off the
`model.message` event, before Zod strips a key it no longer declares, so an
in-flight review keeps the exact comments it was posted with.

`details` and `summary` join the sanitizer allowlist in `apps/web`, which had
neither, so the folds render on the board the way they render on GitHub. `open`
deliberately does not: without it every fold is collapsed in both places, and a
review cannot force a wall of JSON open on the run page.

Chosen over / Rejected: **tightening the rubric again**, which is the option
decision 36 already rejected for the footer and which this entry is the second
piece of evidence against — a model can produce a perfect body on Tuesday and a
different one on Wednesday, and nothing fails; **a template the model fills in**,
which is the same rule with more words and the same silence when it is ignored;
**keeping `comments[]` alongside `findings[]`**, which is two sources for one
anchor and is how #8 posted a critical finding with no comment on any line;
**inferring which warns are held from the finding text**, which would put prose
matching back into the trusted side one paragraph after Contract 3 forbids it;
**rendering the machine-readable block visibly**, which puts the least
human-readable thing in the review at eye level; **deriving the board's inline
comments in `http/public/serialize.ts`**, which would push a derivation into a
module with an import allowlist and break the sentinel fixtures that guard it;
**two independent derivations of the comment format**, which is what the first
cut of this entry shipped and what the section below is about; and **making `github-mcp` read the check reports** so it could classify a
finding itself, which widens a write-only server (decision 5) into one that
knows what it is posting about.

### The renderer is a package, because two processes must agree on one format

The first cut of this entry put the renderer inside `apps/github-mcp` and had
`apps/cujo` derive the inline comments a second time, on the reasoning that
re-deriving is the trade decision 21 already takes for the hard rules. That
reasoning was wrong and the review found three separate bugs in it: a dedupe key
missing `check`, so comments that posted separately collapsed on the board; a
title translated on one side only, so *exactly the field-name titles this entry
exists to repair* read differently in the two places; and a board rendering
`body`, which by then was a one-sentence lede, where GitHub had the whole
review.

The distinction decision 21 turns on is that a hard rule is a **judgment** the
trusted side must reach independently — that is the whole point of re-deriving
it. This is a **format** two processes have to agree on exactly. Two
implementations of one format is drift with extra steps.

So `@cujo/review-render` holds it: pure functions, no IO, no config, no
knowledge of either caller. `apps/github-mcp` composes the body it posts;
`apps/cujo` reproduces that body and those comments for the board. Sharing a
pure formatter is not the trusted side depending on the write-only server
(decision 5) — neither imports the other, and both depend on one definition of
what a review looks like.

Both callers hand the renderer values a model wrote, and only one of them has a
schema in front: `apps/github-mcp` parses with Zod, while `apps/cujo` reads the
raw `model.message` tool call so it can project a run the server never saw.
Nothing in the renderer may therefore throw on a shape — a `coverage: {}` from a
confused model would otherwise throw inside `fold`, which is pure and replayed
on every rehydration, and that run could never be projected again. A section
built from a value that is not the shape it claims is omitted rather than
guessed at, which is the same rule the check reports are read by.

Known limit: the board's reproduction differs from the posted copy in two ways,
both of them things this side cannot know. The machine block's `run_url` is
null, because the board *is* that page; and no finding is marked
`(not in this diff)`, because validating an anchor needs the pull request diff
and `apps/cujo` does not have it. The second one is why the board's panel is
labelled "Anchored findings" and says so, rather than claiming those comments
landed on GitHub. Second limit: the board's own findings list still shows the
model's raw title, so a jargon title translated in the review body is
untranslated in the list beside it. Third: the rubric rewrite reaches only
sessions created after it deploys, and no test asserts on the rubric's review
prose, so a regression there is still visible only in a posted review — the same
hazard decision 36 named, now one layer smaller.


## 75. The record is one field of a fixed length, and an empty one is armed

The record grew and shrank with what it held. Two runs left it sitting against
whatever followed, which decision 68's ghost rules already half-answered; sixty
pushed the key off the bottom of the page; and none pushed it as hard as an
empty board, which swapped the table out for a bordered block of a different
shape and height. Three different objects for one instrument, and the page moved
under a reader every time the record changed size.

It is now one field with a floor and a ceiling, both measured in its own rows.
The floor is five rows, held by ruled lines under a short record and by the
empty block's own height. The ceiling is twelve and a half, and the scrollport
is the table's own so the column header stays pinned to the top of it. The half
row is the affordance: a whole number would sit flush against the edge and read
as the end of the record, and a row cut through the middle says there is more
without a control that says so in words.

The header rule under a pinned header is an inset shadow and not a border.
`border-collapse` hands a collapsed border to the row, and the row is not the
element that sticks, so a border there scrolls away and leaves the header
floating on the rows.

**Whether the port is a tab stop is measured, not counted.** It takes
`role="region"`, a label and a stop only when it actually clips something, and
the row count does not know that. The ceiling is `min(…, 70vh)`, so a short
viewport clips at eight rows; and this is the same port the seven columns
overflow sideways in, which a phone does at any row count including zero.
Counting rows left both of those scrollable and unreachable from a keyboard —
the sideways one had been unreachable since the record was first drawn. So a
`ResizeObserver` watches the port and its children, and the effect re-measures
when the rows or the filter change what is in it.

**An empty record is the record, not a message where the record was.** The
column header stays, the ruled lines stay at the same rhythm, and the copy sits
on its own ground in the middle of them the way a label plate covers the part of
a chart it annotates. A reader learns the columns before there is anything in
them, and nothing on the page moves when the first run lands. The block is a
sibling of the table and not a cell spanning it, because a cell is as wide as
the table and the table is wider than a phone — the copy would have needed a
sideways scroll to be read.

The empty board carries one action, a link to the App's public page, and the
filtered empty carries the undo instead. They are different states and the
second is not an invitation: telling somebody to install the App because they
clicked "Live" answers a question they did not ask. Each filter names its own
absence — "Nothing is running", not "No run matches this filter", which makes a
reader look back up at the chips to work out which one they picked.

The install link targets `github.com/apps/cujo-guard` and not
`/installations/new`, which bounces an anonymous reader through a login before
they have decided anything. It is the one place the board hardcodes the App's
slug, and renaming the App breaks it.

Rejected: **a "show all" control below twelve rows**, which keeps one scroll
surface but answers a record that is merely long with a click, and then grows
the page exactly as before. **A centred card for the empty state**, which is
cleaner as a standalone screen and is a different shape from the thing it
replaces. **Drawing the ruled lines through the copy**, which is the rhythm at
the cost of the sentence.

## 76. Interpreter and index coverage is additive, not exhaustive

**Status:** active — expanded `INTERPRETER_NAMES`, `KNOWN_INDEX_HOSTS`, and
noise filters in `policy.py`.

**Context.** The sandbox sensors (fsdiff, decoy, proxy) are fully
language-agnostic at the OS level: a filesystem write or a network connection
is detected regardless of which runtime made it. Two narrower mechanisms are
language-aware: `INTERPRETER_NAMES` controls whether `capture_script` reads
the script file before execution (`script_content`), and `KNOWN_INDEX_HOSTS`
controls whether an egress connection to a package registry is classified as
`egress_to_unknown_host`. Both are frozensets checked by membership only.

**Decision.** These lists are expanded to cover every interpreter runtime
Daytona natively supports (Ruby, Perl, Deno, Bun, tsx, ts-node) and the
RubyGems registry. The noise filters gain entries for Go vendored deps
(`/vendor/`), Ruby gem cache (`/.gem/`), and `.gem` suffixes. No interpreter
for `go` or `java` is added because those compile rather than interpret — there
is no script file to capture.

Adding a name to any of these lists cannot change sensing behaviour. It can
only improve report quality: `script_content` is populated instead of `null`,
an egress connection is correctly classified, or a noise read is filtered
from `files_read`. Missing a name means the safe default applies
(`script_content: null`, `egress_to_unknown_host: true`, read left in the
list), not a failure.

**Consequences.** Script capture works for Ruby, Perl, Deno, Bun, and tsx
scripts. Ruby installs via Bundler no longer produce false
`egress_to_unknown_host` warnings for connections to `rubygems.org`. Go
vendored dependency reads and Ruby gem cache reads no longer clutter
`files_read`. No existing behaviour changes for Python or Node repos.

## 77. Detonation covers every ecosystem `MANIFESTS` recognises

**Status:** active — added Go and gem install paths to `detonate.py`.

**Context.** `apps/cujo` already recognises `go.mod`, `go.sum`, `Gemfile`,
and `Gemfile.lock` in its `MANIFESTS` list (`agent-spec.ts`), so a PR that
changes those files sets `manifest_changed: true` and the agent is told a
detonation check is warranted. But the sandbox only knew how to install npm
and PyPI packages: `detect_source` returned `"pypi"` for anything that was
not npm, and `cmd_detonate` had no `go install` or `gem install` path.

**Decision.** `detect_source` gains two new return values: `"go"` for module
paths containing a slash (but not `git+` URLs, which remain `"pypi"`), and
`"gem"` for the `gem:` prefix. `cmd_detonate` dispatches to
`_go_install_cmds` (one `go install` into an isolated `GOPATH`) and
`_gem_install_cmds` (one `gem install --install-dir`). The CLI's `--source`
choices are expanded to match.

**Consequences.** PRs that change `go.mod` or `Gemfile` can now be detonated
in the sandbox. The same OS-level sensors (fsdiff, decoy, proxy) observe
the install, so filesystem writes, egress, and credential reads are reported
the same way they are for npm and PyPI. No existing behaviour changes for
Python or Node repos.

## 78. The Python suite runs in parallel, and a superseded run is cancelled

CI took six minutes, and one step was five minutes forty-four of it: `uv run
pytest`. Every other job finished well inside two minutes — `contract` at 1.8,
`node` at 1.0, the three `docker` builds at half a minute each in parallel. The
Python job was not slow among peers; it was the entire critical path, and the
rest of the matrix had been waiting on it for as long as it has existed.

The step is not slow because the tests are heavy. It is slow because it is
serial. Almost every test in `sandbox/tests/` spawns `python3 -m cujo_sniff` and
blocks on it, several start and stop the sensor daemons, and one builds a
virtualenv and installs a package — so the suite spends its time on process
startup and IO, on a runner with four cores and one of them working. The same
261 tests take 34.1s serially on a developer machine and 10.9s to 14.6s under
`pytest-xdist` over five consecutive runs.

**Running four at a time found a race in the suite on the first try.**
`test_health.py`'s stand-in daemon handed its pid over the instant `Popen`
returned, but `daemon_alive` reads `/proc/<pid>/cmdline` and wants `cujo_sniff`
in it — and until the child reaches `execve` that file still holds the parent's
argv. A health check winning that window reads a live daemon as dead. It could
never fail on a developer machine here, because macOS has no procfs and
`daemon_alive` stops at the pid check, so the branch only runs in CI; and it was
rare enough on one core to have never been seen. The fixture now waits for the
child to announce itself, which cannot happen before the exec. Worth recording
as a cost of this decision honestly: parallelism did not create that bug, but it
is the reason the suite is a place where such bugs surface rather than lurk.

**Measured in CI, the step went from 344.3s to 177.6s on four workers, and the
whole run from six minutes to 193s.** That is 1.9x, not the 3x the local ratio
predicts, and the gap is the point: the runner's four vCPUs are two physical
cores with hyperthreading, so four workers that each spawn and wait on a child
process contend for two cores' worth of real execution. A developer machine with
four physical cores is not a model of this runner. The remaining ceiling is
cores, not test code — `python` is still the critical path at 189s against
`contract`'s 117s, and the next real gain would come from a larger runner or
from tests that stop shelling out, neither of which is worth doing yet.

**The isolation this depends on was already there, which is why the change is a
flag and not a refactor.** The `cli` fixture roots `HOME`, `CUJO_DIR` and
`CUJO_ENVS_DIR` in the test's own `tmp_path`, and `setup` takes `--proxy-port 0`
and gets an ephemeral port. There is no shared directory and no fixed port for
two workers to fight over. That was written for the sandbox's benefit rather
than for parallelism, and it happens to be exactly the property parallelism
needs. It is now load-bearing for a second reason: a test that reaches for a
fixed path or a fixed port will fail here intermittently, under a worker count
that varies by machine, which is the worst way to find out.

`-n auto` lives in `addopts` and not in the workflow, so that `uv run pytest` is
one command with one meaning in CI, in `AGENTS.md`, and on a developer machine.
A flag in the workflow would have made the documented command a slower thing
than the one CI actually runs, and the gap would only be visible to somebody
reading the YAML.

**A second run on the same branch answers a question nobody asked.** The
workflow had no `concurrency` group, so two runs on one branch both finished in
full when only the later one described the code now on it. Eight of the last
twenty runs were this, and the pairs starting two, three and four seconds apart
turned out not to be double pushes: each is a `pull_request` run beside a
`workflow_dispatch` run that a person started by hand on the same branch,
seconds later, for the same commit.

That is why the group does not key on `github.event.pull_request.number`. A
`workflow_dispatch` run has no pull request, so a key built from the number
falls back to a different expression and puts the manual run in its own group —
leaving the one pairing this is here to collapse running exactly as before,
while looking like it had been fixed. The branch name is the thing both events
actually share.

**A branch name is not an identity, though, which is the second half of the
key.** Two forks can both offer `patch-1`, and a group keyed on the branch alone
would put those two pull requests together; with `cancel-in-progress` one
stranger's push would cancel another's run and leave that pull request with no
completed CI — a worse failure than the duplication being fixed, because it is
silent and it lands on somebody who did nothing. So the group is
`github.event.pull_request.head.repo.full_name || github.repository` and then
the branch, which separates forks while still letting a `workflow_dispatch` run
share the group with the `pull_request` run for the same branch here. Every pull
request this repository has ever had is from a branch on the repository itself,
so this is a latent bug rather than an observed one; it is in the key because
the cost of carrying it is one expression and the cost of hitting it is a
contributor who cannot see why their CI never finished.

**Both of those keys looked right when they were written, so the requirement is
executable.** `repo_checks/test_ci_concurrency.py` reads the group out of the
workflow, evaluates the `${{ a || b }}` subset against the event shapes GitHub
would really supply, and asserts the two properties: a dispatch run lands in its
PR's group, and two forks offering one branch name do not. The number-based key
fails the first and the branch-only key fails the second, each on the test that
names it. The temptation was to assert the expression string instead, which
would have restated the workflow in a second place and passed on both — a
literal written beside a change is written from the same understanding that
produced it. `repo_checks/` is deliberately not called `tests`, which would
shadow the `tests` package `sandbox/tests/conftest.py` imports from.

**A fixture that answers "null" to a question it was never taught is the same
bug one level up.** The first draft of that evaluator resolved any unknown
context path to null, so a key could reach for a field the fixture had never
described — `github.run_id` in the middle of a fallback chain, say — and the
operand would be skipped here while GitHub selected it for real. The dispatch
and pull_request groups would then match in the test and differ in production,
which is worse than no test, because it reports success. So an unmodelled path
raises, and only a field GitHub genuinely supplies as null reads as null. The
per-run identifiers are modelled too, each unique per run: any of them in a
grouping key gives every run its own group and cancels nothing, and that now
fails an assertion instead of going unnoticed.

Rejected: **marking the slow tests and skipping them in CI**, which buys the
time back by not running the detonation test — the one that proves the product's
central claim, and the last one that should be optional. **Sharding the suite
across matrix jobs**, which parallelises across runners instead of across cores,
pays a fresh checkout and `uv sync` per shard, and splits one readable report
into several. **`-n auto` in the workflow only**, above. **Caching the Docker
layers and deduplicating the three builds of the same apps** — real duplication,
but every one of those builds is off the critical path, so it is work that
changes no wall clock until this decision lands, and possibly not after.

## 79. Entry selectivity: drafts, labels, and docs-only advisory

**Status:** active — guards added to `github-webhook.ts`, classification
added to `agent-spec.ts`.

**Context.** Every `pull_request` webhook with action `opened` or
`synchronize` claimed a run, provisioned a sandbox, and consumed model tokens.
Draft PRs, PRs a maintainer explicitly wants to skip, and documentation-only
PRs all received the same full-cost review as a code change.

**Decision.** Three filters, applied in the webhook handler before any session
or run is created:

1. **Draft skip.** `pull_request.draft === true` → 200, `ignored: "draft"`.
   No session, no run, no sandbox. Explicit `=== true`, same defensive
   pattern as `private === false` (decision 34).

2. **Label skip.** A PR carrying the `cujo:skip` label → 200,
   `ignored: "label"`. The label is an explicit opt-out by a maintainer with
   write access.

3. **Docs-only advisory.** When every changed file is documentation (`.md`,
   `.txt`, `.rst`, `.adoc`, `LICENSE`, `CHANGELOG`, etc.), the turn message
   carries `docs_only: true`. The agent uses this to select
   `post_advisory_review` over `post_blocking_review`. The sandbox still
   runs in full — the sensors prove the classification is correct, and the
   hard rules still fire on anything they observe.

Drafts and labels are full stops because they are explicit human choices.
Docs-only is an inference, so it degrades to a softer posture (advisory)
rather than to silence — a false positive in advisory mode means "reviewed
but didn't block" (harmless), while a false positive in skip mode means
"not reviewed at all" (invisible).

**Consequences.** Draft PRs and labelled PRs cost nothing. Documentation-only
PRs still get a full sandbox run but cannot block a merge. An empty changed
file list is not docs-only (a metadata-only PR should still be judged).
The `isDocsOnly` predicate is conservative: only well-known prose extensions
and basenames match, so a code file cannot accidentally qualify.

## 80. The chamber may have air in it, and the air is two files

**Amended by 82**, which makes the sweep a plane again — a layer is one depth,
so the objection below to a plane no longer applies — and promotes the dust to
a star field. Still two files.

**Amended by 81**, which narrows the rule once more — a specimen's depth is a
measurement and its position across the volume is not — and reverses two of the
choices below: phones no longer keep the flat elevation, because there is no
longer a flat elevation, and the sweep is no longer a plane. Not reversed:
everything here about the decorative layer, the bloom threshold, and where a
rule with a claim in it has to live.

Decision 68 made every object in the chamber a measurement, and that was the
right rule. What it left behind was an instrument that is correct and inert.
Materials are unlit on near-black by design, `LineBasicMaterial` ignores
`linewidth` on every desktop driver, and on a board with no live run the only
motion in the whole scene was a forty-four second drift of four hundredths of a
radian — which over the seconds anybody actually looks at a page is a still
frame. The product's central claim was a faint wireframe in a 40rem band under
a bordered header, with a type wash over three fifths of it.

The honest reading of 68 forbids the fix. Haze is not a measurement. Neither is
a graded backdrop, a mote of dust, film grain, or a glow behind a core. Each of
them could be moved, resized or recoloured without a fact changing, which is
exactly the test 68 wrote down.

**So the rule is narrowed rather than broken: no *geometry* exists that is not
a measurement.** Every shape, length, position and colour still comes from a
run or from the room's own axis. What is admitted is a layer that describes the
medium those shapes hang in rather than the shapes themselves — and it is
admitted as a boundary, not as a licence. The decorative layer is
`chamber/atmosphere.ts` and `chamber/post.ts`. Neither imports `Specimen`, and
neither may. A reader checking whether this rule is being kept looks at two
import lists, which is a cheaper check than the one 68 left them with.

The layer is a graded backdrop parented to the camera, five additive haze
planes that brighten where the sweep passes, about two hundred motes of drifting
dust, an additive glow sprite behind each core, and a film pass. Everything
brightens by `multiplyScalar` from an existing token; no `--chamber-*` value
changed, and the glow sprite is greyscale and tinted per specimen, so the light
in the room can never introduce a hue the palette does not already spend.

**The bloom threshold is where the rule actually bites.** `UnrealBloomPass`
thresholds in linear space, where `--chamber-fg` — the colour of a check that
passed — sits near 0.72 and `--chamber-amber` near 0.47. Set low enough to
bloom the amber sweep, it also blooms four bone arms and washes them toward
white: a decorative pass repainting a colour that means something. The
threshold sits above bone. What glows is the sprite drawn to glow, the amber
sweep, and `blocked_pending` — things that emit light, never a verdict.

### The sweep reads one specimen at a time

Decision 68 made the sweep the poll, which was right, and then lit every
specimen within `SWEEP_REACH` of the plane on a linear falloff. At a reach of
1.1 scene units against a slot spacing of 0.58 that is nearly two slots either
side: four specimens brightening together, which reads as a glow passing over
the record rather than as an instrument taking one reading at a time. The
envelope is now narrow enough that at most one specimen is more than half lit at
any point in a crossing — asserted in `tests/lib/board/sweep.test.ts` rather
than eyeballed — and asymmetric, because a specimen the plane has not reached is
anticipating and one it has passed has just been read.

### A run arrives; it does not appear

`setSpecimens` released every node and rebuilt all of them on each poll. That is
correct and says nothing: the board's most interesting moment, a review
starting, was drawn as a flicker — while the sweep two lines away exists to
announce exactly that. The record is now diffed by id (`lib/board/arrival.ts`),
a landing run eases into the front slot while the rest slide back, and a node is
rebuilt only when `specimenSignature` says its *drawing* changed. A poll that
returns an equal record, which is almost every poll, touches nothing.

### Everything with a rule in it left the scene files

`apps/web` runs vitest in node with no DOM, so nothing under
`components/board/chamber/` can be tested at all. The easing, the layout
constants, the sweep envelope, the record diff, the dust field and the camera
placement are now in `src/lib/board/`, where they are, and the scene modules are
wiring. This is why the sweep's sequencing claim and the reduced-motion
guarantee are assertions rather than intentions: reduced motion still renders
exactly one frame, now through the whole composed pipeline, and every new motion
has a defined resting value at time zero.

### The bar is gone and the chamber takes the window

The site header held a wordmark and a second theme control the footer already
carried, and charged the chamber the top of every page for it. It is deleted.
The mark is absolute in the corner and scrolls away, placed by each page rather
than by the layout — its fill is `currentColor`, so what it needs is a text
colour, and the board's chamber is pinned dark while a run page follows the
reader's theme. A server layout cannot know which it is rendering without being
told, and the page telling it is simpler than a hook. The run header gains an
"all runs" breadcrumb, because most readers arrive there from a link in a GitHub
review and the mark scrolls off.

The hero is `100svh`, the wash is a band under the readout instead of three
fifths of the frame, and the renderer gate comes down from `lg` to `md` — phones
keep the flat elevation, which is where a composed frame with a bloom pass in it
is the wrong trade. The record now starts below the fold: the board says what it
is first and lists what it has second.

### The run page draws its own specimen

A reader who followed a specimen from the chamber used to arrive at a page that
described the same run in words and gave them nothing to recognise. It now draws
one, beside the title, from the same builder — parameterised by a rig rather
than a flag named after its caller, so "no chain to hang from and no floor to
land on" is stated in the builder's own vocabulary. The flat SVG renders first
and the canvas replaces it once `three` loads, because that page is usually
reached cold from a GitHub comment. `chamber/inline.ts` imports neither the room
nor the composer, which keeps the addons off every run page — a property one
stray `import` from `scene.ts` would silently undo.

Rejected: **letting bone bloom**, which is more luminous on a healthy board and
makes a post pass a partial author of what "this check passed" looks like.
**Changing the `--chamber-*` values** to get vibrancy, which would have moved
the drawing away from the badge for the same run and invalidated the contrast
table in `brand/brand.md`; brightness at the call site does the same work and
leaves the tokens true. **Dropping the measurement rule entirely** and treating
the chamber as a hero image, which is the change this one exists to avoid.
**A third `BOXES` preset in `ChamberFallback`** for the run page's flat
specimen, which would have drawn a chain and a rail the WebGL version does not:
two drawings of one run have to be one drawing, so it got its own glyph with the
same rig.

## 81. Depth is time; across the volume means nothing, and says so

**Amended by 82**, which keeps the rule — depth is time, position across it
means nothing and the key says so — and replaces what it was applied to: the
field is three layers, the shape is a star with orbits, the chain is not drawn,
the camera stands outside because there is no mouth, and the sweep is a plane.
Not reversed: the arm split by strength rather than hue, `sandboxMs` on a list
row, the serializer guard, the deleted flat elevation, the reordered headline.

Decision 68 said no object in the chamber exists that is not a
measurement. Decision 80 narrowed that to geometry and admitted one named
decorative layer, `atmosphere.ts` and `post.ts`, on the grounds that a layer
describing the medium is not a claim about a run. Both still hold of everything
that carries a fact. This narrows the rule once more, at the one place left
where it was costing the drawing more than it was buying it.

The record was a line: every specimen at one x and one y, spaced down the depth
axis by `SPACING`. That is honest and it reads as a row of pins in a case — a
corridor with a rail down the middle of it, most of a full-height frame holding
nothing. **A specimen's depth is still time. Its height and its lateral position
are a deterministic function of its run id and mean nothing at all.** The seam is
one file and it is checkable the way 80's is: `scatter.ts` takes an id and a
depth, imports `chamber-layout` and `ease`, and knows nothing else about a run.

Deterministic matters as much as decorative. A field reshuffled on each poll
would be an animation of nothing, and a reader who found a specimen once could
never find it again; seeded off the id, a run sits where it sat.

Two constraints, both tested rather than eyeballed. Nothing leaves the volume at
any depth. And nothing crosses `minX(z)`, which rises toward the open face —
the readout is at the left of the frame and a near specimen is the largest thing
on screen, so the two of them have to be kept apart at the end where it matters.
The spread itself is a cone rather than a box, because the camera moved: at the
near end the frame is barely two units across, and a newest run at full spread is
not scattered, it is off the side of the screen.

The legend says this in words. A reader will otherwise assume a specimen sitting
high means something, which is the failure mode a decorative axis has and a
decorative haze does not.

### The chamber is seen from inside it

`MOUTH_Z` is the volume's near face and the camera stands 0.5 units behind it,
so the box's near edges are out of frame and its rails and ribs run off the top
and the sides toward the vanishing point. That is what fills the top of a
100svh hero. A box 2.3 units tall viewed from beyond it could not: framed so its
depth fits, its height only ever occupied a band across the middle, and the
answer was never going to be a taller box — a taller empty box is still empty.

The volume is 7.2 by 4.2 by 13 where it was 3.9 by 2.3 by 17, and the chamber
draws ten runs where it drew twenty-four. Fewer, larger, further apart: ten
objects a reader can tell apart beats twenty-four dots receding into one, and
both the readings above and the record below still carry how many runs there
have been.

### The chain threads the record, and the sweep travels it

The chain used to run overhead with a drop line per specimen. It threads them
now, in order, which keeps decision 68's rule about it — its length is the
record's length — by construction rather than by an end-point formula, and makes
it the only thing left saying a scattered field is a *series*.

**The sweep rides it.** A plane crossing the volume was right while one depth was
one run; over a field it lights every run at that depth together, which is
exactly the defect decision 80 narrowed the envelope to remove, arriving back by
a different route. A cursor on the chain visits them in the order the board holds
them however they are scattered, and "at most one specimen more than half lit" is
still asserted — now against the tightest gap on a real scattered path rather
than against an assumed slot spacing.

It is also a soft additive light rather than the *edges* of a box of depth
0.001. That is what a reader was actually seeing: an amber rectangle framing the
scene, not light passing through it.

### A specimen is a solid, and an arm carries two numbers

Four arms in the plane facing the camera is a drawing of a run rather than an
object: the camera drifts, the volume breathes, and nothing about the shape is
ever revealed because there is nothing behind it. The arms leave the core along
the four diagonals of a cube — the tetrahedral arrangement, every pair at
109.47°, the widest four directions can be from each other.

**And the flat drawing did not move.** Projected down the view axis those four
land on exactly the 45° diagonals the specimen has always been drawn with. So
the run page's glyph and the legend's diagram keep the silhouette a reader
already knows, and all three call `projectArms` rather than laying the angles out
again — which is what stops four independent copies of one shape drifting apart.
That they agreed at all was luck.

An arm's length is how long its check watched; its solid part is how much of that
was the sandbox executing the pull request, and the thinner tail is the sub-agent
deciding what to do next. Decision 68 rejected a second *hue* for that split by
name, and strength is what it asked for instead. An arm whose check measured no
share is drawn whole, never all-tail: null is not zero.

The findings leave the drop line for six fixed slots around the core. Fixed
rather than spread to fit, for two reasons and the second is why the first is not
enough: slots make the cap visible, so one finding fills a sixth of the ring and
six fill it; and even spacing cannot clear the arms — at five marks the spacing
is 72° against arms 90° apart, and the best available offset still puts a mark
4.5° from a check.

The core is sized as a ratio of the arms. It was radius 0.042 against an
`ARM_MAX` of 0.3 — the verdict drawn as the smallest thing in a picture that
exists to show the verdict — and stating it as a ratio is what keeps that from
happening again the next time the arms are resized.

### A list row says how much of each check was execution

`DigestCheck` was `{status, ms}`: one number for a check that measured two. The
detail route has carried the split since `CheckTimings` landed, so the run page
could say where a check's time went and the chamber, looking at the same run,
could not. `sandboxMs` is that number on a list row, read off the timings the
fold already computed rather than re-summed — `apps/web` ports `digest.ts` by
hand, and a second implementation of the same sum is the most direct way to break
the contract that both sides get the same answer.

Null and never zero, now for three reasons rather than two: the check is still
running, its report carried no `runs[]`, or the digest was stored before the
field existed. That last one is permanent. `backfillDigest` re-derives a
*missing* digest and not a stale one, so every already-folded run keeps a blob
without the key for good; the `?? null` in the serializer is what stands between
those rows and a response whose shape varies per run.

**It also found a hole in decision 34's guard.** `serializePublicSummary` copied
`digest.checks` through *by reference*, so a field added to `DigestCheck` reached
the wire past every allowlist on both sides — `PUBLIC_DIGEST_FIELDS` classifies
`RunDigest`'s three keys, one of which is `checks`, and it can see no further.
The file says twice that a field must be written down before it can be published;
that was true of the digest and not of a check inside it. Checks are shaped per
field now, walked over `CHECK_NAMES`, with `PUBLIC_DIGEST_CHECK_FIELDS` and a
`Record<keyof DigestCheck, true>` on both sides of the wire.

### Nothing flat is served any more

`ChamberFallback` is deleted. It drew the record as SVG for two audiences and
was wrong for both. A phone got the chain hung down a hundred-pixel margin —
the record is a long thin thing, and the same picture turned sideways is a column
of dots — under a full screen of near-black held open for it. A desktop browser
that refused a WebGL context got the horizontal form, a second drawing that had
to track every change to the first.

That cost was already real and this decision makes it unpayable: a flat elevation
of a scattered field with a chain through it, seen from inside the volume, is not
the same drawing however carefully it is redrawn, and two pictures that disagree
are worse than one picture and a list. Both cases get the record itself. The
hero collapses on a phone and on a browser that will not draw it, and holds its
screen while a canvas is still importing — `Chamber` reports three states rather
than a boolean, because "not yet" and "never" used to lay out identically and no
longer do.

This reverses 80's "phones keep the flat elevation" and its rejection of a third
`BOXES` preset, which is now moot: `SpecimenGlyph` survives as its own file, and
it was always a different job.

### The board says what it does before it says how

"Containment record", "executed in a sealed sandbox", "running the code, not
reading it" — three statements about the mechanism and none about the job. The
headline is still a count and not a slogan, which is what `brand/brand.md` asks
for; it counts pull requests reviewed, and the sandbox moved to the sentence
under it. The readout splits across the frame, claim at the top and readings at
the bottom, because one block anchored to the bottom left of a full-height hero
left the top of it holding nothing.

Rejected: **free scatter on all three axes**, which abandons the claim the whole
board rests on for a starfield. **Height as severity and lateral as repository**,
which is the version of this that keeps every axis a measurement and was the
first instinct — it makes the drawing a chart, and a chart of two facts already
on every row is a worse use of a volume than a record you can walk into.
**Keeping the chain overhead** with drop lines to a scattered field, which draws
twenty-four lines to nowhere in particular and says less than one line through
the runs themselves. **Turning each specimen to face the camera**, which always
presents its widest profile and costs an arm's direction its meaning. **Redrawing
the field flat** for phones, which at that width is a smudge. And **a minimum
presence floor** so a clean run reads as an object anyway — a calm board is
calm, which is the reading `brand/brand.md` asks for and the one a maintainer
wants to be able to take at a glance.

## 82. The record is a galaxy, and a run is a star with orbits

**Amended by 95**, which removes the gates and lets a star's depth wander
within its layer, and by 94, which gives a running run its own hue.

Decision 81 scattered the record across a box and made a specimen a solid.
Looking at it running, four things were wrong and they were one thing: ten runs
spaced down a thirteen-unit corridor, inside a wireframe box with rails, is a
hallway with objects in it. The depth was too great to read as layers and too
sparse to read as a field; the box made the field a room; the tetrahedron was
small and said little at any distance; and the amber sweep, a soft light nearly
three units across, was the largest object on screen. This replaces the shape,
the room and the field together, because they were composed together and could
not be fixed apart.

### A run is a star with four orbits

The core is the star and the verdict, in its colour, sized by the worst thing
the run found, with the additive glow behind it that the bloom pass already
lights. Each check is a ring round it on one of four fixed tilts: its radius is
how long the check watched, the bright arc of it is the share spent executing
in the sandbox and the faint remainder is the agent deciding, and its colour is
how the check ended. Findings are satellites on an orbit outside the rings, six
fixed slots so the cap stays visible. A check that never appeared has no ring,
as it had no arm.

**The four ring planes are the four tetrahedral directions the arms used to
leave the core along, now used as normals.** That is the one piece of the old
shape that survives, and it survives for the reason 81 chose it: every pair is
109.47° apart, the widest four planes can be, and each projects down the view
axis to an ellipse with the same minor/major ratio, squashed along one of the
four 45° diagonals. So `tests` is still upper-left and `detonation` lower-left
in the flat glyph, two runs are still comparable by silhouette, and `orbit.ts`
asserts it — every ring the same ellipse, each on its own diagonal — where
`caltrop.ts` asserted the equivalent for arms. Three flat drawings and one
solid read `projectRing`, as they read `projectArms`.

A pointer picks the system and not the core. The core is a tenth of a unit
across and a hover that had to find it would find nothing, so every node
carries an invisible sphere the raycaster is given instead; the raycaster does
not consult `visible`, and the sphere writes no colour and no depth.

The satellites go round, and a live run's rings precess. Neither carries
**Amended by 90**, which has every star's rings tumble slowly and a live one's
fast: the precession about y and the spin about a ring's normal were invisible.

The satellites go round, and a live run's rings precess. Neither carries
anything; both are decoration by the rule that admits the haze and the glow,
and what they show is the shape, which is entirely measurement. Under reduced
motion both are at rest.

### Three layers of time

The record is three layers by recency, 2.6 units apart, holding six, ten and
fourteen runs — thirty, up from ten. Depth is time and nothing else, as it has
been since 65; what changes is that a reader can count it. Equal groups rather
than age buckets, because a layer that can be empty is a gap the drawing has to
explain. It was five layers first, and five read as a wall: the apparent size
of one layer against the next was too close to tell apart, and every ring in
it was too large. Three layers a reader can name at a glance, with rings two
thirds the size, is a galaxy with a front, a middle and a back.

Within a layer a run's place is a function of its slot and its id: slots at
equal angles round a band, wider than tall, jittered by the id by less than
half the gap to the next slot. It still means nothing (81), and the key still
says so. Two things are tested rather than eyeballed: no two runs in a layer
come within one and a half rings of each other whatever their ids, and no band
crosses the clear line for its layer, which is higher toward the front because
a near star reaches furthest into the type.

### The room is gone, and the gates remain

No shell, no rails, no ribs, no floor ticks. A galaxy is not in a box, and the
box was what made the field read as a hallway. What remains of 68's occupancy
rule is one gate per layer — an ellipse at the band's own extent, drawn only
while the layer holds a run — so three gates say the record is three layers
deep and one says it is one. The dust becomes a star field: nine hundred motes at two
sizes in a volume far larger than the record, reaching past the back layer and
off every edge of the frame, because a galaxy does not end where the record
does. And the lattice comes back — the wireframe volume, its rails and its
ribs — as texture: it was the room and said something, one rib per slot; it
says nothing now, its pitch is a fixed number, and a field of stars in the dark
with nothing behind it reads as flat, where lines running to a vanishing point
are the cheapest depth there is. It is still `atmosphere.ts`, still decorative,
still two files, and that is exactly why the lattice lives there and not in
`room.ts`.

### The sweep is a plane again

80 narrowed the sweep from a plane to a cursor on the chain because the record
was a scattered field and a plane lit every run at one depth together. A layer
*is* one depth. A plane lights one layer at a time, oldest first, which is what
an instrument reading a record in three pages looks like, and "at most one layer
more than half lit" is asserted against the layer spacing. The gate is the
light — it goes amber and solid as the plane reaches it and settles as it
passes — and the additive quad that framed the scene is deleted.

### The chain is not drawn

`brand/brand.md` says Cujo is a guard dog on a chain, and the chain has been in
the chamber since 65. A line threading thirty points in three bands is a
scribble, and there is no honest place for it in a galaxy. The mark, the name
and the copy keep the motif; the chamber stops drawing it. This is the one
thing here that is a loss rather than a trade, and it is written down as one.

### The record rises over the chamber

The hero scrolled away like a banner. The galaxy is the ground the board stands
on, so from `md` up the section is sticky and the rack, the record and the key
rise over it as one opaque sheet. A pinned hero never leaves the viewport — it
is only ever covered — and intersection knows nothing about overlap, so a
one-pixel sentinel in flow between the hero and the sheet says when the sheet
has covered everything, and the page hands that to the chamber as a gate on
its loop beside the two it already had.

Rejected: **age buckets for the layers**, above. **Every run in the galaxy**,
which scales the frame's cost with the record and buys nothing the stats line
and the record below do not already say. **A text label per star**, which is
the callout, and the callout already follows the pointer. **Keeping the box
with the stars inside it**, which is the hallway. **Turning the rings to face
the camera**, which costs a ring's tilt its meaning.

## 83. A star's tilts are its own, the read walks the stars, and the copy is a caption

**Amended by 95**: the read beats the star once at its peak. The strobe this
decision removed stays removed.

Decision 82 was looked at running, with a live run on the board. Four things
were wrong, and this time they were four things.

### The tilts are the run's own

Four tori on four fixed tetrahedral tilts around a sphere is the Bohr atom,
and thirty of them is thirty of the same atom. The one property 82 kept the
tetrahedral set for — every ring the same ellipse, each on its own diagonal,
so a tilt *is* its check and two runs compare by silhouette — was not being
read by anyone: a reader learning which diagonal is `probes` from a galaxy
was never going to happen, and the colour and the radius already say what a
ring is. So a run's four ring planes are now seeded off its id (`ringNormals`
in `orbit.ts`): four azimuths a quarter turn apart from a jittered start,
each jittered again by less than half a quarter, a polar lean drawn between
two bounds so no ring is ever edge-on or flat, and alternate rings leaning
away from the reader so a system is not a stack of dishes. Every star is its
own system and no two share a silhouette. This **reverses** the "tilt is the
check" claim of 82; what survives is that a ring's colour, radius and arc are
measurements, which was always the part that carried anything.

Seeded and never stored, for the same reason a place in a band is (81): one
hash per ring on every build is cheaper than remembering thirty runs' tilts,
it holds across rebuilds, and the run page's glyph and the key's diagram
project the same normals the scene orients by, so the star beside a title is
the star on the board seen down the view axis. The FNV-1a hash the galaxy
already used moves to `hash.ts` and both draw from it.

### The read walks the stars

The plane of 82 lit a whole layer at once and crossed the record once per
poll — every five seconds while a run was live, which is exactly when a
reader is watching — and every star in the layer scaled up by half as it
passed. That is a strobe, and it got faster when the board got busier. Three
changes, in `wash.ts`:

- **It walks the record run by run** rather than lighting a depth. The
  cursor is an index; a run's index is its age and the layers are contiguous
  ranges of index, so oldest-first *is* back layer first, and one layer is
  finished before the next begins. "At most two runs more than half lit, and
  they are neighbours" and "every run of a layer peaks before any run of the
  next" are asserted, as the layer claim of 82 was. This is what 80's cursor
  on the chain did, without drawing the chain.
- **It takes at least fifteen seconds** whatever the poll interval, and a
  poll that lands while a wash is walking starts nothing. The wash still
  begins on a read (68), so it is still honest; it is no longer the poll's
  metronome.
- **It is a light.** One amber dot hops from star to star along the walk,
  on the straight line between them, and the star it is on swells its glow;
  nothing scales. It fades in at the oldest run and out at the newest, and
  between walks there is no light, because nothing is being read. The gates
  stay at rest: a gate going amber per layer was three rings flashing, which
  was the pulse this set out to remove. The haze follows the cursor's layer.
- **It takes a second and a half per star**, so a full board walks in
  forty-five seconds. With an object on screen the per-hop speed is what a
  reader sees, and fifteen seconds over thirty stars darted. "Scale with run
  count" was rejected for the plane; it is right for a light.

### A live run turns

A live run had five motions at low amplitude: a scale breathing at 2.4
rad/s, a running check's ring breathing at 3.1 rad/s, a thirty-second
precession, forty-second satellites and a pulse every 1.6 s. Together they
read as jitter, and a reader could not find the live star. By subtraction:
the two breaths are gone, and what is left turns. The tori of a live run
rotate in their own planes, alternate ways, so the bright arcs circulate
round the core; its satellites go round in ten seconds and a finished run's
in forty; the system precesses in eight; the pulse leaves it every four. A
finished run turns only its satellites. The one star on the board whose
rings are moving is the one still in the sandbox.

### The copy is a caption

The hero carried a paragraph beside a galaxy and the key carried four
paragraphs under the record. The hero also carried a full-width band of dark
across its bottom half to ground the stats, which covered the front layer of
the galaxy; the band is now a third of the frame and solid only for its last
tenth. A ground local to the stats block was tried and read as one dark
corner. The hero now has the eyebrow, the headline, the
stats and one sentence: colour is the verdict, rings are checks, dots are
findings. The key keeps its diagram, whose labels are now the caption's
words, with one line per part, the verdicts and the severities; the paragraph
on what a critical defect and a critical accusation each do belongs on the run
page and the pull request, which is where a reader meets one. The empty-state
onboarding list stays: it is the one sequence on the board.

Rejected: **coplanar rings**, which are a planetary system and are legible,
but two checks of near-equal duration draw one ring, and a ring hidden by
another is a check that did not happen. **A wash decoupled from polling**,
a fixed loop with no read behind it, which would make the light decoration
by 80's own test. **Removing the sweep**, which leaves a board that never
shows it is reading. **Dropping the arc split on the board** for one solid
ring per check: the share is the one thing on a ring the timeline does not
also say louder, and the board and the run page have to be the same drawing.
**Re-randomising tilts on every rebuild**, which re-tilts every star each
poll while a run is live. **Text labels on stars**, still the callout. **The diagram in the hero**, beside the stats: tried, and it competed with the galaxy it was a key to.

## 84. A lane says how bad, not what happened; the sentence is where the sentence fits

The run page had four places where a thing was said in the wrong size for the
box it was said in, and the same fix in each: put the short form where the eye
sweeps and the long form where a reader stops.

**A timeline lane ends with a verdict, not with a finding's title.** The title is
a sentence a model wrote — "3 tests pass on base and fail on head" — and the lane
ends in a twelve-rem column, so every lane worth reading ended in an ellipsis.
Truncation is the failure mode of putting prose in a slot: it cut most often
exactly where the run had most to say. A lane now carries how many findings the
check produced and how bad the worst one was (`2 critical`, `1 warn`, `ok`), or,
where the sandbox itself tripped, which alarm it was (`decoy read`,
`unknown egress`) — `lib/verdict.ts`, from fields already on the wire. The
alarm outranks the count deliberately: "the decoy was read" is a fact the number
of findings does not carry, and the number is one click away.

**And the lane is that click.** It is a button over the whole row, and it opens
the check's report card, scrolls it into view and moves focus to it — the
delivery `Record` already does when a specimen in the chamber picks a row, down
to `focus({ preventScroll: true })` and firing once per pick rather than on every
poll. The two sections are siblings, so the signal is state in `RunView` rather
than a store; a nonce rides with the name so picking the same lane twice delivers
twice.

**The decision bar is one line, and only while something is outstanding.** It was
a pinned band of three sentences on every run — including the four statuses where
nothing is being waited on, which spent a permanent strip of the window saying
so. What confirming and dismissing *do* is a fact about the held review, so it is
said under that review where there is room for it; what is pinned is the state
and the two words. A run that is over says why in the flow of the page.

**A collapsed disclosure shows the thing it is a disclosure of.** Provenance shut
was a blank box with `expand` at the right of it: a section whose whole purpose
is to name four handles, naming none. Shut, it is now the handles on one line.
The words `expand` and `collapse` are gone from the page — they were a fifth
column of type on rows that had four, and a word at the right edge reads as
though only that word is the control, which was never true. A glyph on the same
64-unit grid as the mark says the state, and the whole row is visibly the
trigger it always was.

**Every section says what it is.** One muted line under each heading, in the
recipe the page already used once. "Provenance" and "detonation" are Cujo's
words, not a reader's.

### The specimen is a view, not a glyph

128 pixels with nothing behind it, in the header of a page largely about it. It
is 224 now (160 under `md`), on the chamber's own ground inside a hairline
border, sized from a `ResizeObserver` rather than a constant. Two layout bugs
were hiding under the old size and neither survives at this one: the header row
wrapped in reverse, so a phone got the specimen *above* the title rather than
under it, and `items-start` under `flex-wrap-reverse` means the bottom, so the
title block hung off the specimen's floor.

The mark moved too, or rather stopped moving: `HomeMark` positions itself against
its nearest positioned ancestor, which on the board is the full-bleed chamber and
on a run page was the centred column — half a gutter in from where the board puts
it. One mark in two places is two marks.

Rejected: **deriving "3 failed" or "500 on GET /orders"** for a lane, which is
what the truncated sentences were saying and what a reader wants. Nothing on the
wire carries a test count or a status code; only the model's prose does, and
shortening that prose here would be this page inventing a measurement.
**A severity word alone**, dropping the count, which loses the difference between
one advisory note and eleven. **Anchors and `href="#"`** for lane-to-report,
which apps/web has none of and which would put a check name in the URL bar as
though it were a route. **Keeping the pinned bar on finished runs** as a
consistent page footer, which is a strip of window spent on "nothing to do".

## 85. An observed zero is a result; an unobserved one is not

**Amended by 93**: the flag no longer opens a table. Everything below about
`none` versus `not measured` and the alarms map stands.

The report card is what an operator reads before blocking a merge, and it was a
dump. Four tables with no column headers, so `185.220.101.4:443 | 3.1 KB |
unknown` asked the reader which figure was bytes and what `unknown` was unknown
about. Cells that rendered blank for three different reasons. And a group that
returned nothing at all when it had no rows, so the cleanest possible check —
the one where nothing happened — expanded into empty space, and the reader had
to know that meant clean.

**A table with a live sensor behind it says `none`; a table with no sensor
behind it says nothing.** That is the whole rule, and it comes from the block
`sandbox/cujo_sniff/report.py` writes for exactly this purpose: `sensors` exists
so that "not observed" and "not observable" stop looking alike. The web side had
been parsing it and rendering it as four grey dots. Now `groupState` reads it per
table — the proxy behind egress, the audit hook behind files read and
subprocesses, the filesystem diff behind the change list — and a table is either
`measured` (rows, or the word `none`), `blind` (`not measured`, and what the
sandbox said about the sensor), or `unknown`, which behaves exactly as the page
always has, because a report that never said cannot be made to claim either.

**Coverage is a sentence, once per block.** "All four sensors were watching." /
"Nothing tripped, but the proxy was not running, so nothing outbound was
measured." It replaces the dotted strip rather than joining it: the strip said
the same thing in a form that read as decoration, and the four `detail` strings
it carried are reference, so they moved under the raw-report disclosure. This is
a qualification of one block's own tables, not a second alarm, so decision 20's
rule — one blind interval must not be *counted* twice — is intact. Nothing here
is counted.

**An alarm's colour comes from whether a hard rule reads it.** The four flags
`apps/cujo/src/review/findings.ts` turns into findings are all `critical` there;
`wrote_outside_workspace` is read by no rule, because a build that writes to
`/tmp` is ordinary. It was rendered in the same red as the other four, which is
the page accusing the code of something Cujo's own rules do not.

The rest is discipline. Named columns, shared between the header and the rows so
they cannot drift. `—` where a cell was blank, and `in workspace` where the
absence of "outside workspace" was doing the work. `refused ×3` where a row the
proxy blocked was indistinguishable from a connection that moved no data — the
count was on the wire from `merge_egress` and this side dropped it. A command
that wraps rather than truncates, because the tail is the answer. Evidence set
to its own measure, narrower than the page column, since a full-width table put
seven hundred pixels between a host and its byte count. And one disclosure
pattern: the raw report is a Collapsible with a chevron, like the card above it
and the provenance section below it, not a native `<details>`.

**The tables collapse, and a flag decides which ones open.** A detonation report
is a roll-up plus one block per dependency, so a card that opened everything was
twelve tables deep and the reader scrolled past eleven of them to reach the one
the alarms were about. `flaggedTables` maps each derived flag to the table that
proves it — unknown egress to egress, a decoy or sensitive read to files read,
a write in the wrong place to filesystem changes, a spawned subprocess to the
process list — and a card opens on exactly those. Everything else is a heading
and a count until somebody asks, which is also what makes a clean block worth
reading: four lines and four numbers instead of four tables of rows nobody
wanted. `spawned_subprocess` is in that map and deliberately not in `alarms`: an
install spawns processes, so it accuses nothing, but when the sandbox sets it the
process list is the list to read. A table with no rows is not a control and
carries no glyph, and its heading's `0` is the whole statement — the `none` line
under it was the same fact twice.

Rejected: **plain-language headings** ("Where it called out" for egress), which
reads better cold and then disagrees with the finding, the review comment and the
sandbox contract, all of which say `egress`. One vocabulary end to end is worth
more than one easier heading. **Keeping the dotted strip beside the new
sentence**, which is the same fact twice in four centimetres. **Rendering `none`
for a report with no health block**, which would be this page claiming an
observation no sandbox made. **A left rule down the open card** to tie the
evidence to its row, which at hairline weight in a view that is already all
hairlines is one more line, not a device. **A hover ground on a table heading**,
which is the pattern the card row and the raw report use and is wrong at four
headings a block and three blocks a card — the chevron says it is a control
without putting a band of colour under every second line. **Collapsing the
blocks too**, a third level of disclosure inside the second, which buys a
scroll and costs a reader the ability to see what a card holds.

## 86. The alert gets its own card, and the opener takes the author line

**Allocation reversed by 100.** The first half of the title stands — the ping's
embed, the checks wording, the grouped criticals, the pull-request link and
the run-page metadata are untouched. 100 puts Cujo back on the author line and
moves the opener to the footer, bottom-left.

The message that exists to fetch a human was the least informative thing in
the channel. A blocked run posted a sentence and a bare run URL, which Discord
unfurled into a grey box rendering the site's front page — the same two lines
for every run that has ever been posted. The card above it had the same
disease from the other side: the person who opened the pull request had their
avatar at the bottom of the embed and their name in the middle of it, four
ticks under a `Critical (3)` heading read as "everything passed" when they
meant "the threads finished", and the three criticals were one decoy-secret
read reported once per phase. And nothing on the card reached GitHub.

**Decision 55's allocation is reversed, on its own premise.** 55 gave the
author line to Cujo because the alternative "spends the only avatar
affordance on an identity already visible in the message header" — and that
redundancy is exactly what the screenshot showed: `APP cujo` with its avatar
directly above an author line saying `Cujo` with the same mark. The variable
party is the one that needs the affordance; the fixed one is already named
twice. So the opener takes the author line — name stripped but never escaped
(the line renders no markdown, so a backslash is litter), avatar still built
from the numeric account id, profile link still only for a login the rule 7
allowlist accepts, so a bot opener keeps its icon and loses the link. The Cujo
mark moves into the freed footer icon, and the `Opened by` field is deleted
rather than kept beside the line: one embed does not name the same person
twice. `clamp` only pops fields, which now has a stated consequence rather
than a discovered one — the author line is the one identity the 6000-character
budget can never drop.

**The ping gets its own card, and rule 8 is amended rather than quietly
broken.** A slim embed in the run's amber, titled `repo #n — <pr title>`,
saying the critical count and that a human is blocked, with no fields: it sits
directly under the run card, and anything it repeated from the card above it
would be noise. The role mention stays in `content`, because a mention only
pings from there, and the run URL is wrapped in angle brackets so Discord
unfurls nothing beside the embed Cujo just built. The embed's title is
stranger-authored text on a ping payload for the first time, so it passes
through the same escaping, truncation and clamping as any card string — that
is the amendment: rule 8's "structural only" now bounds `content` and the two
URLs, not the whole message. A private run's ping renders with the title
unlinked, which is the same rule its card applies (decision 57). Once the run
leaves `blocked_pending` the same message is edited: the embed is recoloured
to the outcome and the content says resolved, so the message that raised the
channel's unread mark is the one that clears it.

**A check says what it measured, not a tick.** Decision 65 settled this for
the public list row; the card was the last surface showing a bare glyph, and
it showed it under a `Critical` heading. Each check now carries its terminal
state in words, the criticals attributed to it through `Finding.check`, and
how long it watched — `tests done, 1 critical, 41s` — and `0 critical` is
written out rather than implied by an absence, because an absent count next
to a `done` would read as a pass again. Critical findings group by title and
evidence for display, so one fact across three checks costs one line naming
all three; the fold still records each finding, because what the review
*recorded* is the evidence trail and what the card *shows* is a summary of
it. Whether the fold should emit one finding carrying three checks remains
open and is not decided here.

**The card links the pull request**, beside `Head` on the identity row that
the deleted field freed up (`Head`, `Pull request`, `Findings`). Structural,
not derived: the repo was validated when the channel was bound and the number
is a number — rule 8's own argument — and the repo is shape-checked
`owner/name` in code before the link is built, the field omitted when the
check fails, for the same reason rule 7's login check exists. On a private
run it is the card's only live link.

**A run link previews as the run.** `generateMetadata` on the run page, built
only from fields the public serializer already serves the same anonymous
caller: decision 65's argument, applied to the preview, disclosing nothing
new. A private run 404s and inherits the site default, which is the correct
answer for it, and `robots: noindex` is restated on the page because Open
Graph is about previews, not discoverability.

Rejected: **`flags: 4` to suppress the unfurl**, which suppresses every embed
on the message including the ping's own new one, for a wire change angle
brackets do not need. **Reusing `buildRunCard` for the ping**, which shows the
same embed twice for every blocked run. **Fixing the metadata and leaving the
ping as text**, which leaves a private run's alert a bare sentence dependent
on Discord's proxy reaching `apps/web`. **A thumbnail for the opener**, rejected
by 55 and still: a large image on every card, squeezing the fields on a narrow
client. **Keeping both the author line and the field**, which names one person
twice. **Deduping criticals in the fold**, which changes what the review
records rather than what the card shows.

## 87. Detonation runs even when no test suite can be inferred

**Refines 15.**

Decision 15 stopped the whole run when no test suite was found: "without a
suite the regression tripwire cannot fire, so execution evidence would be
thin". That argument holds for `tests`, `probes`, and `smoke`, all of which
need the suite as a baseline. It does not hold for `detonation`, which
existed in neither name nor concept when decision 15 was written.

Detonation is never comparative. It reads neither `/work/base`'s test output
nor the suite. Its gate, `manifest_changed`, is settled at setup
independently of the test inference. Three of the four malice rules
(`decoy_read`, `decoy_in_egress`, `wrote_sensitive`) fire on any check;
the fourth, `egress_to_unknown_host`, needs `detonation` specifically. A
repo with no discoverable tests is exactly the one where dependency
detonation earns the most, and under decision 15 it was the one that got
nothing.

**The change.** The rubric now spawns `detonation` in setup step 4 whenever
`manifest_changed` is true, regardless of whether a test command was inferred.
`tests`, `probes`, and `smoke` are still skipped — decision 15's argument for
those three stands. `missingCheckFindings` no longer emits `check_missing`
for the three suite-dependent checks when none of them had a sub-agent
thread, because those checks were inapplicable, not failed.

**Consequences.** A no-suite run that touches a manifest now gets a detonation
report and the hard rules that read it. The three `check_missing` warns that
previously read as failures disappear when the suite was never applicable.
`REQUIRED_CHECKS` itself is unchanged — when a suite is inferred, all three
are still required.

## 88. One results cell, and the whole row is the link

Issue 96 read the board as a first-time reader would: a developer arriving
from a review link who has never seen the sensor model. The record had a
"Checks" column of four squares and a "Found" column of a three-tone bar, and
nothing on the page said what either meant or that the second was produced by
the first. And the row was a link only in its first cell, so a click on the
verdict to see why it was that verdict did nothing.

**The two columns are one cell.** The four squares, the severity bar, and the
counts spelled out beside it in their tones — `2c 3w 1i` — read as one
sentence: these sensors ran, this is what they found. Each square is a tooltip
naming its check, how it ended and how long it took, and the cell carries a
disclosure that opens a second row with all four lines at once. The tooltip is
Radix, already in the tree and unused until now, and its trigger is a button so
a keyboard can reach it. The column sorts by what was found, rank by rank, as
"Found" did (`compareFindings`).

**The row is the link.** Still one anchor — the first cell's — stretched over
the row with a pseudo-element, so a keyboard walk down the record stays one
stop per run and a middle click still opens a tab. The controls in the results
cell sit above it. A row that is a link needs a plain sentence saying so, and
the record gains one under its title: "Every pull request Cujo has reviewed,
newest first. Click a row for the run." The title itself stays "The record":
the instrument vocabulary is the product's voice, and one panel renamed to
"Review history" would be the one panel not speaking it.

Rejected: **a prose summary per row** ("4 checks — 8 findings: 2 crit, 3
warn"), which the issue proposed and which trades a scannable column for a
sentence a reader has to parse thirty times. **`router.push` on the row**,
which is not a link: no new tab, no status bar, and every control inside the
row has to stop propagation. **Tooltips on `title=`**, which a keyboard never
sees and a touch screen never shows.

## 89. The key comes to the pointer

The chamber had no legend in it. The one sentence under the readings said
colour is the verdict, rings are checks, dots are findings, and the full key
was a screen away under the record (83). A reader with a star under the
pointer had to scroll to learn what its parts were and scroll back to look.

**While a specimen is hovered, the readings become the key.** The hero's
bottom block holds both, stacked on one grid cell, and the focus store the
chamber and the record already write decides which is visible: hover a star,
or a row, and the five readings fade out and the diagram with its four lines
fades in, two hundred milliseconds, in the same place. The same `PARTS` and the
same diagram as the key under the record, so the two cannot drift. Only on a
device whose pointer can hover — on a phone there is no chamber and a key that
appeared on a tap would replace the readings for nothing — and only while the
scene is live. Reduced motion swaps without the fade.

**The readings are reordered** while they are being replaced: findings with
the critical count first, live now second, then the record's size. A page with
four criticals on it opened with "1 repository".

Rejected: **a permanent legend in the chamber corner**, a fourth block of
type on a frame that already has three, saying what the hover now says at the
moment it is wanted. **A dismissable first-visit overlay**, which is the
template answer and is remembered in local storage, which means a reader on a
second machine gets it again and a reader who dismissed it by accident never
does. **Swapping only the caption sentence** and leaving the readings, which
was the cheaper design and left the diagram nowhere to go.

## 90. Every star tumbles, and a live one tumbles fast

Decision 82 made a live run "the one star that turns its rings", and it was
looked at running and did not. Two reasons, and both were geometry. A ring
spun about its own normal is a circle turning into itself: on a full ring
there is nothing to see, and on a split one only the gap crawls. And the
group precession was about y, which on the run page is the axis the holder
already turns about, so the live star merely turned faster.

**The rings tumble about an axis in their own plane**, alternating direction
ring by ring, so the plane swings and the whole system visibly moves. Every
star does this, slowly — a turn in forty-eight seconds — and a live run does
it in six, with its satellites going round four times faster than at rest.
Speed is the live signal now, rather than motion against stillness. This
**amends 82**: the resting star is no longer still. What survives is the rule
that none of it carries anything; the shape is the measurement and the
motion is what admits the haze and the glow (80).

**The star field comes back to the record.** The field 82 spread through a
volume twenty-two units deep sat mostly behind the fog's far plane — a camera
near z 4 and a fog ending at twelve puts everything past z -7.5 in the dark,
and four motes in ten were there — and the rest so thin it read as nothing.
The box now hugs the galaxy, the points are brighter, and the drift is a
tenth of a unit rather than a sixteenth, which against a field this size is
the difference between air and a still picture.

**The name comes back beside the mark.** The bar went (the commit that
removed it says why) and took the wordmark with it. A mark alone reads as an
icon, and a reader arriving from a review has not met the icon; `cujo` sits
beside it again, in the corner, on both pages.

Rejected: **the group tumbling as one**, calmer and cheaper, which keeps the
four rings' relative tilt fixed and so keeps most of the silhouette still.
**Speed alone with the old axes**, which is what did not work.

## 91. The verdict is a card; the operator's numbers fold away

The run page opened on a dense paragraph mixing check summaries, finding
counts and the review link, with the model name and rubric hash on the line
above it. A PR author wants three things — what was decided, how bad, where
the review is — and had to read to find them.

**A verdict card above the prose.** The status badge at display size, the
severity counts as chips in their tones with `0 critical` said outright, and
the link to the review on GitHub. The generated summary stays beneath it as
what it always was: the reasoning, for the reader who wants it. While a run is
live the card says "still running" rather than counting nothing.

**Operator detail is one fold.** Model, rubric hash, session and turn ids were
already in a collapsed block; it is now titled "Operator details" and the
header no longer repeats the first two. Token counts and cost leave the check
card's trigger row for a plainly labelled line inside it — "Model input 270.2k
tokens" — because a number with no unit on a public page is a number nobody
can read. Findings group by the check that produced them, groups with a
critical or a warn open and info-only groups closed, with severity chips to
filter; the timeline gains the two-line legend the solid/light split always
needed; the review panel opens on a four-row table of what ran.

Rejected: **removing the cost from the public page**, which is part of what a
run is and was only unlabelled. **The card replacing the prose**, which moves
the reasoning into the review panel where a reader would not look for it.

## 92. Latest and superseded, derived on the board

A pull request pushed to twice is two rows, and the record drew them alike.
The older run's review was dismissed by the push, and a reader could act on a
verdict GitHub no longer shows.

**The newest run per pull request is marked `latest`; the others are marked
`superseded` and dimmed.** Derived on the client from `repo`, `pr_number` and
`created_at` (`lib/board/supersede.ts`), over every run on the board and not
the filtered ones, and said only where it distinguishes: a pull request with
one run is neither. This is a claim about the runs on this board — a run
older than the list's window is invisible to it — which is the right
blindness for a record.

Rejected: **a field on the public API**, which is accurate about dismissed
reviews and is a change to `serialize.ts` and its classification test to
serve one badge; the public plane adds nothing to itself for the board
(57). It remains the right answer if the board ever needs to know about
runs it cannot see.

## 93. Nothing on the run page opens itself

Decision 85 had a flag decide which evidence tables open, and the same rule
grew outward: a check card opened when a block needed attention, a findings
group opened when it held a critical or a warn, the probe group opened when a
probe tripped. Read cold, a blocked run's page was three cards and four
tables and two groups already open, and the reader's first act was closing
things to find out where they were.

**Everything is closed until asked, and the timeline pick still summons.**
Findings groups, check cards, evidence tables and the probe group all start
shut. What says where the trouble is has moved up the page since 85: the
verdict card counts it, the timeline colours the lane, each trigger row
carries its count and its worst alarm. A reader who picks a lane on the
timeline still gets that check's card opened and scrolled to, because a pick
is a request and not a default. `EvidenceTable` keeps its `defaultOpen` prop
and the rising edge behind it; nothing passes true today, and the prop is the
right shape if something should.

**Reverses** the opener half of 85. What survives of 85 is everything else:
`none` versus `not measured`, the column headers, and the alarms map that
still decides what a trigger row says.

Rejected: **opening the one worst thing** — the single card the alarms point
at — which is the compromise that keeps the reader guessing why that one and
not the others. **Remembering open state per reader**, which is local storage
for a page most readers see once.

## 94. Running is green

A running run was inert grey: the core, the ring, the badge, the record's
verdict text. The reasoning was sound — blue is a verdict in the chamber and
could not be spent on an arm, and grey is what "no measurement yet" means —
and the result was that the one star on the board doing something was the
one star nobody could find. The pulse was meant to carry it and did not
against thirty stars in a dark room.

**`live` is a sixth tone, green, on exactly one thing: what is still
executing.** A running run's core and badge and verdict text, a running
check's ring and strip segment and rack segment, and the legend row. It is
off the severity ramp on purpose: it cannot be read as a verdict, and it
never means "passed" — a finished clean run is blue, as it was. The tokens
are `--sev-live` and `--sev-live-bg` on both themes and `--chamber-live` on
the pinned chamber set, in `brand/tokens.css`, and brand.md says the rule.
The legend and the rack no longer dim the running swatch as "not a verdict":
it has its own hue now and nothing to be told apart from.

**Amends** the "a check still running is inert, not blue" rule stated at
`OUTCOME_TONE` in `tone.ts` under 68 and 82. Blue is still a verdict; running
is no longer asked to share grey with superseded and denied.

Rejected: **amber, pulsing**, which puts the brand accent on a second status
and leaves `blocked_pending` and `running` distinguished by animation alone.
**White with bloom**, which is bright in the chamber and grey everywhere the
page has no bloom.

## 95. The gates go, depth wanders, and the light beats the star it reads

Three things about the chamber, looked at again after 88.

**The gates go.** One ellipse per occupied layer said the record was three
layers deep. It also drew three hoops round the galaxy, and a galaxy inside
hoops is a diagram of a galaxy. The lattice behind everything still gives the
drawing its vanishing point (82's reason for keeping any wireframe at all),
and the layers are read from the stars — three sizes, three depths — without
a loop to trace them. `room.ts` is deleted, and with it the last
measurement-drawing outside `specimens.ts`. This **amends 82**: the gates
were its one piece of room.

**Depth wanders within a layer.** A layer was one z, so a layer was a wall of
stars at one distance, and three walls read as three slides. A star's z is
now its layer's z plus up to a third of the layer spacing either way, seeded
off its id like its place in the band, and the front layer wanders only
backward so nothing crosses the camera's near plane. Which layer is still a
measurement — the layers do not overlap, and a star is never nearer than the
layer in front of it — and where within it is decoration, exactly as a place
in the band is (81). `galaxy.test.ts` pins both halves.

**The light beats the star it reads.** 83 removed a strobe: every star grew
as the sweep passed and shrank as it left, for as long as it passed, which
was thirty stars pulsing in turn. What it left was the glow swelling, which
read as nothing. Now a star beats once, at the moment the read peaks: an
eight-percent rise over the first two hundred milliseconds, a slower settle
over the next four hundred, the glow leading the body by a few frames, and
a hairline ring leaving the core as it goes. One beat per read, timed to the
peak rather than smeared across the pass, is what makes the light legible as
a read and not a weather front. Reduced motion keeps the glow swell and
nothing else. This **amends 83**: the strobe stays gone; a beat is not a
strobe.

Alongside these, **rings brighten under focus**: a star under the pointer or
the keyboard lifts its faint arcs toward the bright ones, so the ring the
callout names in colour is the ring the eye finds.

**The run page's specimen sits on the page.** It was on a black panel, the
chamber's ground carried onto a page that is not the chamber. It now draws
on `--bg` with the page's own tones (`TONE_PAGE_VAR`), follows the theme, and
repaints when the theme changes, so the star beside a title is the same
star in the page's own ink.

Rejected: **removing the lattice too**, which leaves size and fog alone to
carry depth and loses the vanishing point 82 kept it for. **Continuous depth
by age**, which reverses 82's layers and makes the key's "three layers"
false. **An expanding ring alone as the read**, which is the live pulse's
shape and would make every read star look live for a moment.
## 96. The envelope roll-up is the model's work, so the schema reads it leniently

**Refines 62.**

Decision 62 drew one line — the validator may only add — and one boundary: what
the schema requires is what the rubric asks for, and no more. It did not
distinguish the two kinds of block a report carries, and that is where it went
wrong. Every `runs[]` entry is copied verbatim from what `sniff.py` printed. The
envelope's `derived`, `sensors` and `truncated` are a roll-up the sub-agent
assembles by hand. `report-schema.ts` typed both with one schema, so the strict
shape that is correct for a copied block was also demanded of a written one.

It failed on every run. Five runs across three models produced fourteen
`report_invalid` warns and not one of them was about a report anybody would call
wrong: `derived` short one key, `truncated: {}`, `truncated.stdout_tail`
missing, `truncated: true`. Three models, three different malformations of the
same two blocks, which points at the instruction rather than at any model.
`agent/SKILL.md` asked for "the same roll-up over every run" and never said the
roll-up must carry every key, and `{}` is a defensible reading of "there was
nothing to roll up" — so the one shape the rubric invited was the one shape the
schema rejected.

**The change.** `TruncatedRollUp` and `DerivedRollUp` are `.partial()` of the
strict pair and are used only at the envelope. Every key optional, each one
still a boolean when present, extras still passing through, and a block that is
not an object at all still refused — `truncated: true` is a wrong shape, not an
absent one. `derived` stays required at the envelope because the rubric names
it. Inside `runs[]` nothing moves: a key missing there means the producer moved,
which is the failure the validator was built for, and the tests now assert that
the leniency stops at the boundary. The rubric says the rest: a roll-up must
carry every key as a boolean, omitting the block is better than sending a
partial one, and the per-run sensor block list — which had never mentioned
`sensors` or `truncated`, though the schema required both on every entry — now
names them. `Truncated` also gains `sensor_logs`, the seventh of
`TRUNCATION_KEYS`, which the schema had never named and which therefore rode on
`.passthrough()` untyped.

**Consequences.** Nothing is lost. `sensorLayers` runs every hard rule over the
top level *and* every `runs[]` entry, precisely so a roll-up nobody wrote cannot
hide a signal, and a roll-up of booleans that are all `false` in every run is a
value `any()` over the runs computes anyway. What is regained is the meaning of
the board's warn count: at a 100% firing rate `report_invalid` was noise, and it
was noise the posted review never showed, so the two surfaces contradicted each
other on the same run — the board counting four warns where the review counted
one. This is the second time this argument has been made about this file;
`sensors.detail` was the first, and the rule is now stated generally: **a block
a model writes is read leniently, a block the sandbox writes is not.**

Not fixed here, and outliving this: a hard-rule warn is Cujo's own measurement
(21, 42) and cannot reach the posted review at all, because the body is composed
from the agent's `findings[]`. Every route to changing that is already a named
rejection — `github-mcp` reading the check reports is rejected in 74 as widening
a write-only server (5), `apps/cujo` posting is rejected in 21 as a second
author of reviews, and tightening the rubric is rejected in 74 twice with
evidence. So it needs a decision of its own rather than a fix. Cujo's `Finding`
type has no `next` field either, so a hard-rule finding cannot yet name an
action even internally.

**And the warns that are left have to be readable.** Leniency and legibility are
one subject here: dropping the roll-up warns promotes what remains from noise
nobody triaged to the only thing this rule says, and two of those were
`runs.0: Invalid input`. `runs[]` is a union, zod reports a failed union as one
issue whose message is that literal string and whose path stops at the entry,
and `validateReport` took issue zero. What it was hiding, on
spencerjireh/orders-api #19, was six run entries each missing `files_read` and
`fs_changes` — a sub-agent trimming entries the rubric tells it to copy whole,
which is the run-level strictness working exactly as intended and saying so in a
way no operator could act on. `validateReport` now walks into the branch with
the fewest issues, which is the branch the entry was reaching for, and appends
the count of what it did not name. The safety rule is unchanged and now tested
on that path: nothing in the schema is an enum or a literal, so every message a
branch can produce is `Required` or a pair of type names, never a received
value.

The standing hazard behind the wrong shapes is a name. `truncated` means two
different things in one rubric — `prepare` prints a list of build files it
capped, a check report prints an object of named booleans — and sub-agents
inherit the same instructions, so both are in front of them. Renaming the
`prepare` field is what decision 54 forbids, so the rubric contrasts the two
instead, in both places. Every remaining warn on the runs behind this entry is a
`truncated` that came back as a bare boolean, which is what a model does with a
word it has seen mean two things.

Rejected: **making the run-level blocks lenient too**, which is decision 62
reversed — a renamed field in `sniff.py` would then fail nothing, which is the
silence that entry exists to break. **Accepting a non-object roll-up**, which
treats a claim about the shape as no claim. **Dropping the envelope roll-up from
the schema entirely**, which loses the type check on the values that are there
for nothing, since the keys were never what carried the risk.

## 97. The template tires the reader, not the model

**Refines 74.**

Decision 74 took the review body away from the model because the model was
writing it badly: the verdict nowhere near the top, a sensor field name used as
a claim, an `info` finding and a credential read in the same weight. That
complaint is answered. The one left is different and worth naming as different —
a post-74 review is correct, grounded, and tiring to read.

The load-bearing observation is that the prose is good. On run
`8aa92099-006f-4b32-8335-e9c078b6a96a` the lede reads "Rounding the total once
instead of per line changes what multi-line orders cost", one sentence naming
the mechanism and the consequence, which is exactly what the rubric asks for.
What tires the reader is everything around that sentence, and everything around
it is this repository's own template. So the fix is placement and density in
`packages/review-render`, and a bound in `agent/SKILL.md`; none of it is a
better model, and asking a model for shorter prose it was already writing well
would have fixed nothing.

Three things changed in the renderer, and they apply to every session on the
next deploy — `github-mcp` is stateless, so a session pinned to the old rubric
(decision 16) still gets the new rendering.

**The evidence moves below the sentence that explains it.** It used to be the
first block after the title, so the reader met a `pytest` tail before learning
why it mattered, and paid for parsing it either way. Below the `detail` and the
`next`, the proof does not stop being the proof, and a reader who trusts the
sentence never has to read it.

**A finding with no judgment on it is one line.** Four findings rendered as four
identical four-part blocks at four identical lengths read as a form rather than
as writing, and give the eye nowhere to skip to. A finding carrying neither
`detail` nor `next`, with evidence that fits on a line, is now
`**title** · meta — evidence`. The condition is the fields and not the severity:
a `warn` that carries a `next` is making a case and keeps the full block. With
one floor under it — **a `critical` never collapses, whatever it carries.** The
rubric requires a `detail` and a `next` on every one and the tool schema leaves
both optional, deliberately, because a schema that refused a finding would drop
a real one; so a `critical` with neither is reachable, and rendering it as a
line is how a reader is told something is minor. The one shape this cannot
render terse is the one that matters most.

**Coverage prints one line per check.** It used to stack every note into one
sentence of parentheticals — the exact shape the rubric warns about two
paragraphs earlier, "a caveat in a parenthesis is a caveat nobody reads",
reproduced by the renderer over every check at once.

Four rubric changes go with them, and by decision 16 they reach only sessions
created after the deploy, so only a new pull request tests them: a length and
subject bound on `title`, which banned sensor field names and then asked for
nothing in their place and got clauses nobody would say out loud; a two-sentence
cap on `detail`, because "one paragraph" is read generously; a rule that
findings sharing a cause and an anchor are one finding with combined evidence,
because a failing test and the probe confirming it were being posted as two
`critical`s on the same line and the reader had to work out they were not two
problems; and a line saying that `next` on a `critical` names the action the
evidence supports rather than enumerating the options — the ban on praise and
the first person was being read as a ban on reaching a conclusion, which it is
not.

Not warmth, not jokes, not a friendlier voice: a review that blocks a merge and
reads chatty undermines its own verdict, and the ban on praise and exclamation
marks stays exactly as written. The goal is faster to read, which is what
"easier to read" means for someone reading a review of their own code.

Rejected: **folding the evidence into `<details>`**, which is shorter still and
charges a click for every proof — the evidence is the thing this reviewer has
that a diff-reading one does not, and it should not need opening. **Collapsing
by severity** rather than by fields, which would flatten a `warn` that carries a
`next` into a line and lose the argument it was making. **Reordering the inline
comment too**: on the Files changed tab it arrives with no headline above it,
it is short, and the evidence is the reason it is on that line. **Telling the
model to write shorter blocks** instead of rendering them shorter, which is
decision 74 reversed — a rule a model applies is a rule that fails silently.

## 98. The board carries the manual, and it is the one thing indexed

**Status:** active — `/docs` in `apps/web`, `robots.ts` amended.

**Context.** Everything a person needs in order to adopt Cujo was written for
somebody else. `architecture.md` and `spec.md` are the design of record and are
written for a contributor; the README is four paragraphs; the board itself
teaches how to read a specimen and, when it is empty, three lines of
onboarding. So a reader handed a board link could learn what a satellite means
and could not learn what `.cujo.yml` accepts, which pull requests are skipped,
who may answer a held finding, or how to run their own instance. The gap was
not a missing document — the facts are all written down — it was that the
audience for them had never been the person deciding whether to install this.

**Decision.** A documentation plane on `apps/web`, at `/docs`, in four groups
that are tasks rather than topics: point it at a repository, understand a
verdict, use it day to day, run your own. Twelve pages, `nav.ts` as the only
ordering, `registry.ts` as the only slug-to-component map, and a test that the
two agree — a page listed in the sidebar with no component behind it is a 404
nobody notices.

**Routes and not one page.** A single scrolling page is cheaper to build and
worse to link: half of what this covers is reference a reader returns to for
one answer, and "see the section on the gate" wants a URL. The overview is
served at `/docs` itself rather than at `/docs/overview`, so no page has two
addresses.

**TSX and not MDX.** MDX is a pinned dependency and build configuration bought
for authoring convenience this does not need, and it makes the thing that
matters harder rather than easier: the severity list, the run-status table and
the alarm vocabulary are generated from `SEVERITIES`, `RUN_STATUSES`,
`STATUS_LINE` and `lib/api/report.ts`, exactly as `Legend.tsx` already
generates its own legends. Those words are matched literally in `apps/cujo`. A
manual that retypes them is a manual that will eventually describe a status the
product no longer has. `STATUS_LINE` moved out of the run page to
`lib/api/status-line.ts` for this, so the sentence a link preview shows and the
sentence the manual shows are one sentence.

**`/docs` is indexed; nothing else is.** `robots.ts` grew an `allow` beside its
`disallow`, and the docs segment overrides the root layout's `noindex`. The
argument for the board's own exclusion is untouched and still holds: Cujo
reviews public pull requests belonging to people who did not ask to be listed
beside their own repository, and a finding quotes their code. None of that
reaches these pages. They are ours, they quote nobody, they name no repository —
and unlike a run, a manual that cannot be found has failed at its job, because
somebody deciding whether to adopt this is not holding a link to it yet.

**No navigation bar came back.** Decision 65's bar was removed because it cost
the chamber the top of the window, and reversing that is a bigger change than
this one and would deserve its own. The manual is reached from the footer's
bottom rule, from the 404, and from the board's empty-state onboarding list,
whose first step already read "Install Cujo on a repository" with nothing to
click. The sidebar is the manual's own chrome and lives inside its column.

**The self-host page names no vendor.** This deploy runs on one particular
host, behind one particular proxy, deployed by one particular tool, and none of
that is a requirement of the product. The page says "a container host", "a
reverse proxy that terminates TLS", "an OpenAI-compatible provider", and names
only what is actually required: Compose, a Daytona key, a model provider, a
GitHub App. `architecture.md` keeps the specifics, where they belong — that
file documents this deployment, and the manual documents the software.

**Consequences.** Twelve statically rendered pages that call nothing, so the
manual is readable when `apps/cujo` is not. A status added in `apps/cujo` now
appears in the manual without anyone remembering, and fails a test if its
sentence is missing. `robots.txt` has an exception in it, so it grew a test of
its own: one line there stands between an anonymous board of other people's
pull requests and a search index. `docs/demo.md` was corrected in the same
change, because it still described approving a held finding by clicking a
button in a UI that decisions 49 and 57 deleted, and a repository whose own
demo script contradicts its published manual is worse than one with neither.

Rejected: **a `sitemap.ts`**, which needs an absolute `metadataBase` and so a
build-time origin — decision 35 warns about freezing a `main`-relative value
into an image, and `allow: /docs` is sufficient without one. **A fifth footer
column**, which breaks the four-column composition the footer was built as; the
link goes on the bottom rule, with the other two things that are about the page
rather than about Cujo. **Reusing `.cujo-prose`**, which exists to style
sanitized agent markdown arriving as bare tags — restyling the manual must not
restyle what the agent wrote on a pull request. **Indexing the whole board
while we were there**, which is decision 34's argument thrown away for the
convenience of one fewer line.

## 99. The watchdog bounds the run, not the current process

The turn watchdog (`runner.service.ts:consume`) bounds how long Cujo waits for a
terminal event. Before this entry, the timer was armed from "now" — a fresh
`setTimeout(callback, turnTimeoutMs)` on every call to `consume`. On restart,
`rehydrate` calls `follow` → `consume`, granting a fresh full window. A run
unlucky enough to be in flight when someone merges — which deploys immediately
(decision 35) — earned another 30 minutes on every redeploy, indefinitely.

The watchdog now bounds the *turn*, not the process's attention span. `rehydrate`
finds the latest `turn.created` event in the replayed stream and computes
`remaining = turnTimeoutMs - (Date.now() - turnStart)`, passing the remainder as
`budgetMs` to `follow` → `consume`. If the budget is already spent,
`fireWatchdog` runs immediately — the same synthetic terminal and best-effort
cancel, without a timer. Falls back to `run.createdAt` when no `turn.created`
event is found.

The anchor is the turn's own start, not `run.createdAt`, because a run that went
through preparation, waited for approval, and then resumed should not charge
that earlier time against the resumed turn's budget. A fresh turn after approval
deserves a fresh window — only within the same turn does a restart inherit the
elapsed time.

`start`, `approve`, and `pollForNewTurn` keep the default full budget: those are
genuinely fresh turns from this process's perspective. Only the rehydrate path
inherits the active turn's elapsed time, since that is the one place a
pre-existing turn's clock was being restarted from zero.

Rejected: **using `run.createdAt` as the sole anchor**, which includes
preparation and approval wait time and would prematurely expire a resumed turn
after a long approval wait. **Using `updatedAt`**, which moves on every `refold`
(including the `refold` inside `rehydrate` itself) and would re-arm the same bug
one level up. **Using `setup.turnCreatedAt`** from the projection, which is more
precise but requires `refold` to have run first and introduces a dependency on
fold output for a decision that logically belongs to the runner.

## 100. Cujo leads the card, the opener closes it, and the sections breathe

Decision 86 put the opener on the author line on the argument that the
variable party needs the affordance of an icon in front of their name. In a
channel the card read the other way: the first line named a stranger, and the
product's own name had scrolled into the small print of the footer. A channel
scanning four of these an hour reads the fixed party first — *whose card is
this* — and only then *who it is about*. 86 had that order backwards.

**Cujo takes the author line back; the opener takes the footer.** The footer
is the embed's last line, and the one slot outside the author line whose icon
renders to the left of its text — bottom-left, which is exactly where a
signature belongs. So the footer reads `@login · run <id> · <sha>` with the
opener's avatar beside it, the avatar still built from the numeric account id
exactly as 55 and 86 built it. A bot opener is named like anybody else, and a
run with no stored author shows the handles alone and no icon.

**The footer renders no markdown at all** — not a link, not even emphasis —
which settles two questions at once and was learned the hard way: the first
draft of this change built `[@login](profile)` into the footer and review
caught that Discord draws that as literal syntax. So the profile link is
dropped rather than shown as text pretending to be a link, and the login is
cleaned by stripping alone rather than escaping, because a backslash in a
no-markdown slot is litter rather than defusal — `some_login` keeps its
underscore where 55's `Opened by` field showed `some\_login`. The run's own
handles pass the same strip, because a bidi override reorders plain text as
happily as markdown. The card's live links remain the run's own and the pull
request's.

**The sections breathe.** Between surviving field groups the card now carries
a blank row: a field whose name and value are a single zero-width space,
which renders as nothing but the row it occupies. It is Cujo's own literal,
not a derived string, so the rule that strips zero-width characters from
untrusted text is not reached by it. The spacers are budgeted in the clamp
and inserted after it — a spacer placed ahead of the clamp could be all the
clamp leaves of a dropped section, a dangling blank row where a section was —
and the reserve is searched from loose to tight, taking the first layout
where the surviving content plus the blank rows those very survivors need
fits the total. A fixed maximum reserve would over-reserve near the limit and
pop a real field for blank-row budget a dropped section left unused; a
downward correction is not sound either, because a looser clamp keeps more
groups alive and those groups need the budget back. Group membership is
tracked by identity, so a dropped group takes its blank rows with it. The
description-to-fields gap is fixed by Discord and stays as tight as Discord
allows.

Rejected: **keeping the opener on the author line and only adding the
spacers**, which was the first draft of this change and still opened every
card with a stranger's name. **An `Opened by` field instead of the footer**,
55's original answer, which puts the name and the avatar in two different
corners of the embed again. **Keeping the profile link by any other means**
— a trailing field just to hold it, or link syntax left in the footer to be
drawn literally — the first spends the field budget on a link the pull
request field already provides, the second is text pretending to be a link.
**Real blank lines inside field values as spacers**, which widen sections
instead of separating them.

## 101. The page does not bounce

The board is an instrument in a frame: the chamber is pinned and the record
rises over it as a sheet, and neither half moves of its own accord. The
browser's rubber-band contradicted that. Scrolling past the top or bottom of
the document stretched the page and snapped it back, which read as the sheet
slipping on the galaxy, and on Android the same root gesture is
pull-to-refresh — a full reload of a page that re-reads the API every five to
thirty seconds without being asked.

**The root scroller's vertical overscroll is off.** One declaration,
`overscroll-behavior-y: none`, on `html` and `body` both, because browsers
disagree about which of the two is the effective root scroller and the
belt-and-braces form costs nothing. Vertical only: horizontal overscroll is
the browser's back and forward gesture, and the page has no claim on it.
The inner scrollers — the record's table, the windowed reports, the prose's
code blocks and tables — keep their default, so they still hand their scroll
to the page at their edges rather than stopping dead mid-page.

Safari 16 is the floor; below it the property is ignored and older iOS keeps
its bounce.

Rejected: **applying it to every scroller**, which would strand the scroll
at the edge of the record halfway down the page. **`position: fixed` on
body**, the old iOS workaround, which is a layout change disguised as a
scroll tweak and breaks the sticky hero and the sticky approve bar to remove
a bounce.

## 102. The key waits for a stay

**Refines 89.**

Decision 89 brought the key to the pointer: hover a star, or a row, and the
readings became the key. What that also meant was that a pointer *crossing*
the field swapped the block under it. A sweep of the galaxy — the natural
way to see where the criticals cluster — crossed star, gap, star, and the
readings blinked out and back for every one of them, taking with them the
very numbers the sweep was being taken over.

**The swap now waits for a stay.** The focused run must hold for three
seconds before the key replaces the readings, and the wait restarts on
every change of focused run, so a sweep never finishes one. Once committed,
the key stays while the pointer moves star to star: the restart gates the
appearance, which is where the flicker lived, and does not take back what
is already explaining the thing under the pointer. One leave hands the
readings back at once. The focus store itself is unchanged — the chamber
still lights the star on contact and the record still lights the row — only
the swap learned to wait.

Three seconds, and not the few hundred milliseconds a menu uses as hover
intent, because the question this delay parses is not "did the pointer mean
to be here" but "is the reader reading the star or walking the field", and
a walk is slow.

Rejected: **hiding again on a move between stars**, which puts the flicker
back the moment there are two stars to compare. **A fade long enough to
smooth a sweep away**, which makes a real dwell slow and a fast sweep into
a strobe. **Delaying the focus store instead of the swap**, which would lag
the star lighting under the pointer — the one effect that must stay
immediate.

## 103. The verdict card stops linking out

**Reverses part of 91.**

Decision 91 put "Read the review on GitHub" on the verdict card, as the
third of the three things a PR author wants — what was decided, how bad,
where the review is. Two of the three turned out to be enough, because the
third was already answered twice on the same page: the reader arrived by
that link and holds the back button, and the review panel below renders the
review itself, while the run header still links the pull request. What the
link added was a fourth thing — an invitation to leave the page before
reading what the page is for.

**The link is gone; the card is the verdict alone.** The status badge and
the severity counts, and nothing else. `reviewPosted` and
`gatedReviewPosted` keep deciding everything else they decide — the review
panel, the approve bar; only the card no longer spends the fact.

Rejected: **keeping it behind a disclosure**, a control that reveals one
link nobody asked for. **Moving it into the review panel**, which already
is the review and would carry a link to itself.

## 104. Supersede, do not delete, on re-review

**Status: active.** Closes #103.

`/cujo review` re-triggers a review for the current head. Before this decision
the old run was hard-deleted so the `runs_head` UNIQUE constraint would allow
the replacement's INSERT. The deletion silently broke every evidence link the
old review's footer pointed at, because the `Full evidence:` URL resolves to a
run row that no longer exists.

The fix has two parts.

**The run is marked `superseded` instead of deleted.** `superseded` already
exists as a `RunStatus` and already means "a newer head replaced this run."
Using the same vocabulary for the same concept keeps the data model consistent
and lets the public page stay reachable.

**The unique index becomes partial.** `runs_head` now covers only non-terminal
statuses (`status NOT IN ('superseded', 'error', 'clean', 'blocked_unattended',
'blocked_posted', 'denied')`). A head may have many completed or superseded
runs, but at most one that is still active. The duplicate-delivery guard (Contract 5, `INSERT OR
IGNORE`) still works, because only a `running` or `blocked_pending` row
occupies the index, and a second webhook for the same head still bounces.

`createRun` no longer pre-deletes stale error runs with empty turn lists. Those
runs were created by a webhook delivery that started a row and immediately hit
the `already_reviewed` guard or an error before any turn ran. Under the old
unique index they had to be swept first; under the partial index they are
already excluded, so the pre-delete is dead code.

**The status is persisted after cancellation, not before.** `Runner.supersede`
sets the in-memory `superseded` flag immediately (to gate re-entry and stop
polling), but defers the database write — and therefore the index release —
until the turn is confirmed stopped. A failed cancellation reverts the flag and
returns `false`, leaving the partial index protecting the head.

Rejected: **serving a tombstone** (option 2 in the issue). Cheaper, but it
answers only the reader's 404 and does not preserve the run's data for board
history or model comparison. **Dismissing the old review** (option 3): related
to decision 52 and solves a different problem — stale blocking reviews on newer
heads — rather than the evidence reachability one.

## 105. SessionEvents are validated at the boundary

**Status: active.** Closes #90.

`fold` turns TrueForge `SessionEvent`s into a run's verdict, and nothing
checked their shape at runtime. The SDK's TypeScript types are compile-time
only; if an upgrade renamed or dropped a field, `fold` would silently read
past it, and a run could resolve `clean` because evidence went missing — the
same failure mode `report-schema.ts` exists to prevent (decisions 61-62), one
layer up.

**Shallow schema of accessed fields.** The Zod schema validates only the
structural fields `fold.ts` and `runner.service.ts` actually read: the `type`
discriminant, `id`, `createdAt`, and the specific payload fields each branch
destructures. Every object carries `.passthrough()` so a newer SDK's additions
survive without a false rejection — the same rule decision 54 applies to check
reports.

**Validated at the boundary, not at every consumer.** Events enter through two
paths: the live SSE stream (via `push`) and persisted replay (via `rehydrate`
and `replayTurn`). Validation happens at those three call sites. Everything
downstream — `fold`, `refold`, `reportChecks` — trusts what has already been
checked.

**Warn, never reject.** `safeParse`, and an event that fails is logged as
`run.event.invalid` with a diagnostic and kept in the fold. Never dropped,
never fatal. This matches decision 62 exactly: the validator may only *add*
a finding's worth of signal, never gate the rules.

**CI type-assignability test.** A compile-time guard asserts that the SDK's
`SessionEvent` type is assignable to the schema's inferred type. If the SDK
drops a field the schema declares, `tsc --noEmit` fails — catching drift at
build time rather than runtime.

Rejected: **validating at every consumer** (six-plus call sites), which
multiplies maintenance for no safety gain when the boundary is already
covered. **Full SDK surface validation**, which would reject events carrying
new fields from a newer SDK — exactly what `.passthrough()` exists to prevent.
**Dropping invalid events**, which fails toward `clean` the same way the
original problem does.

## 106. Every expanded link carries the one branded still

A link pasted into Discord, Slack, or iMessage now expands into a card with a
picture: the dark lockup — mark, `cujo` wordmark, the one-line tagline — on the
board's own ground. Before this entry the board's pages carried `og:title` and
`og:description` only, so every expansion was two lines of text beside no
image, and the runs' own titles (decision 86) expanded the same way.

The image is one still for every route, not a card drawn per run. Next's file
convention (`opengraph-image.png` at the app root) attaches it to the board,
the manual, and every run page alike, and the layout's `metadataBase` makes
the URL absolute — a platform fetching `og:image` will not resolve a relative
one. The run's identity already travels in its title and description, which
the embedder prints beside the picture, so the picture itself carries the one
thing that is the same everywhere: the brand.

The still is generated, not hand-drawn: `pnpm --filter @cujo/brand og
<jetbrains-mono.ttf>` composes it from `avatar.svg`'s mark (dark-ground fills)
and `wordmark.svg`'s outlines and renders it with resvg, the way `render.mjs`
renders every other PNG in brand/. The tagline is live text, so the font is
passed in and not committed — the rule `wordmark.mjs` already set — with
system fonts refused at render time, so the card cannot render differently on
the machine that regenerates it. The committed PNG is copied byte for byte
into `apps/web` and held there by a test (decision 22's arrangement for the
favicons), which also fails if the asset comes back any size but 1200x630.

The ground is dark and opaque, `avatar.svg`'s argument (decision 55) applied
to a second place: an embed is read on whatever theme the reader's client is
in, so the image carries its own ground rather than trusting theirs. The
noindex rule is untouched — Open Graph is previews, not discoverability
(decision 86's distinction, now with a picture), and the manual's exception
(decision 98) neither gains nor loses anything from a card.

Rejected: **a per-run card drawn at request time** (`next/og`), which would
need font data committed — satori has no system fonts, and the repo's own
wordmark tool refuses to commit one — or fetched at runtime, a build-time
dependency on Google Fonts inside a read-only container, all to put into the
image what the title and description already say. **A separate
`twitter-image`**, when Next falls back to `opengraph-image` and one asset
with one test is enough. **A transparent ground**, which vanishes on a
light-theme client and takes the wordmark with it.

## 107. A run that proved nothing is `unproven`, not `clean`

`fold` reached `clean` whenever a review posted and no earlier rung fired, and
coverage was never part of that decision. So run `b30239c8` ran zero checks,
posted an advisory carrying four warnings, and sat on the public board as
`clean`. The review body was honest about what had not happened; the status
beside it was not, and a list view shows only the status.

Nothing was going to fix that from the findings side. Every operational rule —
`check_missing`, `sensor_unarmed`, `report_invalid` — is a `warn` by design (62,
96), and the only rung above `clean` that reads findings at all filters on
`critical`. A `warn` cannot move a status and should not be able to: a sub-agent
that mis-formats one roll-up must not be able to change a verdict. So coverage
enters as a status of its own rather than as a finding.

`unproven` is set when a review posted and not one check returned a report. It
sits immediately above `clean` in the ladder and below every contradiction rung,
which is what stops it masking anything: a run that under-gated an accusation,
or blocked a merge, or posted an advisory over a critical, still says that
instead. Only a run with nothing else to say lands here.

It is not `error`. Cujo did not fall over — it ran, it posted, and it had
nothing to show. Those are opposite claims about where to look next, which is
the same argument that keeps `error` blue rather than red: a status that
describes Cujo must not read as a verdict on the pull request. `unproven` takes
the same blue and the same 😕, and the *word* carries the distinction on every
surface the colour appears on.

A check that **reported** is the test, not a check that existed. Run `0c644064`
lost all three sub-agents to a provider fault in under 1.6 seconds; three
threads were created and `report` was null on every one. That is an unproven run,
and reading thread count instead would have called it covered.

The one case that stays `clean` is the one 87 allows: no test suite was
inferred, so the three suite checks are inapplicable rather than missing and
`detonation` ran alone. Its report is evidence like any other, so the predicate
asks only whether any check reported and never which — the same reason
`missingCheckFindings` suppresses itself there.

**Terminal, and three places had to be told.** The status vocabulary was spelled
out as a SQL string literal in three places, and `listUnfinishedRuns` already
carried a comment saying what that costs: the type system cannot check a SQL
string, so a status missing from one of them is silent. The specific failure
here would be the partial unique index `runs_head` treating a finished run as
active and refusing the next run on that head — a re-review that never starts,
with nothing logged. So the list is one exported constant now,
`TERMINAL_STATUSES_SQL`, interpolated at each site, and migration 10 rebuilds
the index from it. Migration 9 keeps its own literal, because that is the text a
deployed database already ran and editing it would make the ladder a lie about
what was applied (the rule `CONTRIBUTING.md` states and `tests/store/db.test.ts`
enforces).

Everything else fell out of the compiler. `Record<RunStatus, …>` in the card
colour, the card description, the reaction map, the board's tone, label and
legend maps, and the manual's status sentence all stopped building until the new
status was answered for, which is the property those maps exist to have (98).

Rejected: **folding coverage into `error`**, which needs no schema change and
spends the distinction the change exists to draw. **Keeping `clean` and adding a
coverage field to the projection**, which is cheaper and leaves a list view
reading `clean`, which is exactly where the problem was. **Making the
operational rules `critical`**, which would let a formatting warn block a merge.

## 108. A failed check is respawned once, by the rubric, and the run records it

Run `0c644064` lost `tests`, `probes` and `smoke` between 1425 ms and 1600 ms to
a provider that had been narrowed to one endpoint, and nothing tried again. The
review posted with no evidence. The design that makes a review fast — all three
spawned in one message (73) — is the same one that makes them fail together.

**The retry cannot live in `clients/trueforge.ts`.** A sub-agent is a thread
inside one harness turn, not a call the client makes. Its failure arrives as a
`thread.done` with an error state, and by then the only thing Cujo holds is an
event: there is no handle to restart a thread, and the turn it belongs to is
still running and still the parent's. The only backoff in that file,
`bootstrapUntilReady`, is at a layer where a retry is a fresh HTTP request, which
this is not.

So the retry is the parent's, in the rubric: a sub-agent that returns an error
instead of a report is spawned again, once, under the same name, after a short
wait. Once and not twice, because two provider faults in a row are a provider
that is down rather than one that is throttling, and a third attempt spends a
turn budget the watchdog is already counting.

**And the trusted side records it, because an invisible retry is worse than
none.** A review saying "the tests check returned no report" when the first
attempt died on a 429 and the second one worked describes a run that did not
happen. `CheckState.attempts` is which attempt a thread was, so a projection
carries both the fault and the answer. A count rather than a list, because what a
reader needs is whether this evidence came first time.

Two consequences follow from a check name appearing twice, and both were
previously documented as shapes the fold does not produce:

- **The digest takes the last thread, not the first.** `deriveDigest` kept the
  first writer, with a comment saying two threads for one check was not a shape
  the fold produced. It is now, and the earlier thread is the one holding the
  fault — so reading it would put `error` on the row of a check that went on to
  succeed. Reversed on both sides of the wire, because `apps/web` ports that
  file and the two specimens of one run must agree.
- **The run's duration spans every attempt.** The envelope is taken over all
  named-check threads rather than the winners, so a retried run keeps the time
  its first attempt spent before failing. `spanMs` is an envelope, so an extra
  attempt can widen it and never double-count.

`check_missing` needed no change and that is the point of where it already
looked: it keys on titles that produced a report, so a successful retry
suppresses it and two failures still raise it. `hardRuleFindings` and
`invalidReportFindings` both skip a null report, so a failed attempt contributes
no findings of its own and cannot accuse anything.

Session pinning (16) means only a new pull request gets the instruction, so the
recording half lands on every run and the retrying half lands on new sessions.
That asymmetry is fine in this direction: a run with one attempt records one.

Rejected: **retrying the whole turn**, which `retryTurn` already does for a turn
that posted nothing and which cannot help the case that hurt — the parent posted
an advisory anyway, so nothing was retryable and the run was recorded `clean`
(107 is the other half of that run's fix). **Letting Cujo respawn the sub-agent
over the SDK**, which would make the trusted side a second author of threads
inside a turn the agent owns. **Collapsing the two threads into one
`CheckState`**, which would lose the first attempt's timings and its error text,
the two things that say what was retried and why.

## 109. A timed-out run posts what it measured, as a comment and never a review

Run `b5724912` reached the 30 minute ceiling with `smoke` still running. `tests`
had finished at 930,958 ms and `probes` at 1,215,088 ms, both with real reports.
Neither reached the pull request, which got `review NONE` and nothing else after
half an hour of real work. The same signature is in `c7bf0e13` and `ced0c934`, so
this was never new.

Nothing was missing but the publication. `fireWatchdog` already refolds, and the
projection it writes already holds every parsed report, the hard-rule hits, and a
`check_missing` warn for the check that hung. What it does not hold is
`projection.review`, because no review tool was ever called — so the author saw
the one outcome that carries no information.

**A comment, not a review.** `apps/cujo` has no review-creation call at all
(decision 5), and that is the gate: `post_gated_review` is the one tool a human
answers for. So the new module reaches GitHub through `createComment` and holds
no other write, which makes "this can never become a review" a fact about the
types rather than a rule to remember.

**Against decision 38.** That entry's invariant, stated honestly, is that
*nothing states a finding on a pull request without a human allowing it*, and
decision 42 already narrowed "a finding" to an accusation — a correctness
critical posts unattended as `post_blocking_review`, and only a malice claim
waits. So the line is the accusation, and this comment does not cross it:
`heldClaims` counts malice claims and says how many are held, never what they
are. Everything else it says is weaker than what 42 already permits, and a
comment is weaker still than the review it stands in for, because it sets no
review state.

38 also rejected *a status comment edited in place*, for cluttering a thread
Cujo was about to post a review into. This is not that. It fires only when no
review was posted and none is coming, and a run gets one comment ever.

**The harvest is a read, and that distinction is load-bearing.** The first cut
called `replayTurn`, which was wrong in a way the tests caught: that method
replaces the run's event list and preserves only what arrived *during* its own
await, so the synthetic terminal `fireWatchdog` had appended a moment earlier was
discarded — the fold went back to `running` with the timer already spent, which
is a run nothing can finish. `harvest` does the same `listEvents` read and folds
it into a projection nobody persists. Falling back to the stored projection when
the read fails, because a thinner comment still beats silence.

The read is what makes the comment true rather than merely present. A stream that
never delivered a terminal event never triggered `hydrate` either, so the events
in hand can hold a report as an id-only stub — and a comment built from those
would tell an author that a check which worked reported nothing.

**One comment per run, and the store says so.** A reaction could be re-applied
freely because its POST is idempotent (38); a comment is not, and `rehydrate`
re-folds a run's whole history on every restart, so "post it when the fold says
so" would post it again on every redeploy. `run_announcements` is keyed on the
run rather than on (run, kind), because a run gets one comment at most and a
primary key is a better place to say that than every caller. The claim is taken
*before* the GitHub call: a crash between them costs a comment nobody reads, and
the other order costs a duplicate on the next boot.

The run keeps `status: "error"` and the comment does not soften it. Cujo did fall
over. What changed is that the author can see what was measured before it did,
and the harvest will also notice a review the stream had not delivered yet — in
which case nothing is posted, because the author already has the review.

Rejected: **synthesising a verdict from the harvested reports**, which would make
the trusted side the thing that reviews a pull request, when reading reports is
the agent's whole job. **Raising the ceiling**, which does not make a hung check
finish and costs every run the difference. **Posting through `github-mcp`**,
which would put the gate's one tool on a path no human is on.

## 110. Operational hard rules reach the author, as a follow-up comment

A review posted `0 critical, 1 warn` while the run held two. The missing one was
`report_invalid` on the `smoke` report — `runs.0.schema_version: Required (+31
more)` — and it was on the board and in the log and nowhere the author could see.

That split is structural, not a bug in one place. The posted body is composed by
`github-mcp` from the agent's own tool arguments, and its headline counts the
agent's findings. Cujo re-derives the hard rules afterwards on its own side
(decision 21), by which time `fold` says plainly that nothing can be prevented —
the review is already on the pull request under the bot's name. So the two
surfaces disagreed by construction, and no amount of care in either one closes
it.

Of the three re-derived families, the operational rules are the one the author
has a use for. `check_missing`, `sensor_unarmed` and `report_invalid` say the
evidence was thin and never that the code did anything (decisions 62, 96), so
passing them on states no finding about the pull request — which is what makes
this allowed under 38's invariant at all. A malice claim would not be, and a
correctness critical is already the agent's to post.

So when one trips, Cujo posts one follow-up comment naming the gaps and saying
they do not change the verdict. One per run, not one per finding, through the
same module and the same claim as decision 109 — and a run that timed out never
reaches this path, because it has no review to follow up on.

What this does **not** do is reach back into the review. The review is the
agent's, it is already posted, and editing it from the trusted side would make
Cujo a second author of its own gated output.

Rejected: **calling it intended and documenting it**, which was the cheaper
answer and leaves the author reading `0 critical, 1 warn` on a run whose
evidence had four holes in it. **Making the board stop reproducing the GitHub
headline**, which reconciles the board with itself and tells the author nothing.
**Teaching `github-mcp` the hard rules**, which would mean the write-only server
reading Cujo's store — the dependency decision 5 exists to prevent.

## 111. Where a command runs and what the sensors call the workspace are two questions

The `tests` check has never once run against `orders-api`, and the reason was one
word in the rubric. Discovery was already service-aware — `PREPARE_MAX_DEPTH` is
2, and its own comment names this repository as six services under
`services/<name>/` with no manifest at the root — while execution was not. The
rubric ran exactly two installs, `--cwd /work/head` and `--cwd /work/base`, so
the model was handed six manifests and one place to run one command.

Two runs recorded the consequence. `b30239c8`: the wrapped install ran from the
two roots and exited 1 because neither held a Python project. `319e3f8a`, which
otherwise produced a useful review: `python -m pytest -q` exited 1 on both trees
with `No module named pytest`, and no test ids were collected. Probes and smoke
compensated by exercising the code directly, which is why the review was still
worth reading — but the strongest evidence available was absent from every run.

`sniff.py run` executes argv with no shell, so `cd services/x && uv sync` is not
one wrapped command. Per-service install means one invocation per project root,
and that is the easy half.

**The hard half is a hazard nothing in `docs/` anticipated.** `cmd_run` passed
`workspace_roots=[cwd]`, so the filesystem diff's idea of "inside the workspace"
moved with `--cwd`. Narrowing `--cwd` to one service directory would have
reclassified every write elsewhere under `/work/head` as outside the workspace —
and that feeds `fs_changes` and `derived.wrote_sensitive`, a rule that accuses
code of acting against the person running it. An install writing a lock file at
the repository root is the ordinary case, not a corner one. A false accusation is
the worst thing this code can produce, worse than the missing check it was fixing.

So the two questions are separated. `--cwd` says where the command runs;
`--workspace-root` is repeatable, says what the sensors count as inside, and
defaults to `[cwd]` — exactly the old behaviour, so nothing that does not pass it
changes. The rubric passes the *tree* root while narrowing `--cwd` to the service,
and says plainly why.

`sandbox/` stays standard-library only, so decision 46 is untouched: this is one
`argparse` option and a `Path.resolve()`.

The cost is serial. `sniff.py run` takes an exclusive lock, so six services on
two trees is twelve installs one after another, and the `tests`, `probes` and
`smoke` fan-out cannot begin until the last finishes. That is a real regression in
wall clock on a polyglot repository, and it buys the `tests` check its first
evidence ever on one. Worth it, and worth saying in the rubric rather than
discovering in a run.

Session pinning (16) means only a new pull request installs this way.

Rejected: **inferring the roots in `sniff.py`**, which would put project-layout
judgment in the untrusted zone when `prepare` already reports the manifests and
the model already decides every other command. **Passing a shell string**, which
would make `argv` a shell injection surface for text read out of a pull request.
**Narrowing the workspace with `--cwd`**, covered above — the defect that would
have shipped if the two ideas had stayed one.

## 112. `sniff.py` assembles the envelope, because asking a model to did not work

`report_invalid` fired on `319e3f8a` with `runs.0.schema_version: Required (+31
more)`. There was no producer-and-consumer drift to find: `sniff.py` emits
`runs[].schema_version`, the validator requires it, `report.example.json` carries
it, and `sandbox/tests/test_contract.py` asserts it at both levels. The sub-agent
in between was rebuilding each `runs[]` entry out of the fields it judged
interesting — against a rubric that already said, in bold, never to trim an entry.

That was the fourth shape of the same failure. Decision 96 records fourteen
`report_invalid` warns across three models in five runs, each a different partial
reading of one sentence, and the fix then was to make the validator more lenient.
Leniency has a floor: `runs[]` entries are copied verbatim, so a key missing there
means the producer moved, which is the thing the validator exists to catch. The
instruction could not get stricter and the schema could not get looser.

So the instruction goes away. Every `run` and `detonate` records its own entry
under the check's name, and `sniff.py report --check <name>` prints the whole
envelope: `check`, `schema_version`, every entry in the order it ran and whole,
and the `derived` / `sensors` / `truncated` roll-up computed over them. The
sub-agent copies one blob. Copying one blob is something a model does reliably and
copying thirty-odd fields per entry is not, which is the entire argument.

**The roll-up is now computed rather than asked for, and the rules are
asymmetric.** Each `derived` and `truncated` key is an OR across entries, because
something that happened in one command happened. A sensor counts as armed only if
it was armed for *every* entry, and carries the detail from the first entry it was
not — a sensor blind for one command leaves that command's clean rows worth less
than they look, and naming the window it was blind in is what a reader needs.

**`--extra` is the model's half and it cannot reach the sensors' half.** The
per-check fields the sensors know nothing about still come from the sub-agent —
`base`, `head` and `base_pass_head_fail` for `tests`, `probes[]`, `endpoints[]` and
`log_tail`. They are spread *under* the envelope's own keys, so a model that sends
`derived` or `runs` in `--extra` is ignored rather than believed. The whole point
is that those stopped being the model's to write.

Still standard library only, so decision 46 holds: `json`, `pathlib`, and a file
per check. Append-only, one object per line, and a half-written line from a killed
command is skipped rather than taken as the end of the file.

This does not relax the validator. A report that fails the schema is still read by
the hard rules field by field, and `report_invalid` is still a `warn` that says
the evidence is not the shape it claims (62). What changes is that there is far
less left for a model to get wrong — and decision 110 now tells the pull request
author when one of these trips, which it did not before.

Session pinning (16) means only a new pull request reports this way. The command
exists for every sandbox immediately, because `sandbox/` is fetched from `main`
(19, 46), so an old session simply does not call it.

Rejected: **making the envelope's `schema_version` required**, which punishes a
session pinned to the old wording for a field that wording never named — the
reason 54 left it optional. **A second validator pass that repairs a trimmed
entry**, which would invent fields nobody measured. **Teaching the rubric harder**,
which is what the previous three attempts were.

## 113. The sandbox is an interface, reached through MCP and not through the harness

**Refined by 128.** The interface stands; the harness now exposes its five tools to the model by name, with no meta-tool between.

Daytona tier one gives no sandbox-level egress policy, which is why the
in-sandbox logging proxy became load-bearing — the thing enforcing the trust
boundary sat on the untrusted side of it. That is the weakest joint in the
two-zone story, and it cannot be fixed from inside the box.

**The harness cannot be asked for a different sandbox.** Four facts, checked
against SDK 0.1.3:

- `SandboxProviderManifest.type` is the string literal `"daytona"` on a plain
  interface, not a union.
- The wire serializer uses `core.serialization.stringLiteral("daytona")`, so
  casting past the type is rejected at runtime too.
- `auth` is typed `DaytonaSandboxProviderAuth` directly, one field, `apiKey`.
- The provider is a **singleton per tenant**, with only `get()` and
  `createOrUpdate()`. There is no list, so there is no register-a-second-and-
  switch migration either.

There is also no image field anywhere in the SDK, which is the concrete form of
decision 46's constraint: the image is not ours to choose, which is why there is
no install step and why `sandbox/` is standard-library only.

So Cujo stops using the harness's sandbox provider. `config.sandbox` is
`{ enabled: false }` on both specs, no sandbox provider is registered at all, and
the agent reaches a sandbox through `sandbox-mcp` — a second remote MCP server
beside `github-mcp`, registered the same way and modelled on the same code.
`McpServerType` is also a single literal, `"remote"`, which is all this needs.

**`apps/sandbox-mcp/src/runtime.ts` is the point of the change.** Five operations
and a name, with Daytona as one implementation and a local container runtime as
the other, chosen by `CUJO_SANDBOX_RUNTIME`. Nothing in that interface names a
vendor: no API key, no auto-archive interval, no exec timeout named after
somebody's knob. Making `type` pluggable from the start is the entire lesson of
the literal, and keeping Daytona behind the same interface is what makes the move
reversible on one variable rather than a bet.

Ids are minted by the server and mean nothing outside it, for the reason
`github-mcp` mints a run id rather than taking a URL: the caller's input was read
out of a pull request, and a vendor handle crossing back would let it name a box
somebody else is using. The image, the gateway image and the container runtime
come from this process's environment and are never tool inputs — a sandbox whose
image a caller chose is not a sandbox.

`sandbox-mcp` carries no `requireApprovalForTools`. Provisioning a box and running
a command in it is what a review *is*; the gate is for the one irreversible thing,
an accusation reaching a pull request (42).

The contract suite's pinned bootstrap array grew an entry, which is a change to the
contract and is named as one rather than edited to make a test pass. That suite
runs with no sandbox at all, so it still covers the harness contract and still
covers nothing about this.

Rejected: **forking the SDK** to widen one literal, which is decision 1 in reverse
for one field. **A local MCP server over stdio**, which `McpServerType` does not
have. **Keeping the harness sandbox and adding a second one**, which is two
sandboxes per review and an invitation to put the evidence in one and the checks
in the other.

## 114. `sandbox-mcp` cannot carry the hardening the other services do

`github-mcp` runs `read_only: true`, `cap_drop: ALL` and
`no-new-privileges: true`. `sandbox-mcp` cannot: it provisions a container, an
egress gateway and a network per sandbox, so it holds the host's Docker socket,
and that socket is root on the host by any honest reading.

This is a real reduction and it gets an entry rather than a comment, because the
alternative is a reader finding the missing hardening later and assuming it was
forgotten.

What stands in for it. The service is small and holds no pull request code — the
code under review runs in the container it creates, never in this process. It takes
no image name, no host path and no runtime name from a caller; all three come from
its own environment, so the widest thing an agent can do through it is run a
command in a box that was going to run commands anyway. It keeps
`no-new-privileges`, which is compatible. And the container it creates gets
`cap_drop: ALL` and `no-new-privileges` itself, so the hardening that was lost here
is present exactly where the untrusted code is.

The honest summary is that the trust boundary moved rather than weakened: before,
the process holding no capability talked to a vendor that held them all; now it
holds one capability and the vendor is gone. A deployment that prefers the old
shape sets `CUJO_SANDBOX_RUNTIME=daytona` and gets it back, with the egress
property given up (see 116).

Rejected: **a rootless Docker socket**, which is the right answer and is a host
provisioning change this decision does not reach — worth doing and not a
prerequisite. **Giving this service its own Docker-in-Docker daemon**, which adds a
privileged container to avoid a socket. **Building the sandbox with a library
instead of the CLI**, which changes nothing about the socket.

## 115. `provisioned_ms` replaces the `sandbox.created` event

`sandbox.created` is a *harness* event. With the harness no longer provisioning
anything (113) it is never emitted, so `setup.sandboxCreatedAt` would be null on
every run from here on — and `docs/spec.md` documents a null there as meaning the
sandbox was already there. Left alone, the board would have started telling that
lie on every run, quietly, with no test failing.

So `sandbox_create` returns `provisioned_ms`, and the fold reads it off that tool
response into `setup.sandboxProvisionedMs`. The old field stays rather than being
deleted: a projection stored before this change still carries the stamp, and the
board still renders it.

Read leniently and first-writer-wins, like the stamp it replaces. A tool result is
a string the MCP server wrote, so it parses or it does not, and a
`provisioned_ms` that is not a finite number is simply not recorded — a
measurement nobody made is absent rather than zero (54).

Per-check `sandboxMs` needed nothing, and it is worth saying why: it is summed from
`report.runs[].duration_s`, measured by `sniff.py` inside the box. It never came
from a harness event, so it survives the move untouched.

Rejected: **deleting the field and the span with it**, which loses the one part of
setup that was never the agent thinking. **Keeping `sandboxCreatedAt` and filling
it with a timestamp this process makes up**, which would be a stamp off a different
clock from every other stamp beside it.

## 116. Egress is enforced outside the sandbox, and its allowlist is a crossing

The in-sandbox proxy was the control. It ran in the untrusted zone, next to the
code it was judging, and the only reason that held is that nothing had defeated it
yet. With our own runtime the control moves out: one network per sandbox created
`--internal`, so Docker installs no default route, and a gateway container on that
network *and* one with outside access, holding the only route off and filtering
with nftables. The sandbox can reach the gateway and cannot reconfigure it — they
share no namespace, no filesystem and no process tree.

Default deny, then the allowlist, then NAT, in that order, so the policy is in
place before a packet can be forwarded. A gateway that finds no default route
refuses to forward rather than falling back, because a gateway forwarding to
somewhere nobody chose is worse than one that is down.

**The in-sandbox proxy keeps running and becomes a sensor**, which is what it
should always have been. `egress[]` still records what was attempted — and a row
there now means an attempt that genuinely did not leave, rather than one the proxy
decided to allow.

**The allowlist is a new crossing and is treated as one.** It comes from a
repository's own `.cujo.yml`, so it is untrusted text, and it used to reach a
process *inside* the box where getting it wrong could only weaken a control the
pull request already sat beside. It now configures a control outside the box. So it
is validated on the trusted side and **refused rather than repaired**: hostnames
only, no scheme, port, path, CIDR, wildcard, credentials, control character or
address. Silently dropping the part that did not parse would leave a repository
believing in an allowance it does not have, which is the argument `policy.py`
already makes for refusing half a policy. Capped at 32 entries, because past that a
repository is describing a network rather than its dependencies.

A hostname and never an address, because the allowlist is resolved by name and an
address would bypass the name it stood for. Every address a name resolves to is
allowed, because a name behind a CDN is several and allowing one of them is a flake
rather than a policy. A name that does not resolve is logged and skipped, not
guessed at.

gVisor (`runsc`) over a microVM for the runtime itself. It installs as a Docker
runtime beside the default and needs no VMM, no rootfs pipeline and no per-VM
bridge. Firecracker buys isolation against a kernel escape and costs all of that;
the threat this sandbox contains is exfiltration, and the deciding factor named in
the plan was network-layer egress rather than cold start. The runtime name is
configurable and empty falls back to Docker's default with a warning on every
create — a host that has not been provisioned yet still runs reviews, which beats a
service that will not start.

Rejected: **keeping the proxy as the control and hardening it**, which leaves the
boundary enforced from inside. **An allowlist of CIDRs**, which is a network policy
a repository should not be writing. **Resolving the allowlist once at boot**, which
would pin a CDN's addresses for the life of the deployment.

## 117. The sandbox image is ours, which reverses 46

**Reverses decision 46 in part.** That entry chose to fetch `sandbox/` into the
box from a source archive at run time, stdlib-only and imported from
`sys.path[0]`, and it was right for the situation it was in: the image belonged to
the sandbox provider, there was no install step, and `SandboxProviderManifest` has
no image field at all, so the image was not ours to change. Every constraint in
that entry traces back to that one fact.

Decision 113 changed the fact. `sandbox/Dockerfile` builds the image a review runs
in, so the sensors ship in a layer and the rest of 46 falls away with them:

- **No runtime fetch.** `COPY sniff.py /opt/cujo/sniff.py` and
  `COPY cujo_sniff /opt/cujo/cujo_sniff` put them there as siblings, which is the
  property 46 arranged with `tar --strip-components=1` and a `mv`. The rubric's
  first step is now a sentence rather than an `&&` chain, and the failure mode it
  guarded against — a half-extracted fetch leaving a module deleted upstream
  importable — cannot happen to a layer.
- **`CUJO_SNIFF_TARBALL_URL` is gone**, and with it `tarballUrl()` in `config.ts`.
  That validator existed because the rubric interpolated the value into a
  double-quoted shell word, so a `"` or a `$` in it changed the command rather than
  the URL. No interpolation, no shell word, nothing to validate. Three tests in
  `config.test.ts` went with it.
- **`specFingerprint` is now a digest of the rubric as written.** It used to change
  with the substituted URL, because two deploys pointing at different sensor code
  were two different rubrics. Nothing is substituted now, and the sensor code's
  version is the image's — which this deliberately does not try to capture, because
  an image digest in the rubric's fingerprint would mean every image rebuild
  re-pinned every session (16).
- **There is an install step, so `pytest` is in the image.** This is the other half
  of decision 111: the `tests` check had never once run against the demo
  repository, first because the install did not reach the service directories and
  then because there was no `pytest` to run. A repository's own install is still
  what *should* provide its test runner; this is what stops a repository with none
  from producing no evidence at all.

**The stdlib-only rule becomes a default rather than a constraint.** A third-party
import under `sandbox/` is now possible. It stays discouraged, and the reason
changed: it is no longer that it cannot work, it is that every package in that
image is something a pull request's code can reach. So adding one needs a reason
in the pull request, the way an unpinned dependency does. `CONTRIBUTING.md` and
`best_practices.md` both say so, in step.

What 46 got right and this keeps: state lives outside the code. `Context.from_env`
derives `code_dir` from `__file__`, so moving the package to `/opt/cujo` needed no
Python change at all, and the state directory stays at `/tmp/cujo-state` for the
reason `context.py` gives — state that outlives the code it was written by has to
sit outside it. A read-only code directory makes that argument stronger rather
than weaker.

The image runs as a non-root user. Root in the box would have made every
`wrote_sensitive` reading weaker than it looks, because everything is writable to
root and the decoy is supposed to be a file somebody chose to read. `tini` is PID 1,
because the box is entered with `exec` and lives for a whole review: without an
init, a suite that abandons a child leaves a zombie whose row would appear in a
later check's `subprocesses`.

Rejected: **pinning the archive to a commit** instead, which is what 19 and 46 both
left open and which solves the wrong half — it makes the fetch reproducible and
still leaves the image somebody else's. **Installing the repository's own
dependencies into the image**, which would mean the image knows what it is about to
review. **`apt`-installing every language a target might use**, which is an image
that grows forever to cover a case a `.cujo.yml` could state.

## 118. `sandbox-mcp` builds the images it runs, at boot, from contexts it carries

Decision 117 made the sandbox image ours and 116 added the gateway beside it.
Neither said who builds them on the host, and the answer was nobody.
`docker-compose.yml` names both as tags, `cujo-sandbox:latest` and
`cujo-sandbox-gateway:latest`, but they are not services in it: the local
runtime starts them with `docker run` per sandbox, so `up --build` never sees a
`build:` for either, and Coolify's deploy — which is `up --build` and nothing
else (architecture, deployment topology) — would have brought up a `sandbox-mcp`
whose first `create` was a `docker run` of a tag Docker had never heard of, which
it answers by trying to pull `docker.io/library/cujo-sandbox` and failing. Every
review after the first deploy of 113 would have failed at provisioning.

So `sandbox-mcp` builds them itself. `apps/sandbox-mcp/Dockerfile` copies
`sandbox/` and `apps/sandbox-mcp/gateway/` into its image at `/app/images`, and
at boot, when the runtime is `local`, `buildImages` runs `docker build` on each
through the socket the service already holds, tagging the result with the name
the runtime will later run. The HTTP server listens meanwhile and answers 503 on
`/healthz` *and* `/mcp` until both builds finish; a build that fails ends the
process, so a sandbox service that cannot provision is never one the deploy
calls healthy. The compose healthcheck's `start_period` is twenty minutes,
because failures inside it do not count and a cold build is minutes of `apt` and
`pip`; a warm rebuild is layer-cached and passes in seconds.

Why this and not a build-only compose service, which is the usual trick — a
service with `build:` and `image:` and an entrypoint of `true`, that
`sandbox-mcp` `depends_on` completing. Three reasons. It relies on Coolify
keeping the `image:` name a compose file gives a service it builds, which the
documentation does not promise and which a rename would break silently: the
tag would simply not exist, in the same way as before. It makes the images'
freshness a property of the deploy pipeline rather than of the service, so a
`sandbox-mcp` started any other way — `make up-local`, a container run by hand —
would run stale sensors or none. And it would show in Coolify as a service that
exits, which is a thing to explain on every deploy. Building at boot makes the
sensors a review runs exactly the code the deploy shipped, from the same commit
that built the service, with no third thing to keep in step. The
`specFingerprint` argument in 117 rests on that.

What this costs. The socket was already there (114); this uses it for one more
thing, and `docker build` is a bigger surface than `docker run`. The contexts
are this image's own files and never a caller's, and the tags come from the
environment, so nothing a pull request wrote reaches the build. The first boot
after a base-image change is a slow boot, and `cujo` waits on it; that is the
right order, since a webhook that arrived earlier would have had nowhere to run.
The build does not `--pull`, deliberately: the base images are whatever the host
has, and a registry that is down must not stop a deploy whose layers are cached.

`CUJO_SANDBOX_IMAGES_DIR` set empty skips the build and runs whatever the two
tags already name. That is for a developer with both built by hand, and for the
`daytona` runtime the question does not arise, which is why the contract-test
overlay needs no socket.

Rejected: **pre-built images in a registry**, pulled by tag, which is a release
step and a second credential for a project whose deploy is a merge (35).
**Building lazily on the first `create`**, which puts minutes of build inside a
tool call the agent is waiting on, and a turn that times out there looks like a
sandbox failure. **A `depends_on` a build-only service**, above.


## 119. No review bot; `best_practices.md` goes with it

Qodo is uninstalled from this repository. It reviewed every pull request from
the first to #120, and the project got real value from it: several entries
above cite a finding of its by name, and `sandbox/tests/test_script_capture.py`
still carries the numbers. Those citations stay, because they are history and
the rule is that an entry is reversed rather than edited.

What changes. The Standards section of `CONTRIBUTING.md` was mirrored, bullet
for bullet, into `best_practices.md` because that was the file the bot read;
with no bot there is no reader, and a second copy of a rule set is a drift
waiting to be found. It is deleted, and CONTRIBUTING.md is the one copy. The
repo rule "wait for Qodo's review, resolve every thread" becomes the rule it was
standing in for: CI green, and every open review thread applied or answered
with a one-line reason and resolved. The README's "Qodo Code Review Evidence"
section goes as well. It counted reviews for a submission that is over, and a
section whose first sentence is no longer true is worse than none.

Why not keep it. The bot was installed for an event, the event has passed, and
the last two pull requests sat without a review from it, which meant a rule
that gated every merge on a service that had stopped answering. A review bot
that runs may come back — Cujo is one, on `orders-api` — but that will be a new
choice with a new entry, not this one restored.

Not a reversal of anything numbered. The bot was never a decision here; it
predates the file. The entries that lean on `best_practices.md` (26, 35, and
the ones that name a finding) describe what was true when they were written and
are left as written.

## 120. `sandbox-mcp` says `requireApprovalForTools: []`, because absent means everything

**Premise reversed by 128.** Absent means none on `apps/harness`; the empty list stays because it now means exactly what it says.

Decision 113 gave `sandbox-mcp` no `requireApprovalForTools`, reasoning that
provisioning a box and running a command in it is what a review *is* and the
gate is for the accusation alone (42). The reasoning holds; the spelling was
wrong. The SDK documents the key's default as `["@write", "@destructive"]`, and
every tool on that server but `sandbox_read_file` is annotated as a write, so an
absent key gated four of the five. The first live review on the new runtime
(orders-api #38) called `sandbox_create`, the harness paused for an approval
nobody was going to give, and `apps/cujo` folded the pause into
`blocked_pending` — a status that names a human decision, over a run that had
nothing to decide.

Nothing before production could have caught it. The contract suite runs with no
sandbox and never calls a sandbox tool, which decision 113 says in as many
words, and the unit test pinned the shape it was given rather than the harness's
reading of it. The fix is the empty list on both specs, which the SDK types
accept and which means what the comment always said.

Two things this does not do. It does not annotate the tools as read-only to
dodge the default: `sandbox_exec` runs a pull request's code and
`sandbox_destroy` removes a box, and lying about that to the harness to avoid
one line of config is the wrong trade. And it does not teach the fold to
distinguish a pause on a review tool from a pause on any other, which is a real
gap — `blocked_pending` should be reachable only through `post_gated_review` —
but is a second change with its own test, not this one.

## 121. The gateway is the sandbox's router and resolver, which refines 116

Decision 116 put the sandbox on a network created `--internal` and a gateway
container beside it holding "the only route off". The first live review on the
new runtime (orders-api #39) could not resolve `github.com` to clone anything,
and the reason is that an internal network gives a container two things 116 did
not account for: no default route at all, and an embedded resolver that refuses
to forward. Nothing in the sandbox had a route *to* the gateway, and nothing in
it could turn a name into an address. The gateway forwarded correctly and no
packet ever reached it.

So the shape changes in three places, and the property 116 wanted — the
gateway is the only way out, and the sandbox cannot change that — is now true
rather than intended.

**The network is not internal.** It is created with the bridge's own address
inhibited (`com.docker.network.bridge.inhibit_ipv4`) and host masquerade off.
Docker still reserves a gateway address for the subnet and still installs the
sandbox's default route through it; with the bridge inhibited that address
belongs to no interface, so the route leads nowhere until the gateway container
claims it, which its script does first. The host holds no address on the bridge
and NATs nothing for the subnet, so even a packet aimed at the host bridge has
no one to answer it. The sandbox runs with every capability dropped, so it can
neither add a route nor open a raw socket to bypass one.

**The gateway is the resolver.** The sandbox's `--dns` is the gateway address,
so Docker's embedded resolver inside the box forwards to `dnsmasq` on the
gateway, which forwards each allowlisted name (and the clone host) to its own
upstream and answers NXDOMAIN for everything else. A name outside the list does
not resolve, which is a stronger statement than "does not connect": the old
design would have let the daemon resolve any name on the sandbox's behalf, and
a resolver that answers for anything is a covert channel one label wide. The
gateway's input path accepts only port 53 from the sandbox leg, so the sandbox
can ask it a name and nothing else.

**The clone host is a baseline, not a request.** `github.com` is allowed on
every sandbox before a repository asks for anything. Fetching the pull request
is Cujo's own step; making it the repository's to declare, or the rubric's to
remember, is how a review ends with "could not resolve github.com" and three
`check_missing` warnings, which is exactly what happened.

Two mechanics that fell out of doing it for real. Forwarding is switched on
with `--sysctl net.ipv4.ip_forward=1` at creation, because `/proc/sys` is
read-only inside the container and the script's `echo 1 >` would have failed on
`set -e`. And the gateway is created, connected to its outside leg with the
highest gateway priority, and only then started, because the script reads its
routing table on its first line and a container started with one leg has that
leg as its default route — the masquerade would have gone out the sandbox side.
`--gw-priority` needs Docker 28, which the deploy host exceeds.

`create` now waits for the gateway to print `gateway.armed` before returning,
bounded, and fails the provision with the gateway's own log if it exits first.
The first `exec` follows `create` within a second, and a resolver that is not
listening yet is a clone that fails on DNS with no way to tell it apart from a
real outage.

What this reverses in 116: the "internal network" and the claim that DNS to the
embedded resolver is what makes the allowlist resolvable. What stays: default
deny, the allowlist as a crossing validated on the trusted side, names not
addresses, resolve every address, and the proxy as a sensor. Verified end to end
on a 29.x daemon: a sandbox with `allow_hosts: [pypi.org]` fetches `github.com`
and `pypi.org`, gets NXDOMAIN for `example.com`, and times out on `1.1.1.1`.

Rejected: **sharing the gateway's network namespace** (`--network container:`),
which puts the policy in the same namespace as the code it judges and, under
gVisor, in the path of a netstack that injects frames below netfilter. **A
non-inhibited bridge with masquerade off**, which leaves the host as the
sandbox's router with a private source address, dropped upstream but not by us.
**Leaving DNS to the daemon**, above.

## 122. The gateway's baseline is the sensor's known-host list

Decision 121 gave every sandbox `github.com` before a repository asked for
anything, on the argument that the clone is Cujo's step. The next live review
(orders-api #40, a real code change this time) cloned, then failed to install:
`pip` got NXDOMAIN for `pypi.org`, because the repository's `.cujo.yml` names no
`allow_hosts` — deliberately, as its comment says — and the gateway allowed
nothing else. Every check needs the install, so the run was `unproven` again,
one hop further along.

The same argument covers the install. Under the old runtime the in-sandbox
proxy carried `KNOWN_INDEX_HOSTS`, the registries an install legitimately talks
to, and a repository never had to name one; the gateway replaced the proxy as
the control (116) and did not inherit the list. So the gateway's baseline is now
that list — the clone hosts and the package indexes for Python, Node, Rust, Go
and Ruby — and a repository's `allow_hosts` adds to it. The sensor still holds
its own copy, because nothing under `sandbox/` can import from the trusted side
(46, 117), and a test in `sandbox-mcp` reads `policy.py` and fails if the two
differ. They have to be one list: the sensor's says which egress was
*expected*, the gateway's says which is *possible*, and a host on one and not
the other is either an install that cannot run or an egress row marked unknown
that the gateway let through.

Not a widening of what a review may reach in any way that matters. These are
the hosts the sensor already called clean, on every review that ever ran, and
the gateway still resolves nothing else. What changes is who has to remember
them: nobody.

## 123. The harness is ours, built on pi, and the contract is a package

Decision 1 chose stock TrueForge because the hackathon rubric rewarded using a
harness, not building one. What the harness layer has cost since is written
down in the outage findings and in the decisions that worked around it: a
running sub-agent wedges the session (69), a turn timeout discards reports its
sub-agents already finished (109), a sub-agent failure is terminal so the retry
lives in the rubric (108), a session is pinned to a pull request with no reset
(16), the provider must declare reasoning efforts or the session is refused
(56), the stream's `model.message` is an id-only stub (spec Contract 6),
`listEvents` pages at 100, and an absent `requireApprovalForTools` gates every
tool (120). Each was a fact about a dependency, and the design of record is
mostly a list of them.

So the harness is now `apps/harness`: a service on the same port with the same
eight operations `clients/trueforge.ts` already needed, built on the pi coding
agent SDK (`@earendil-works/pi-coding-agent`, pinned) rather than an agent loop
of our own. pi is the loop, the provider layer, the retry and the compaction;
the harness is sessions, turns, the event log, the gate, and the sub-agent
tool, which is everything that hurt. TypeScript, in this repo, because it is a
few hundred lines of glue around a library and not a service of its own; the
language split the plan assumed bought nothing once the loop was not being
written.

The contract is `packages/harness-contract`: the event vocabulary TrueForge
used (`turn.created`, `turn.done`, `model.message`, `thread.created`,
`thread.done`, `tool.approval_required`, `tool.response`), kept because
`fold.ts`, the event schema and the board already speak it, as types both
sides compile against and Zod schemas the harness validates inbound bodies
with. camelCase end to end; the SDK's snake-case wire translation goes with
the SDK. Dropped: `sandbox.created` (115 already), `mcp.*`,
`tool.response_required`, and the spec's `sandbox`, `askUserQuestions`,
`generativeUi` and `skills` keys. Added: `tool.response.toolName`, which 125
needs.

Takes effect when `apps/cujo` cuts over, in the pull request after the one
that lands the service. Reverses 1 and 2's dependency on a hosted harness;
refines 17 (Cujo still owns the UI; the harness is now ours too) and 18 (Cujo
is still a projection; the event log it projects is now the harness's SQLite
table). What is not built: a console, multi-tenancy, a plugin system, a
provider abstraction wider than one manifest.

Rejected: **the Claude Agent SDK**, which is Claude Code as a library: it
speaks the Anthropic API only, so a non-Anthropic model needs a proxy, and its
sub-agents, retries and transcript are its own; the parts this decision exists
to own are the parts it hides. **The OpenAI Agents SDK**, provider-neutral and
with a serializable suspended run, but a second opinionated layer between the
model and the gate. **Writing the loop**, which is small but is where the time
goes. **A separate repository**, which would have made Cujo review its own
harness at the cost of a release step per change; there is nothing to version
across repositories.

## 124. A sub-agent is a nested pi session, and its report is durable as it lands

pi has no sub-agents in core. `create_sub_agent` is a tool the harness
registers itself, with the `{ name, input }` shape `agent/SKILL.md` already
asks for, so the rubric did not move (14 stands: one sub-agent per check).
Its execution is a second `AgentSession` in the same process: the rubric as
its system prompt, the sandbox tools only — no `github-mcp` tool and no
`create_sub_agent` of its own, which is the rubric's "a sub-agent never posts
a review" enforced rather than asked — and an in-memory transcript, because
its events go to the same log as the parent's, tagged with a thread id, as
they happen. `thread.created` when it starts, `thread.done` with its final
message when it ends, and every `model.message` and `tool.response` in
between, each written to SQLite before the next thing happens.

That last clause is the point. A parent turn that times out after its children
reported (findings #3; 109) loses nothing, because the reports were rows before
the parent knew about them. pi runs sibling tool calls concurrently by default,
so "spawn `tests`, `probes` and `smoke` together" still means together. A
parent abort aborts its children through the tool's signal, so the four facts
69 recorded about a wedged session are no longer facts: cancel ends everything
on the session, and a new turn supersedes cleanly. 108 stands: a sub-agent that
errors still reports an error thread and the rubric still respawns it once,
because the reason for the respawn (a provider error inside the child is the
child's) has not changed.

Rejected: **a pi subprocess per sub-agent** (the shipped `subagent/` example),
which isolates but hides the child's events behind stdout parsing.
**Flattening to one agent**, which changes the fold, the hard rules and the
board for a smaller harness.

## 125. The gate holds the call; a new turn voids it; a restart is answered by a re-call

The gate is pi's `beforeToolCall`. A call to a tool named in
`requireApprovalForTools` is held there: the harness writes a pending
approval, emits `tool.approval_required` on `main` with the call id and the
event id of the message that carried it, ends the current turn as `done` with
that event as its required action, and waits. The pi run is suspended inside
the hook, its arguments intact, with no deadline. The answer arrives as the
next turn's input, `user.tool_approval` with the same shape as before: allow
lets the call run, and its `tool.response` carries the original call id, which
is what the fold matches; deny returns the reason as the tool result, which is
what the model reads before it ends its turn. One send answers the approval
and starts the turn, as Contract 4 always said.

Two things change from TrueForge. There is no 422: a `user.message` on a
session with a pending approval does not refuse, it supersedes — the pending
row is marked so, the run is aborted, the held hook is released by the abort
signal, and the new turn starts. 39's stale-deny stays as a courtesy to the
model (the reason reaches it) but is no longer what unblocks the session.
And an approval that outlives the process is answered by a re-call: the row
is still pending, the suspended call is gone with the process, so the answer
opens the transcript, gives the dangling call a result that says what
happened, and starts a turn whose prompt tells the model the outcome and, on
allow, asks it to make the same call again; the gate lets that one through
once, and only with identical arguments. A call that never ran is not a side
effect to replay, so this is a message, not a replay engine.

Rejected: **persisting the suspended call and executing it without the
model** on allow, a second path the model never sees and a serializer for a
half-finished pi run. **Failing the run on restart**, which throws away a
review a human was about to approve.

## 126. A gated tool runs sequentially, so the observation posts before the pause

pi's default tool execution is parallel: every call in an assistant message is
preflighted, hook and all, before any executes. The rubric posts the
observation and the accusation in one message, advisory first. Under parallel
execution the gate would hold the batch before the advisory ran, and a deny
followed by a cancel would drop the advisory on the floor while the fold, which
records the review from the tool call and not the response, believed it
posted. That breaks the one invariant the two-call design exists for: the
observation always publishes.

So a tool named in `requireApprovalForTools` is registered with pi's
`executionMode: "sequential"`, which makes pi prepare, execute and record each
call in that batch before it preflights the next. The advisory has posted
before the gate is reached. The cost is that a gated call in the same message
as `create_sub_agent` calls would serialize those; the rubric never writes
that message.

## 127. Reasoning effort is clamped by the harness, not declared by the provider

56 existed because TrueForge refused a session whose reasoning effort the
provider manifest had not listed, and refused it with a 502 after boot. pi
clamps a thinking level against what the model declares (`xhigh` and `max`
fold to `high` unless the model maps them; a model with `reasoning: false`
gets none), so there is nothing to declare and nothing to refuse. The manifest
carries `reasoning`, `contextWindow` and `maxTokens` per model instead: pi
clamps the output cap against the window and, with both zero, would ask the
provider for one token. `MODEL_PROVIDER_REASONING_EFFORTS` goes; the seven
effort words are validated where they are read. Reverses 56; 53 stands (the
effort is still a deployment setting, still pinned at session creation).

## 128. MCP tools are exposed by name, and only exact names are gated

The harness bridges each MCP server's `listTools` into pi tools of the same
name, with the server's JSON Schema handed through verbatim: the model sees
`post_gated_review` and `sandbox_exec`, not TrueForge's `call_tool` meta-tool.
The fold already recognised both forms; the meta-tool branch goes with the
cutover. Only remote streamable-HTTP servers, as 113 already narrowed it to.

`requireApprovalForTools` is a list of exact tool names, and absent or empty
means none. There are no `@write` and `@destructive` classes, so 120's
workaround (`[]` because absent meant everything) is no longer a workaround;
the empty list means what it says. Refines 113; reverses 120's premise.

## 129. Compaction is pi's context-window rule

64 raised TrueForge's compaction threshold to 200,000 tokens and noted that
nothing said when a compaction happened. pi compacts when the context would
exceed the model's declared window less a reserve, and says so with an event
the harness logs (`harness.compaction.finished`). The threshold knob goes
(`CUJO_COMPACTION_THRESHOLD_TOKENS`); the spec's `compaction.enabled` stays,
on for the review session and off for the conversation one. Reverses 64.

## 130. A harness restart ends a running turn as an error, so Cujo retries it once

A turn that was running when the harness process died is ended at the next
boot with `turn.done { status: "error", message: "harness restarted" }`, not
as `cancelled`. The fold treats every cancel as final and Cujo's retry refuses
it; an error is the one outcome that lets Cujo start the turn over once. A
restart mid-review is then one lost attempt, not a lost review.

The same rule binds the way down. The first shutdown handler ended every live
turn as `client-cancelled` and, with it, marked its held approval superseded:
the first deploy over a held gate (orders-api #42) then answered the
operator's confirm with "approval is superseded", and the accusation could
never post. Shutdown now drops the pi sessions without bookkeeping and leaves
the rest to the next boot, so a running turn becomes the retryable error above
and a held approval stays pending for the re-call path (125).

## 131. A sensed command refuses to open a second window

`sniff.py run` and `sniff.py detonate` each hold the exclusive sensor lock for
the length of one command (decision 111's window). The first detonation on the
pi harness (orders-api #42) was `sniff.py run --check detonation -- timeout 90
python3 sniff.py detonate ...`: the model wrapped the one command that wraps
itself. The inner `detonate` waited on the lock the outer `run` held, for the
900 seconds the lock allows or until the `timeout` killed it; what came back
was the wrapper's report of a timeout, with no install and no egress, so the
malice rule had nothing to trip on and the run ended `blocked_unattended` on a
correctness reading of an unvetted dependency. The gate was never reached.

So a window-opening command run inside another's window now refuses at once,
on stderr, saying what to do instead. `run_sensed` marks its child with
`CUJO_SENSED_WINDOW`, and `run` and `detonate` exit on it before touching the
lock. The refusal is what makes decision 108's single respawn worth having: a
sub-agent that gets a sentence back gets the command right the second time,
where one that gets a timeout repeats it. The rubric says the same thing in
words, and the words alone were not enough for this model.

Rejected: **a re-entrant lock**, which would make the inner report a slice of
the outer window and both reports describe the same rows, the overlap the lock
exists to prevent. **Detecting the wrapper in `run`'s argv**, which catches
`sniff.py` by name and nothing that reaches it through a shell.


## 132. A token budget in the spec, enforced by the harness

An agent spec may carry `config.tokenBudget`. The harness sums the billed
tokens of every assistant message in the turn, sub-agents included, and after
each message ends the turn as `turn.done { status: "error", message: "token
budget exhausted: N of B" }` once the sum passes the budget. The metrics ride
on that error the way they ride on every finished state, so an exhausted turn
still says what it cost.

The number is billed tokens, which is what a provider charges for: the context
is re-read on every message and counted every time, so a turn holding a large
brief spends most of its budget on re-reading it. That is the honest unit for
a cap on spend, and it is the one the accumulator already had. The check runs
after a message, not during one, so a single message can overrun the budget;
none can follow it.

The harness enforces it rather than `apps/cujo`, because the client only sees
usage on the stream after the fact and cannot stop the model between two
calls; the harness is the one thing that stands between messages. Absent means
unlimited, which is what every spec written before this said.

Rejected: **`maxTokens` per response**, which bounds one reply and not the
turn. **`iterationLimit` alone**, which bounds messages and not context: a
hundred small messages and twelve messages over a huge brief cost the same
under it and nothing alike in tokens.

## 133. Cujo is a diff reviewer that can execute; the sandbox is a tool and a floor

Decision 11 said every pull request gets the full run: tests, probes, smoke,
detonation. That was the right claim for a product whose one idea was the
sandbox, and it is the wrong shape for a reviewer somebody uses on their own
repositories, where most pull requests are trusted, most have CI, and a
fifteen-minute run to re-run a suite that already ran is a cost with no reader.

Cujo is now a **diff reviewer that can execute**. The diff review is the
default a repository may choose: it reads the pull request against the
repository's own written standards on a cheap model, with no sandbox and a
token budget, and posts one advisory review. The sandbox review is what it
was, and it is where the rules send any pull request that needs running — a
dependency change, a pull request nobody wrote — whatever the repository
chose. Later slices make the sandbox a tool the reading reaches for (a probe
to settle a claim the reading could not) rather than a separate review; this
one gives the reading a path of its own.

What does not change: the sandbox review's design, the hard rules, the gate,
the trust boundary. A diff run is a run in which the bridge is never opened.

Rejected: **the sandbox review with a "skip the checks" switch**, which would
keep a fifteen-minute session, a sandbox spec and 150 iterations for a review
that is one reading and one post. **A separate service**, since the diff review
is the same webhook, the same run record, the same review tool and the same
board; only the turn differs.

## 134. The diff review's package is prepared in code

Decision 71 made setup one command because none of it is a decision. The diff
review's reading has the same shape: which files changed, what their hunks
are, which of them fit under a cap and in what order, what the repository's
standards files say, and what the last review on this pull request already
said. None of that is judgment, and every other reviewer that does it well
does it in code — ranking and compressing the diff, running static tools first,
carrying repo memory — so that the model's whole spend is on the judgment.

So `apps/cujo` prepares a **package** (Contract 11) on the trusted side and
hands it to the model as the turn's one message. The model never lists files,
never fetches a patch and never opens a standards file. Three consequences the
design leans on: the cost of a review is bounded by the package's caps rather
than by what the model decides to look at; the model's session needs no tool
but the review tool, which is what makes decision 137's session safe; and what
the model did not read is a list in the package rather than a thing it forgot,
the way a sensor report says what it could not observe (decision 54).

The standards files are `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and
`.github/copilot-instructions.md`, read at **base**: what a pull request may be
held to is decided by the branch it targets, which is decision 13's argument
for `.cujo.yml` and holds for the same reason. A read that fails ends the run
rather than reviewing against nothing, since "no standards" and "GitHub did not
answer" are different facts.

Rejected: **giving the diff session a read tool**, which is the sandbox review's
shape with a smaller box and the same unbounded spend. **Sending the whole diff
and letting compaction cope**, which is what decision 129 does for the sandbox
review and is wrong here: compaction summarises away exactly the hunks a
finding would anchor to.

## 135. Review mode: deploy default, `.cujo.yml` from base, floors the code enforces

Which review a pull request gets is a setting with two layers and two floors,
resolved in `startRun` once the pull request has been read and recorded on the
run as `mode`.

The layers: `CUJO_REVIEW_MODE` is the instance's answer when a repository gives
none, and it defaults to `sandbox` so an existing deploy reviews exactly as it
did; `mode:` in `.cujo.yml` overrides it. The file is read at the pull
request's **base SHA** — a commit and not the default branch, unlike
`discord_guild`, because a push to the target branch between the webhook and
this read must not change the answer, and policy is what the pull request was
opened against (decision 13). It is matched by the same strict line rule, so a
typo is no declaration and never costs a review.

The floors override both layers and are code: a changed dependency manifest is
`sandbox`, and a Bot author is `sandbox`. The declaration is text a repository
owner controls, which is enough to let it pick the cheaper review; it is not
enough to let it skip the one review that watches an install, because the pull
request that adds a hostile dependency is exactly the one whose owner may have
been talked into `diff`, and a pull request nobody wrote (Dependabot, Renovate,
a coding agent) is one nobody read. The floors do not read the pull request
and cannot be argued with, which is decision 9's split applied to entry.

`mode` is published on both planes, the list included: a `clean` that read the
diff and a `clean` that ran it are different claims, and a list row shows only
the status. The run page, the record row and the Discord card each say so in
their own place. No new run status: `clean` and `error` are what a diff run
reaches, and `unproven` is never reached, because the fold reads a diff run
under a ladder with no rung for evidence that was never expected.

Rejected: **a per-run `.cujo.yml` read by the agent in the sandbox**, since
there is no sandbox on the path that needs the answer. **Letting the model
decide**, which a later slice does within these floors and never past them.
**Reading the default branch**, for the race above.

## 136. A diff finding is at most `warn` and always advisory; a `critical` is a contradiction, not clamped

A diff review is opinion. A `critical` blocks a merge, and a block needs
evidence a reader cannot produce: a test that passes on base and fails on head,
an endpoint that errors, an install that phoned home. The sandbox review
produces those (decision 9); the diff review cannot, so its rubric offers
`info` and `warn` only and permits `post_advisory_review` alone. Where reading
convinces the model the change is broken, that is a `warn` whose `detail` says
what would prove it — and the later probe slice is what proves it.

The fold enforces the rubric the one way it can, after the fact. A
`post_blocking_review` or `post_gated_review` from a diff run, or a `critical`
on its advisory, ends the run `error` naming the tool or the finding. Not
clamped to `warn` on the board and called `clean`: the review is already on the
pull request under the bot's name by the time the fold sees it, and decision 74
says the board must not describe a finding differently from the pull request.
An `error` row for a review that is fine on the pull request is the cost, and
it is the same cost the sandbox ladder already pays for the same mistake
(Contract 3), so the two reviews agree on what disobedience looks like.

Rejected: **clamping**, for decision 74. **Gating the two other tools on the
diff session**, which would hold a call the rubric forbids for a human to
answer, and there is nothing to answer.

## 137. A diff run gets its own harness session

Decision 16 keys a session to a pull request so the agent can see what it said
before, and pins a session to the spec it was created with. The diff review
cannot share that session: its spec has no sandbox server, a different rubric
and a token budget, and a session is one spec. So each diff run creates a
fresh session on the diff spec, records it on the run before the turn starts,
and its memory of the pull request is the previous review's findings in the
package (Contract 11) rather than the transcript.

That is the better memory. The outage findings tied a session holding four
turns to checks thirty times slower than the same checks on a fresh one, and a
reader's brief that grows with every push is a brief whose cost grows with
every push. Three hundred tokens of "what was said last time" does what the
transcript did.

Accepted: the per-PR session row is still claimed at the webhook, before the
pull request is read, because `session_id` is not nullable and the mode is not
known yet. On a repository that only ever reads, that is one idle harness
session per pull request — a row, not a pi session, since the harness opens
nothing until a turn. Moving the claim after the read is a larger change to
the webhook path than this slice wants, and the row costs nothing.

Rejected: **one diff session per pull request**, which is decision 16's
mechanism with the same weight problem and a second table. **Reusing the
sandbox session with the sandbox spec**, which hands a reading session a box.

## 138. The block is a check run, and the human decision is the unlock

The gate held the wrong thing. Since decision 6 a `critical` that named a
change as malicious paused the turn with the accusation drafted, and a person
with write access answered `/cujo confirm` or `/cujo dismiss` on the pull
request. Three facts, each visible in the design once it ran for real, say the
hold delayed the guard instead of providing it. The observation posted before
the pause (decision 126), so the pull request already carried the host, the
path and the time; the confirmer read those same words and typed `confirm`
with nothing added. A REQUEST_CHANGES review is dismissable by anyone with
write access — which, on a repository where a coding agent holds write, is the
agent — so the thing the confirmation released was not a lock. And the
product's claim since decision 133 is a reviewer that blocks on evidence a
reader cannot produce; a block that waits for a reader is that claim
withdrawn.

What a guard against coding agents needs is the opposite shape: a block that
posts at once, a lock the agent cannot remove, and an unlock only a person can
give. So:

- **Every review posts.** Two tools on `github-mcp`: `post_advisory_review`
  and `post_blocking_review`, one call per run, neither held.
  `post_gated_review`, `accusation_follows` and the `held` finding key are
  gone, and the machine block is `schema_version` 2 because a key was removed.
  A malice finding is a `critical` like a failing test: the review states the
  measurement, and the merge is held.
- **The lock is a check run.** `apps/cujo` writes `cujo/guard` on every
  commit it reviews and moves it with the run's status, a projector beside the
  reaction (decision 38) on the same status changes. A check run cannot be
  dismissed; only the App that owns it completes it. Where branch protection
  requires `cujo/guard`, a `blocked` run holds the merge and nothing a write
  principal can do on the pull request lifts it. It needs `checks: write`,
  which every installation approves once.
- **The unlock is `/cujo dismiss`**, and it is human-only: repo write or
  admin, not the author (decision 44), and not a Bot account whatever its
  access — the `user.type` on the payload decides that before a read is
  spent. It dismisses the bot's own REQUEST_CHANGES review naming the person,
  turns the check neutral titled *Dismissed by @login*, and moves the run to
  `dismissed` with `approver` set. The findings stay; only the block lifts.
  `/cujo confirm` no longer exists, since there is nothing left to release.
- **The harness keeps the gate.** `requireApprovalForTools`, the
  `beforeToolCall` hold and `user.tool_approval` (decisions 125, 126, 128)
  stay as a capability no spec names. A session pinned to an older spec that
  still asks is folded as an `error` naming the call, not waited on and not
  retried (decision 130's retry excludes it), and `Harness.resume` is
  deleted from `apps/cujo` because nothing calls it.

The reversals. Decision 6 put the human gate on the block; there is no gate on
the block. Decision 42's second review and its `blocked_pending` are gone with
the hold. Decision 39 answered a superseded run's pending approval; nothing is
pending, so a superseded run — `blocked` included — is moved in the store and
emitted, which is what lets its ping, its reaction and its check hear that a
newer commit owns the pull request. Decision 60's maintainer prompt was the
text of a confirmation nobody gives. Decision 38 rejected a check run because
a write from `apps/cujo` that stated a finding would bypass the gate; the check
states a status and a login, never a finding, and the gate it would have
bypassed no longer exists.

The amendments are the places that named the gate: what Discord may not do
(23), the plane the decision lives on (28, 45, 57), the principal (44), the
same principal for `/cujo review` (63), the body the server owns (74), the ping
(86), the timed-out comment's count of held claims (109), the empty
`requireApprovalForTools` on both servers now (120), the retry (130), the
product claim (133) and the diff run's contradiction (136), which is now only
`post_blocking_review` from a diff run.

Accepted: **a block holds only where branch protection requires the check.**
Without that, a `blocked` run is a REQUEST_CHANGES review and a failed check,
both visible and neither holding — which is what the reviewer without a
check had all along. **Installations must re-approve once** for
`checks: write`; until they do the write fails with 403, is logged as
`check_run.failed`, and nothing else is affected. **A superseded run writes
`skipped` only while it is still the latest for its head**; on `/cujo review`
the new run owns the commit and writes its own.

Rejected: **the harness writing the check** through a third `github-mcp` tool,
which puts the lock on the agent's own path where the agent could omit the
call. **A dismissal from Discord**, for decision 23. **Letting the author
dismiss**, for decision 44. **Keeping `confirm` as a no-op alias**, which
would teach a verb that means nothing.

## 139. Seven run states; the gate's three are migrated

`blocked_pending`, `blocked_posted`, `blocked_unattended` and `denied` each
named a position in the hold decision 138 removed. The seven states are
`running`, `clean`, `unproven`, `blocked`, `dismissed`, `error` and
`superseded`, and old rows are moved rather than left under names the code no
longer knows:

| Old | New | Why |
|-----|-----|-----|
| `blocked_posted`, `blocked_unattended` | `blocked` | Both mean a REQUEST_CHANGES review is on the pull request; what differed was whether a person had been asked, and nobody is asked now. |
| `denied` | `dismissed` | A person with write access said the block should not stand. Same decision, same principal, same `approver` row. |
| `blocked_pending` | `error` | The accusation was held and never posted. Nothing on the pull request says it, no tool exists to post it now, and calling the row `blocked` would claim a lock that is not there. `error` is the honest name for a run that stopped short of its review. |

Migration 13 does it in one step: drop the `runs_head` partial index, rewrite
the statuses on `runs` and on `run_discord_messages.last_notified_status`,
rebuild the index over the new terminal list, and drop `run_cujo_turns`, which
tracked the resume turns `apps/cujo` had sent. The index is dropped first
because two old rows on one head could both become `blocked`, and both are
terminal, so the rebuilt index accepts them. Migration 10 interpolated the
terminal list from the constant; it is frozen to the literal it shipped with,
so a database opened from any older version sees the migration it saw then,
and a test holds it byte for byte.

`dismissed` is terminal and `blocked` is terminal: a block is a review already
on the pull request and a failed check, with no turn to follow, and the one
thing that moves it is a dismissal from outside the fold. `isTerminal` is
therefore `status !== "running"`, and the polling, the stale deny and the
session heal that existed to keep a held turn alive across restarts go with
the state that needed them.

Rejected: **leaving old rows as they were**, which every status map — the
card, the reaction, the check, the board — would have had to carry a default
for. **`blocked_pending` → `blocked`**, for the reason in the table.

## 140. A review is what posted, not what was called

The fold recorded a review from the model's tool call, read off
`model.message` before the tool ran. That was a fair reading while both
review tools posted the moment they were called; it stopped being one the
day GitHub said no. On orders-api #44 — a pull request the App itself had
opened, so a REQUEST_CHANGES from the App was a review of its own change —
GitHub answered 422 to every `post_blocking_review`, the agent tried once
more with an empty "Probe run." payload, and the run ended `blocked`: the
`cujo/guard` check failed on the head, the reaction went to 👎, and the pull
request carried no review at all. Before decision 138 that was a wrong board
row. After it, it is a held merge with nothing on the pull request to explain
it, which is the one shape the block must never take.

So the review is recorded from the call's `tool.response`, and only when that
response is not an error. The call is parsed as before and held by its id;
the response either promotes it to `review` or leaves `review` null and the
refusal in hand. A turn that ends with a refused post and no later success
ends `error` — `review post failed: <tool> — <first line of the refusal>` —
which the check run writes as `neutral`, the reaction as 😕 and the card as an
error, all of which are true: nothing was posted and the run did not reach
its verdict. Not `blocked`, for the reason above; not `clean`, which is the
same lie in the other direction. A later call in the same turn that GitHub
accepts records its review and the earlier refusal no longer matters, which
is what a model that retries deserves.

The retry (decision 130) does not run for it. A refusal is a property of the
head and the account, not of the turn: the same call from a fresh sandbox
gets the same 422, and a second run would be a second sandbox for one line
of text the first run already has. So `retryTurn` excludes the error by its
prefix, next to the token budget (132) and the held call (138).

Amends 21: re-deriving the verdict in `apps/cujo` now reads the response as
well as the call, because the call alone does not say what the pull request
carries. Amends 130: one more error class the retry leaves alone.

Accepted: **a call with no response at all** — a turn that died mid-call —
records no review and ends `error` as before, "turn ended without a review",
and that one the retry does take, since a dead turn is exactly what decision
130 is for. **The contract tests changed meaning**: against a github-mcp
with placeholder credentials the real tool fails, which used to fold to a
review that "still lands" and now folds to the refusal. That is the point.

Rejected: **recording the refusal on the projection** as its own field, which
would have widened the public run row for a sentence the `error` column
already carries. **Retrying with a fresh turn**, above. **Treating the
duplicate answer as a failure**: `github-mcp` answers a second call for the
same head with the review already there, as a normal result, and that is a
posted review.

## 141. The run keeps a token ledger per thread

On 2026-09-13 the instance spent $0.93 on sixteen runs, and the board could
say only two things about where: the run's total, from the harness's turn
metrics, and each check's share, summed from its own thread's messages. The
difference between them — the parent's cost — was 50 to 75% of every sandbox
run's input, and nothing named it. The parent holds the rubric, the brief and
every report, and a model bills its whole context on every message, so the
parent is the expensive thread by construction; but "by construction" is not a
number, and the tool results that made its context large were not listed
anywhere. A run cannot be made cheaper on purpose from that.

So the fold keeps a ledger on the projection: one row per thread in the order
threads appeared, the parent titled `main`, each summed from the `usage` on
its own `model.message` events and carrying the byte size of every tool
result it received; and the ten largest tool results on the run, by bytes,
with the receiving thread's title, the tool's name and whether it was an
error. Bytes and not tokens, because the harness has no per-call token count
and a result's size is what the next message's input carries. Titles and not
thread ids, because the public plane serves this and a harness handle is
withheld there (decision 34): the fold keys its rows by id in a map it does
not store, so no id ever sits beside a title. A result is measured and never
copied.

Two corrections ride along. `usage.messages` on the run total read zero on
every run page, because turn metrics carry no count and nothing else
incremented it; it is now every message on every thread, counted as they
arrive. And the per-check sum ignored `reasoningTokens` on a message; it now
carries them when a message reports them, absent otherwise (decision 54's
rule).

Accepted: the ledger fills late and in a jump, like `usage` — the streamed
message is a stub and the counts land with the persisted copy — and a
projection stored before the field rehydrates without it, so the key is
always present and null there. Rejected: **putting the parent's sum on
`usage`**, which is a different producer with a different meaning (the
harness's total, summed over turns); **per-call token counts**, which the
contract does not carry and the provider does not give.

## 142. Exec output is bounded at the tool, and the rest stays in the box

A tool result is context the model re-reads on every message after it. A
`pytest -v` over a hundred tests, a verbose install, or a fetch retried with
its progress printed each land whole in a sub-agent's context, and the
sub-agent's next ten messages each pay for them again. `sandbox_exec`
returned each stream up to the 8 MB the docker call would buffer, and the
rubric's only advice was that there is no shell to pipe through.

So `sandbox_exec` bounds each stream at 32 KB. Above that it returns the
first 8 KB and the last 24 KB — a command's opening lines say what ran and
its closing lines say how it ended — around a marker that gives the total
size and names the file in the box that holds all of it; the whole stream is
written there through the runtime's own `writeFile`, which streams over
stdin and lands on no host filesystem. Reading the middle is then a choice
made with `sandbox_read_file`, bounded by `max_bytes` as every read is. A
write that fails still clips: the marker says the rest was not kept, and the
model gets a bounded result either way.

The size is set by what must survive. `sniff.py run` already caps a wrapped
command's output at 4000 characters per stream, and what it prints is one
JSON line — the report, the sensor block, the escaped tails — that the
sub-agent must copy verbatim into its final message. Those lines run past 10
KB, and a cap that cut one in the middle would cut the evidence. 32 KB is
above any report the sensors produce and below any output worth carrying
whole; the ledger (decision 141) is what says whether the reports themselves
are the cost, which this bound does not touch.

Rejected: **a `max_bytes` argument on the call**, which exists on
`sandbox_read_file` and which the model does not remember to pass; **the tail
alone**, which loses the line that says which tool and version ran;
**capping inside `sniff.py`**, which already does its part and cannot see a
command run outside it.

## 143. A timeout is an answer, not a failure

Decision 108 respawns a sub-agent once when it comes back with an error
instead of a report, because a provider fault mid-check is the one failure
the parent can undo. The rubric said "an error instead of a report", and the
model read a report that recorded an error as one. On orders-api #42 the
added dependency was a `git+` URL whose fetch hangs by design; `detonation`
timed out, reported the timeout, and was spawned again to time out again —
two attempts of 130k to 230k input tokens each, on two runs, for one line of
evidence the first attempt already had.

A report is an answer, whatever it says. A command that timed out, an install
that hung, a fetch that never finished: each is a measurement, recorded as a
coverage gap (decision 54), and a second attempt at a thing that hangs by
design buys a second wait and the same gap. The rubric now says so beside the
respawn rule: respawn only the sub-agent that returned no report at all.
Nothing in `apps/cujo` changes — the fold records attempts as before, and
nothing on the trusted side ever respawned anything.

Amends 108: its rule stands for the case it was written for, the sub-agent
that died; it never meant the sub-agent that reported a death.

## 144. A push burst is one run

Three of the six runs orders-api #42 got on 2026-09-13 were cancelled by the
push after them, and each had already spent its setup and most of a check:
860k input tokens on the largest, for a review nobody saw. A push claims a
run at the delivery (decision 16) and the run started at once; the next push
superseded it wherever it was.

The row is still claimed at the delivery — that is what makes a redelivery a
no-op and gives the audit trail its head — but the start now waits out a
window, one minute by default, and a newer push on the same pull request
inside the window drops the older pending start. The run that does start
supersedes the rows the dropped ones left behind, through the same loop that
supersedes live runs, so nothing new is needed to keep the store honest. The
reaction and the check run land at the start rather than the delivery, so a
burst shows one eye on its last head; an `opened` or `ready_for_review` has
nothing to wait for and starts at once. On shutdown, pending starts fire at
once: a row left `running` with no turn is an error on the next boot, which
is the window a claimed-but-unstarted run always had, and one that got its
turn is followed there.

A minute, because that is the shape of a burst: a fix, a lint fix, a rebase.
Longer delays every review by that much for the common single push; shorter
misses the second commit. `CUJO_PUSH_DEBOUNCE_MS` moves it, and `0` restores
a start per push.

Rejected: **provisioning the sandbox from `apps/cujo` before the agent
starts**, so a supersede in the first minute would cost a container and no
tokens — it adds a crossing the architecture forbids (the agent reaches a box
only through the five `sandbox-mcp` tools, and `apps/cujo` has no MCP
client), for a saving the window already gets. **Not claiming the row until
the window closes**, which would make a redelivery inside the window a
second run. **Cancelling the pending start on shutdown**, which loses a
review the next boot could have followed.

## 145. A pinned specifier is detonated once per instance per week

`evil-package` was detonated six times on 2026-09-13, for one specifier, on
one pull request, each time from a fresh environment behind the proxy — and
`detonation` is the slowest check by a distance, at 130k to 230k input
tokens and up to five minutes an attempt. An install is a function of the
thing installed: the same registry version or the same git commit does the
same thing on Tuesday as it did on Monday, on this repository as on that
one. What was not a function of the thing installed was the reviewer.

So an instance keeps one detonation entry per exact specifier for a week.
**Exact** means the specifier names one immutable thing: `name==X`,
`name@X`, `module@vX.Y.Z`, `name:X`, or `git+url@<40-hex commit>`. A range, a
tag, a branch, `latest` or a bare name may resolve to something else
tomorrow and is never cached. The key is `(source, normalised specifier)`
and not what the install resolved to: the specifier needs no resolution to
be exact, and `resolved` is best-effort text read off an installer's output,
recorded on the entry for the reader and left out of the key on purpose.

The lookup is on the trusted side, before the turn starts, off the manifest
hunks the pull request read already carries — no new GitHub call, and a
parser narrow enough to read only the simple line-added cases of five
ecosystems. A hit rides the brief as `detonation_cached`. Inside the box the
parent writes that array verbatim to one file and the sub-agent runs
`sniff.py detonate --cached` for each listed specifier, which records the
earlier entry through `record_run` marked `cached_from_run`; it installs
nothing, and a specifier the file lacks exits non-zero with nothing recorded.
Through `record_run` and not through a model placing an entry in `runs[]`,
because decision 112 was about exactly that and stands.

The write-back is the selective half. When a `detonation` check finishes,
`apps/cujo` stores an entry only when the install succeeded under an
exclusive sensor window, no hard rule tripped (`wrote_sensitive`, `egress_to_unknown_host`, a decoy read — not `wrote_outside_workspace`, which every pip install trips on its own cache, nor `spawned_subprocess`, which is the installer itself),
the specifier is exact, the entry is not itself a copy, and every host the
install reached is on the sensors' own index list (`KNOWN_INDEX_HOSTS`,
mirrored on the trusted side and held to it by a test). The last rule is
what lets the cache be per instance rather than per repository: `known` on
an egress row is judged against the source repository's `allow_hosts`, and
an entry that reached a host one repository allowed would otherwise say
"known" in a repository that did not. An entry that reached only the
registries says the same thing everywhere.

`run_id` on a cached entry is the producing run's id when that run is
public and null otherwise (decision 36): a private run's id names a page a
stranger cannot open, and the brief reaches a stranger's pull request. The
board marks a copied entry `cached`, with the run id as text.

Accepted: **the blob crosses the model twice** — the parent reads it in the
brief and writes it to the file — which the ledger (141) will price against
an install; **a registry-side takedown is unseen for a week**, and a
compromised version that was clean when detonated stays clean in the cache
until the TTL; **the rubric reaches new pull requests only** (16), and a
session on the old rubric detonates as before while the trusted side writes
the same entry back; **no sweeper** — the TTL is enforced on read and the
table grows one row per unique pin.

Rejected: **keying on `resolved`**, best-effort text whose absence would
mean no cache at all; **a per-repository key**, which removes most of the
hits and is the fallback if the index-host rule proves too strict; **caching
failed installs**, which are a coverage gap and not a measurement of the
thing; **a cache the sub-agent queries itself**, which would put a store
read inside the box.

## 146. A report lists what the rules read, and a spawned check owes one

Every successful detonation on the pi harness ended with `report: null`. The
sub-agent had done its work — the install ran, the sensors saw it, `sniff.py
report` printed the envelope — and then copied the envelope into its final
message as decision 112 asks, and stopped at the model's output limit with
the JSON half written: 16,837 output tokens on orders-api #46, 26,209 on #42.
The envelope was that large because `fs_changes` listed every file a fresh
environment plus a pip install creates, a few thousand rows, uncapped. And
nothing said so: `check_missing` was owed only by `tests`, `probes` and
`smoke`, so a detonation with no report was a run that read `clean` on the
strength of the parent's own sentence about it, with the malice rules —
`decoy_read`, `egress_to_unknown_host` — never having read a thing. The
detonation cache (145) could not fill either; there was nothing to write.

Two rules. **`fs_changes` keeps what the rules read.** Every sensitive or
outside-workspace row stays whatever the count, the `derived` flags are
computed over the full list before the cut, and the benign in-workspace rows
are bounded at `MAX_FS_CHANGES`, the same 200 as `files_read`, with
`truncated.fs_changes` saying a cut happened. A cut can hide a path, never a
signal. **A spawned check owes a report.** `check_missing` fires for any
check thread that was created and ended without a report the fold could
parse, `detonation` included, with the evidence line naming the output
limit when that is what cut it. The three suite checks are owed whether or
not they were spawned, as before.

Accepted: a reader of a clean install sees two hundred of its files and a
flag, not all of them; the board's table says so. Rejected: **raising the
model's output limit**, which moves the cliff and keeps the cost of copying
thousands of rows through a model on every install; **reading the report
off the `sniff.py report` tool result instead of the model's message**,
which is the right shape and a larger change — the envelope would stop
crossing through the model at all — and belongs with the per-check rubric in
the next step, where the output tokens it saves can be measured.

## 147. The report is the tool result, not the model's copy of it

Decision 146 bounded the envelope and the next run showed the bound was not
the problem. orders-api #48's detonation sub-agent ran `sniff.py report`,
got 35 KB back, read the exec log for good measure (59 KB), and stopped at
its output limit at 16,990 tokens with the JSON half written: `report:
null` again. The envelope of a real install is 30 to 60 KB after every cap
— two hundred file rows, two hundred reads, the subprocess list, the tails —
and copying 60 KB through a model with a 16k output limit does not work,
whichever bound is raised.

Decision 112 already said the model must not assemble the envelope; it
still asked the model to carry it. It no longer does. The sub-agent runs
`sniff.py report` as its last command, and the fold reads the envelope off
the `sandbox_exec` result that carried it: a result with exit code 0 whose
stdout is one JSON object with `check` naming the thread's title and a
`runs` array. The final message is a few sentences for the parent, with no
JSON in it. `sandbox-mcp` hands back a stream that is one JSON object whole,
so the report crosses uncut (142's bound stays for everything else; sniff's
own caps are what bound a report).

This is the token change, not only the correctness one. The envelope used to
cross the model twice — once out of the sub-agent as output tokens, once
into the parent as the sub-agent's final message — and the parent then
re-read every check's envelope on each of its own messages. Now it crosses
into the sub-agent's context once, as a tool result, and the parent gets a
paragraph. On #45's shape that is four envelopes out of a 26k-token parent
context and ten thousand output tokens per check that are not spent.

Accepted: **the fold reads a tool result's `stdout`**, which is untrusted
data from the box and is parsed the way the message was, through the same
schema and the same rules; **a session on an older rubric** still pastes the
envelope and still folds, because the message is the fallback when no
report result exists; **a sub-agent that runs `sniff.py report` twice**
reported the second time.

Rejected: **raising the model's output limit** (146 said why); **`sniff.py
report` printing a pointer to a file** the fold cannot read; **the parent
reading each check's file** through `sandbox_read_file`, which puts the
envelope in the parent's context again and asks the parent to carry it into
its review call.

## 148. A cached detonation never crosses the model

Decision 145 accepted that a cached entry "crosses the model twice" and
said the ledger would price it. It did, on the first replay: orders-api #50
reused #49's `tabulate==0.9.0` entry and billed 856k tokens against #49's
679k. The 43 KB entry sat in the brief through all twenty-one of the
parent's messages and was written back into the box by the parent's own
hand; the install it saved had cost 79k. The cache was a net loss of about
180k tokens per hit, and the only thing it saved was twelve seconds.

So the entry stays on the trusted side. The brief names a cached specifier
by `dependency`, `source`, `cached_at` and, for a public source run,
`run_id` — a hundred bytes. The run keeps the entries it was briefed with in
`run_detonation_cache`, written at the lookup and read at every fold of
that run, so a live fold, a refold and a rehydrate substitute the same
thing. Inside the box the sub-agent runs `sniff.py detonate --cached` for a
listed specifier, which records a stub — the key and a mark, nothing a rule
reads — and installs nothing. When the fold reads the detonation report it
puts the kept entry in each stub's place, marked `cached_from_run` and
`cached_at`, before the schema or a hard rule sees it. The evidence the
rules read is the earlier run's whole entry; the model carried a line.

Accepted: **a stub the fold cannot substitute** — a specifier the brief
never listed and the model marked cached on its own — stays a stub, fails
the schema as `report_invalid`, and nothing from that report is written
back; **the entries a run was briefed with are what it reads back**, even
if the cache row was refreshed by another run meanwhile, because that is
what this run was told; **`sniff.py detonate --cached` is a flag now**, not
a path, and the file the parent used to write does not exist.

Amends 145: the "crosses the model twice" cost is withdrawn, and the
`--cached PATH` mechanism with it. Rejected: **the sub-agent reading the
entry from a file the parent wrote**, which is 145's design and the cost
above; **the parent carrying the entry only into the brief and not the
box**, which halves the cost and keeps the wrong half.

## 149. Open Code Review runs beside a review and posts nothing

The question behind the measurement week is whether Cujo's own diff review
earns its tokens against an off-the-shelf reader. Alibaba's Open Code Review
(`ocr`, Apache-2.0, a Go binary, v1.12.0) is that reader: deterministic file
selection and bundling, a fixed rule set, one model call per bundle, a JSON
envelope with `--format json --audience agent`. Its v1.12.0 source was read
before this was written. Its tools are `file_read` over `git show`,
`file_find` over `git ls-files`, `code_search` over `git grep`, a diff reader
over an in-memory map, and the two that record a comment and end the loop.
No shell, no execution of repository code, no HTTP beyond the model call and
MCP servers named in the user's own config, which this deploy does not set.
Telemetry is off unless `OCR_ENABLE_TELEMETRY` says otherwise.

So `ocr` runs beside every run, on the same pull request, and what it says is
kept per run in `run_ocr_reviews` and posted nowhere. A second reviewer on the
pull request would double the noise the week is measuring; a stored envelope
is compared by hand against the review that was posted and against the fold's
findings, and the comparison decides whether diff mode stays. It runs on the
same model as `CUJO_DIFF_MODEL`, so the comparison is of the tool and not of
the model.

It is a service of its own, `apps/ocr-sidecar`, and not part of `apps/cujo`
or of the sandbox. `apps/cujo` has no git, spawns nothing, and runs on a
read-only rootfs with every capability dropped; the diff review deliberately
reads the diff from the GitHub API and never clones on the trusted side
(decision 134). `ocr` needs a checkout and a model key. A checkout with a key
beside it cannot go in the sandbox — no credential crosses that line — so it
goes in a trusted container like `github-mcp`: git and one pinned binary, a
tmpfs, one route, one review at a time, and the same clone-URL refusals
`sniff.py prepare` makes. It holds no GitHub credential; public repositories
clone without one, and private repositories are a non-goal.

One thing `ocr` does that a trusted service must not let a pull request do:
it reads `.opencodereview/rule.json` from the repository it reviews, and
`--rule` adds a layer above that file rather than replacing it. That is text
out of a pull request steering a trusted model. The sidecar deletes the
directory from the checkout before `ocr` runs; the diff is taken from the two
refs and does not notice.

Accepted: **a second model key**, `OCR_LLM_TOKEN`, held only by the sidecar;
**a stored envelope nothing in the process reads**, which is the point — the
week reads it over SQL and the table is dropped or promoted with the result;
**`apps/cujo` calls it fire-and-forget** from `startRun`, before the mode is
resolved so both reviews get a shadow, and never waits — a sidecar that is
down, busy or slow is an error row and a warning line, and the posted review
is byte-identical with or without it; **binary and checksum pinned** in the
Dockerfile, both architectures.

Rejected: **`ocr` inside the sandbox**, where the model key would cross the
trust boundary; **`ocr` inside `apps/cujo`**, which would give that image git,
a subprocess and a writable path it has never had; **OCR's own GitHub
Action**, which reviews a different diff base and leaves nothing to join to a
run; **posting under the review from day one**, which is what the week is
deciding.

Amended the same day: the call is a start and then polls, not one request.
Node's fetch stops waiting for response headers after five minutes whatever
the caller's signal says, and the first shadow reviews that ran longer came
back to `apps/cujo` as `fetch failed` while the sidecar was still working
(orders-api #43, 300 s, and the next run refused as `busy` behind it).
`POST /review` answers 202 with an id at once; `GET /review/:id` says
`running` or `done` with the outcome, kept for an hour. The one-at-a-time rule
and the 429 stay.

## 150. `/cujo review` starts a fresh session

Decision 63 made `/cujo review` re-review the current head on the pull
request's own session, the one every push turns on. That session carries the
history, and the history carries the review the model already posted for
this head. On 2026-09-14, `/cujo review` on orders-api #45 produced one
message and no review: the model read its earlier advisory review of the
same commit in its context, said posting again "would duplicate the
evidence already on the PR", and ended the turn. The run recorded `turn
ended without a review`; the ledger shows 451 tokens in and 326 out, no
sandbox, no check. The command's whole point is a second look, and the
session made the second look impossible.

So `/cujo review` creates a session and makes it the pull request's, after
the head's live turn, if any, has been superseded. The next push turns on
the new session, whose history is the re-review. `putSession` stays
first-writer-wins for the webhook, where two deliveries racing for one pull
request must agree; `replaceSession` is this command's and nobody else's.

Accepted: **the old session is abandoned on the harness**, a row and a
transcript nobody reads again; **a re-review has no memory of the pull
request's earlier heads**, which is what a clean look is. Rejected: **a
line in the brief telling the model this is a re-review**, which asks a model
to ignore what it can see; **deleting the old session on the harness**,
which decision 104 already argued against for runs and which holds here.

## 151. A repository registry, fed by the installation events

Cujo learned which repositories it reviews only from deliveries about pull
requests. There was no table of them: the public board listed repositories
that had a run, the Discord autocomplete asked GitHub for the App's
installations on each keystroke and cached the answer, and nothing could say
"this one, not that one". Track 10 makes Cujo something an owner manages,
and the first thing an owner manages is which repositories it works on.

So there is a `repositories` table, keyed by the lowercased `owner/name`
every other table uses, holding the installation it came from, its
visibility, the owner's `enabled` flag, and when the App gained and lost it.
Two sources fill it. The fast path is GitHub's own `installation` and
`installation_repositories` webhooks, which every App receives without a
subscription or a permission: `created`, `unsuspend` and `added` upsert the
repositories they list, `deleted`, `suspend` and `removed` flag them. The
reconciler behind it, `review/registry.service.ts`, lists the App's
installations at boot and every six hours and brings the table into line, for
the delivery that never arrived and for the first boot of a deploy, when the
table is empty. Both sources are the same shape the visibility service and
the `repository` webhook already are (decision 34).

`enabled` means no work at all. A disabled repository's `pull_request`,
`issue_comment` and `pull_request_review_comment` deliveries are answered 200
and logged at `info` with `reason: "disabled"`, beside `draft` and the skip
label, because it is the same kind of fact: a person chose this, and the
audit trail should say so where "why was this never reviewed?" is asked. The
gate sits in the ingress and not in the store or the run, so a disabled
repository claims no session, no run row and no harness turn. Nothing sets
the flag yet except the store itself; the authenticated plane that will is
the next slice.

Accepted: **a removed row is kept**, flagged with `removed_at`, so that
`enabled` survives the App losing and regaining a repository and a reinstall
does not quietly turn review back on; **an unknown repository is not
disabled** — a delivery can beat the boot sync, and "never heard of it" must
not read as "told to ignore it"; **the Discord autocomplete keeps its own
scan** for now, and moves to the registry once the plane exists to edit it.

Rejected: **learning repositories from pull request deliveries alone**,
which is what existed and cannot list anything; **deleting a removed row**,
which loses the owner's flag; **an `installation` event as the only source**,
which leaves the table empty on every deploy that predates it.

## 152. The models and the provider live in the store, seeded once from the environment

Every setting was an environment variable read once at boot, and the model
provider was registered on the harness once at boot and never again
(decision 127). Changing a model meant editing Coolify and redeploying, and a
redeploy restarts the harness, which ends every review in flight as `harness
restarted` (seen on 2026-09-14, three times). Track 10 gives Cujo an owner
who changes things from the board; the things changed most, and at the
highest cost, are the model and the provider.

So eight keys move into a `settings` table — the review model and its
sampling (`model`, `modelReasoningEffort`, `modelTemperature`,
`modelMaxTokens`), the diff review's model and budget, the review mode
default, and the provider (name, base URL, key, models, context window,
output cap, reasoning) — and are read at use, not at boot. `Settings.open`
seeds each key the table lacks from the environment, marked `seed`, and
reads the rest from the table; after the first boot that knows a key, the
environment is ignored for it. The agent, diff and conversation specs are
built when a session is created, on the values of that moment, so a run
claimed after a change is stamped with the new model. A provider written
through `Settings.set` is registered on the harness at once, through the
same upsert bootstrap uses; the harness persists it and re-registers it
live, and the next turn resolves against it.

What stays in the environment is what a process needs before it has a
database, and what wires one process to another: the port, the database
path, the App identity, the webhook secret, the service URLs, the log level.
Timeouts, limits, Discord and the push window stay there too for now; they
move when a board page wants them, one slice at a time, with this table as
the home.

`loadConfig` still parses every one of the moved keys, because the
environment is the seed and every validator lives there; `Settings.set`
runs the same validators, so an owner's bad value reads exactly like an
operator's. Nothing calls `set` yet except tests; the authenticated plane
(slice b) is what will.

Accepted: **a stored row that no longer parses is replaced by the seed**,
with one `settings.invalid` line, rather than stopping the boot; **the
provider key rests in SQLite on the data volume**, the same host and the
same trust as the environment file it came from — encrypting it with a key
from the environment is a later decision, and not one this table
forecloses; **`rubricSha256` is still computed once at boot**, since the
fingerprint covers the instructions and not the model, and the rubric files
do not change at runtime.

Rejected: **a hot-reloaded `Config`**, which would keep the environment as
the source and leave the board nowhere to write; **moving every setting at
once**, which touches every subsystem's construction for no page that asks
for it yet; **validating settings with a new schema**, when the environment's
validators already say what a good value is.

## 153. The owner plane: GitHub sign-in on the App's own OAuth, any admin of the installation

Decision 57 deleted the operator plane and left `apps/cujo` with no
authenticated route at all, because the only write path had gone to the pull
request with the human gate. Track 10 brings a write path back: an owner who
turns a repository off (decision 151) or changes the model (decision 152)
needs somewhere to say so, and the board has had nowhere to put a change
since 57. The credential question was answered in 34 and stands: not an API
key, which makes everyone who holds it the same principal and has nowhere
safe to live in a browser. The principal is a GitHub login.

So a third route group, `/auth` and `/owner`, on the internal host beside
`/public`, reached only through `apps/web`'s proxy. Sign-in is GitHub's
OAuth web flow on the GitHub App's own client id and secret, so there is one
identity to manage and one settings page on GitHub. `apps/cujo` starts a
sign-in by minting a `state` it remembers for ten minutes; `apps/web` sends
the browser to GitHub; the callback comes back through `apps/web` to
`apps/cujo`, which consumes the state, trades the code for a user token,
asks who the token is and which installations they can see, and decides
whether they are an owner: the account itself for an installation on a user
account, an organisation admin for one on an organisation — any admin of
the installation, settled on 2026-09-15. The verdict and the login go on a
session that lives a week; the token is used for those three calls and
never stored. The session id is the browser's cookie, `HttpOnly` and
`SameSite=Lax`, stored hashed on this side so a copy of the database is not
a copy of every session. The proxy turns the cookie into a bearer on the
one prefix that reads one, and forwards the write verbs there and nowhere
else; the board itself still has no write route.

What the plane serves in this slice: who is signed in; the settings of
decision 152, read with the provider key masked and written validated as a
whole, so a bad second key leaves a good first one unapplied, and a masked
key sent back means "keep the one you have"; the registry of decision 151,
listed and switched. Every write logs the actor.

Accepted: **401 on the owner plane without a session**, which reverses one
half of 57's "404, not 401" — that rule said a 401 is a route somebody could
still reach with the right header, and now there is a right header by
design; outside `/public`, `/auth` and `/owner` the answer is still 404, and
with no client configured the two new prefixes are 404 too; **a signed-in
non-owner is 403**, told why, and can do nothing; **the owner verdict is
made at sign-in and held for the session**, so a person removed from the
organisation stays an owner for up to a week — the price of not storing a
token, and short enough; **no page yet**: the plane is exercised with the
proxy and a cookie until slice g draws it.

Rejected: **a separate OAuth App**, a second identity for the same product;
**storing the user token** to re-check the verdict, which puts a credential
in the store for a question a week's expiry answers well enough; **a shared
token or password**, for 34's reasons; **serving the plane on its own
hostname**, which 34 tried and 57 removed, and which the internal-name
proxy makes unnecessary.

## 154. The run page is an evidence log

The run page held the same facts three times in three shapes: the findings
grouped by check, every group shut (decision 93); the review as posted, with
its own table of what ran and the findings again in prose; and the reports,
every card shut. The measurement week's tally was read off this page, and
reading it meant opening every group and every card on every run, then
reconciling the review's copy of the findings with the list's. The page
answered "what is the worst thing here" at the top and made "what happened,
and what is the evidence" a sequence of clicks.

So below the timeline the page is now one column, the evidence log: what
happened in the order it happened, each entry beside its evidence. Setup,
then each check as it started, then the review, then the end. A check's
entry says when it started (measured from the turn's creation, the way the
timeline's lanes are), what it ran (each wrapped command with its exit and
duration), what the sensors saw (the alarms, worst first, and the count of
hosts reached), what it concluded (its findings, with their evidence), and
what it cost (tokens from the ledger). The review's entry is one line about
what was posted and the model's lede. The three sections it replaces are
deleted, with their stories.

The rule from decision 93 that nothing opens itself now holds for bulk and
not for facts. The evidence tables, the raw report, the `info` findings and
the composed review body fold, closed; a finding above `info`, the commands
and the sensor facts are on the page. A person deciding whether to lift a
block should not have to click to see the finding the block rests on, and
the composed body repeats the log, so it is the one thing that gains from
folding. The timeline's pick still opens one entry's tables and scrolls to
it.

Accepted: **the one memorable device is the gutter**, a time column and the
check's name beside a rule that runs the length of the log, on the same axis
the lanes above draw; **`hard_rule_hits` stays unrendered**, since every hit
is already in `findings` with `source: "hard_rule"`; **the review's "what
ran" table is gone**, because the log is that table with the evidence
attached; **the entry builder is a pure function** (`lib/run/log.ts`) and the
shape of the page is a unit test.

Rejected: **cards and dots**, the generic activity-timeline; **opening every
fold by default**, which is decision 85's page again; **keeping the three
sections and adding a fourth**, which is how the page got here.

## 155. Per-repository settings and instructions, the file winning

Per-repository policy was a two-key `.cujo.yml` read by regex — `mode` and
`discord_guild` — plus the commands the sandbox reads at base. Nothing an
owner wrote for one repository reached a review beyond the standards files
that happen to be there. Track 10's owner now has a plane to write on
(decision 153), and the first thing to write per repository is how it should
be reviewed.

Two things move. The review mode gains a board layer between the instance's
default and the repository's file: `deploy default < board < repository
file`, settled with the user on 2026-09-15. Commands stay the file's alone —
`install`, `test`, `boot`, `smoke`, `allow_hosts` are what the sandbox runs,
and a pull request must not be able to talk a box into anything the base
branch did not say. For every other key the file wins where it sets it and
the board is the fallback, so a repository stays self-describing and the
board fills what it leaves unsaid. The board shows all three layers and
which one the next run will use, so an owner reading it is not surprised by
a file they forgot.

And instructions: a text in the owner's words, what to weigh, what to leave
alone, which paths not to comment on, read by both reviews beside the
standards files. From `.cujo/REVIEW.md` at the pull request's base when the
repository carries one, else from the board, capped at the standards file
cap and cut on a line. It rides in both briefs as `instructions` with its
source, and both rubrics say what it may do: narrow and weigh, never switch
a hard rule off, never move a severity the evidence does not support. It is
text somebody wrote, and the rubrics' rule that repository text is data and
not instructions to the model still holds; this is the one channel where an
owner's text is meant to steer, within those limits.

Accepted: **`resolveMode` gains `board` and the reason `board`** in the
log and on the run page; **the instructions read happens only in a
composition that has the board's layer**, so every earlier test composes a
reader with no `readFile` and briefs as before; **an empty file or an empty
board text is no instructions**; **the file is read at base for the review
and at the default branch for the board's display**, which are the same
commit except when a pull request targets another branch.

Rejected: **the board winning over the file**, which would let a forgotten
board setting override what a repository says about itself; **editing the
file from the board by opening a pull request**, ruled out earlier and still
open (#162); **instructions in `.cujo.yml`**, a policy file the sandbox
parses by regex, where a paragraph of prose does not belong.

## 156. The owner's pages: repositories, one repository, and sign-in on the footer

The owner plane (decision 153) and the per-repository layer (decision 155)
existed as routes and nothing else; an owner exercised them with a cookie
and curl. The board is for anyone, and it has stayed that way; these are
the first pages that are for one person.

Two routes. `/repos` lists what the App holds — name, visibility, when it
was installed, the switch of decision 151 — with a lost repository dimmed
and dated rather than dropped, since its switch survives a reinstall.
`/repos/<owner>/<name>` shows how one repository is reviewed in the three
layers, says in a sentence which layer the next run will use and why, lets
the owner set the board's mode and instructions, shows a file that speaks
beside them read-only, and lists the repository's runs off the public list.
Both are server-rendered against the reader's session cookie, prefetched
into the query cache, and never indexed.

Sign-in lives on the footer's rule beside the manual and the theme control,
as a client component that asks the owner plane on mount: signed out is one
quiet button, signed in is the repositories link and a sign-out, and an
instance with no OAuth client configured draws nothing there at all. A
client component and not a server read in the layout, because a layout
that reads the cookie renders every page per request, and the manual is
meant to stay static and indexed (decision 98).

Accepted: **a signed-out or non-owner visitor gets an invitation, not a
404**, since saying who the page is for is more useful than pretending it
is not there and nothing on it is disclosed; **the pages draw the board's
values as the only editable ones**, with a file's value beside them, which
is the precedence of decision 155 made visible; **the sentences under each
control are pure functions with tests**, so what the page claims about the
layers is checked and not only drawn.

Rejected: **a server read of the session in the layout**; **a separate
sign-in page**, when a button and GitHub's own page are the whole flow;
**editing a file-set value from the board**, still open (#162).

## 157. The instance page, and the App as GitHub sees it

The settings of decision 152 lived in the store with a route to write them
and no page; a model change was still a curl. And what the App held on
GitHub — its permissions, where it was installed, whether its webhook was
reaching this process — was visible only on GitHub, which is where a missing
permission is discovered after the review it cost.

So `/instance`, for an owner: the review models and their sampling as one
form, the provider as another with its key masked and kept unless a new one
is typed, both saving through the owner plane and taking effect on the next
session; the App as GitHub sees it against what the reviews need, from three
reads on the App JWT cached for a minute — the App itself, its
installations, its last twenty webhook deliveries with the status this
process answered; and whether the process can take a run, the same answer
`/readyz` gives, asked again every few seconds. The permissions the reviews
need are the README's list, compared level by level, so a `checks: read`
where `write` is needed is said before the check run that fails for it.

Accepted: **the App's state is read through the reviewer's own client**,
which already held the App JWT path; **a delivery's tone is what this
process answered**, 2xx, 503 while the harness was not ready, or anything
else; **the health line names what the process is waiting on**, the store
or the harness, since those are the two things a run needs; **the settings
form sends the eight keys as one PATCH**, which the plane validates as a
whole (decision 153), so a bad value leaves nothing half-applied.

Rejected: **an instance page on the anonymous board**, which would publish
the provider's name and base URL to anyone; **reading GitHub on every
visit**, when nothing there changes by the second; **editing per-model
limits per model**, when a deploy registers one provider and, in practice,
one model (decision 127).

## 158. Private repositories: the trees are staged on the trusted side, and the box clones nothing

Private repositories were a non-goal (134, 149): the sandbox holds no
credential and never will, so a private pull request's brief carried a clone
URL the box could not use, and the run failed at `prepare`. Track 10 makes
Cujo a reviewer for one person's repositories, most of which are private.

So a private repository's trees go in as bytes. `apps/cujo` fetches GitHub's
archive of the base commit and of the head commit with the installation
token — a fork's head commit is served by the base repository, which keeps it
under `refs/pull/<n>/head` — and streams each to a staging route on
`sandbox-mcp` under a 32-hex ticket minted for the run. The brief carries
`staged: <ticket>` where a public repository's brief carries `clone_url`,
never both. The agent's `sandbox_create` with the ticket copies both trees
into the box it makes, through the same exec-stdin path `sandbox_write_file`
uses, and the entry is gone. `sniff.py prepare --staged /work/stage` adopts
them: each tree becomes a repository of one synthetic commit, and the rest
of `prepare` — policy from base, build files from head — runs as for a
clone. The token is used on the trusted side and dropped; the ticket buys one
copy into one box and reads nothing back; the box sees a tree, not a URL.

Accepted: **archives, not a clone**, because no trusted service had to gain
git for it and a tree is what the checks run — a build tool that asks git a
question gets a one-commit answer, which is said in the report as
`source: "staged"`; **the staging door on `sandbox-mcp`**, since it already
holds the box and the exec path, and a second service with the docker socket
would be a second thing to guard; **its own tmpfs**, so a private tree never
rests on the host's disk; **single use and thirty minutes**, so a ticket read
out of a transcript later buys nothing; **a per-tree cap** (256 MiB), which
is a refusal the run reports rather than a tmpfs that fills; **staging before
the turn**, so a failure costs no session; **the shadow review skips a
private repository** with a line, since the sidecar clones by URL and holds
no credential; **`daytona` refuses a ticket**, having no upload path.

Rejected: **a token in the box**, in any form — a signed archive URL is a
credential too; **a git bundle**, which needs git on the trusted side and
carries history the checks do not use; **the harness or the model fetching
the trees**, which would put the installation token where the model's
tool calls are; **`docker cp` from a staged file**, which the `writeFile`
comment already ruled out for landing bytes on the host.

The public plane still hides a private run; who may see one is the next
slice.

## 159. An owner sees every run, and a private run's page is the owner's

Decision 158 made a private repository's review run; nothing showed it. The
public plane hides a private run behind a 404 (34), which is right for a
stranger and wrong for the person whose repository it is, who had a check
run on the pull request pointing at a page that said not found.

So the owner plane serves runs: `GET /owner/runs`, `/owner/runs/:id` and
`/owner/runs/:id/events`, for a signed-in owner (153), with the `is_public`
filter left out and nothing else changed — the public plane's shapes and its
allowlisted serializer, so an owner reads no field the board could not, only
runs it could not. The stream is the public stream's code, extracted and
handed each plane's idea of "visible": for the board a run is visible while
its repository is public and closes when that flips; for an owner it is
visible while it exists. The owner plane holds its own stream limit of
twenty, sized for one person's tabs and not for the internet.

The web asks the public plane first, with no credential, for every run page
— which is what every reader gets — and on a 404 asks who is reading; an
owner's session is then sent to the owner plane, and a run it names renders
on the owner's stream through a proxy route that turns the cookie into the
bearer. Anyone else, and any run neither plane names, is the same 404 the
page always was, and the page never says which. A repository's page lists
the owner's runs, so a private repository's runs are on the board that
manages it.

Accepted: **one serializer for both planes**, so classifying a field for the
public plane (34) is still the one gate; **one query key per run whichever
plane answered**, so the stream writes into the same cache entry and the
page does not know or care; **the public plane first, always**, so the
owner plane is asked only when the board would not answer, and a public
run never depends on a session; **no per-installation scoping**, since an
owner is an admin of an installation of the App and already sees every
setting of the instance (153).

Rejected: **an `is_public` field on the run page** for the owner, which
would be the first field served to one reader and not another; **a link on
the pull request to the owner page**, since the check run's link is the run's
page and it is now the right page for whoever may see it; **the owner list
on the anonymous board**, which is where a private repository's name would
leak.

Follow-up, the same day: `runUrl` linked nothing for a private run (57),
which left the check run, the Discord card and the announcement pointing
at the board's root once the page existed. It now links every run; the
things that carry it are the repository's own — its pull request, its
check, its channel — and an owner follows it, while anyone else meets the
same 404. The review's own footer is unchanged: the brief carries a run id
only for a public run (36), since the agent's side cannot know who reads.

## 160. The front door is a landing, and the galaxy is at `/galaxy`

The site's front page was the board: a full-height chamber of public runs,
the readout rack, the record and the key (80 to 95). That was the product
when the board was the product. Track 10 makes Cujo a personal reviewer with
a manual (98), an install path and an owner's pages (153 to 159), and a
reader arriving at the root — from a search, a README, a review's footer —
was met by an instrument before anything said what it was for.

So the root is a landing: the name, one line, one paragraph, and two links.
For a visitor the links are the App on GitHub and the manual; for a
signed-in owner they are their repositories and the instance, with the
manual kept as a third. Under them, three short sections in the manual's
own prose kit: what lands on a pull request, what it will not do, where the
evidence is. Nothing on the page is live — no run, no count, no poll — and
the board is one link away at `/galaxy`, exactly as it was, with everything
80 to 95 made it. The corner mark goes home, which is now the landing, and
every "all runs" link on a run page or an error page goes to `/galaxy`.

Reversed, of 80 to 95: only that the board is the site's first thing and
that the chamber is pinned under the root. Kept: everything the board is,
and 98's "no site header" — the landing has a mark in the corner like every
page. Amended, of 98: the manual is no longer the one thing indexed; the
landing is too, for the same reason — it is ours, it quotes nobody, and it
is the page somebody deciding whether to install has to find — and
`robots.txt` allows `/$` and `/docs` and nothing under them.

Accepted: **one landing for everyone**, with the owner's pair in place of
the install link, because the page is the same page and only the next step
differs; **nothing live on it**, so the front door never waits on the API
and never shows a stranger's run as its first impression; **the manual's
style**, one bold element and the prose kit, so the front page and its
manual read as one thing; **the App's public page as the install link**,
which renders for a reader who is not signed in, where `/installations/new`
would bounce them through a login first.

Rejected: **the chamber as the landing's hero**, which is the front page
this replaces with a paragraph on top; **a header bar**, for the reasons
the layout's own comment gives; **sending an owner straight to `/repos`**,
since an owner is also the person who shares the landing's link; **a
recent-runs strip**, which would make the landing a second board; **a
sitemap**, until there are more than two indexed roots.

## 161. Declared commands run with no model; the parent judges

A sandbox review was a model doing a shell script's work. The parent read
`.cujo.yml` out of `sniff.py prepare`'s output inside the box, ran the
install, then spawned four sub-agents, three of which existed to wrap one
`sniff.py run` and hand back a report. Measured over the fixture (the
measurement week, track 6): the parent was half a run's tokens, `smoke` a
fifth, `probes` a sixth, `tests` a tenth; a sub-agent is a fresh context
carrying the whole rubric and every tool schema; and the 2026-09-10 incident
was three sub-agents rate-limited in under two seconds producing a review
with no evidence. Cost was not the reason to change it — a run is cents —
latency, predictability and honesty of coverage were.

So a repository that declares how to test itself gets a **judge run**. With
`.cujo.yml` at base parsed on the trusted side and carrying `test`,
`apps/cujo` calls `sandbox-mcp`'s tools itself: the box, `sniff.py prepare`
(clone or the staged trees of 158), `sniff.py setup` with the declared
`allow_hosts`, the declared `install` on each tree under `--check setup`,
the declared `test` on base then head under `--check tests`, each line as
`sh -c <line>` inside the box, and `sniff.py report` for the Contract 2
envelope. The `base`, `head` and `base_pass_head_fail` extras are read off
the two runs' output here, the way the sub-agent read them. The envelope is
kept in the store and seated in the projection as a check with no thread
before any event folds, so the hard rules read it exactly as they read a
sub-agent's; the box is handed to the parent, prepared, with its id and
the sensors' environment in the brief, and the parent — on its own spec,
`agent/JUDGE.md`, with its own digest — starts at judgment: it reads the
evidence, spawns `probes` by default and skips it only for a reason it
writes into coverage, spawns `smoke` and `detonation` as before until their
executors land, and posts. `apps/cujo` destroys the box when the turn ends,
when a run fails before its turn, and on supersede; a restart destroys the
boxes it still owes. A repository that declares no `test`, or whose file
does not parse, takes the **gather run**, `agent/SKILL.md`, unchanged.

Accepted: **`sh -c` for a declared line**, since the line is the
repository's own and the model passed the same string before; **the
suite's outcome read on the trusted side**, so the sensors' report shapes do
not change and `sniff.py report` still writes the envelope; **the fold's
door as `FoldOptions.executed`** beside the cached detonations, so rehydrate
is still a pure replay of the store; **probes on by default**, because the
first private run's bug was found only by a probe while every test passed
on both trees, with the coverage map deferred until the ledger shows the
parent over-spending; **coverage prefilled by the executor**, which knows
first-hand what ran; **two rubrics for now**, the judge's and the gatherer's,
sharing their judgment and review sections word for word, until `smoke` and
`detonation` are executed too and `SKILL.md` goes; **a switch**
(`CUJO_EXECUTE_DECLARED`) that sends every run down the gather path, so a
rollback needs no rubric change; **the allowlist rules copied** into
`apps/cujo` with a test holding both copies to one answer, rather than a
shared package for forty lines.

Rejected: **a harness route that runs a tool with no model**, which 125
already refused, and which the sandbox service's own door makes unnecessary;
**executing for an undeclared repository by inference**, since inference is
the one setup step that earns its tokens and the gather rubric already does
it; **one rubric that also gathers**, which would keep the parent a
gatherer in half its branches; **a coverage map now**, per ecosystem, before
the first judge run has been measured; **destroying the box in the executor**,
which would cost the probes their prepared tree and re-run the install for
nothing.

What stays: 71 (prepare is one command), 112 and 147 (the envelope comes
from `sniff.py report` and is read off its own result), 143 (one respawn,
for the sub-agents that remain), 145 and 148 (cached detonations, unchanged
in the judge rubric), 158 (a private repository's trees are staged; the
executor prepares from them).

## 164. The limits and switches live on the board

Every knob that moves a run's cost or length lived in the deploy's
environment: the turn ceilings, the diff byte cap, the push window, the
conversation limit and its window and ceiling, and whether the OCR sidecar
is asked at all. Changing one meant a redeploy, and a redeploy kills every
run in flight, so the day the ceiling had to move for one pull request cost
two runs. Decision 152 put the models and the provider in a store seeded
from the environment and read live, and said the timeouts and limits would
move "when a board page wants them". The instance page wants them.

So `settings.ts` carries them: `turnTimeoutMs`, `diffTimeoutMs`,
`diffBytes`, `pushDebounceMs`, `converseLimit`, `converseWindowMs`,
`converseTimeoutMs` and `ocrEnabled`, seeded from the same environment
variables on the first boot that knows them and read at use from then on.
The runner reads its ceilings per run; the push debounce reads its window
per schedule; the conversation service is always built and reads its limit
per question, so zero is a switch and not a boot-time absence; the shadow
review asks the switch per run. One table in `settings.ts` names every key
and the form it belongs to, `SETTING_KEYS` and the owner route's allowlist
derive from it, and the route serves the groups, so the four hand-kept
copies of the key list are one. The instance page draws a third form,
"Limits and switches", in seconds.

Accepted: **the OCR switch is a setting and its URL is not**, since the URL
wires two processes together and the switch is what costs money; **a
limit applies at its next use**, and a run under way keeps the window it
started with, which is what a ceiling means; **whole numbers in
milliseconds on the wire, seconds in the form**; **the same `zeroOk` rule
the environment had**, so the push window and the conversation limit
accept zero and the ceilings do not.

Rejected: **moving the interval services, the stream limit, the OAuth
client, service URLs and secrets**, which a process needs before it has a
store or which wire it to another process; **a hot-reloaded `Config`**,
still (152); **a per-repository ceiling**, until a repository needs one.

## 165. What a run may spend, and what it was seen to spend

Four things the ledger and one bad day showed, each with a measure.

**A timed-out run recorded nothing.** The stream delivers `model.message`
as a stub with no usage and the watchdog's terminal event is its own, so a
run that hit the ceiling folded zero tokens — and those are the runs that
cost most. Now the watchdog, once the cancel has settled, reads the turn's
persisted messages back (their usage fills the ledger) and the harness's
cancelled state (its metrics fill the run's usage), and logs
`run.usage.recovered`. The board shows what the day cost.

**The sandbox spec had no budget.** Only the diff review did (132). A
`sandboxBudgetTokens` setting, seeded from `CUJO_SANDBOX_BUDGET_TOKENS`
and three million by default — the fixture's p90 plus headroom — is the
sandbox spec's `tokenBudget`, stamped on the run row; a run past it ends
as an error carrying what it measured.

**Every sub-agent carried the parent's whole rubric.** A fresh context
re-reads its system prompt on every message, and cache reads were 60 to 75
percent of a run's tokens. The spec now names `subagents`, a page per
check under `agent/checks/`, each on a common page and a tenth of the
parent's; the harness hands a child the page named for its `name`, and
the parent's rubric otherwise. The digest a run is stamped with covers
the pages.

**A setup that cannot finish burned the whole ceiling, twice.** The gather
brief carries `turn_budget_ms`, and the rubric bounds every install to a
quarter of it and stops installing at half, skipping what needed the
install with the reason in coverage and posting what ran. A review that
says the install did not finish is worth more than a run cancelled with
nothing posted.

Not done here: waiting for in-flight runs before a deploy. A deploy
replaces the harness, which stops the spend at once; what it costs is the
rerun, and that is a deploy-time question for the day the deploys are
scheduled.

Accepted: **usage read back after the cancel**, not before, since the
metrics exist once the harness has ended the turn; **the budget on the
models form**, beside the diff budget it mirrors; **one common page and
one page per check**, so the protocol every check shares is written once;
**the bound in the rubric**, since the gather path is the model's and the
judge path's executor already bounds its own steps.

Rejected: **a budget below the fixture's p90**, which would end real runs
for saving cents; **per-check pages that repeat the review sections**,
which a child never needs; **cancelling turns on `SIGTERM`**, since the
harness dies with the deploy anyway.
