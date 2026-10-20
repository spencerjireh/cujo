# Decisions

Load-bearing choices and why they were made. Newest context wins. Each entry
is short: status, decision, why, the rejected options that matter, and
references (decision 178). A changed entry is marked reversed or amended and
names the entry that changed it; its number and title never change. An entry
that a later decision fully reversed keeps its heading and status here, and
its full text is in [decisions-archive.md](decisions-archive.md). Earlier
wording of every entry is in the commit history. The index says which entries
a later one reversed, superseded, refined or amended.

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
98. [The board carries the manual, and it is the one thing indexed](#98-the-board-carries-the-manual-and-it-is-the-one-thing-indexed) — reversed in part by 175
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
156. [The owner's pages: repositories, one repository, and sign-in on the footer](#156-the-owners-pages-repositories-one-repository-and-sign-in-on-the-footer) — amended by 175
157. [The instance page, and the App as GitHub sees it](#157-the-instance-page-and-the-app-as-github-sees-it) — amended by 175
158. [Private repositories: the trees are staged on the trusted side, and the box clones nothing](#158-private-repositories-the-trees-are-staged-on-the-trusted-side-and-the-box-clones-nothing)
159. [An owner sees every run, and a private run's page is the owner's](#159-an-owner-sees-every-run-and-a-private-runs-page-is-the-owners)
160. [The front door is a landing, and the galaxy is at `/galaxy`](#160-the-front-door-is-a-landing-and-the-galaxy-is-at-galaxy) — reversed in part by 175
161. [Declared commands run with no model; the parent judges](#161-declared-commands-run-with-no-model-the-parent-judges)
162. [Smoke is one sensed command, run by the executor](#162-smoke-is-one-sensed-command-run-by-the-executor)
163. [Detonation runs in the executor, and the gather rubric is for undeclared repositories](#163-detonation-runs-in-the-executor-and-the-gather-rubric-is-for-undeclared-repositories)
164. [The limits and switches live on the board](#164-the-limits-and-switches-live-on-the-board)
165. [What a run may spend, and what it was seen to spend](#165-what-a-run-may-spend-and-what-it-was-seen-to-spend)
166. [A report bounds its benign rows on both sides of the workspace line](#166-a-report-bounds-its-benign-rows-on-both-sides-of-the-workspace-line)
167. [The sandbox has a memory cap and no CPU cap](#167-the-sandbox-has-a-memory-cap-and-no-cpu-cap)
168. [A bundled service is not a service until it boots, and CI says so](#168-a-bundled-service-is-not-a-service-until-it-boots-and-ci-says-so)
169. [Base is run when head fails, and not before](#169-base-is-run-when-head-fails-and-not-before)
170. [The reviewer is told how the code is built, and reads it without running it](#170-the-reviewer-is-told-how-the-code-is-built-and-reads-it-without-running-it)
171. [Every review is told how the code is built, and the sandbox settles it](#171-every-review-is-told-how-the-code-is-built-and-the-sandbox-settles-it)
172. [The map is a service that compiles its own engine, and the two trees become a repository](#172-the-map-is-a-service-that-compiles-its-own-engine-and-the-two-trees-become-a-repository)
173. [An install whose exit nobody reads is not an install that worked](#173-an-install-whose-exit-nobody-reads-is-not-an-install-that-worked)
174. [Models are configured on the board; the environment only seeds a dev stack](#174-models-are-configured-on-the-board-the-environment-only-seeds-a-dev-stack)
175. [A header, an owner's home, and the run page leads with what to do](#175-a-header-an-owners-home-and-the-run-page-leads-with-what-to-do)
176. [The images share one package store and take turns installing](#176-the-images-share-one-package-store-and-take-turns-installing)
177. [The manual is six pages](#177-the-manual-is-six-pages)
178. [Decisions are short; history is in git and the archive](#178-decisions-are-short-history-is-in-git-and-the-archive)

## 1. Build on stock TrueForge — no fork

**Status:** reversed by 123. Full text: [decisions-archive.md](decisions-archive.md#1-build-on-stock-trueforge--no-fork).

## 2. Hosted mode on Hetzner via Coolify, gated by Cloudflare Access

**Status:** superseded in part by 34, 49 and 57, and the rest by 123. Full text: [decisions-archive.md](decisions-archive.md#2-hosted-mode-on-hetzner-via-coolify-gated-by-cloudflare-access).

## 3. In-sandbox logging proxy — not Daytona's `outboundProxyUrl`

**Status:** live

**Decision:** A proxy started inside the sandbox observes egress, with `HTTP(S)_PROXY` exported for every process the checks spawn.

**Why:** Stock TrueForge's Daytona create call passes no network options, so the sandbox's outbound proxy cannot be set from outside without a fork. Under decision 1, the in-sandbox proxy shows egress without a harness patch. It sees only processes that honour the proxy variables; a direct socket from non-Python code is a known gap, for a later network-namespace or iptables redirect inside the sandbox.

**See:** decision 1.

## 4. Bot identity is a GitHub App — `cujo-guard[bot]`

**Status:** live

**Decision:** Cujo posts as a GitHub App, **Cujo Guard** (slug `cujo-guard`), so reviews post as `cujo-guard[bot]`.

**Why:** The App receives the PR webhooks and mints short-lived installation tokens from its private key, which is the standard bot auth flow. It needs no second user account and scopes permissions to the app, not to a person. Bare `cujo` is an existing GitHub account.

## 5. The agent posts the review via MCP, not the `apps/cujo` code

**Status:** live

**Decision:** The agent posts the review by calling a `github-mcp` tool; `apps/cujo` does not call the GitHub API to post it. `github-mcp` is a small server we own that authenticates as the App.

**Why:** Real MCP tool use is what the harness is for, and the human-approval gate must sit on the agent's action. If plumbing posted the review, the agent-gated-by-a-human design would not hold.

## 6. Reviews auto-post; the human gate is on the block

**Status:** superseded by 42, and reversed by 138. Full text: [decisions-archive.md](decisions-archive.md#6-reviews-auto-post-the-human-gate-is-on-the-block).

## 7. The webhook route is on a non-Access hostname

**Status:** live

**Decision:** `apps/cujo` serves its webhook route at `cujo-ingress.spencerjireh.com` with no Access policy, gated only by the webhook HMAC signature, and its UI and API at `cujo.spencerjireh.com` behind Access. Hostnames are one level deep (`cujo-ingress`, not `ingress.cujo`).

**Why:** GitHub cannot solve a Cloudflare Access OTP challenge. The zone's Universal SSL covers only `*.spencerjireh.com`; a proxied two-level name needs Advanced Certificate Manager, a paid add-on the zone does not have. Both hosts reach TrueForge over the internal compose network.

**See:** decision 17.

## 8. A free-tier model provider for inference; hosted Daytona for the sandbox

**Status:** live

**Decision:** Inference runs on a model provider's free tier, and hosted Daytona is the sandbox provider. The key is registered once on the TrueForge server, and the agent spec names the model.

**Why:** Naming the model in the spec lets the provider change without a repo change. Hosted Daytona came with $200 credit; self-hosted Daytona is a later option.

## 9. Code senses, the agent judges, hard rules guard the dangerous cases

**Status:** live

**Decision:** The sandbox emits raw signals with no judgment, the agent assigns each finding a severity against the rubric, and deterministic rules force `critical` when a critical signal is present, which the agent cannot override. The hard rules are: a test that passes on base and fails on head; the decoy secret read or seen leaving; a write to a sensitive path; egress during an install to a host that is neither a package index nor allowlisted.

**Why:** This keeps reasoning in the agent for the ambiguous majority of cases. It makes the dangerous cases impossible to reason away; a diff can look like a refactor and still break a test.

**Rejected:** A thin agent, because code would decide everything. A thick agent, because the model is unreliable on the security call.

## 10. Sensors: language-agnostic base, Python audit hook on top, TLS later

**Status:** live

**Decision:** Three sensors work for any language: the in-sandbox proxy (egress hosts and byte counts), a filesystem diff (writes outside the workspace and to sensitive paths), and an inotify watcher on the decoy file (reads). When a check runs Python, a `sys.addaudithook` hook injected through `sitecustomize.py` on `PYTHONPATH` adds file, socket, and subprocess detail, including pip running `setup.py`.

**Why:** These need no `strace`, no special capability, and no traffic decryption. Inotify is used because `relatime` and `noatime` make `atime` unreliable. TLS interception (mitmproxy with a trusted CA) is a later upgrade that shows the secret leaving, not only being read.

## 11. Cujo reviews the whole PR by running it; detonation is one check

**Status:** narrowed by 133

**Decision:** Every PR gets a sandbox run: `tests`, `probes`, `smoke`, and `detonation` when a dependency manifest changed. Decision 133 narrows this: every PR still gets a review, but its mode decides which, and this argument holds for every PR the floors send to the sandbox review.

**Why:** A PR asks you to run a stranger's code, and that applies to every line, not only a dependency's `setup.py`. A review that cites execution evidence is what a diff-only reviewer cannot produce. The hostile demo sample is never published to a public index; it arrives as a `git+https://` line in a PR.

**See:** decision 133.

## 12. Findings with severity, not a single verdict

**Status:** live

**Decision:** Each finding has a severity (`info`, `warn`, `critical`) and an optional line anchor. Any `critical` finding routes to the gated `post_blocking_review` (REQUEST_CHANGES); otherwise `post_advisory_review` posts a COMMENT with the summary and inline comments.

**Why:** One word cannot carry a failing test and a suspicious host at once. The bot never posts a formal APPROVE, so it can never satisfy branch protection for a bad merge.

## 13. Agent infers repo commands; `.cujo.yml` overrides

**Status:** extended by 135

**Decision:** The agent reads `pyproject.toml`, `package.json`, `Makefile`, and CI workflows to pick install, test, boot, and smoke commands; a `.cujo.yml` (`install`, `test`, `boot`, `smoke`, `allow_hosts`) pins any of them. The file is read from the base SHA, never from the PR, and a PR that edits `.cujo.yml` gets a `warn` finding; decision 135 adds `mode:`, read from base by the service, not the agent.

**Why:** The target repo has no setup burden. Policy comes from the branch the PR targets, so a PR cannot allowlist its own exfiltration host.

**Rejected:** A required config file, because a repo without it would get no execution-backed review. Parsing CI workflows alone, because it couples tightly to CI shape.

**See:** decision 135.

## 14. One subagent per check

**Status:** refined by 124

**Decision:** Each check (`tests`, `probes`, `smoke`, `detonation`) runs in a subagent with fresh context, and only its JSON report returns to the parent. Decision 124 makes each one a nested pi session in `apps/harness` whose events are durable as they land.

**Why:** Each check's context stays small, a noisy test log cannot crowd out the detonation report, and one check can fail without the others. The parent owns setup, the hard rules, synthesis, and the post.

**See:** decision 124.

## 15. No tests means one `warn` and stop

**Status:** refined by 87

**Decision:** If the repo has no test suite and `.cujo.yml` names none, the parent posts one `warn` finding ("no test suite found") and stops. Decision 87 refines this: `detonation` still runs, and the stop applies only to `tests`, `probes`, and `smoke`.

**Why:** Without a suite the regression tripwire cannot fire, so execution evidence is thin, and the missing suite is the most useful thing to report.

**Rejected:** Probes and smoke as a fallback, because they run without a baseline. A diff-only review, because other tools already provide it.

**See:** decision 87.

## 16. One session per PR; `apps/cujo` owns idempotency

**Status:** refined by 47, excepted by 137

**Decision:** A PR maps to one session keyed by repo and PR number, and a `synchronize` event runs a new turn in it. `apps/cujo` skips a turn if `cujo-guard[bot]` already reviewed the current head SHA; decision 47 puts conversation in a second session, and decision 137 gives a diff run a fresh session each time.

**Why:** The agent can see what it said before. The head-SHA check keeps a retried webhook from double-posting and keeps `github-mcp` write-only.

**See:** decisions 47, 137.

## 17. Cujo owns the operator UI; TrueForge is a dependency, not a destination

**Status:** superseded by 27, and refined by 123. Full text: [decisions-archive.md](decisions-archive.md#17-cujo-owns-the-operator-ui-trueforge-is-a-dependency-not-a-destination).

## 18. `apps/cujo` is a projection of TrueForge, not a source of truth

**Status:** refined by 123

**Decision:** The harness keeps the event log; `apps/cujo` stores only the PR-to-session map, the derived run status, and who approved, and rebuilds the rest from the event log after a restart. Decision 123 makes that log `apps/harness`'s SQLite table, read whole.

**Why:** There is no second event store to drift and no migration for event data. `github-mcp` stays a separate container because it holds the GitHub App private key and is the process the harness calls as a tool. The approve route validated the Access JWT (`Cf-Access-Jwt-Assertion`) and recorded the approver's email as the audit trail.

**See:** decision 123.

## 19. The sensor script reaches the sandbox by public URL, not by upload

**Status:** superseded by 46. Full text: [decisions-archive.md](decisions-archive.md#19-the-sensor-script-reaches-the-sandbox-by-public-url-not-by-upload).

## 20. One run, one turn chain; the newest head supersedes the rest

**Status:** superseded in part by 39

**Decision:** A run records the id of each turn it creates (`createTurn`, then `subscribeToTurn`) before the first event, never adopts a turn another run recorded, and ends in `error` after a restart if it has no recorded turn. When GitHub's current head differs from a run's head, the run is `superseded`: it stops following its turn, takes no decision, and cancels a turn still running; decision 39 adds that it also answers its pending approval.

**Why:** Decision 16 puts every run on a PR in one session, so a run must know its own turns. The webhook confirms the head with GitHub because a delayed delivery for an older commit can arrive after a newer one. An errored, turnless run does not hold its head, so a redelivery re-claims it.

**Rejected:** Ownership from the event stream, because it folded the next head's turn into a run waiting on a human. Keeping both runs live, because a human could approve a blocking review on a stale SHA.

**See:** decisions 16, 39.

## 21. The hard rules are re-derived in `apps/cujo`, not only in the rubric

**Status:** amended by 140

**Decision:** `apps/cujo` reads every check report as its `thread.done` arrives and derives the hard-rule findings itself (`apps/cujo/src/findings.ts`); the agent's `findings[]` on the review tool call merge after them. If the agent posts an advisory review while a hard rule tripped, the run ends `error` with the rule named.

**Why:** The rubric prose and the `derived` booleans from `sniff.py` are both untrusted at the moment of judgment, so a recorded `critical` could be reasoned away or dropped. `post_advisory_review` is ungated, so `apps/cujo` cannot stop it posting. The rubric still carries the rules so the common case takes the blocking path.

**Rejected:** Gating the advisory tool, because every review would wait for a human. Re-posting a blocking review from `apps/cujo`, because it makes `apps/cujo` a second review author.

**See:** Contract 3; decision 140.

## 22. A brand system in `brand/`: guard dog, amber, dark and light

**Status:** live

**Decision:** `brand/` is the one source for the UI and README: a flat geometric dog head with one amber eye, lowercase `cujo` in Bricolage Grotesque, JetBrains Mono for evidence, warm near-black and bone grounds in both themes, amber as accent and `high`, red only for `critical`. The favicon lives in `apps/web` as `src/app/icon.svg` and `icon.png`, copied from `brand/logo/favicon.svg` and `favicon-32.png`.

**Why:** One source keeps the UI and README from drifting. The guard-dog reading matches `cujo-guard[bot]` and the approval gate. The PNG exists because Safari does not use SVG favicons in tabs; the old `apps/cujo` operator plane is gone (decision 57).

**Rejected:** Renaming, because the name is in every handle. Pixel and single-line styles, because they fail at 16 px. Red-orange accent, because it is too close to critical.

**See:** decisions 17, 57.

## 23. Discord is notified by `apps/cujo`, not by the agent, and it notifies only

**Status:** amended by 138

**Decision:** `apps/cujo` sends Discord notifications from the events it already folds, through a bot application over REST only, and the agent is not told Discord exists. One card per run, which notifies only; a superseded run's card and ping are rewritten to say so.

**Why:** The facts worth announcing (review started, `error`, `superseded`) are not the agent's to know, and the agent could skip or repeat a call. A card edited in place needs a message the poster owns, which a channel webhook cannot give. Approving from Discord would swap the Access identity in `approver` for channel membership, so the card links to the run.

**Rejected:** The gateway and `discord.js`, because Cujo only writes and `tsup` bundles with `noExternal`. One card per PR, because it loses the history of earlier heads.

**See:** Contract 6; decisions 17, 138.

## 24. The repo-to-channel binding lives in the store, not the environment

**Status:** superseded by 28, then by 31. Full text: [decisions-archive.md](decisions-archive.md#24-the-repo-to-channel-binding-lives-in-the-store-not-the-environment).

## 25. New tables, not new columns: the store has no migration path

**Status:** live

**Decision:** Contract 7 adds `discord_channels`, `run_discord_messages` and `run_pr_meta` as separate tables, not new columns on `runs`.

**Why:** The schema was one `CREATE TABLE IF NOT EXISTS` block with no `ALTER TABLE` and no migration runner, so a new column would not reach the deployed database. New tables do, keep `RunRecord` and `/runs` unchanged, and remove with a `DROP TABLE`. The next change that must alter an existing table adds the mechanism: `PRAGMA user_version` with an ordered list of migrations, each in a transaction that bumps the version.

**See:** Contract 7; decision 30.

## 26. Every Discord payload is treated as attacker-controlled

**Status:** live

**Decision:** Every card field is treated as hostile: Contract 7 applies mention suppression, markdown escaping, bidi and zero-width removal, and hard truncation, and clamps the 6000-character embed budget.

**Why:** The PR title comes from GitHub, and the rest was written by a model that read a stranger's PR. Without this a hostile PR could make Cujo `@everyone`, post an attacker link, or render "not critical" as "critical"; a bidi override survives escaping, so it is removed. Exceeding the embed budget is a 400 that loses the card. A channel's membership is wider than the UI's audience, so reopen this when private repos are in scope.

**See:** Contract 7.

## 27. The operator UI is `apps/web`; `apps/cujo` becomes API-only

**Status:** live

**Decision:** The UI is a Next.js app in `apps/web` on `cujo.spencerjireh.com`, and `apps/cujo` keeps the webhook host, run store, harness client and JSON API and serves no HTML. `apps/web` proxies the API same-origin at `/api/*`, and `createApp` accepts `internalHost` (`CUJO_INTERNAL_HOST`, default `cujo`) because Node's `fetch` ignores a set `Host` header.

**Why:** Browser code cannot forge the Access assertion and `EventSource` has no header API, so a cross-origin API would need a second Access application and a custom stream. Same origin means no CORS and no public route to the store. `CheckState` gained `startedAt` and `endedAt` from each thread event's `createdAt`, so the fold stays pure.

**Rejected:** Path routing at the edge, because CI cannot test it. Forwarding `Host` through `node:http`, because it gives up `fetch`. Setting `CUJO_UI_HOST` to the service name, because it misnames the variable.

**See:** Contract 6; decision 17.

## 28. Two tiers: an operator authorizes a server, the server configures itself

**Status:** superseded by 31 and 49, amended by 138. Full text: [decisions-archive.md](decisions-archive.md#28-two-tiers-an-operator-authorizes-a-server-the-server-configures-itself).

## 29. Slash commands over the HTTP interactions endpoint, registered per server

**Status:** live

**Decision:** `/cujo` is a route on the existing Hono app on the webhook host, verified with `node:crypto`'s Ed25519. Commands register per server, as a full replace on every start.

**Why:** Slash commands, autocomplete and deferred replies are all HTTP callbacks, so no gateway is needed (decision 23). A guild command appears at once where a global one takes up to an hour. A full replace keeps definitions in step with the code; a server joined later has no commands until the next start.

**Rejected:** Registering both globally and per server, because `/cujo` would appear twice in the picker.

**See:** decision 23.

## 30. The store gets a migration path, at the first change that needed one

**Status:** live

**Decision:** The constructor reads `PRAGMA user_version`, and each statement in an ordered, append-only migration list runs inside the transaction that bumps the version. A fresh database creates the original tables and then runs the same migrations.

**Why:** Recording `bound_by` on the existing `discord_channels` table was the first change that needed it, as decision 25 predicted. A container killed mid-migration comes back before or after a migration, never halfway. Adding a table is still preferred; this is for altering one that exists.

**See:** decision 25.

## 31. The repo declares its Discord server; the operator route becomes an override

**Status:** superseded in part by 57

**Decision:** A repo names its server with `discord_guild: "<snowflake>"` in `.cujo.yml` on the default branch, read trusted-side through the App and extracted with one strict pattern, and the server must also run `/cujo watch`. Revocation is checked on the delivery path, `/cujo unwatch` is ungated, and `declaredGuild` throws on a failed read so an unreadable file is not a revocation; decision 57 deletes the operator override route and its table.

**Why:** Decision 28 put the authority on a Cujo operator, who is not necessarily a repo owner, and needed a manual request per repo. Repo write access correlates with ownership, is self-serve, and is auditable in git. Both sides are required so nobody can route a repo they do not own or into a server they do not belong to.

**Rejected:** A claim-code flow, because it needs expiry and replay handling and leaves no lasting record. Manage Server alone, because any server admin could bind any repo.

**See:** decisions 24 (superseded), 28 (superseded), 57.

## 32. The file tree carries the trust boundary, not the layer

**Status:** live

**Decision:** `apps/cujo/src` groups by trust plane and bounded context (`http/ingress`, `http/operator`, `review`, `notify`, `clients`, `store`), `tests/` mirrors it, and each directory has a `README.md` with its invariant. Only `runner` and `notifier` take `.service.ts`; the store splits so `/cujo` handlers hold a `NotificationStore` with no `claimDecision`; the channel-permission rule lives once in `notify/channel-check.ts`; `sniff.py` moves to `sandbox/`.

**Why:** Trust zone is orthogonal to technical role, and a flat tree hid which files the internet can reach. The store split makes "Discord never approves" (decision 28) a compile error. Paths in decisions 1–31 refer to the old tree and stay as written.

**Rejected:** `controllers/services/models`, because layering deletes the trust distinction and `models/` implies authority a projection lacks (decision 18).

**See:** decisions 18, 28, 35.

## 33. The origin accepts Cloudflare only; the ACME path is bypassed to match

**Status:** live

**Decision:** A Hetzner Cloud firewall accepts ports 80 and 443 (TCP, and UDP for HTTP/3) only from Cloudflare's published ranges; port 22 stays open. A second Access application scoped to `/.well-known/acme-challenge` on `cujo.spencerjireh.com` holds one bypass policy.

**Why:** The origin IP was a path that skipped Access; `access.ts` re-checked every request (Contract 6), so only the empty shell rendered. The Coolify control plane deploys over port 22 from a host with no fixed address. Access served Let's Encrypt's HTTP-01 challenge a login page, so the certificate could not renew.

**Rejected:** An on-host `iptables` rule, because Docker's chains bypass it outside `DOCKER-USER` and it can lock the machine out. An Origin CA certificate, because it loses browser trust when the proxy is off. Restricting port 22 to a guessed address.

**See:** Contract 6; decisions 2, 7.

## 34. The run board is public and read-only; the operator surface moves hosts

**Status:** superseded in part by 57

**Decision:** The board is anonymous and read-only at a `/public` route group mounted beside the gated router, built by an allowlist serializer with an exhaustive test that fails on an unclassified field. Visibility is stamped from `repository.private`, corrected by the `repository` event and a periodic sweep that also runs at start, and an unanswered row reads as private; public streams cap at 200 with 503 and `Retry-After`. Decision 57 removes the second hostname (`cujo-admin`) and everything that linked to it; the board, serializer, `is_public` stamping and stream cap stand.

**Why:** The board shows only public PRs, so it can be anonymous. A path split avoids trusting a forwarded `Host` header, which `apps/web`'s `fetch` cannot set (decision 27). An allowlist makes a new field private by default. The sweep marks only a 404 private, so a GitHub outage does not take the board dark.

**Rejected:** A read-only replica deployment, because it costs a second image. A redacting serializer, because it is public by default. `NOT NULL DEFAULT 0`, because it hides how many rows the sweep owes.

**See:** decisions 2, 23, 27, 28, 57.

## 35. Merging is the deploy, so an env-coupled change is valid on both sides

**Status:** live

**Decision:** Coolify rebuilds on every push to `main`, so a merge is a release. To move a Coolify variable or a raw-content URL fetched from `main`, add the new location while the old one still answers, let the deploy land, and delete the old one in a follow-up.

**Why:** When decision 32 moved `sniff.py`, the merge removed the old path from `main` at once while the running container kept the old `CUJO_SNIFF_URL` until the swap. Patching the variable before the merge narrows that window but does not remove it. A path inside the image moves with the image and has no window. Nothing enforces this mechanically; it is a review rule in `best_practices.md`.

**Rejected:** Patching after the merge or restarting before it, because both widen the window. Accepting the window as short, because deploy length is not observable here.

**See:** decision 32.

## 36. The review links to its own evidence, and the bot wears the brand

**Status:** live

**Decision:** Every review on a public repo ends with `Full evidence: <run page>`, composed in `github-mcp`'s `body.ts` from a run id: `apps/cujo`'s `review/links.ts` `publicRunId` returns `""` for a private run so `buildTurnMessage` omits the key, and `github-mcp` builds `<base>/runs/<uuid>` from `CUJO_PUBLIC_BASE_URL` and appends nothing without it. Discord cards use `brand/tokens.css`: amber marks only `blocked_pending`, an errored run is `--sev-info` blue, and the App gets `logo/avatar.svg`.

**Why:** The agent relays a UUID, not a URL, because a URL lets the PR under review choose the host, and `z.string().url()` passes embedded newlines. A footer composed in code is correct or absent, where a rubric line can fail silently. Red means the PR is dangerous, never that Cujo failed.

**Rejected:** A `run_url` from the agent, for the reasons above. `github-mcp` checking visibility through the API, because it adds a call and a failure mode to every review. Linking private runs to `cujo-admin` or to the board root, because readers get a login screen or an unrelated page.

**See:** decision 34.

## 37. Logging is a closed vocabulary on stdout, and readiness is not liveness

**Status:** live

**Decision:** Logs are one JSON object per line on stdout through `@cujo/log`: `log.info` takes an event name from `EVENT_NAMES` and scalar fields from the `FIELD_NAMES` allowlist, `noConsole` bans `console`, and a source-scan test fails on an undeclared or unemitted name. `/healthz` stays a liveness probe, and a new `/readyz` on `cujo` answers `503` when the harness flag or the store ping fails; each run stores its delivery id in a `runs` column and every run event carries it.

**Why:** A closed set of names is greppable and countable, and scalar-only fields stop a spread of a wide object (the App key, webhook secret, bot token) from reaching the logs; unknown field names are dropped and reported under `dropped_fields`, with a pattern scrubber as the second layer. Readiness in `/healthz` would restart-loop the container while `bootstrapUntilReady` retries. The correlation id is `ray` (`x-github-delivery` on the webhook plane, else `cf-ray`), and `approve.requested` carries both `ray` and `delivery_id`; the public serializer withholds the delivery id. Known limit: the scan sees only a literal first argument on a receiver named `log` or `logger`.

**Rejected:** Handing the logger the secrets to redact by exact match, because a bug in the logging path then discloses them all. Correlating background work by run id alone, because it cannot join a delivery to its outcome.

**See:** Decisions 18, 25, 30. Reverses the Standards bullet that promoted `console.log` to `console.info`.

## 38. `apps/cujo` may write a reaction; the gate is about reviews, not writes

**Status:** reversed in part by 138

**Decision:** `apps/cujo` reacts on the pull request as `cujo-guard[bot]` and moves the reaction with the run's status (Contract 9); `superseded` writes nothing, and the eye is placed only after GitHub confirms the run's head is the pull request's head. A failed call retries twice with backoff, the reactor cache is bounded with least-recently-seen eviction, and `CUJO_PR_REACTIONS=0` turns it off.

**Why:** The protected rule is that nothing states a finding on a pull request without a human allowing it, and a reaction from a closed set of eight emoji states no finding. `pull_requests: write` is enough for `POST /repos/{repo}/issues/{n}/reactions`, the POST is idempotent, and bot reactions are found by `BOT_LOGIN`, so no permission change, table, or migration is needed. Reactions describe what happened to the pull request: `denied` is a thumbs up, `error` is a confused face. Known limit: a stale delivery whose `pullRequest()` read fails can put the error reaction over a current verdict until the next push.

**Rejected:** A Check Run, because it needs the new `checks: write` permission. A status comment edited in place, because it notifies on every change. A third `github-mcp` tool, because it fires only after the agent runs. Reacting before the stale-head guard in `start-run.ts`, because a late delivery overwrites a current verdict.

**See:** Contract 9; decision 30.

## 39. A superseded run answers its pending approval

**Status:** refined by 125, reversed by 138. Full text: [decisions-archive.md](decisions-archive.md#39-a-superseded-run-answers-its-pending-approval).

## 40. A single-server deploy may name its server, and skip the declaration

**Status:** live

**Decision:** `CUJO_DEFAULT_DISCORD_GUILD` names one Discord server, and a repo whose `.cujo.yml` declares no server belongs to it. This extends decision 31: `/cujo watch` still needs Manage Server, a declared server always wins, and an unreadable `.cujo.yml` stays `unknown`.

**Why:** A deploy that serves one server and one owner's repos should not need a commit per repo. It is one id, not decision 28's rejected guild allowlist, so a server where somebody else invited the public bot does not match and is refused. The default is checked on the delivery path, so unsetting it drops the bindings it created.

**Rejected:** Turning Public Bot off, because Discord does not allow it without verification. A channel webhook URL, because the URL is a secret that needs an Access-gated config path and removes `/cujo` and Contract 8. Dropping the declaration for Manage Server alone, because Public Bot is on.

**See:** Contract 8; decisions 23, 28, 31.

## 41. One sensed command at a time, and one audit log per command

**Status:** live

**Decision:** `sniff.py run` and `sniff.py detonate` hold an exclusive `flock` on `CUJO_DIR/sensed.lock` for the whole sensed window, and proceed with a stderr note after a fifteen-minute wait. `run_sensed` gives each sensed command its own audit log at `CUJO_DIR/audit/<random>.jsonl` through `CUJO_AUDIT_LOG`, and reads under `CUJO_DIR` are not filtered as noise.

**Why:** All checks write to the same `proxy.jsonl`, `audit.jsonl`, and `decoy.jsonl`, so concurrent checks put one check's evidence in another's report. A process left running by an earlier check keeps its own log, and the shared `audit.jsonl` is read by no report. Tagging rows with `CUJO_RUN_ID` failed because a child that drops the variable is silenced from the report. Known limit: proxy rows are bounded only by offsets, so after a lock timeout a report can carry another command's hosts.

**Rejected:** Tagging proxy and watcher rows, because long-lived daemons cannot tell which check opened a connection. A proxy and log file per run, because it moves the ambiguity into port allocation. Attribution by process tree, because the proxy cannot support it. Serialising the checks in the rubric, because prose does not enforce correctness.

## 42. The projection holds two reviews, and a blocking review can end a run

**Status:** reversed by 138. Full text: [decisions-archive.md](decisions-archive.md#42-the-projection-holds-two-reviews-and-a-blocking-review-can-end-a-run).

## 43. `apps/cujo` may reply on a pull request, because a person asked it to

**Status:** live

**Decision:** `apps/cujo` may comment on a pull request only to reply to a person who addressed Cujo (a `/cujo` command, its refusal, or an `@cujo-guard` question), with the body capped at 8000 characters. `GitHubReactions.addToComment` is a separate add-only method, not a parameter on `set`.

**Why:** Decision 38 protects against unprompted statements about code, and a reply to a direct question is human-initiated. The write lives in `apps/cujo` and not in `github-mcp`, so the agent has no path to it. `set` deletes bot reactions it did not ask for and `PrReactor` caches by run id, so routing a comment reaction through it would strip the run's verdict. The live App reached the comment, comment-reaction, and collaborator-permission endpoints with `contents: read`, `metadata: read`, `pull_requests: write`; decision 50 corrects the conclusion that no re-approval was needed, because `issue_comment` needs `issues: read`.

**See:** Decisions 38, 50 (corrects this).

## 44. Repo write is the principal that may publish an accusation

**Status:** amended by 138

**Decision:** Repo write access, checked against GitHub, is the principal that may decide a held finding, and the pull request's author is refused `dismiss` by name but may `confirm`. The check has three answers, and `unknown` (GitHub unreachable) asks for a retry rather than refusing or allowing.

**Why:** Repo write is broader than an Access email, but it is the authority that matches the decision: the claim is about code in the repo and the consequence lands on its pull request. It is self-serve, audited by GitHub, and revoked by removing someone, which is decision 31's argument applied to a decision. The author exception is required because hostile code in a pull request is the case Cujo exists for, and `dismiss` buries an accusation. The audit trail is a GitHub login in `approver` next to a comment in the pull request timeline.

**See:** Decisions 28, 31, 34, 51.

## 45. The signature-gated plane may answer a held finding

**Status:** amended by 138

**Decision:** This corrects the ingress rule "nothing here may approve a review": nothing from Discord may answer a held finding, but a `/cujo` command on a pull request may, with repo write as the principal (decision 44) and the author barred from `dismiss`. `parse-command.ts` matches `/cujo <verb>` alone on a line, after it drops fenced and indented code, blockquotes, HTML comments, and raw HTML, and Cujo ignores comments by `BOT_LOGIN`.

**Why:** Decision 28 rejected a principal, not a plane, and the HMAC in `github-webhook.ts` already covers every event, including `issue_comment`. Exact verbs mean a mention or prose can never carry a privileged verb, and the scan skips more than GitHub hides because an invisible matched command hands over the gate. Every outcome replies on the pull request, with a sentence for `no_such_run`, `not_blocked_pending`, `already_decided`, `resume_failed`, a stale head, an author's dismissal, a missing run, and an unconfirmed permission. `supersede` leaves a run alone when the deny finds the call already answered and `approver` set, and the current head is read from GitHub last and selects the run by commit.

**See:** Contract 8; decisions 23, 28, 44.

## 46. The sensors are a package, delivered as a source archive

**Status:** reversed in part by 117

**Decision:** `sandbox/sniff.py` is split into the `sandbox/cujo_sniff/` package on a one-way import chain (paths, policy, context, sensors, report, runner and commands), where nothing under `sensors/` imports the context and `Context` replaces the `CUJO_DIR` and `ENVS_DIR` constants. The rubric fetched a source archive from the new key `CUJO_SNIFF_TARBALL_URL` with `--strip-components=1` and `mv` into `/tmp/cujo`; decision 117 reverses that delivery and the stdlib-only constraint, and state outside the code directory still holds.

**Why:** The thousand-line file held every hard rule's evidence and was past the length anyone reads. Import-time constants could not be changed for subprocesses in tests. A new config key avoids a window where a container fetches a path that does not exist on its side of the merge, and `sniffUrl` stays unread until removed. This amends decision 19 and corrects its claim that `raw.githubusercontent.com` was on `KNOWN_INDEX_HOSTS`.

**Rejected:** Vendoring the package into one generated file, because stack traces then name lines not in the repo. One `curl` per module, because the file list goes stale.

**See:** Decisions 4, 19 (amended), 35, 117.

## 47. Conversation runs in its own session, and the agent that answers cannot write

**Status:** live

**Decision:** `@cujo-guard <question>` runs in its own harness session keyed by pull request (a second table), not through `Runner`, with the sandbox enabled and `mcpServers: []`; `apps/cujo` posts the final assistant message as the reply. It needs repo write before a per-pull-request in-memory limit of three questions an hour, one at a time, and listens on both `issue_comment` and `pull_request_review_comment`, replying on the surface the question came from.

**Why:** Sharing the review session cancels a live review, is refused with a 422 while an approval is pending, and corrupts the fold by duplicating checks; `refold` through `Runner` could repaint a verdict. With no write tool, a prompt injection can only waste a sandbox, and reading the final message means a failed turn still answers. `/cujo` stays on the pull request's own thread only, and both rubrics treat any later user message as untrusted.

**Rejected:** A shared session that converses only when the run is terminal, because it fixes only the 422. Conversation without a sandbox, because it only re-reads the diff. No rate limit, because repo write gates who and not how often.

**See:** decisions 16 (refined), 17, 38, 43.

## 48. `sniff.py` is an entry point, and state lives beside the code

**Status:** live

**Decision:** `sandbox/sniff.py` is a docstring, `from cujo_sniff.cli import main`, and the `__main__` guard, with no `sys.path.insert`, and `sandbox/tests/test_sniff.py` is deleted. `CUJO_DIR` defaults to `/tmp/cujo-state` and `CUJO_ENVS_DIR` to `/tmp/cujo-state-envs`, both beside the code directory `/tmp/cujo`.

**Why:** The rubric types `python3 /tmp/cujo/sniff.py`, which puts `/tmp/cujo` on `sys.path[0]` and finds the package. A refetch replaces `/tmp/cujo` wholesale, so state under it lost `proxy.pid`, `watcher.pid`, and `decoy.backup` while the daemons and the displaced credentials still needed them. The envs directory stays outside the state directory because the snapshot prunes state but must see what an install writes. Reads under the state directory stay unfiltered, per decision 41.

**See:** Decisions 35, 41, 46.

## 49. The operator plane swaps an email for a shared token, because it no longer decides anything

**Status:** superseded by 57. Full text: [decisions-archive.md](decisions-archive.md#49-the-operator-plane-swaps-an-email-for-a-shared-token-because-it-no-longer-decides-anything).

## 50. `issue_comment` costs the App a permission, and decision 43's check did not cover it

**Status:** live

**Decision:** The App holds `issues: read` so that the `issue_comment` event arrives, and installations had to re-approve. This corrects decision 43, which tested API calls but not event subscriptions; `pull_request_review_comment` needs only `pull_requests`.

**Why:** GitHub releases `issue_comment` only through the `issues` permission, also for pull request comments, and the subscription cannot be set through REST. `/cujo confirm` is the human gate (decision 44), and a gate that never receives its event is not a gate, so the feature outweighs the new permission under decision 38's rule. Nothing in `apps/cujo` or the agent reads an issue.

**Rejected:** `author_association` from the payload, because `COLLABORATOR` does not separate triage from push and so is not the repo-write check.

**See:** Decisions 38, 43 (corrected), 44.

## 51. A shipped design document is deleted, and the log carries its own reversals

**Status:** live

**Decision:** `docs/hitl.md` is deleted: its unbuilt Design 4 moves to issue #56, and its six user flows move to `docs/architecture.md`, with Flow E marked unbuilt. This file gains an index, and each reversed entry names its successor in one line under its heading.

**Why:** After designs 1, 2, 3 and 5 shipped, the document was a second, incorrect description of the running system, and `docs/README.md` linked it as current. A reversed entry gave no sign of its reversal, so a top-down read gave wrong answers about entries 2, 6, 17, 19, 24 and 28. Only the superseded side needs the banner, because a superseding entry already says what it corrects. Two entries look reversed and are not: 16 stands (39 only rejects reversing it, and 47 refines it), and 38, 43, 47 are one rule that widens.

**Rejected:** Keeping `hitl.md` as a dated tombstone, because its rotted citations look live and the index still links it. Rewriting it in past tense, because it duplicates `spec.md` and this file. Leaving reversals unmarked, because "newest context wins" resolves a conflict but does not show one.

**See:** decisions 16, 38, 39, 43, 44, 46, 47, 48; Contract 6.

## 52. `apps/cujo` dismisses its own stale blocking reviews when a clean run supersedes them

**Status:** live

**Decision:** When a run reaches `clean`, `apps/cujo` dismisses each of the bot's own `REQUEST_CHANGES` reviews whose `commit_id` is not the current head, with the fixed text `"Superseded by a clean run on <sha>."` It logs `review.stale.dismissed` or `review.stale.dismiss.failed`, and skips with `review.stale.skipped` (`reason: "head_moved"`) if the PR's live head differs from the run's `headSha`.

**Why:** Branch protection keeps an old blocking review in force after a fix, and the system already has the evidence to remove it. Only `clean` triggers it, because a `blocked_*` or `error` run does not show the findings are gone. The text carries no finding and no model prose; this extends the content-bearing writes of decision 43 and the content-free write of 38. The dismissal stays out of `github-mcp`, which stays write-only and PR-state-blind (decision 5), and reuses the review read of the `alreadyReviewed` check.

**Rejected:** Manual-only dismissal, because the system that blocked the merge and confirmed the fix can remove the block itself.

**See:** Contract 5; decisions 5, 38, 43.

## 53. Reasoning effort is a deployment setting, not a constant

**Status:** live

**Decision:** `CUJO_MODEL_REASONING_EFFORT` joins `CUJO_MODEL` as a deployment setting, sent as `model.params.reasoningEffort` with the provider's values (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Unset means the key is absent, and one value applies to both the reviewer and the `@cujo-guard` conversation.

**Why:** A model change can need a different effort for a review to finish. An empty string is forwarded as-is and a non-reasoning model returns an error, so absent is the only safe "do not ask". A conversation that reasons less than the review it explains would contradict it. Effort is not per run, because that puts the cost of a review in the hands of the PR author; the spec pins at session creation, so a change reaches only a new pull request.

**See:** decision 16.

## 54. The report says what it could not observe

**Status:** live

**Decision:** Every check report carries `sensors` (one `{armed, detail}` per sensor, daemons re-checked per command), `truncated` flags for each cap, `schema_version`, and `decoy_in_egress: null`; `apps/cujo` turns an unarmed proxy or watcher into one `warn`, `sensor_unarmed`, outside `MALICE_RULES`. Report strings are escaped as `\xNN`/`\uNNNN`, `argv` is coerced and capped, the credential locations and `/etc` get a SHA-256 digest (opened `O_NOFOLLOW | O_NONBLOCK`, checked by descriptor), and the sensitive set matches whole path components.

**Why:** `false` meant both "not observed" and "sensor dead", and nothing told them apart. The warn says the evidence is thin, not that the code acted, and forging health can only suppress a warn; `audit` and `fs_diff` are reported but not ruled on. A digest that was not taken never counts as a match or as a change: a failed read is its own value, an over-cap file counts in `truncated.hashes`, and a file unreadable in both snapshots falls back to metadata, a gap Contract 2 states. Changes are additive only (no renames, removals or nesting of the six sensor keys), because consumers duck-type and the old container reads the new report between merge and deploy (decision 35); `docs/contracts/report.example.json` is tested by all three consumers.

**Rejected:** `armed: false` as `critical`, because a sandbox flake becomes an accusation. Warning on all four sensors, because it fires on every repo without Python. Stripping control characters, because it hides what the code did. Hashing every file, because each snapshot reads all of `$HOME`. A two-release rollout as in decision 46, because additive fields make it unnecessary.

**See:** Contract 2; decisions 21, 35, 46.

## 55. A card names both parties, and a login reaches a URL only through an allowlist

**Status:** reversed by 86. Full text: [decisions-archive.md](decisions-archive.md#55-a-card-names-both-parties-and-a-login-reaches-a-url-only-through-an-allowlist).

## 56. A provider must declare the reasoning efforts it will accept

**Status:** reversed by 127. Full text: [decisions-archive.md](decisions-archive.md#56-a-provider-must-declare-the-reasoning-efforts-it-will-accept).

## 57. The operator plane is deleted; every route is signature-gated or anonymous

**Status:** amended by 138

**Decision:** `cujo-admin`, its operator API, token, Cloudflare Access verifier and the `.cujo.yml` override table are deleted; `apps/cujo` has no authenticated route, the ingress host takes signature-verified requests, the internal name serves `/public`, and all else is 404. `session_id`, `turn_ids`, `external_resume` and `delivery_id` become public; `CUJO_UI_HOST` is replaced by `CUJO_INTERNAL_HOST`, migration index 3 is `DROP TABLE IF EXISTS discord_guild_repos`, `/cujo watch` replaces a binding whose holder the declaration no longer names (read `fresh`), and a private run's Discord card omits `url`.

**Why:** Decisions 44 and 49 had already moved every attributable action off the plane, so the gate protected only reads `/public` already served. This executes 49's rejected alternative: bindings move to `/cujo watch` (Manage Server plus `.cujo.yml`), and the handles authorize nothing while `cujo-harness` keeps its Access application. 404 and not 401 because there is no credential to present. `approver`, `decided_at`, the `is_public` filter, the 15-minute visibility recheck and the `serialize.ts` allowlist stay; decision 7 is generalized, not reversed.

**Rejected:** Keeping the plane behind the token, because it is a gate with nothing behind it. Moving `/public` to the router root, because the prefix is a live URL contract and the log discriminator. Keeping the override table for a release, because it leaves an orphan. Linking a private card to the PR, because it advertises a route into a private repo.

**See:** decisions 2, 7, 25, 27, 31 (superseded in part), 33, 34, 35, 36, 44, 49 (its rejected alternative executed), 138.

## 58. A sensor may not read the tripwire it is watching

**Status:** live

**Decision:** `should_hash` excludes the decoy file (`~/.aws/credentials`), using the caller's `lstat` verdict, so a symlink that resolves to the decoy is still digested by `os.readlink`. A harness test asserts that a command that touches nothing reports `decoy_read` false.

**Why:** The decision 54 digest opened the decoy twice per command inside the sensed window, so `decoy_read` (a hard rule, decision 21) was true on every run. Nothing is lost: the entry keeps metadata, the `decoy` health check follows the inode, and an overwrite must open the file. Skipping symlinks too would reopen the retargeted-link evasion that the decision 54 digest closes.

**Rejected:** Narrowing the sensed window, because it needs a timing constant where a predicate is exact (revisit if a second sensor reads a watched path). Dropping `.aws` from the sensitive list, because `wrote_sensitive` would miss a real write. Filtering decoy rows by process, because inotify does not report it.

**See:** decisions 21, 54.

## 59. The checks start together, because nothing was ever waiting

**Status:** superseded in part by 73

**Decision:** The rubric spawns all checks at once instead of `tests` first and `probes` and `smoke` after; decision 73 later keeps three of the four together. The wrapped commands still run one at a time under the sensor lock, and an overlapping window reports `window_exclusive`.

**Why:** Model turns, not sandbox commands, are the cost, and the serial order cost about a third of the run. No check reads another's report, and the facts that choose which checks run are settled during setup. Decision 41's exclusive lock already makes concurrent checks safe; decision 69 builds on this reasoning. The rubric pins at session creation (decision 16), so this reaches only new pull requests.

**Rejected:** Spawning three and keeping `detonation` last, because the lock makes it a queueing question and the slowest check should not start last. Raising `SENSED_LOCK_TIMEOUT_S`, because 900 seconds already exceeds any check and there is no queue to measure.

**See:** decisions 16, 41, 69, 73.

## 60. The prompt for a maintainer is written by the thing it instructs

**Status:** reversed by 138. Full text: [decisions-archive.md](decisions-archive.md#60-the-prompt-for-a-maintainer-is-written-by-the-thing-it-instructs).

## 61. The model is trusted; the pull request is not

**Status:** live

**Decision:** The trust boundary is the sandbox, not the agent loop: the PR code is untrusted, and the model, TrueForge and the provider are trusted. The hard rules of decision 21 defend against hostile code and against a model reasoning past a finding, not against a model that fabricates a report.

**Why:** `findings.ts` reads the JSON block a sub-agent writes, and nothing signs it or ties it to a command, so a fabricated clean report defeats every rule silently. This is accepted on purpose and recorded because it is load-bearing.

**Rejected:** Signing reports in the sandbox, because it needs a key in the sandbox. A per-run nonce, because the model copies it with the report. The parent re-reading raw `sniff.py` output, because that is another model reading a string. `apps/cujo` reading reports directly, because it needs a credentialed channel into the untrusted zone.

**See:** decision 21.

## 62. The report validator may only add

**Status:** live

**Decision:** `report-schema.ts` validates check reports, and `invalidReportFindings` runs as a separate pass from `hardRuleFindings`, which never learns the result. A failing report adds one `warn`, `report_invalid`, and the run status and review do not change.

**Why:** A renamed field reads as "not observed" and stops a tripwire silently, so validation must exist. Treating an invalid report as no report would hide a visible `decoy_read: true` behind a format warning; separate functions prevent that. The schema requires only what the rubric asks for, because sessions pin their rubric (decision 16).

**Rejected:** Rejecting an unknown `schema_version`, because Contract 2 forbids it and it breaks the deploy order of decision 54. Failing the run, because a format slip leaves a PR with no review. A strict schema that refuses unknown fields, because it reverses decision 54.

**See:** Contract 2; decisions 16, 54.

## 63. `/cujo review` re-reviews the current head, on the same principal

**Status:** amended by 138

**Decision:** `/cujo review` re-runs the review on the current head and needs repo write (decision 44's principal), but has no author guard and no `no_run` or `stale_head` refusal. It supersedes an in-flight run first and refuses unless the stop is confirmed, then deletes the old run by id with `reclaimRunForHead`/`deleteRun` (projection, board page and Discord rows), and the `runs_head` unique index on `(repo, pr_number, head_sha)` lets one concurrent command win.

**Why:** Without it, only a push could re-run a review. Repo write is required because the command spends a Daytona sandbox and a model turn; the author may use it because a re-review buries nothing (decision 45). `supersede` swallows a failed `cancelTurn`, so the path refuses when the cancel is refused, a `/cujo confirm` is landing, or another caller superseded first. Deleting by id keeps a slow concurrent command from deleting the replacement.

**Rejected:** A mention, because decision 45 holds that a sentence cannot carry a privileged verb. Letting any commenter ask, because the PR author would control the cost (decisions 44, 47). Refusing whenever a run is in flight, because a wedged run could not be cleared.

**See:** decisions 44, 45, 47, 138.

## 64. Nothing says when a compaction happened, so Cujo does not

**Status:** reversed by 129. Full text: [decisions-archive.md](decisions-archive.md#64-nothing-says-when-a-compaction-happened-so-cujo-does-not).

## 65. A public list row carries what the checks measured, not only the verdict

**Status:** live

**Decision:** `GET /public/runs` adds `digest`: `checks` keyed by name with status and duration, `findings` counts by severity, and `durationMs`. `deriveDigest` runs inside `putProjection` into a new `run_digests` table, and `listPublicRuns` backfills a missing digest from the stored projection.

**Why:** The board could show `blocked` but not which check caused it. Each value reduces data the detail route already serves, and `PUBLIC_DIGEST_FIELDS` classifies `RunDigest` with the same compile guard as `RunRecord` and `Projection` (decision 34). Storing avoids parsing full projections on a list polled every five seconds, and a new table needs no migration rung (decision 25). Absence is never zero: a missing check stays missing, `ms` and `durationMs` are null while running, `digest` is null for a run never folded, and `durationMs` spans the checks, not `updated_at − created_at`.

**Rejected:** Fanning out detail requests from the browser, because it costs up to a hundred requests and goes stale. Putting the reduction on the detail route, because it duplicates data. An aggregate endpoint, because the board does not need one.

**See:** decisions 25, 34; Contract 2.

## 66. The sandbox must never crash silently; sensor logs count what they lost

**Status:** live

**Decision:** `cli.py:main()` catches `Exception` (not `KeyboardInterrupt`) and prints `{"ok": false, "error": "…", "traceback": "…"}`; the proxy's `except OSError` branch logs an egress row with `"error": "connect_failed"` and `"bytes": 0`. `read_jsonl` returns a `JsonlResult` with `rows` and `dropped`, and the runner sets `truncated.sensor_logs` true when any sensor log line fails to parse.

**Why:** An uncaught exception gave only a traceback, so `check_missing` fired with no reason. A refused upstream connection appeared in no sensor data, and a torn JSONL line vanished with no mark. None of the changes breaks an older consumer, because `truncated` uses `.passthrough()` (decision 62).

**See:** decision 62.

## 67. The setup window is measured, because guessing at it picks the wrong fix

**Status:** live

**Decision:** The fold records four event stamps for the window before the first check (`turnCreatedAt`, `sandboxCreatedAt` from the `sandbox.created` event, `agentStartedAt`, `firstCheckAt`) plus `messages`, the parent's message count before the first check. They are published on the run's detail route only, not on the list row's digest.

**Why:** A run does 17 to 28 seconds of execution inside 500 to 630 seconds of wall clock, and the two possible causes of the setup window (sandbox provisioning or parent round trips) have opposite fixes. Every input is an event timestamp, so a rehydrated run computes the same values; `ms` is omitted when either end is missing or the subtraction runs backwards. `sandboxCreatedAt` is null on a re-run because the sandbox already existed, and absence is never a zero.

**Rejected:** Inferring provisioning from the first parent message, because it conflates provisioning with the first generation; closing the window on any `thread.created`, because a helper subagent would end it early; storing spans instead of stamps, because two spans end on the run record.

**See:** decisions 54, 59, 64, 65.

## 68. Nothing in the chamber exists that is not a measurement

**Status:** amended by 80

**Decision:** Every object in the board's chamber carries a fact: floor ticks are one per occupied slot, the chain ends where the record ends, each specimen has a tether and shadow at its time position, and the sweep is the poll interval exported from `queries.ts`. `digest.findings` sets a specimen's marks (cap six) and core size by worst severity, the run page draws `usage`, `checks[].timings` (`sandboxMs` against `wallMs`), `model` and `rubric_sha256`, a click scrolls and focuses the record row, the empty board renders disarmed panels and setup steps, and the theme choice moves to `lib/theme-store.ts`.

**Why:** Four of seven scene objects were scenery in a file that claims to be a diagram. Absent fields render nothing rather than zero, per decision 54. The canvas is `aria-hidden`, so a pick must move focus to the row link, and two `ThemeToggle` instances need one shared store.

**Rejected:** Spacing specimens by real elapsed time, because a quiet weekend leaves the board mostly empty; a second hue for the sandbox share or the running-check arm, because one hue would then say two things.

**See:** decisions 54, 65, 80 (amends), 82 (deletes the room, keeps the rule).

## 69. Losing the stream is not a verdict; only the watchdog ends a turn

**Status:** refined by 124

**Decision:** When `Runner.consume` spends its resubscribes, the run watches the turn through `listTurns` and folds the verdict it reached from the persisted events; a failed read is retried. The thirty-minute watchdog (`CUJO_TURN_TIMEOUT_MS`) is the only place a run ends without a terminal event, and it cancels the turn it ends.

**Why:** A synthetic `turn.done` reported a failure Cujo never observed, the abandoned turn could still post a review, and `error` hid the run from `listUnfinishedRuns`, which caused the 422 on the next turn. This matches the `docs/spec.md` `error` row, which already required the turn timeout. A stream-lost run that really ends in error now gets the one `retryTurn`; the watchdog keeps the flag so a timeout never doubles its budget.

**Rejected:** Detecting and cancelling the running turn, because `cancelTurn` does not release the session; sending empty input to unstick it, because it waits on abandoned work; a second liveness check in `startReview`, because `Runner.start` is the choke point; cancelling where the stream is given up, because it destroys a turn that may still post.

**See:** decisions 39 (not reversed; no error text is matched), 54, 124 (refines: the wedge facts were TrueForge facts).

## 70. Probe scripts are captured by the sensor, not self-reported by the agent

**Status:** live

**Decision:** `run_sensed` reads the script file before the subprocess starts when `argv[0]` is a known interpreter (`python3`, versioned Python names, `node`, `bash`, `sh`) and the first positional argument is a readable file. It scrubs the file through `scrub()`, caps it at `MAX_SCRIPT_CHARS` (8 000), stores it as `script_content` (string or `null`), and sets `truncated.script_content` when capped.

**Why:** The agent's self-reported `{script, expectation, outcome}` cannot be verified after the sandbox is gone. A reader can now diff the claimed script against what the sensor saw. `null` means no script was identified, not a failed capture, and the field is optional in the Zod schema so older reports still validate.

**See:** decisions 62, 72.

## 71. The mechanical half of setup is one command, because none of it is a decision

**Status:** extended by 134

**Decision:** `sniff.py prepare` clones, fetches the head by `refs/pull/<n>/head`, checks out, adds the worktree, and returns the base `.cujo.yml` raw as `cujo_yml` plus the head's build files in `files`, walked two directories deep with `omitted`, `truncated` and `unreadable[]` reported. It parses no YAML, refuses a clone URL that is not `http`/`https`, names another host or repository than `--repo`, or carries a credential, query or fragment, refuses bad SHAs and a moved pull ref, replaces only paths it marked, and reads only non-symlink files inside the checkout.

**Why:** Each mechanical step was one model round trip, and none depends on the previous result; Python gives tests, a JSON `steps[]` result, and a place to refuse. The policy file has its own larger budget and is never truncated: its outcome is `read`, `absent`, `too_large` or `unreadable`, and `unreadable` blocks the run, because a capped or refused policy would hand the pull request its own `allow_hosts`. Reads are bounded at four bytes per permitted character plus one, the budget is spent on escaped text, lock files are skipped, and the pull ref is fetched always so forks work without a credential.

**Rejected:** Requiring checkout paths under `/work`, because tests would need a container; cloning the fork's repository, because it adds an untrusted host; reviewing whatever the pull ref points at, because `head_sha` would be false; one longer `&&` chain; a YAML parser in `prepare`; reading lock files; a shallow clone, because it lacks the base commit.

**See:** decisions 41, 46, 54, 69 (cited for the `runner.py` tail fix), 134 (extends).

## 72. A length cap is spent on the escaped text, not on the text

**Status:** live

**Decision:** `scrub_head` and `scrub_tail` escape and measure in one pass, spending the budget one whole character at a time; `stdout_tail`, `stderr_tail`, `script_content`, `scrub_argv` and the CLI error and traceback fields all use them. The truncation flag means either the raw output or its escaped form was cut, and `keep` characters cost one.

**Why:** Escaping expands `\x1b` to four characters and `‮` to six, so a cap on the raw text let output written by the code under review exceed the budget six-fold. Escaping first and slicing the result bounds the size but cuts `‮` into `\u20`, which is text the command never printed. Tests assert the property at every alignment, because one offset passes the old code one time in six.

**Rejected:** Escape then slice, because it invents text; raising `TAIL_CHARS` to the worst case, because every report grows six-fold; not escaping inside a tail, because the escape is what makes the text safe for a model.

**See:** decisions 26, 68 (cited for `prepare`'s own cap), 70.

## 73. `detonation` starts during setup, and the install takes the lock so it can

**Status:** live

**Decision:** Corrects 59: the parent spawns `detonation` before the repository install, and the rubric wraps the install in `sniff.py run --check setup` so it takes the sensor lock. `setup` is not one of the four checks, so the fold builds no `CheckState` for it and no hard rule reads it.

**Why:** `detonation` installs each added specifier into its own environment and does not need an installed repository, so its manifest reading can overlap the install. An unwrapped install beside a check would put its egress and decoy reads into that check's slice of the shared `proxy_log` and `decoy_log`, firing `egress_to_unknown_host` or `decoy_read` falsely. The wrapped install reports its own `duration_s`, which with decision 67's window measures the gain; if the install span is small, reverse the reordering and keep the wrap.

**Rejected:** Leaving the install unwrapped, because a hard rule fires on a check that did nothing; reporting the install as a fifth check, because the whole dependency tree would reach the hard rules; spawning all four during setup, because `tests`, `probes` and `smoke` need an installed tree.

**See:** decisions 41, 58, 59 (corrected), 67.

## 74. The server owns the review body, not only its footer

**Status:** amended by 138

**Decision:** Extends 36: `@cujo/review-render`, a pure package with no IO that never throws on a shape, composes the whole review body from `findings[]`, `coverage` and `egress`; `body` is one verdict sentence, the verdict word comes from which tool was called, held findings render as `warn · held`, field-name titles are rewritten, and a folded JSON block (`schema_version` first, additive-only) closes it. `comments[]` is deprecated and derived from finding anchors, legacy prose bodies fold under `### Notes`, `apps/cujo` reproduces the body for the board, and `apps/web` allows `details` and `summary` but not `open`.

**Why:** A rule telling a model how to shape its body fails silently, and posted reviews buried the verdict, used sensor field names as claims, and lost every inline comment. `github-mcp` is stateless, so a render change reaches every open pull request, while a rubric change reaches only new sessions. Two processes must agree on one format exactly, unlike a hard rule, which the trusted side re-derives on purpose.

**Rejected:** Tightening the rubric or a fill-in template, because both fail silently; keeping `comments[]` beside `findings[]`, because two sources for one anchor diverge; inferring held findings from text; a visible machine block; deriving comments in `http/public/serialize.ts`; two independent derivations of the format; letting `github-mcp` read check reports, because it widens a write-only server.

**See:** Contract 2; Contract 3; decisions 5, 16, 21, 36 (extended), 37, 54, 138 (amends).

## 75. The record is one field of a fixed length, and an empty one is armed

**Status:** live

**Decision:** The board's record is one table with a floor of five rows and a ceiling of `min(12.5 rows, 70vh)`, in its own scrollport with a pinned column header ruled by an inset shadow, and an empty record keeps the header and ruled lines with the copy in a sibling block over them. The port takes `role="region"`, a label and a tab stop only when a `ResizeObserver` measures that it clips, and the empty board links to `github.com/apps/cujo-guard` while a filtered empty offers the undo and names its own absence.

**Why:** A record that changed shape and height moved the page under the reader. The half row shows there is more without a control, and a border under a sticky header scrolls away because `border-collapse` gives it to the row. A row count cannot know about a short viewport or the sideways overflow on a phone, so only a measurement makes the port keyboard-reachable. The install link avoids the login bounce of `/installations/new`, and it is the one place the board hardcodes the App slug.

**Rejected:** A "show all" control below twelve rows, because a long record then grows the page as before. A centred card for the empty state, because it is a different shape from the record it replaces. Ruled lines drawn through the copy, because they break the sentence.

**See:** decision 68.

## 76. Interpreter and index coverage is additive, not exhaustive

**Status:** live

**Decision:** `INTERPRETER_NAMES` in `policy.py` covers every interpreter Daytona supports (Ruby, Perl, Deno, Bun, tsx, ts-node), `KNOWN_INDEX_HOSTS` adds RubyGems, and the noise filters drop `/vendor/`, `/.gem/` and `.gem` paths. There is no entry for `go` or `java`, because they compile and leave no script file to capture.

**Why:** The fsdiff, decoy and proxy sensors are language-agnostic, and these lists are membership checks that only affect report quality. A listed name fills `script_content`, classifies registry egress correctly, or filters a noise read from `files_read`. A missing name falls back to the safe default (`script_content: null`, `egress_to_unknown_host: true`, read kept), not to a failure.

## 77. Detonation covers every ecosystem `MANIFESTS` recognises

**Status:** live

**Decision:** `detect_source` in `detonate.py` returns `"go"` for a module path with a slash (a `git+` URL stays `"pypi"`) and `"gem"` for the `gem:` prefix, and `cmd_detonate` dispatches to `_go_install_cmds` (one `go install` into an isolated `GOPATH`) and `_gem_install_cmds` (one `gem install --install-dir`). The CLI's `--source` choices match.

**Why:** `MANIFESTS` in `agent-spec.ts` already set `manifest_changed: true` for `go.mod`, `go.sum`, `Gemfile` and `Gemfile.lock`, but the sandbox could only install npm and PyPI packages. The same OS-level sensors observe the new installs, so findings report the same way, and Python and Node behaviour does not change.

## 78. The Python suite runs in parallel, and a superseded run is cancelled

**Status:** live

**Decision:** `pytest` runs under `pytest-xdist` with `-n auto` in `addopts`, so `uv run pytest` means one thing in CI, `AGENTS.md` and on a developer machine. The CI workflow has a `concurrency` group with `cancel-in-progress`, keyed on `github.event.pull_request.head.repo.full_name || github.repository` and then the branch, and `repo_checks/test_ci_concurrency.py` evaluates that key against real event shapes.

**Why:** The serial Python step was the whole CI critical path, and the suite is bound by process startup and IO, not by test weight. Parallel runs depend on the `cli` fixture rooting `HOME`, `CUJO_DIR` and `CUJO_ENVS_DIR` in `tmp_path` and on `--proxy-port 0`, so a test that uses a fixed path or port fails intermittently. The key must put a `workflow_dispatch` run in its PR's group and keep two forks with one branch name apart, and the test's evaluator raises on an unmodelled context path and models per-run ids as unique. `repo_checks/` is not named `tests` because that shadows the package `sandbox/tests/conftest.py` imports.

**Rejected:** Skipping slow tests in CI, because that drops the detonation test. Sharding across matrix jobs, because each shard pays a checkout and `uv sync` and splits the report. `-n auto` in the workflow only, because the documented command then differs from CI. A key on the PR number or on the branch alone, because each fails one of the two properties. Asserting the expression string, because it restates the workflow and passes on both wrong keys.

## 79. Entry selectivity: drafts, labels, and docs-only advisory

**Status:** live

**Decision:** The webhook handler in `github-webhook.ts` returns 200 with `ignored: "draft"` for `pull_request.draft === true` and `ignored: "label"` for a PR with the `cujo:skip` label, before any session, run or sandbox. When every changed file is documentation (`isDocsOnly` in `agent-spec.ts`: well-known prose extensions and basenames only, and not an empty list), the turn message carries `docs_only: true` and the agent posts with `post_advisory_review`, while the sandbox and hard rules still run in full.

**Why:** Drafts and the label are explicit human choices, so they stop the run. Docs-only is an inference, so a false positive must give "reviewed but did not block", not "not reviewed at all". The explicit `=== true` follows the same pattern as `private === false`.

**See:** decision 34.

## 80. The chamber may have air in it, and the air is two files

**Status:** amended by 81 and 82

**Decision:** Narrows 68 to "no geometry exists that is not a measurement" and admits one decorative layer, `chamber/atmosphere.ts` and `chamber/post.ts`, which must not import `Specimen`; the bloom threshold sits above `--chamber-fg` so only the glow sprite, the amber sweep and `blocked_pending` bloom. Every rule with a claim in it (easing, layout, sweep envelope, record diff in `lib/board/arrival.ts`, dust, camera) lives in `src/lib/board/` where vitest can assert it, and `chamber/inline.ts` draws the run page's specimen without importing the room or the composer.

**Why:** An instrument that only draws measurements was correct and inert, and a layer that describes the medium makes no claim about a run, so two import lists are the check. Brightness comes from `multiplyScalar` on existing tokens, so no `--chamber-*` value or hue changes. The sweep envelope lights at most one specimen more than half at a time, and a node rebuilds only when `specimenSignature` changes. 81 reverses the flat elevation on phones, the plane sweep and the rejected third `BOXES` preset; 82 makes the sweep a plane again and the dust a star field.

**Rejected:** Letting bone bloom, because the post pass would repaint a verdict colour. Changing `--chamber-*` values, because the drawing would leave the badge and invalidate the contrast table in `brand/brand.md`. Dropping the measurement rule, because the chamber becomes a hero image.

**See:** decisions 68 (narrowed), 81, 82.

## 81. Depth is time; across the volume means nothing, and says so

**Status:** amended by 82

**Decision:** Narrows 68 and 80 again: a specimen's depth is time, and its height and lateral position are a deterministic function of its run id in `scatter.ts`, which the legend states means nothing. `DigestCheck` gains `sandboxMs` (null, never zero), and `serializePublicSummary` shapes each check per field over `CHECK_NAMES` with `PUBLIC_DIGEST_CHECK_FIELDS`, closing a hole in decision 34's allowlist.

**Why:** One line of pins left most of the frame empty, and a seed off the id keeps a run where it was across polls. Arms split by strength (solid sandbox share, thin agent tail) rather than by hue, as 68 asked, and `projectArms` keeps every flat drawing on one shape. `ChamberFallback` is deleted because a flat redraw of the field is a different picture, so phones and no-WebGL browsers get the list; this reverses 80's flat elevation and moots its third `BOXES` preset. 82 replaces the shape, field, chain and camera but keeps the rule, the arm split, `sandboxMs`, the serializer guard and the deleted fallback.

**Rejected:** Free scatter on all three axes, because it abandons depth as time. Height as severity and lateral as repository, because it charts two facts every row already shows. A minimum presence floor for clean runs, because a calm board must read calm.

**See:** decisions 34, 68, 80 (reversed in part), 82.

## 82. The record is a galaxy, and a run is a star with orbits

**Status:** amended by 90 and 95

**Decision:** A run is a star (core colour is the verdict, size the worst finding) with one ring per check on four tetrahedral tilts (radius is watch time, bright arc the sandbox share, colour the outcome) and findings as satellites in six fixed slots; the record is three layers by recency holding six, ten and fourteen runs, with no room around it. The sweep is a plane again that lights one layer at a time, the chain is not drawn, and from `md` up the record sheet rises over a sticky hero that a sentinel gates.

**Why:** The scattered field in a box read as a hallway, and the shape, room and field had to change together. Each layer is one depth, so a plane lights one layer, and tests assert placement and at most one layer more than half lit. The lattice returns as texture in `atmosphere.ts`, and dropping the chain motif from the chamber is a recorded loss. 90 makes every star's rings tumble, 94 gives a running run its own hue, and 95 removes the gates and lets depth wander in a layer.

**Rejected:** Age buckets for layers, because a layer can be empty. Every run in the galaxy, because cost scales with the record. A text label per star, because the callout does that. Keeping the box, because it is the hallway.

**See:** decisions 68, 80, 81 (amended), 90, 94, 95.

## 83. A star's tilts are its own, the read walks the stars, and the copy is a caption

**Status:** amended by 95

**Decision:** A run's four ring normals are seeded off its id (`ringNormals` in `orbit.ts`, hash in `hash.ts`), which reverses 82's "tilt is the check". The read (`wash.ts`) is one amber light that walks the record run by run, oldest first, at a second and a half per star and at least fifteen seconds per walk; only a live run's rings turn, and the hero copy is one caption sentence.

**Why:** Fixed tilts gave thirty identical atoms, and nobody read a check from its diagonal; colour, radius and arc still carry the measurements. 82's plane lit a whole layer on every poll and scaled stars, which made a strobe that sped up when the board was busy. A walk still starts on a read (68) but a poll during a walk starts nothing. 95 makes the read beat the star once at its peak; the strobe stays removed.

**Rejected:** Coplanar rings, because one ring can hide another. A wash decoupled from polling, because it is decoration by 80's test. Re-randomising tilts each rebuild, because stars re-tilt on every poll. The diagram in the hero, because it competes with the galaxy.

**See:** decisions 68, 80, 82 (reversed in part), 95.

## 84. A lane says how bad, not what happened; the sentence is where the sentence fits

**Status:** live

**Decision:** A timeline lane ends with the finding count and worst severity (`2 critical`, `1 warn`, `ok`), or the sandbox alarm (`decoy read`, `unknown egress`) when one tripped, from `lib/verdict.ts`; the lane is a button that opens, scrolls to and focuses the check's report card. The decision bar is one line and shows only while something is outstanding, a collapsed disclosure shows its contents on one line with a glyph instead of `expand`/`collapse`, each section has a one-line description, and the run-page specimen is 224 px (160 under `md`) sized by a `ResizeObserver`.

**Why:** A model-written title in a narrow column truncated most where the run had most to say. The alarm outranks the count because the count does not carry that fact, and the count is one click away. A pinned bar on a finished run spends window space on "nothing to do".

**Rejected:** Deriving "3 failed" or a status code for a lane, because nothing on the wire carries those numbers and the page would invent a measurement. A severity word without the count, because it loses one note versus eleven. Anchors and `href="#"` for lane-to-report, because they put a check name in the URL as a route.

## 85. An observed zero is a result; an unobserved one is not

**Status:** amended by 93

**Decision:** Each evidence table reads the report's `sensors` block through `groupState`: a table with a live sensor is `measured` (rows, or `none`), a table without one is `blind` (`not measured`), and a report that never said is `unknown`; coverage is one sentence per block. Alarm colour follows whether a hard rule in `apps/cujo/src/review/findings.ts` reads the flag (`wrote_outside_workspace` is not red), and `flaggedTables` opens only the tables that prove a flag (the opener part is reversed by 93).

**Why:** `sandbox/cujo_sniff/report.py` writes `sensors` so that "not observed" and "not observable" look different. The coverage sentence qualifies one block's tables and counts nothing, so decision 20's rule against counting a blind interval twice holds. Tables have named columns, `—` for blanks, and `refused ×3` from `merge_egress`.

**Rejected:** Plain-language headings, because `egress` is the one word the finding, review and sandbox contract use. Rendering `none` for a report with no health block, because no sandbox made that observation. Collapsing the blocks as a third disclosure level, because it hides what a card holds.

**See:** decisions 20, 93.

## 86. The alert gets its own card, and the opener takes the author line

**Status:** amended by 138

**Decision:** A blocked run's ping is a slim amber embed titled `repo #n — <pr title>` with the critical count, the role mention in `content` and the run URL in angle brackets; when the run leaves `blocked_pending` the same message is edited to the outcome. Each check on the card states its terminal state, criticals and duration (`tests done, 1 critical, 41s`), criticals group by title and evidence for display only, the card links the pull request after an `owner/name` shape check, and the run page has `generateMetadata` from public-serializer fields with `robots: noindex`.

**Why:** A bare URL unfurled into the site's front page and a tick under a `Critical` heading read as a pass. Rule 8's "structural only" now bounds `content` and the two URLs, and the ping title passes through card escaping, truncation and clamping. This reversed decision 55's author-line allocation (opener on the author line), and decision 100 reversed that back: Cujo is on the author line and the opener is in the footer.

**Rejected:** `flags: 4` to suppress the unfurl, because it suppresses the ping's own embed. Reusing `buildRunCard` for the ping, because it shows the same embed twice. Deduping criticals in the fold, because that changes what the review records.

**See:** decisions 55 (reversed), 57, 65, 100, 138.

## 87. Detonation runs even when no test suite can be inferred

**Status:** live

**Decision:** Refines 15. The rubric spawns `detonation` whenever `manifest_changed` is true, with or without an inferred test command; `tests`, `probes` and `smoke` are still skipped without a suite, and `missingCheckFindings` emits no `check_missing` for those three when none had a sub-agent thread.

**Why:** Detonation is not comparative and its gate is settled at setup, independent of test inference. A repo with no discoverable tests gets the most from detonation and got nothing under 15. `REQUIRED_CHECKS` is unchanged; with a suite, all three suite checks are still required.

**See:** decision 15.

## 88. One results cell, and the whole row is the link

**Status:** live

**Decision:** The board's "Checks" and "Found" columns are one cell: four squares, the severity bar and counts such as `2c 3w 1i`, with a Radix tooltip per square on a button and a disclosure for all four lines, sorted by `compareFindings`. The first cell's anchor stretches over the row with a pseudo-element, and the record says "Click a row for the run." under its title.

**Why:** Nothing on the page said what the two columns meant or that one came from the other, and a click outside the first cell did nothing. One anchor keeps one keyboard stop per run and middle-click still opens a tab.

**Rejected:** A prose summary per row, because a reader parses it thirty times. `router.push` on the row, because it is not a link. Tooltips on `title=`, because a keyboard and a touch screen never show them.

## 89. The key comes to the pointer

**Status:** live

**Decision:** While a specimen or row is hovered, the hero's readings fade out (200 ms) and the key diagram fades in on the same grid cell, using the same `PARTS` and diagram as the key under the record. This runs only on a hover-capable pointer while the scene is live, reduced motion swaps without the fade, and the readings are reordered to findings with the critical count first, then live now, then record size.

**Why:** The full key was a screen away, so a reader had to scroll away from the star to learn its parts. One source for both keys keeps them from drifting.

**Rejected:** A permanent legend in the chamber corner, because it adds a fourth block of type. A dismissable first-visit overlay, because local storage makes it reappear on another machine and stay gone after an accidental dismiss.

**See:** decision 83.

## 90. Every star tumbles, and a live one tumbles fast

**Status:** live

**Decision:** Amends 82. Each ring tumbles about an axis in its own plane, alternating direction ring by ring, at one turn in 48 seconds at rest and one in six seconds for a live run (satellites four times faster); the star field box hugs the galaxy with brighter points and a drift of 0.1 unit, and the `cujo` wordmark sits beside the mark on both pages.

**Why:** A ring spun about its own normal shows no motion, and precession about y matched the run page's holder axis. Speed is now the live signal, and the motion still carries no measurement (80). Most of the old star field sat past the fog's far plane.

**Rejected:** The group tumbling as one, because it keeps most of the silhouette still. Speed alone with the old axes, because it did not show.

**See:** decisions 80, 82 (amended).

## 91. The verdict is a card; the operator's numbers fold away

**Status:** live

**Decision:** The run page opens on a verdict card with the status badge, severity chips (`0 critical` stated) and the GitHub review link, or "still running" for a live run, above the generated summary. Model, rubric hash, session and turn ids sit in one "Operator details" fold, token counts and cost get labels inside the check card, findings group by check (critical or warn groups open) with chip filters, and the timeline gets a two-line legend.

**Why:** A PR author wants what was decided, how bad, and where the review is, and had to read a dense paragraph to find them. A number with no unit on a public page is unreadable.

**Rejected:** Removing cost from the public page, because it is part of the run. The card replacing the prose, because the reasoning would move where a reader does not look.

**See:** decision 93 (closed groups).

## 92. Latest and superseded, derived on the board

**Status:** live

**Decision:** The newest run per pull request is marked `latest` and older ones `superseded` and dimmed, derived on the client in `lib/board/supersede.ts` from `repo`, `pr_number` and `created_at` over every run on the board. A pull request with one run gets neither mark.

**Why:** A push dismisses the older run's review, and a reader could act on a verdict GitHub no longer shows. The claim covers only runs on this board, which is the correct scope for a record.

**Rejected:** A field on the public API, because it changes `serialize.ts` and its test for one badge and the public plane adds nothing for the board (57); it stays the answer if the board must know about runs it cannot see.

**See:** decision 57.

## 93. Nothing on the run page opens itself

**Status:** live

**Decision:** Reverses the opener half of 85. Findings groups, check cards, evidence tables and the probe group all start closed; a timeline lane pick still opens and scrolls to its check card, and `EvidenceTable` keeps its `defaultOpen` prop with nothing passing true.

**Why:** A blocked run opened with many cards, tables and groups already open, and the reader first had to close things. The verdict card, lane colour and trigger-row counts now say where the trouble is. The rest of 85 (`none` versus `not measured`, column headers, the alarms map) stands.

**Rejected:** Opening the single worst thing, because the reader then guesses why that one. Remembering open state per reader, because most readers see the page once.

**See:** decisions 85 (reversed in part), 91.

## 94. Running is green

**Status:** live

**Decision:** `live` is a sixth tone, green, used only on what is still executing: a running run's core, badge and verdict text, a running check's ring and segments, and the legend row. The tokens are `--sev-live`, `--sev-live-bg` and `--chamber-live` in `brand/tokens.css`; a finished clean run stays blue, and this amends the "running is inert, not blue" rule at `OUTCOME_TONE` in `tone.ts`.

**Why:** Grey made the one active star on the board the hardest to find, and the pulse did not carry it. Green is off the severity ramp, so it cannot read as a verdict or as "passed".

**Rejected:** Amber pulsing, because it puts the brand accent on a second status and separates `blocked_pending` from `running` by animation only. White with bloom, because it is grey wherever the page has no bloom.

**See:** decisions 68, 82 (amended).

## 95. The gates go, depth wanders, and the light beats the star it reads

**Status:** live

**Decision:** Amends 82 and 83. The layer gates and `room.ts` are deleted; each star's z is its layer z plus up to a third of the layer spacing, seeded off its id (the front layer wanders only backward, pinned in `galaxy.test.ts`); a read star beats once at the read peak (8% rise over 200 ms, 400 ms settle, a hairline ring leaving the core), reduced motion keeps only the glow swell, rings brighten under focus, and the run-page specimen draws on `--bg` with `TONE_PAGE_VAR` and follows the theme.

**Why:** Hoops round the galaxy made it a diagram, and one z per layer read as three flat walls. Layer membership stays a measurement and position within it is decoration (81). One beat per read is legible as a read, and a beat is not the strobe 83 removed.

**Rejected:** Removing the lattice too, because it loses the vanishing point 82 kept. Continuous depth by age, because it reverses 82's layers. An expanding ring alone, because it is the live pulse's shape.

**See:** decisions 81, 82 (amended), 83 (amended).

## 96. The envelope roll-up is the model's work, so the schema reads it leniently

**Status:** live

**Decision:** Refines 62. In `report-schema.ts`, `TruncatedRollUp` and `DerivedRollUp` are `.partial()` of the strict schemas and apply only at the envelope (keys optional, booleans when present, non-objects refused, `derived` still required), while `runs[]` entries stay strict; `Truncated` gains `sensor_logs`, and `validateReport` reports the union branch with the fewest issues plus the count of unnamed ones.

**Why:** A block a model writes is read leniently and a block the sandbox writes is not. `report_invalid` fired on every run over the hand-written roll-up, and `sensorLayers` already runs the hard rules over every `runs[]` entry, so nothing is lost. A hard-rule warn still cannot reach the posted review (21, 42, 74, 5) and needs its own decision; the rubric now contrasts the two meanings of `truncated` instead of renaming one (54).

**Rejected:** Lenient run-level blocks, because a renamed field in `sniff.py` would fail nothing (62 reversed). Accepting a non-object roll-up, because it is a wrong shape. Dropping the roll-up from the schema, because it loses the value type check.

**See:** decisions 5, 21, 42, 54, 62, 74.

## 97. The template tires the reader, not the model

**Status:** live

**Decision:** Refines 74. `packages/review-render` puts evidence below `detail` and `next`, renders a finding with no `detail`, no `next` and one-line evidence as `**title** · meta — evidence` (a `critical` never collapses), and prints coverage one line per check; `agent/SKILL.md` bounds `title`, caps `detail` at two sentences, merges findings that share a cause and anchor, and has `next` on a `critical` name one action.

**Why:** The model's prose was good and the repository's template made the review tiring. `github-mcp` is stateless, so the rendering reaches every session on deploy, while rubric changes reach only sessions created after it (16). The ban on praise and exclamation marks stays.

**Rejected:** Folding evidence into `<details>`, because evidence is what this reviewer has and should not need a click. Collapsing by severity, because it flattens a `warn` that makes a case. Telling the model to write shorter blocks, because a rule a model applies fails silently (74 reversed).

**See:** decisions 16, 74.

## 98. The board carries the manual, and it is the one thing indexed

**Status:** reversed in part by 175

**Decision:** `apps/web` serves a twelve-page manual at `/docs` in four task groups, written in TSX with `nav.ts` as the only order and `registry.ts` as the only slug map (a test checks they agree), with status, severity and alarm text generated from `SEVERITIES`, `RUN_STATUSES`, `STATUS_LINE` (moved to `lib/api/status-line.ts`) and `lib/api/report.ts`. `robots.ts` allows `/docs` and nothing else, with a test; the manual is reached from the footer's bottom rule, the 404 and the empty-state onboarding, and decision 175 brings a navigation bar back.

**Why:** The facts an adopter needs were written for contributors. Generated vocabulary keeps the manual matched to the words `apps/cujo` uses, and the pages quote no one, so indexing them does not undo the board's exclusion (34). The self-host page names no vendor; `architecture.md` keeps this deployment's specifics.

**Rejected:** MDX, because it adds a dependency and build config and makes generated vocabulary harder. A `sitemap.ts`, because it needs a build-time origin (35). Reusing `.cujo-prose`, because restyling the manual would restyle agent output.

**See:** decisions 34, 35, 49, 57, 65, 175.

## 99. The watchdog bounds the run, not the current process

**Status:** live

**Decision:** On restart, `rehydrate` finds the latest `turn.created` event and passes `remaining = turnTimeoutMs - (Date.now() - turnStart)` as `budgetMs` to `follow` → `consume` in `runner.service.ts`; if the budget is spent, `fireWatchdog` runs at once, and with no `turn.created` event the anchor is `run.createdAt`. `start`, `approve` and `pollForNewTurn` keep the full budget.

**Why:** The timer was armed from "now" on every `consume`, so each redeploy (decision 35) gave an in-flight run another full window. The anchor is the turn's own start, so a turn that resumes after approval gets a fresh window and only a restart within the same turn inherits elapsed time.

**Rejected:** `run.createdAt` as the sole anchor, because it charges preparation and approval wait to the resumed turn. `updatedAt`, because every `refold` moves it. `setup.turnCreatedAt`, because it makes the runner depend on fold output.

**See:** decision 35.

## 100. Cujo leads the card, the opener closes it, and the sections breathe

**Status:** live

**Decision:** Reverses the author-line placement of 86: Cujo takes the Discord embed's author line, and the footer reads `@login · run <id> · <sha>` with the opener's avatar (built from the numeric account id, as in 55 and 86), stripped of markdown and bidi characters, with no profile link. Between surviving field groups the card adds a blank-row field (name and value one zero-width space), budgeted in the clamp, inserted after it, and dropped with its group.

**Why:** A channel reads the fixed party first, so the product name leads and the opener signs at the bottom-left, where the footer icon renders. The footer renders no markdown, so a link or escape shows as literal text. The clamp searches reserves from loose to tight and takes the first layout where survivors plus their blank rows fit.

**Rejected:** An `Opened by` field, because it splits name and avatar again. Keeping the profile link by any means, because it spends field budget or shows literal syntax. Real blank lines inside field values, because they widen sections instead of separating them.

**See:** decisions 55, 86 (reversed in part).

## 101. The page does not bounce

**Status:** live

**Decision:** `overscroll-behavior-y: none` is set on both `html` and `body`. Inner scrollers keep their default, and horizontal overscroll stays with the browser.

**Why:** The rubber-band read as the record sheet slipping on the pinned chamber, and on Android the same gesture is pull-to-refresh of a page that polls the API. Browsers disagree on which element is the root scroller, so both get it. Horizontal overscroll is the back and forward gesture; Safari 16 is the floor.

**Rejected:** Applying it to every scroller, because it strands scroll at the record's edge mid-page. `position: fixed` on body, because it breaks the sticky hero and approve bar.

## 102. The key waits for a stay

**Status:** live

**Decision:** Refines 89. The key replaces the readings only after the focused run holds for three seconds, the wait restarts on every change of focused run, a committed key stays while the pointer moves star to star, and one leave restores the readings at once.

**Why:** A pointer sweep across the galaxy made the readings blink for every star it crossed. The focus store is unchanged, so star and row highlight stay immediate. Three seconds separates reading a star from walking the field.

**Rejected:** Hiding again on a move between stars, because it returns the flicker. A long fade, because it slows a real dwell and strobes a fast sweep. Delaying the focus store, because the star highlight must stay immediate.

**See:** decision 89 (refined).

## 103. The verdict card stops linking out

**Status:** live

**Decision:** Reverses part of 91: the verdict card drops "Read the review on GitHub" and shows only the status badge and the severity counts. `reviewPosted` and `gatedReviewPosted` still drive the review panel and the approve bar.

**Why:** The review panel on the same page renders the review, the run header links the pull request, and the reader arrived from the link. The link only invited the reader to leave before reading the page.

**Rejected:** A disclosure, because it reveals one link nobody asked for. Moving it into the review panel, because that panel is the review.

**See:** decision 91 (reversed in part).

## 104. Supersede, do not delete, on re-review

**Status:** live

**Decision:** `/cujo review` marks the old run `superseded` instead of deleting it, and `runs_head` becomes a partial unique index over non-terminal statuses only, so `createRun` no longer pre-deletes stale error runs. `Runner.supersede` sets the in-memory flag at once but writes the status only after the turn is confirmed stopped; a failed cancellation reverts the flag and returns `false`.

**Why:** Deletion broke the old review's `Full evidence:` link. `superseded` already means "a newer head replaced this run." The duplicate-delivery guard (`INSERT OR IGNORE`) still holds, because only a `running` or `blocked_pending` row occupies the index.

**Rejected:** A tombstone, because it loses the run's data for board history. Dismissing the old review, because that solves stale reviews (decision 52), not evidence reachability.

**See:** Contract 5; decision 52.

## 105. SessionEvents are validated at the boundary

**Status:** live

**Decision:** A Zod schema with `.passthrough()` checks only the `SessionEvent` fields `fold.ts` and `runner.service.ts` read, at the three entry points (`push`, `rehydrate`, `replayTurn`); a failure is logged as `run.event.invalid` and the event is kept. A compile-time test asserts the SDK's `SessionEvent` type is assignable to the schema's inferred type.

**Why:** SDK types are compile-time only, so a renamed field could let a run fold to `clean` with evidence missing. Passthrough keeps newer fields, as decision 54 does for reports, and warn-never-reject matches decision 62. Downstream consumers trust the boundary.

**Rejected:** Validation at every consumer, because it adds upkeep for no safety. Full SDK surface validation, because it rejects newer fields. Dropping invalid events, because it fails toward `clean`.

**See:** decisions 54, 61, 62.

## 106. Every expanded link carries the one branded still

**Status:** live

**Decision:** One dark, opaque 1200x630 `opengraph-image.png` at the `apps/web` app root serves every route, with `metadataBase` making its URL absolute. `pnpm --filter @cujo/brand og <jetbrains-mono.ttf>` generates it with resvg from `avatar.svg` and `wordmark.svg`, refusing system fonts, and a test holds the copy in `apps/web` byte for byte and at that size.

**Why:** Pages had only `og:title` and `og:description`, so previews had no image. The run's identity already travels in title and description, so the image carries only the brand. A dark ground stays legible on any client theme (decision 55's argument); the font is passed in, not committed, and noindex is unchanged (86, 98).

**Rejected:** A per-run `next/og` card, because it needs committed or runtime-fetched fonts. A separate `twitter-image`, because Next falls back to `opengraph-image`. A transparent ground, because it vanishes on a light theme.

**See:** decisions 22, 55, 86, 98.

## 107. A run that proved nothing is `unproven`, not `clean`

**Status:** live

**Decision:** `fold` sets `unproven` when a review posted and no check returned a report; it sits directly above `clean` and below every contradiction rung, and is terminal. The terminal list is one exported constant, `TERMINAL_STATUSES_SQL`, used at each SQL site, and migration 10 rebuilds `runs_head` from it; migration 9 keeps its literal.

**Why:** Operational rules are `warn` by design (62, 96) and cannot move a status, so coverage enters as a status. It is not `error`, because Cujo ran and posted; it shares `error`'s blue and the word carries the difference. The test is a returned report, not a thread, and the no-suite case of 87 with only `detonation` reporting stays `clean`.

**Rejected:** Folding coverage into `error`, because it erases the distinction. A coverage field with status `clean`, because list views show only status. Making operational rules `critical`, because a formatting warn would block a merge.

**See:** decisions 62, 87, 96, 98.

## 108. A failed check is respawned once, by the rubric, and the run records it

**Status:** amended by 143

**Decision:** The rubric tells the parent to respawn a sub-agent that returns an error instead of a report once, under the same name, after a short wait, and `CheckState.attempts` records which attempt each thread was. `deriveDigest` (in both `apps/cujo` and `apps/web`) now takes the last thread for a check, and the run duration envelope spans every attempt.

**Why:** A sub-agent is a thread inside a harness turn, so `clients/trueforge.ts` has no handle to restart it. Two faults in a row mean the provider is down, and a third attempt spends watchdog budget. `check_missing` keys on titles that reported, so it needs no change; session pinning (16) limits the retry to new sessions.

**Rejected:** Retrying the whole turn, because the parent had already posted. Cujo respawning over the SDK, because it makes the trusted side a second author inside the agent's turn. Collapsing attempts into one `CheckState`, because it loses the first attempt's timings and error.

**See:** decisions 16, 73, 107.

## 109. A timed-out run posts what it measured, as a comment and never a review

**Status:** amended by 138

**Decision:** When the watchdog fires and no review posted, Cujo harvests the run with a `listEvents` read folded into an unpersisted projection (falling back to the stored one) and posts one comment through `createComment`, with `heldClaims` giving only the count of held malice claims. `run_announcements`, keyed on the run, is claimed before the GitHub call, and the run keeps `status: "error"`.

**Why:** The projection held real reports but the author saw nothing. `apps/cujo` has no review-creation call (decision 5), so this path cannot become a review, and a comment that states no accusation stays within 38 as narrowed by 42. `replayTurn` would drop the synthetic terminal, and the read also detects a late review, in which case nothing posts.

**Rejected:** Synthesising a verdict, because judging reports is the agent's job. Raising the ceiling, because a hung check still hangs. Posting through `github-mcp`, because it puts the gate's tool on a path no human is on.

**See:** decisions 5, 38, 42.

## 110. Operational hard rules reach the author, as a follow-up comment

**Status:** live

**Decision:** When `check_missing`, `sensor_unarmed` or `report_invalid` trips after a review posted, Cujo posts one follow-up comment per run naming the gaps and saying they do not change the verdict. It uses the module and claim of decision 109 and never edits the posted review.

**Why:** The posted body counts only the agent's findings, and Cujo re-derives hard rules after posting (decision 21), so the two surfaces disagree by construction. Operational rules say the evidence was thin, not that the code did anything (62, 96), so passing them on is allowed under 38. A timed-out run has no review and never reaches this path.

**Rejected:** Documenting the gap as intended, because the author still sees a wrong count. Changing only the board headline, because it tells the author nothing. Teaching `github-mcp` the hard rules, because it would read Cujo's store, against decision 5.

**See:** decisions 5, 21, 38, 62, 96, 109.

## 111. Where a command runs and what the sensors call the workspace are two questions

**Status:** live

**Decision:** `sniff.py run` adds a repeatable `--workspace-root` that sets what the sensors count as inside the workspace, defaulting to `[cwd]`, while `--cwd` sets only where the command runs. The rubric runs one install per service root with `--cwd` on the service and `--workspace-root` on the tree root.

**Why:** Execution ran only at `/work/head` and `/work/base`, so the `tests` check never got evidence on a multi-service repository. Narrowing `--cwd` alone would class writes elsewhere in the tree as outside and feed `fs_changes` and `derived.wrote_sensitive`, a false accusation. The exclusive lock makes installs serial, which the rubric states; `sandbox/` stays standard-library only (46), and session pinning (16) limits this to new sessions.

**Rejected:** Inferring roots in `sniff.py`, because it moves layout judgment into the untrusted zone. A shell string, because PR text would become a shell injection surface. Narrowing the workspace with `--cwd`, because of the false accusation.

**See:** decisions 16, 46.

## 112. `sniff.py` assembles the envelope, because asking a model to did not work

**Status:** extended by 145, completed by 147

**Decision:** Every `run` and `detonate` appends its entry under the check's name, and `sniff.py report --check <name>` prints the whole envelope: `check`, `schema_version`, every entry whole, and the computed `derived`, `sensors` and `truncated` roll-up. The sub-agent supplies only per-check fields through `--extra`, spread under the envelope keys so it cannot override them.

**Why:** Models kept trimming `runs[]` entries despite the rubric, and the validator could not get looser (decision 96). Copying one blob is reliable. `derived` and `truncated` are an OR across entries, a sensor is armed only if armed for every entry, and the validator is unchanged (62).

**Rejected:** Requiring the envelope's `schema_version`, because it punishes pinned sessions (54). A repair pass, because it invents fields. A stricter rubric, because that already failed three times.

**See:** decisions 16, 19, 46, 54, 62, 96, 110.

## 113. The sandbox is an interface, reached through MCP and not through the harness

**Status:** refined by 128

**Decision:** Cujo sets `config.sandbox` to `{ enabled: false }`, registers no harness sandbox provider, and reaches a sandbox through `sandbox-mcp`, a second remote MCP server beside `github-mcp`. `apps/sandbox-mcp/src/runtime.ts` defines five vendor-neutral operations, with Daytona and a local container runtime as implementations chosen by `CUJO_SANDBOX_RUNTIME`.

**Why:** The SDK fixes the provider type to the literal `"daytona"`, one per tenant, with no image field, so the harness cannot use another sandbox. Ids are minted by the server, and the image, gateway image and runtime come from the environment, never from tool inputs. `sandbox-mcp` has no `requireApprovalForTools`, because the gate is for accusations (42); 128 exposes its five tools to the model by name.

**Rejected:** Forking the SDK, because it is decision 1 in reverse. A stdio MCP server, because `McpServerType` has only `"remote"`. Two sandboxes per review, because evidence and checks could split.

**See:** decisions 1, 42, 46, 128.

## 114. `sandbox-mcp` cannot carry the hardening the other services do

**Status:** live

**Decision:** `sandbox-mcp` holds the host Docker socket and so runs without `read_only` and `cap_drop: ALL`, but keeps `no-new-privileges`. Each sandbox container it creates gets `cap_drop: ALL` and `no-new-privileges`.

**Why:** It provisions a container, an egress gateway and a network per sandbox. It runs no PR code and takes no image, host path or runtime name from a caller, so the hardening sits where the untrusted code runs. `CUJO_SANDBOX_RUNTIME=daytona` restores the vendor shape and gives up the egress property (116).

**Rejected:** A rootless Docker socket, because it is a host change outside this decision. A Docker-in-Docker daemon, because it adds a privileged container. A library instead of the CLI, because the socket stays.

**See:** decision 116.

## 115. `provisioned_ms` replaces the `sandbox.created` event

**Status:** live

**Decision:** `sandbox_create` returns `provisioned_ms`, and the fold reads it into `setup.sandboxProvisionedMs`, first writer wins, recording nothing if the value is not a finite number. `setup.sandboxCreatedAt` stays for stored projections.

**Why:** The harness no longer provisions (113), so `sandbox.created` never fires, and a null there means the sandbox already existed per `docs/spec.md`. An unmeasured value is absent, not zero (54). Per-check `sandboxMs` comes from `report.runs[].duration_s` and needs no change.

**Rejected:** Deleting the field and span, because it loses the one non-agent setup measurement. Filling `sandboxCreatedAt` with a local timestamp, because it is from a different clock.

**See:** decisions 54, 113.

## 116. Egress is enforced outside the sandbox, and its allowlist is a crossing

**Status:** refined by 121

**Decision:** Egress control moves out of the sandbox to a gateway container that holds the only route off and filters with nftables in the order default deny, allowlist, NAT; the in-sandbox proxy stays as a sensor, and the runtime is gVisor (`runsc`), configurable, with an empty name falling back to Docker's default and a warning on every create. The `.cujo.yml` allowlist is a crossing: the trusted side validates it and refuses it rather than repairs it (hostnames only, no scheme, port, path, CIDR, wildcard, credentials, control character or address, at most 32 entries), resolves each name to every address, and logs and skips a name that does not resolve.

**Why:** A control in the untrusted zone sits next to the code it judges, and the sandbox shares no namespace, filesystem or process tree with the gateway. A gateway with no default route refuses to forward rather than fall back. A partly parsed allowlist would leave a repository relying on an allowance it does not have. gVisor needs no VMM or rootfs pipeline, and the threat here is exfiltration, not kernel escape.

**Rejected:** Hardening the proxy as the control, because the boundary stays inside. An allowlist of CIDRs, because that is a network policy a repository should not write. Resolving the allowlist once at boot, because it pins a CDN's addresses for the life of the deploy.

**See:** decision 121.

## 117. The sandbox image is ours, which reverses 46

**Status:** live

**Decision:** Reverses 46 in part: `sandbox/Dockerfile` (from decision 113) builds the review image with `sniff.py` and `cujo_sniff` copied to `/opt/cujo` as siblings, so there is no runtime fetch, `CUJO_SNIFF_TARBALL_URL` and `tarballUrl()` are gone, `specFingerprint` is a digest of the rubric as written, and `pytest` is in the image. The image runs as a non-root user with `tini` as PID 1, state stays at `/tmp/cujo-state`, and the stdlib-only rule for `sandbox/` becomes a default: a third-party import needs a reason in the pull request.

**Why:** Every constraint in 46 came from the image belonging to the provider, and 113 changed that. A layer cannot be half-extracted, and an image digest in the fingerprint would re-pin every session on each rebuild (16). Every package in the image is reachable by pull request code, so additions need a reason. Root would make every `wrote_sensitive` reading weaker, and without an init an abandoned child leaves a zombie in a later check's `subprocesses`.

**Rejected:** Pinning the archive to a commit, because the image stays somebody else's. Installing the repository's dependencies into the image, because the image would know what it reviews. Installing every language with `apt`, because `.cujo.yml` can state that case.

**See:** decisions 46 (reversed in part), 113, 111, 16, 19.

## 118. `sandbox-mcp` builds the images it runs, at boot, from contexts it carries

**Status:** live

**Decision:** `apps/sandbox-mcp/Dockerfile` copies `sandbox/` and `apps/sandbox-mcp/gateway/` to `/app/images`, and when the runtime is `local`, `buildImages` runs `docker build` on each at boot through the socket, tagging `cujo-sandbox:latest` and `cujo-sandbox-gateway:latest`; `/healthz` and `/mcp` answer 503 until both finish, a failed build ends the process, the healthcheck `start_period` is twenty minutes, and the build does not `--pull`. `CUJO_SANDBOX_IMAGES_DIR` set empty skips the build.

**Why:** The tags are not compose services, so Coolify's `up --build` never builds them and a `docker run` of an unknown tag fails at provisioning. Building at boot makes the sensors exactly the code the deploy shipped, which the `specFingerprint` argument in 117 rests on. The build contexts are the image's own files and the tags come from the environment, so nothing a pull request wrote reaches the build. A registry outage must not stop a deploy whose layers are cached.

**Rejected:** Pre-built images in a registry, because that is a release step and a second credential (35). Building lazily on the first `create`, because minutes of build land inside an agent's tool call. A `depends_on` on a build-only compose service, because it relies on Coolify keeping the `image:` name, ties freshness to the deploy pipeline, and shows as an exiting service.

**See:** decisions 113, 114, 116, 117, 35.

## 119. No review bot; `best_practices.md` goes with it

**Status:** live

**Decision:** Qodo is uninstalled, `best_practices.md` is deleted so the Standards section of `CONTRIBUTING.md` is the one copy, and the README's "Qodo Code Review Evidence" section goes. The merge bar is CI green and every open review thread applied or answered with a one-line reason and resolved.

**Why:** The bot was installed for an event that has passed and had stopped answering, so it gated merges on a service that did not respond. With no bot there is no reader for the mirror file, and a second copy of a rule set drifts. A future review bot is a new decision with a new entry. This reverses nothing numbered; entries that cite the bot or `best_practices.md` (26, 35, and others) stay as written.

**See:** decisions 26, 35.

## 120. `sandbox-mcp` says `requireApprovalForTools: []`, because absent means everything

**Status:** reversed in part by 128, amended by 138

**Decision:** Both `sandbox-mcp` specs set `requireApprovalForTools: []`, because the SDK default `["@write", "@destructive"]` gated every sandbox tool but `sandbox_read_file` and paused reviews into `blocked_pending`. Decision 128 reverses the premise: on `apps/harness` absent means none, and the empty list stays because it means what it says.

**Why:** Decision 113 left the key absent on the reasoning that only the accusation is gated (42), and the reasoning holds but the spelling was wrong. Annotating the tools as read-only would misstate that `sandbox_exec` runs pull request code and `sandbox_destroy` removes a box. Teaching the fold to allow `blocked_pending` only through `post_gated_review` is a separate change with its own test.

**See:** decisions 113, 42, 128, 138.

## 121. The gateway is the sandbox's router and resolver, which refines 116

**Status:** live

**Decision:** Refines 116: the sandbox network is not `--internal` but a bridge with `com.docker.network.bridge.inhibit_ipv4` and host masquerade off, the gateway claims the subnet's gateway address so the sandbox's default route reaches only it, and the sandbox runs with every capability dropped. The sandbox's `--dns` is the gateway, where `dnsmasq` forwards allowlisted names and the clone host `github.com` (a baseline) and answers NXDOMAIN for the rest; the gateway accepts only port 53 from the sandbox leg, is created with `--sysctl net.ipv4.ip_forward=1` and its outside leg at highest `--gw-priority` (Docker 28) before start, and `create` waits, bounded, for `gateway.armed`.

**Why:** An internal network gives no default route and an embedded resolver that refuses to forward, so no packet reached the gateway. A resolver that answers for any name is a covert channel, so a name outside the list must not resolve. The clone is Cujo's own step, so a repository must not have to declare its host. A resolver not yet listening makes a clone fail in a way that looks like an outage.

**Rejected:** Sharing the gateway's network namespace (`--network container:`), because the policy then sits with the code it judges and in the path of gVisor's netstack. A non-inhibited bridge with masquerade off, because the host stays the sandbox's router. Leaving DNS to the daemon, because it resolves any name.

**See:** decision 116 (refined).

## 122. The gateway's baseline is the sensor's known-host list

**Status:** live

**Decision:** The gateway's baseline allowlist is the sensor's `KNOWN_INDEX_HOSTS`: the clone hosts and the package indexes for Python, Node, Rust, Go and Ruby, and a repository's `allow_hosts` adds to it. The sensor keeps its own copy in `policy.py`, and a test in `sandbox-mcp` fails if the two lists differ.

**Why:** Extends the argument of 121 from the clone to the install: a repository never had to name a registry under the old proxy, and the gateway (116) did not inherit the list. Nothing under `sandbox/` can import from the trusted side (46, 117), so the copies must be kept equal by a test. The sensor's list says what egress was expected and the gateway's says what is possible, so a host on only one is either a failed install or an unknown row the gateway let through.

**See:** decisions 116, 121, 46, 117.

## 123. The harness is ours, built on pi, and the contract is a package

**Status:** live

**Decision:** The harness is `apps/harness`, a TypeScript service with the same port and eight operations, built on the pinned pi coding agent SDK (`@earendil-works/pi-coding-agent`), which owns the loop, providers, retry and compaction while the harness owns sessions, turns, the event log, the gate and the sub-agent tool. The contract is `packages/harness-contract`: the TrueForge event vocabulary as shared types and Zod schemas, camelCase, without `sandbox.created`, `mcp.*`, `tool.response_required` or the spec keys `sandbox`, `askUserQuestions`, `generativeUi` and `skills`, and with `tool.response.toolName` added.

**Why:** The design record had become a list of workarounds for the hosted harness (16, 56, 69, 108, 109, 120, Contract 6). The vocabulary stays because `fold.ts`, the event schema and the board already speak it. Reverses the hosted-harness dependency of 1 and 2, and refines 17 and 18 (the projected event log is now the harness's SQLite table).

**Rejected:** The Claude Agent SDK, because it speaks only the Anthropic API and hides the sub-agents, retries and transcript this decision exists to own. The OpenAI Agents SDK, because it adds a second opinionated layer before the gate. Writing the loop, because that is where the time goes. A separate repository, because it adds a release step per change.

**See:** Contract 6; decisions 1 (reversed), 2 (reversed), 17, 18 (refined), 16, 56, 69, 108, 109, 115, 120, 125.

## 124. A sub-agent is a nested pi session, and its report is durable as it lands

**Status:** live

**Decision:** `create_sub_agent` is a harness tool with the `{ name, input }` shape from `agent/SKILL.md`, run as a second in-process `AgentSession` with the rubric as system prompt, the sandbox tools only (no `github-mcp` tool, no `create_sub_agent`), and an in-memory transcript. Its `thread.created`, `model.message`, `tool.response` and `thread.done` events go to the parent's log tagged with a thread id, each written to SQLite before the next step.

**Why:** A parent turn that times out after its children reported loses nothing, because the reports are already rows (109). pi runs sibling tool calls concurrently, and a parent abort aborts its children, so the wedged-session facts of 69 no longer hold. Decision 14 (one sub-agent per check) and 108 (a failed sub-agent is respawned once) stand.

**Rejected:** A pi subprocess per sub-agent, because it hides the child's events behind stdout parsing. Flattening to one agent, because it changes the fold, the hard rules and the board.

**See:** decisions 14, 69, 108, 109.

## 125. The gate holds the call; a new turn voids it; a restart is answered by a re-call

**Status:** amended by 138

**Decision:** The gate is pi's `beforeToolCall`: a call to a tool in `requireApprovalForTools` writes a pending approval, emits `tool.approval_required` on `main`, ends the turn `done` with that event as its required action, and waits with no deadline until the next turn's `user.tool_approval` allows (the `tool.response` carries the original call id) or denies (the reason is the tool result). A `user.message` during a pending approval supersedes it and aborts the run instead of a 422, and after a restart the answer closes the dangling call with a result and starts a turn that asks the model to repeat the call, which the gate passes once with identical arguments.

**Why:** One send answers the approval and starts the turn, as Contract 4 says. The stale-deny of 39 stays only as a message to the model. A call that never ran is not a side effect to replay, so a restart needs a message, not a replay engine.

**Rejected:** Persisting the suspended call and executing it without the model on allow, because it is a second path the model never sees. Failing the run on restart, because it discards a review a human was about to approve.

**See:** Contract 4; decisions 39, 138.

## 126. A gated tool runs sequentially, so the observation posts before the pause

**Status:** amended by 138

**Decision:** A tool named in `requireApprovalForTools` is registered with pi's `executionMode: "sequential"`, so pi prepares, executes and records each call in the batch before it preflights the next. The advisory posts before the gate is reached.

**Why:** pi's default parallel mode preflights every call first, so the gate would hold the batch before the advisory ran, and a deny then a cancel would drop it while the fold believed it posted. The two-call design exists so the observation always publishes. A gated call in the same message as `create_sub_agent` calls would serialize them, and the rubric never writes that message.

**See:** decision 138.

## 127. Reasoning effort is clamped by the harness, not declared by the provider

**Status:** live

**Decision:** pi clamps the thinking level against what the model declares (`xhigh` and `max` fold to `high` unless mapped; `reasoning: false` gets none), so `MODEL_PROVIDER_REASONING_EFFORTS` goes and the seven effort words are validated where they are read. The manifest carries `reasoning`, `contextWindow` and `maxTokens` per model. Reverses 56; 53 stands.

**Why:** Decision 56 existed because TrueForge refused an undeclared effort with a 502 after boot, and pi has nothing to declare or refuse. pi clamps the output cap against the window, and with both zero it would ask for one token, so the manifest must carry them. The effort is still a deployment setting pinned at session creation (53).

**See:** decisions 56 (reversed), 53.

## 128. MCP tools are exposed by name, and only exact names are gated

**Status:** amended by 138

**Decision:** The harness bridges each MCP server's `listTools` into pi tools of the same name with the server's JSON Schema unchanged, so the model sees `post_gated_review` and `sandbox_exec`, not a `call_tool` meta-tool, and only remote streamable-HTTP servers are supported. `requireApprovalForTools` is a list of exact tool names, with no `@write` or `@destructive` classes, and absent or empty means none.

**Why:** The fold already recognised both forms, so the meta-tool branch goes with the cutover. With no classes, the empty list in 120 is no longer a workaround and means what it says. Refines 113; reverses the premise of 120.

**See:** decisions 113 (refined), 120 (premise reversed), 138.

## 129. Compaction is pi's context-window rule

**Status:** live

**Decision:** pi compacts when the context would exceed the model's declared window less a reserve, and the harness logs `harness.compaction.finished`. `CUJO_COMPACTION_THRESHOLD_TOKENS` goes; the spec's `compaction.enabled` stays, on for the review session and off for the conversation session.

**Why:** Decision 64 raised TrueForge's threshold to 200,000 tokens with no signal when compaction happened. pi's rule needs no knob and emits an event. Reverses 64.

**See:** decision 64 (reversed).

## 130. A harness restart ends a running turn as an error, so Cujo retries it once

**Status:** amended by 138 and 140

**Decision:** At boot the harness ends a turn that was running when the process died with `turn.done { status: "error", message: "harness restarted" }`, not `cancelled`. Shutdown drops the pi sessions without bookkeeping, so a running turn becomes this retryable error and a held approval stays pending for the re-call path (125).

**Why:** The fold treats every cancel as final and Cujo's retry refuses it, while an error lets Cujo start the turn over once. A restart mid-review is then one lost attempt, not a lost review. A shutdown handler that cancelled turns also marked held approvals superseded, so a confirm after a deploy could never post.

**See:** decisions 125, 138, 140.

## 131. A sensed command refuses to open a second window

**Status:** live

**Decision:** `run_sensed` marks its child with `CUJO_SENSED_WINDOW`, and `sniff.py run` and `sniff.py detonate` exit at once on it, before touching the exclusive sensor lock, with a stderr message that says what to do instead.

**Why:** Each command holds the lock for its window (111), so a `detonate` wrapped in `run` waited on the outer lock until a timeout and reported no install and no egress. A sentence back lets a respawned sub-agent (108) get the command right, where a timeout makes it repeat the mistake. The rubric alone did not stop the model from wrapping it.

**Rejected:** A re-entrant lock, because both reports would describe the same rows. Detecting the wrapper in `run`'s argv, because it misses `sniff.py` reached through a shell.

**See:** decisions 111, 108.

## 132. A token budget in the spec, enforced by the harness

**Status:** live

**Decision:** An agent spec may carry `config.tokenBudget`; after each assistant message the harness sums the billed tokens of the turn, sub-agents included, and once the sum passes the budget ends the turn with `turn.done { status: "error", message: "token budget exhausted: N of B" }`, metrics attached. Absent means unlimited.

**Why:** Billed tokens are what a provider charges, including each re-read of the context, so they are the right unit for a spend cap. The check runs after a message, so one message can overrun the budget but none can follow. The harness enforces it because only it stands between messages, while `apps/cujo` sees usage only after the fact.

**Rejected:** `maxTokens` per response, because it bounds one reply and not the turn. `iterationLimit` alone, because it bounds messages and not context.

## 133. Cujo is a diff reviewer that can execute; the sandbox is a tool and a floor

**Status:** amended by 138

**Decision:** Cujo is a diff reviewer that can execute: a repository may choose the diff review, which reads the pull request against the repository's written standards on a cheap model, with no sandbox and a token budget, and posts one advisory review. The sandbox review is unchanged and the rules send any pull request that needs running to it, such as a dependency change or a pull request nobody wrote.

**Why:** Decision 11's full run on every pull request fits a product whose one idea was the sandbox, not a reviewer on trusted repositories with CI, where re-running a suite costs time with no reader. The sandbox review's design, the hard rules, the gate and the trust boundary do not change; a diff run never opens the bridge. Later slices make the sandbox a tool the reading reaches for.

**Rejected:** The sandbox review with a "skip the checks" switch, because it keeps a fifteen-minute session and 150 iterations for one reading. A separate service, because the webhook, run record, review tool and board are the same.

**See:** decisions 11, 138.

## 134. The diff review's package is prepared in code

**Status:** live

**Decision:** `apps/cujo` prepares a package (Contract 11) on the trusted side, with changed files, hunks, capped and ordered, the standards files, the previous review's findings and a list of what was left out, and sends it as the turn's one message; the model never lists files, fetches a patch or opens a standards file. The standards files are `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and `.github/copilot-instructions.md`, read at base, and a failed read ends the run.

**Why:** None of that preparation is judgment (71), so the model's spend goes only to judgment and the package caps bound the cost. The session then needs only the review tool, which keeps decision 137's session safe, and omissions are listed the way a sensor report states what it could not observe (54). Reading at base follows decision 13, and "no standards" differs from "GitHub did not answer".

**Rejected:** Giving the diff session a read tool, because spend is then unbounded. Sending the whole diff and relying on compaction (129), because compaction summarises away the hunks a finding anchors to.

**See:** Contract 11; decisions 71, 137, 54, 13, 129.

## 135. Review mode: deploy default, `.cujo.yml` from base, floors the code enforces

**Status:** live

**Decision:** `startRun` resolves the run's `mode` from `CUJO_REVIEW_MODE` (default `sandbox`), overridden by `mode:` in `.cujo.yml` read at the pull request's base SHA with the strict line rule, and then floors in code: a changed dependency manifest or a Bot author is always `sandbox`. `mode` is published on both planes, list included, and shown on the run page, record row and Discord card; a diff run reaches `clean` or `error`, never `unproven`.

**Why:** The base SHA is fixed, so a push to the target branch cannot change the answer, and policy is what the pull request targets (13). A repository owner may pick the cheaper review but not skip the review that watches an install, and a pull request nobody wrote is one nobody read; the floors follow decision 9's split. A `clean` that read the diff and a `clean` that ran it are different claims.

**Rejected:** A per-run `.cujo.yml` read by the agent in the sandbox, because the diff path has no sandbox. Letting the model decide, which a later slice does only within these floors. Reading the default branch, because of the race.

**See:** decisions 13, 9.

## 136. A diff finding is at most `warn` and always advisory; a `critical` is a contradiction, not clamped

**Status:** amended by 138

**Decision:** The diff rubric offers `info` and `warn` only and permits `post_advisory_review` alone; a suspected breakage is a `warn` whose `detail` says what would prove it. The fold ends a diff run `error`, naming the tool or finding, on a `post_blocking_review`, a `post_gated_review` or a `critical` on its advisory.

**Why:** A block needs evidence a reader cannot produce, which the sandbox review produces (9). The fold does not clamp, because the review is already on the pull request and decision 74 forbids the board describing a finding differently. The sandbox ladder pays the same `error` cost for the same mistake (Contract 3).

**Rejected:** Clamping, because of decision 74. Gating the other two tools on the diff session, because it holds a forbidden call for a human with nothing to answer.

**See:** Contract 3; decisions 9, 74, 138.

## 137. A diff run gets its own harness session

**Status:** live

**Decision:** Each diff run creates a fresh harness session on the diff spec and records it on the run before the turn starts; its memory of the pull request is the previous review's findings in the package (Contract 11), not the transcript. The per-PR session row is still claimed at the webhook, because `session_id` is not nullable and the mode is not yet known.

**Why:** A session is one spec (16), and the diff spec has no sandbox server, a different rubric and a token budget. Long sessions made checks much slower, and a transcript grows in cost with every push, while a short summary of the last review does the same work. The idle row on a read-only repository is a row, not a pi session, since the harness opens nothing until a turn.

**Rejected:** One diff session per pull request, because it repeats decision 16's weight problem and adds a table. Reusing the sandbox session and spec, because it hands a reading session a box.

**See:** Contract 11; decision 16.

## 138. The block is a check run, and the human decision is the unlock

**Status:** live

**Decision:** Every review posts at once through `post_advisory_review` or `post_blocking_review` on `github-mcp`, one call per run; `post_gated_review`, `accusation_follows`, the `held` key and `/cujo confirm` are gone (machine block `schema_version` 2), and `apps/cujo` writes the `cujo/guard` check run (needs `checks: write`) on every reviewed commit, moving it with the run's status. The unlock is `/cujo dismiss` from a human with repo write or admin, not the author and not a Bot `user.type`: it dismisses the bot's REQUEST_CHANGES review, sets the check neutral as *Dismissed by @login*, and moves the run to `dismissed` with `approver` set; the harness keeps `requireApprovalForTools` as an unnamed capability, a gated call from an older spec folds as an unretried `error`, and `Harness.resume` is deleted.

**Why:** The observation already posted before the pause (126), the confirmer added nothing, and anyone with write access, including a coding agent, can dismiss a REQUEST_CHANGES review, so the hold delayed the guard rather than providing it. A check run cannot be dismissed and only the owning App completes it, so where branch protection requires `cujo/guard` a `blocked` run holds the merge. A block only holds where branch protection requires the check; until an installation re-approves, the write fails 403 and logs `check_run.failed`, and a superseded run writes `skipped` only while it is still the latest for its head.

**Rejected:** The harness writing the check through a third `github-mcp` tool, because the agent could omit the call. Dismissal from Discord, because of decision 23. Letting the author dismiss, because of decision 44. Keeping `confirm` as a no-op alias, because it teaches a verb that means nothing.

**See:** decisions 6 (reversed), 42 (reversed), 39 (reversed), 60 (reversed), 38 (reversed in part); amends 23, 28, 44, 45, 57, 63, 74, 86, 109, 120, 125, 126, 128, 130, 133, 136.

## 139. Seven run states; the gate's three are migrated

**Status:** live

**Decision:** The run states are `running`, `clean`, `unproven`, `blocked`, `dismissed`, `error` and `superseded`; migration 13 moves `blocked_posted` and `blocked_unattended` to `blocked`, `denied` to `dismissed`, and `blocked_pending` to `error`, rebuilds the `runs_head` index (dropped first), and drops `run_cujo_turns`. `isTerminal` is `status !== "running"`, and migration 10 is frozen to the literal terminal list it shipped with.

**Why:** The old states named positions in the hold that decision 138 removed. A `blocked_pending` row never posted its review, so `blocked` would claim a lock that is not there. Both `blocked` and `dismissed` are terminal, so the polling, stale deny and session heal for held turns go.

**Rejected:** Leaving old rows as they were, because every status map would need a default for them. `blocked_pending` to `blocked`, because no review is on the pull request.

**See:** decisions 138, 10 (migration).

## 140. A review is what posted, not what was called

**Status:** live

**Decision:** The fold records a review from the call's `tool.response`, and only when that response is not an error; a turn whose post was refused with no later success ends `error` as `review post failed: <tool> — <first line of the refusal>`, which the check writes as `neutral`. `retryTurn` excludes this error by its prefix; a call with no response still ends `turn ended without a review` and is retried.

**Why:** A call that GitHub refused (for example a 422) left the run `blocked` with a failed check and no review on the pull request, which the block must never be. A refusal is a property of the head and account, so a retry gets the same answer. A later accepted call in the same turn records its review, and a duplicate answer from `github-mcp` is a posted review.

**Rejected:** A separate refusal field on the projection, because the `error` column carries it. Retrying with a fresh turn, because the refusal repeats.

**See:** decisions 21 (amended), 130 (amended), 132, 138.

## 141. The run keeps a token ledger per thread

**Status:** live

**Decision:** The fold keeps a ledger on the projection: one row per thread in order of appearance (the parent titled `main`), each summed from `usage` on its own `model.message` events with the byte size of each tool result it received, plus the ten largest tool results by bytes with thread title, tool name and error flag. `usage.messages` now counts every message on every thread, and the per-check sum carries `reasoningTokens` when a message reports them.

**Why:** The parent thread was 50 to 75% of a run's input and nothing named its cost. Bytes, because the harness has no per-call token count; titles, because the public plane withholds thread ids, and the fold keys by id in a map it does not store. The ledger fills late like `usage`, and an older projection rehydrates with the key present and null.

**Rejected:** Putting the parent's sum on `usage`, because that is the harness's total with a different meaning. Per-call token counts, because neither the contract nor the provider gives them.

**See:** decisions 34, 54.

## 142. Exec output is bounded at the tool, and the rest stays in the box

**Status:** live

**Decision:** `sandbox_exec` bounds each stream at 32 KB; above that it returns the first 8 KB and last 24 KB around a marker with the total size and the in-box file that holds the whole stream, written through the runtime's `writeFile`. If that write fails, the result still clips and the marker says the rest was not kept; the model reads the middle with `sandbox_read_file` and its `max_bytes`.

**Why:** A tool result is context the model re-reads on every later message. 32 KB is above any `sniff.py` report line, which can pass 10 KB and must not be cut, and below any output worth carrying whole. The head says what ran and the tail says how it ended.

**Rejected:** A `max_bytes` argument on the call, because the model does not pass it. The tail alone, because it loses which tool and version ran. Capping inside `sniff.py`, because it cannot see commands run outside it.

**See:** decision 141.

## 143. A timeout is an answer, not a failure

**Status:** live

**Decision:** The rubric respawns only a sub-agent that returned no report at all; a report that records a timeout, hang or failed fetch is an answer, recorded as a coverage gap. Amends 108, whose rule stands for a sub-agent that died; nothing in `apps/cujo` changes.

**Why:** The model read a report that recorded an error as "an error instead of a report" and respawned a check that hangs by design. A second attempt buys a second wait and the same gap.

**See:** decisions 108 (amended), 54.

## 144. A push burst is one run

**Status:** live

**Decision:** A push still claims its row at the delivery, but the start waits a window (`CUJO_PUSH_DEBOUNCE_MS`, one minute by default, `0` restores a start per push), and a newer push on the same pull request inside the window drops the older pending start. The started run supersedes the dropped rows; the reaction and check run land at the start, `opened` and `ready_for_review` start at once, and pending starts fire at once on shutdown.

**Why:** Superseded runs had already spent setup and most of a check before the next push cancelled them. A minute fits a burst of a fix, a lint fix and a rebase; longer delays every single push, shorter misses the second commit. Claiming at delivery keeps a redelivery a no-op.

**Rejected:** Provisioning the sandbox from `apps/cujo` first, because it adds a crossing the architecture forbids. Not claiming the row until the window closes, because a redelivery would make a second run. Cancelling pending starts on shutdown, because it loses a review the next boot could follow.

**See:** decision 16.

## 145. A pinned specifier is detonated once per instance per week

**Status:** amended by 148

**Decision:** An instance caches one detonation entry per exact specifier (`name==X`, `name@X`, `module@vX.Y.Z`, `name:X`, `git+url@<40-hex commit>`) for a week, keyed by `(source, normalised specifier)`; the trusted side looks it up from the manifest hunks before the turn and `sniff.py detonate --cached` records the hit through `record_run` marked `cached_from_run`. `apps/cujo` writes an entry back only for a successful exclusive-window install of an exact, non-copied specifier with no hard rule tripped (`wrote_sensitive`, `egress_to_unknown_host`, decoy read) and every host on `KNOWN_INDEX_HOSTS`; `run_id` is the producing run's id only when it is public.

**Why:** An install is a function of the immutable thing installed, and detonation is the slowest check. The index-host rule makes a per-instance cache safe, because `known` depends on each repository's `allow_hosts`. The TTL is enforced on read with no sweeper, and a registry takedown is unseen for a week.

**Rejected:** Keying on `resolved`, because it is best-effort text. A per-repository key, because it removes most hits. Caching failed installs, because they are a coverage gap. A cache the sub-agent queries, because it puts a store read inside the box.

**See:** decisions 148 (amends the `--cached PATH` mechanism), 112, 36, 16, 141.

## 146. A report lists what the rules read, and a spawned check owes one

**Status:** live

**Decision:** `fs_changes` keeps every sensitive or outside-workspace row, computes `derived` flags over the full list, and bounds benign in-workspace rows at `MAX_FS_CHANGES` (200) with `truncated.fs_changes`. `check_missing` fires for any spawned check thread, `detonation` included, that ended without a parseable report, naming the output limit when that cut it; `tests`, `probes` and `smoke` are owed as before.

**Why:** Uncapped `fs_changes` made detonation envelopes too large for the model to copy, so every detonation ended `report: null` and the run read `clean` with the malice rules never applied. A cut can hide a path, never a signal.

**Rejected:** Raising the model's output limit, because it moves the cliff and keeps the copy cost. Reading the report off the tool result, deferred to the next step (decision 147).

**See:** decisions 112, 145, 147.

## 147. The report is the tool result, not the model's copy of it

**Status:** live

**Decision:** The sub-agent runs `sniff.py report` as its last command, and the fold reads the envelope off the `sandbox_exec` result with exit code 0 whose stdout is one JSON object with `check` naming the thread's title and a `runs` array; the final message is a few sentences with no JSON. The message stays the fallback when no report result exists, and a second `sniff.py report` wins.

**Why:** A real install's envelope is 30 to 60 KB after all caps, which a 16k output limit cannot copy. The envelope now crosses into the sub-agent once as a tool result instead of out of it and into the parent, which saves output tokens on each check and parent context on each message. The stdout is untrusted and parsed through the same schema and rules; 142's bound stays for other output.

**Rejected:** Raising the output limit, for 146's reason. `sniff.py report` printing a file pointer, because the fold cannot read it. The parent reading each file with `sandbox_read_file`, because it puts the envelope back in the parent's context.

**See:** decisions 112, 142, 146.

## 148. A cached detonation never crosses the model

**Status:** live

**Decision:** The brief names a cached specifier by `dependency`, `source`, `cached_at` and, for a public source run, `run_id`; the run keeps its briefed entries in `run_detonation_cache`, and `sniff.py detonate --cached` (a flag now) records a stub that the fold replaces with the kept entry, marked `cached_from_run` and `cached_at`, before the schema or a hard rule sees it. Amends 145: the "crosses the model twice" cost and the `--cached PATH` mechanism are withdrawn.

**Why:** The full entry in the brief and in the box cost more tokens per hit than the install it saved. A run reads back the entries it was briefed with even if the cache row changed. A stub the fold cannot substitute fails the schema as `report_invalid`, and nothing from that report is written back.

**Rejected:** The sub-agent reading the entry from a file the parent wrote, because that is 145's cost. The parent carrying the entry into the brief only, because it keeps the larger half of the cost.

**See:** decision 145 (amended).

## 149. Open Code Review runs beside a review and posts nothing

**Status:** live

**Decision:** `ocr` (v1.12.0, binary and checksum pinned) runs in its own trusted service, `apps/ocr-sidecar`, beside every run on `CUJO_DIFF_MODEL` with its own key `OCR_LLM_TOKEN`; it stores the envelope in `run_ocr_reviews`, posts nothing, and deletes `.opencodereview/` from the checkout first. `apps/cujo` calls it fire-and-forget from `startRun` through `POST /review` (202 with an id) and polls `GET /review/:id` (results kept an hour), one review at a time with 429 when busy.

**Why:** It measures whether Cujo's diff review earns its tokens against an off-the-shelf reader on the same model. `ocr` needs a checkout and a model key, which cannot go in the sandbox, and `apps/cujo` has no git or subprocess (decision 134). The poll exists because Node's fetch stops waiting for headers after five minutes.

**Rejected:** `ocr` inside the sandbox, because the key would cross the trust boundary. `ocr` inside `apps/cujo`, because it adds git, a subprocess and a writable path. OCR's GitHub Action, because it uses a different diff base. Posting its review, because that is what the measurement decides.

**See:** decision 134.

## 150. `/cujo review` starts a fresh session

**Status:** live

**Decision:** `/cujo review` supersedes the head's live turn, creates a new session through `replaceSession`, and makes it the pull request's session, so the next push turns on it. This changes decision 63's use of the existing session; `putSession` stays first-writer-wins for the webhook.

**Why:** The old session held the review already posted for the head, and the model declined to post again. A re-review is meant to be a clean look with no memory of earlier heads; the old session is abandoned on the harness.

**Rejected:** A brief line saying this is a re-review, because it asks the model to ignore what it can see. Deleting the old session, for decision 104's reasons.

**See:** decisions 63, 104.

## 151. A repository registry, fed by the installation events

**Status:** live

**Decision:** A `repositories` table, keyed by lowercased `owner/name`, holds installation, visibility, an `enabled` flag, and gained and lost times; `installation` and `installation_repositories` webhooks upsert or flag rows, and `review/registry.service.ts` reconciles at boot and every six hours. A disabled repository's `pull_request`, `issue_comment` and `pull_request_review_comment` deliveries get 200 and an `info` log with `reason: "disabled"` at the ingress, so no session, run row or turn exists.

**Why:** Cujo had no list of the repositories it reviews, and an owner must be able to choose them. A removed row is kept with `removed_at` so `enabled` survives a reinstall, and an unknown repository is not disabled because a delivery can beat the boot sync.

**Rejected:** Learning repositories from pull request deliveries alone, because it cannot list anything. Deleting removed rows, because it loses the owner's flag. The `installation` event as the only source, because older deploys would stay empty.

**See:** decision 34.

## 152. The models and the provider live in the store, seeded once from the environment

**Status:** live

**Decision:** Eight keys move to a `settings` table read at use: `model`, `modelReasoningEffort`, `modelTemperature`, `modelMaxTokens`, the diff model and budget, the review mode default, and the provider (name, base URL, key, models, context window, output cap, reasoning). `Settings.open` seeds a missing key from the environment and ignores the environment after that; `Settings.set` runs `loadConfig`'s validators and registers a provider on the harness at once.

**Why:** A model change meant a redeploy, which restarts the harness and ends every review in flight. Specs are built at session creation, so a later run gets the new model. Process wiring (port, database path, App identity, webhook secret, service URLs, log level) and timeouts, limits, Discord and the push window stay in the environment.

**Rejected:** A hot-reloaded `Config`, because the board would have nowhere to write. Moving every setting at once, because no page asks for them. A new validation schema, because the environment's validators exist.

**See:** decision 127.

## 153. The owner plane: GitHub sign-in on the App's own OAuth, any admin of the installation

**Status:** live

**Decision:** `/auth` and `/owner` sit on the internal host beside `/public`, reached only through `apps/web`'s proxy; sign-in is GitHub OAuth on the App's own client, and an owner is the account for a user installation or any organisation admin for an organisation installation. The user token is used for three calls and never stored; the session lasts a week, its id is an `HttpOnly`, `SameSite=Lax` cookie stored hashed, and the proxy turns it into a bearer on that prefix only.

**Why:** An owner needs a write path for decisions 151 and 152, and decision 34 rules out a shared key. The plane serves who is signed in, settings with the provider key masked and validated as a whole, and the registry; every write logs the actor. Reverses in part 57: no session is 401, a non-owner is 403, and other prefixes (and these two with no client configured) stay 404.

**Rejected:** A separate OAuth App, because it is a second identity. Storing the user token, because a week's expiry answers the re-check. A shared token or password, for 34's reasons. A separate hostname, which 57 removed.

**See:** decisions 57 (reversed in part), 34, 151, 152.

## 154. The run page is an evidence log

**Status:** live

**Decision:** Below the timeline the run page is one column in time order (setup, each check, the review, the end), each check entry showing start time, wrapped commands with exit and duration, sensor alarms and host count, findings with evidence, and ledger tokens; the three older sections are deleted. Evidence tables, raw report, `info` findings and the composed review body fold closed, and findings above `info`, commands and sensor facts show, which narrows decision 93's rule to bulk.

**Why:** The same facts appeared three times and reading them took many clicks. A person deciding on a block must see the finding it rests on. The entry builder is a pure function (`lib/run/log.ts`) with a unit test, and `hard_rule_hits` stays unrendered because each hit is in `findings`.

**Rejected:** Cards and dots, because they are a generic timeline. Opening every fold by default, because that is decision 85's page. Adding a fourth section.

**See:** decisions 93 (narrowed), 85, 141.

## 155. Per-repository settings and instructions, the file winning

**Status:** live

**Decision:** Review mode resolves `deploy default < board < repository file`, and `resolveMode` gains `board`; commands (`install`, `test`, `boot`, `smoke`, `allow_hosts`) stay the file's alone. Instructions come from `.cujo/REVIEW.md` at base, else from the board, capped at the standards file cap and cut on a line, and ride both briefs as `instructions` with their source.

**Why:** An owner now has a plane (decision 153) and needs to say how one repository is reviewed. The file wins so a repository stays self-describing, and a pull request must not change what the sandbox runs. The rubrics let instructions narrow and weigh but never switch off a hard rule or move a severity; an empty file or board text is no instructions.

**Rejected:** The board winning over the file, because a forgotten board value would override the repository. Editing the file from the board by pull request, still open (#162). Instructions in `.cujo.yml`, because the sandbox parses it by regex.

**See:** decision 153.

## 156. The owner's pages: repositories, one repository, and sign-in on the footer

**Status:** amended by 175

**Decision:** `/repos` lists the App's repositories with the decision 151 switch, a lost one dimmed and dated; `/repos/<owner>/<name>` shows the three layers, says which the next run uses, edits the board's mode and instructions, shows file values read-only, and lists runs. Both are server-rendered against the session cookie and never indexed; sign-in was a client component on the footer, and decision 175 moved it and the owner links to a site header.

**Why:** The owner plane and per-repository layer had no pages. A client component keeps the layout from reading the cookie, so the manual stays static and indexed (decision 98). A signed-out or non-owner visitor gets an invitation, not a 404, and the sentences under each control are pure functions with tests.

**Rejected:** A server read of the session in the layout. A separate sign-in page. Editing a file-set value from the board, still open (#162).

**See:** decisions 175, 153, 155, 151, 98.

## 157. The instance page, and the App as GitHub sees it

**Status:** amended by 175

**Decision:** An owner-only page shows the review models and sampling, the provider with its key masked and kept unless a new one is typed, the App's permissions and installations and last twenty webhook deliveries compared against the README's permission list level by level, and the `/readyz` health answer polled every few seconds. Amended by 175: the page is Settings at `/settings`, `/instance` redirects to it, and its forms are one form saved once.

**Why:** The settings of 152 had a write route and no page, and a missing App permission was found only after the review it cost. The App state comes from three App JWT reads through the reviewer's own client, cached for a minute. A delivery's tone is what this process answered (2xx, 503 while the harness was not ready, or other), and the settings form sends the eight keys as one PATCH that the plane validates as a whole (153).

**Rejected:** An instance page on the anonymous board, because it would publish the provider's name and base URL. Reading GitHub on every visit, because nothing there changes by the second. Per-model limits, because a deploy registers one provider and in practice one model (127).

**See:** decisions 127, 152, 153, 175.

## 158. Private repositories: the trees are staged on the trusted side, and the box clones nothing

**Status:** live

**Decision:** For a private repository, `apps/cujo` fetches GitHub's archive of the base and head commits with the installation token (a fork head from `refs/pull/<n>/head` on the base repository) and streams each to a staging route on `sandbox-mcp` under a 32-hex ticket; the brief carries `staged: <ticket>` instead of `clone_url`, never both. `sandbox_create` with the ticket copies both trees into the box over the exec-stdin path, and `sniff.py prepare --staged /work/stage` makes each tree a one-commit repository, reported as `source: "staged"`.

**Why:** The sandbox holds no credential and never will, so a private clone URL failed at `prepare`; this lifts the non-goal of 134 and 149. The token stays on the trusted side, and the ticket is single use, expires in thirty minutes, and buys one copy into one box. Staging uses its own tmpfs, a 256 MiB per-tree cap, and runs before the turn so a failure costs no session; the shadow review skips a private repository and `daytona` refuses a ticket.

**Rejected:** A token in the box in any form, because a signed archive URL is a credential too. A git bundle, because it needs git on the trusted side and carries unused history. The harness or model fetching the trees, because it puts the token near tool calls. `docker cp` from a staged file, because it lands bytes on the host.

**See:** decisions 134, 149, 159.

## 159. An owner sees every run, and a private run's page is the owner's

**Status:** live

**Decision:** The owner plane serves `GET /owner/runs`, `/owner/runs/:id` and `/owner/runs/:id/events` for a signed-in owner (153) with the `is_public` filter removed, the same shapes and the same allowlisted serializer as the public plane, and its own stream limit of twenty. The web asks the public plane first with no credential and, on a 404, sends an owner's session to the owner plane through a proxy route that turns the cookie into the bearer; `runUrl` now links every run, while the brief carries a run id only for a public run (36).

**Why:** After 158 a private run had a check run that pointed at a 404 page (34). One serializer keeps field classification as the one gate, and one query key per run lets the stream write the same cache entry whichever plane answered. Anyone else, and any run neither plane names, gets the same 404, and the page never says which; there is no per-installation scoping because an owner is already an installation admin (153).

**Rejected:** An `is_public` field on the run page, because it would be the first field served to one reader and not another. A separate link on the pull request to the owner page, because the check run's link is now the right page. The owner list on the anonymous board, because it would leak private repository names.

**See:** decisions 34, 36, 57, 153, 158.

## 160. The front door is a landing, and the galaxy is at `/galaxy`

**Status:** reversed in part by 175

**Decision:** The root is a static landing with the name, one line, one paragraph and links (the App's public page and the manual for a visitor; repositories, instance and manual for an owner), and the board moves unchanged to `/galaxy`, where every "all runs" link now goes. `robots.txt` allows `/$` and `/docs` and nothing under them; reversed in part by 175, which restores a site header and sends a signed-in owner on `/` to `/activity`.

**Why:** A reader at the root met an instrument before anything said what Cujo is for. Nothing on the landing is live, so it never waits on the API or shows a stranger's run first. This reverses only the part of 80 to 95 that put the board at the root, and amends 98 so the landing is indexed with the manual.

**Rejected:** The chamber as the landing's hero, because that is the page this replaces. Sending an owner straight to `/repos`, because an owner also shares the landing's link. A recent-runs strip, because it makes a second board. A sitemap, until there are more than two indexed roots.

**See:** decisions 80 to 95 (reversed in part), 98 (amended), 175.

## 161. Declared commands run with no model; the parent judges

**Status:** live

**Decision:** When `.cujo.yml` at base parses and declares `test`, `apps/cujo` calls `sandbox-mcp` itself for a judge run: `sniff.py prepare` (clone or staged trees), `sniff.py setup` with `allow_hosts`, the declared `install` under `--check setup` and `test` on base then head under `--check tests` as `sh -c <line>`, then `sniff.py report` for the Contract 2 envelope, stored and seated through `FoldOptions.executed`. The parent then judges on `agent/JUDGE.md`, spawns `probes` by default unless it writes a reason in coverage, and posts; a repository with no `test` or an unparsable file takes the gather run on `agent/SKILL.md`, and `CUJO_EXECUTE_DECLARED` sends every run down the gather path.

**Why:** Sub-agents that only wrapped one `sniff.py run` cost latency and predictability, and could fail together and leave a review with no evidence. The trusted side reads `base`, `head` and `base_pass_head_fail` off the runs, so report shapes do not change and the hard rules read the envelope as before. `apps/cujo` destroys the box when the turn ends, when a run fails before its turn, on supersede, and on restart; the allowlist rules are copied into `apps/cujo` with a test that holds both copies to one answer.

**Rejected:** A harness route that runs a tool with no model, because 125 refused it. Executing for an undeclared repository by inference, because the gather rubric does that. Destroying the box in the executor, because the probes need the prepared tree.

**See:** Contract 2; decisions 71, 112, 125, 143, 145, 147, 148, 158.

## 162. Smoke is one sensed command, run by the executor

**Status:** live

**Decision:** `sniff.py smoke --boot <line> --request 'METHOD /path'… --tree <name>` runs the boot line in its own process group, waits for the port (from the boot line or `--port`), makes each request on loopback from the sensor process, stops the group inside the window, and records one entry with `tree`, `port`, `port_source`, `ready` and `requests[]`. When the policy declares `boot`, the executor runs it on head then base, joins `endpoints[]` and `log_tail`, and asks `sniff.py report --check smoke`; the judge reads `executed.smoke` and spawns no smoke sub-agent, and a policy with no `boot` owes no smoke report.

**Why:** The smoke sub-agent was the costliest and most variable check and only re-derived a script on every run. `run_sensed` has a `during` hook and starts the child in a new session when given one, and the sensor process drains the boot's pipes before it kills the group. Loopback requests bypass the proxy so the sensors record only the app's egress, and `null` marks a side that never answered.

**Rejected:** A `port` key in `.cujo.yml`, until a boot line that names no port appears. Inferring the boot command, because that is the gather rubric's job. App output to a file, because the pipes are drained by the process that kills the group.

## 163. Detonation runs in the executor, and the gather rubric is for undeclared repositories

**Status:** live

**Decision:** Before the install, the executor runs one `sniff.py detonate --dependency --source` per added specifier, with `--cached` where the cache holds it, then `sniff.py report --check detonation`; the fold replaces cached stubs with stored entries (148) and the cache write fires on the executed check (145). The judge reads `executed.detonation`, `detonation_cached` leaves the judge brief, `probes` is the only sub-agent a judge run spawns, and `SKILL.md` is the gather rubric for a repository whose `.cujo.yml` declares no `test`.

**Why:** Detonation was already deterministic: the trusted side reads the specifiers from the manifest diff, and each `sniff.py detonate` records its own entry. `SKILL.md` stays because a repository that is not the owner's still needs inference.

**Rejected:** Retiring `SKILL.md`, until inference moves out of a model. A per-specifier timeout below the step bound, because `sniff.py detonate` already bounds its own install.

**See:** decisions 145, 148, 161.

## 164. The limits and switches live on the board

**Status:** live

**Decision:** `settings.ts` holds `turnTimeoutMs`, `diffTimeoutMs`, `diffBytes`, `pushDebounceMs`, `converseLimit`, `converseWindowMs`, `converseTimeoutMs` and `ocrEnabled`, seeded once from the same environment variables and read at use; one table names every key and its form, and `SETTING_KEYS` and the owner route's allowlist derive from it. The instance page has a "Limits and switches" form in seconds, the wire uses whole milliseconds, and the `zeroOk` rule from the environment still applies.

**Why:** Each change was a redeploy, and a redeploy kills every run in flight; this extends 152's store. A limit applies at its next use, so a running run keeps the window it started with. The conversation service is always built so a zero limit is a switch, and the OCR switch is a setting while its URL stays in the environment because the URL wires two processes.

**Rejected:** Moving interval services, the stream limit, the OAuth client, service URLs and secrets, because a process needs them before it has a store. A hot-reloaded `Config` (152). A per-repository ceiling, until one is needed.

**See:** decision 152.

## 165. What a run may spend, and what it was seen to spend

**Status:** live

**Decision:** After a timeout cancel settles, the watchdog reads back the turn's persisted messages and the harness's cancelled-state metrics and logs `run.usage.recovered`; the sandbox spec gets `tokenBudget` from the `sandboxBudgetTokens` setting (seed `CUJO_SANDBOX_BUDGET_TOKENS`, default three million), stamped on the run row, and a run past it ends as an error with what it measured. The spec names `subagents`, one page per check under `agent/checks/` on a common page and covered by the run's digest, and the gather brief carries `turn_budget_ms` so the rubric bounds each install to a quarter of it and stops installing at half.

**Why:** A timed-out run recorded zero tokens, and those runs cost most. Only the diff review had a budget (132). Each sub-agent re-read the parent's whole rubric on every message, and a setup that could not finish burned the whole ceiling with nothing posted.

**Rejected:** A budget below the fixture's p90, because it ends real runs to save cents. Per-check pages that repeat the review sections, because a child never needs them. Cancelling turns on `SIGTERM`, because the harness dies with the deploy anyway.

**See:** decision 132.

## 166. A report bounds its benign rows on both sides of the workspace line

**Status:** live

**Decision:** `fs_changes` keeps every sensitive row and bounds benign rows at `MAX_FS_CHANGES` on each side of the workspace line, with the `derived` flags computed on the full list first and the outside sample sorted to take rows under no `CACHE_ROOTS` entry (`~/.cache`, `~/.npm`, `~/.local/share/pnpm`, `~/.local/share/uv`, `~/.yarn`, `~/.cargo/registry`, `/tmp`) first; `sandbox-mcp` clips a one-JSON-object stream above 512 KB. A `sniff.py run` under a name outside the four checks prints only `exit`, `duration_s`, the tails, `derived`, `sensors`, `truncated` and `recorded` (the entry path for `sandbox_read_file`).

**Why:** A pnpm store under the home directory put tens of thousands of outside-workspace rows into setup reports that no rule reads, and the 147 exemption passed them to the model whole. Reverses part of 146: an outside-workspace row is no longer kept whatever the count, and a sensitive one still is. The 512 KB ceiling (about 130k tokens) means a pull request that adds more than about five dependencies can read `check_missing` on detonation, which is accepted until one is seen.

**Rejected:** Rolling outside rows up per directory with a count, because it is a schema change for a signal the sample carries. Raising the token budget, because it pays for paths nobody reads. Bounding `subprocesses`, because no install grew it.

**See:** decisions 146 (reversed in part), 147, 165.

## 167. The sandbox has a memory cap and no CPU cap

**Status:** live

**Decision:** `sandbox-mcp`'s local runtime passes `--memory` and `--memory-swap`, both set to `CUJO_SANDBOX_MEMORY` (compose default `5g`), and no `--cpus`.

**Why:** With no cap, an install shared host memory with every service and could make the OOM killer choose a service. One figure for memory and swap means swap cannot extend the cap, so a runaway install fails its own run. The cap is an env because `sandbox-mcp` has no store and takes no limit from a caller, and a cap above host RAM never binds.

**Rejected:** A CPU reservation for the services, because it slows installs for contention nobody measured. The cap as a board setting, because it would make a tool input of a limit the service owns.

## 168. A bundled service is not a service until it boots, and CI says so

**Status:** live

**Decision:** Each ESM bundle with `noExternal: [/(.*)/]` carries a `banner` that defines `require` from `createRequire(import.meta.url)`; this now covers `apps/cujo`, `github-mcp`, `ocr-sidecar` and `sandbox-mcp`. The CI docker job starts every image detached with no configuration, reads its log after fifteen seconds, and fails on `Dynamic require of`, `Cannot find module`, `Cannot find package` or `ERR_MODULE_NOT_FOUND`.

**Why:** esbuild's ESM shim throws for a CommonJS dependency's dynamic `require`, and no pipeline step ever ran the built artifact. The gate checks that the bundle loads, not that the service runs, and it runs detached because `timeout` on a foreground `docker run` can hang the job. The banner first went on `apps/cujo` only; decision 170's rule found the other three.

**Rejected:** Making `yaml` external, because it puts `node_modules` back in the runtime image. A compose healthcheck as the only guard, because it finds the fault after the merge. The full stack in CI, because `make test-int` covers it and takes minutes.

**See:** decisions 161, 170.

## 169. Base is run when head fails, and not before

**Status:** live

**Decision:** The executor installs and tests head first, and runs base's install and test only when head is not clean (exit 0 with no failing test named); smoke boots base only when head did not come up or did not serve a declared request under 400. When base is skipped, the extras carry `base_not_run: true` beside empty `base` and `base_pass_head_fail`, coverage reads "base not run, head was clean", and `JUDGE.md` says how to read it.

**Why:** A clean head leaves `base_pass_head_fail` empty whatever base did, so a passing pull request now costs one install and one suite. The marker keeps a comparison that was not made from reading as one that came back clean (20, 54). The extras use two code paths, `suiteOutcome` and `headOnlyOutcome`.

**Rejected:** Running base in parallel with head, because `sniff.py run` takes an exclusive lock for the sensors. Reading base from a cache of an earlier run, because staleness needs its own decision. Skipping base for smoke only, because it leaves the larger half.

**See:** decisions 20, 54.

## 170. The reviewer is told how the code is built, and reads it without running it

**Status:** live

**Decision:** The trusted side reads head's packaging as text and puts a `build_facts` block on the brief, per touched service (nearest ancestor with a `package.json` or `pyproject.toml`, cap eight): module type, bundler, output format, `noExternal`, a `createRequire` banner (168), the image `CMD`, and runtime-stage installs; an unreadable config is `unknown`, and a failed read gives `unavailable` without ending the run. The rule `esm_bundle_without_require_shim` fires at `warn` when the pull request adds a `dependencies` entry to, or edits the bundler config of, an ESM bundle that inlines every dependency with no banner; `apps/cujo` also derives it with `source: "build_fact"` and stores the facts in `run_build_facts` before the turn.

**Why:** The fact that makes a packaging defect lives in files the diff need not touch. Evaluating a pull request's config would run untrusted code in the trusted zone, and facts come from head because they describe what the change produces, unlike policy read from base (13). It is `warn` because a read fact is a signal and the boot proof is 168's CI step (136); it is derived twice like a hard rule (21) but is not a `HardRule`, because a diff run reproduces it, and it is stored like 148 and 161 so a refold reads the same facts. Decision 171 reverses the "diff brief only" part.

**Rejected:** Evaluating the config, because it crosses the trust line. Blocking on the rule (136). Deriving it from diff patches, because it turns a set difference into JSON-hunk parsing. Caching facts across runs, because staleness needs its own decision.

**See:** decisions 13, 21, 134, 136, 148, 161, 168, 171.

## 171. Every review is told how the code is built, and the sandbox settles it

**Status:** live

**Decision:** Reverses the "diff brief only" part of 170: build facts are read once per run above the mode branch beside `readInstructions`, stored on every run, and carried by all three briefs as a shared key beside `instructions`, not on `JudgeBrief`. The gather rubric checks the installed package for a `main` with no ESM entry under `exports` or `module` and names package and version, the judge settles it from `executed.detonation` or reports it as handed, and severity stays `warn` on every path.

**Why:** `resolveMode` applies the manifest floor first, so every pull request that adds a dependency went to a sandbox review that never saw the block. The rubric `## Judgment` sections stay word for word identical, so each rubric's evidence section holds the difference. A CommonJS entry point says the bundle can break, and only the boot (168) proves it; `prepare.ts` now receives the facts and no longer fetches them.

**Rejected:** Narrowing the manifest floor, because it trades a real protection for a cheaper review. A `critical` when the sandbox confirms, because the evidence does not reach that far. Waiting for the detonation-only mode, because the rule stays unreachable until then.

**See:** decisions 168, 170 (reversed in part).

## 172. The map is a service that compiles its own engine, and the two trees become a repository

**Status:** live

**Decision:** `apps/mapper` builds `codebase-memory-mcp` from source at a commit pinned in one `ARG` on trixie for both stages, takes base and head tarballs, commits base, replaces the working tree with head and commits again with a fixed identity and clock, and serves precomputed slices over HTTP. It calls `cbm cli <tool>` one-shot (never the daemon), queries the graph instead of `trace_path`, ignores the `Route` model, pages `detect_changes`, sets `CBM_ALLOWED_ROOT` to the trees directory, holds no secret and makes no outbound call, and keeps an MCP bridge behind `CUJO_MAPPER_MCP`, off, with no caller.

**Why:** `detect_changes` needs a git ref, and an archive has no `.git`, so the two trees become a repository whose diff matches GitHub's. A downloaded binary would be trusted rather than built, and `trace_path` skips `CALL_REFERENCE` edges and misses callers. The service execs the engine at boot, exits on failure, and answers 503 on every route but `/healthz` until the engine has run, because the 168 boot gate does not test a C binary; a live test runs when `CUJO_MAPPER_BIN` names one.

**Rejected:** A downloaded release binary, because it is not built here. Indexing head alone, because it loses `detect_changes`. Holding the engine's daemon open, because nothing here owns its lifetime. Wiring the slice into the review in this change, because the service is proven first.

**See:** decisions 57, 168.

## 173. An install whose exit nobody reads is not an install that worked

**Status:** live

**Decision:** The executor reads the declared install's exit from the JSON that `sniff.py run` prints (the process itself always exits 0): a head install failure ends the run in `error` with the command, exit code and an eight-line stderr tail taken after Node deprecation notices are filtered, and a base install failure skips base's suite, sets `base_not_installed`, and reports "base did not install, nothing to compare". The executor also merges the extras into the report envelope itself, in `cmd_report`'s spread order so the envelope's keys win, and `--extra` on `sniff.py report` stays only for the gather path.

**Why:** An unread install failure made a missing test runner look like a repository without one. A head tree that cannot install makes every later check measure the environment, while a base tree that cannot install may be what the pull request repairs. A comparison that could not be made must not read like one that came back clean, so the third coverage state stays separate from decision 169's "base not run, head was clean". The extras passed as one argument exceeded the `sandbox-mcp` 4096-character argv cap, and merging trusted-side removes that crossing for tests, smoke and detonation together.

**Rejected:** Raising the 4096 cap, because it moves the failure to the next limit. Writing the extras to a file in the box, because it adds a door for data that need not cross. Inferring an install failure from a suite that failed the same on both trees, because an exit code is a fact and that is a guess.

**See:** decisions 20, 54, 113, 169.

## 174. Models are configured on the board; the environment only seeds a dev stack

**Status:** live

**Decision:** A provider manifest carries `kind` (`openai`, the default for old manifests, or `anthropic`, a key only, registered as an overlay on pi's built-in `anthropic` provider so specs name `anthropic/<id>` and get catalog limits, `cache_control` and `totalCostInUsd`), and `modelProvider` becomes the uniquely named list `modelProviders`, synced to the harness as PUT and DELETE differences. `CUJO_MODEL` is optional; until a chosen model's provider is on the harness, a pull request gets a neutral `cujo/guard` check "Cujo is not configured" and no run row, and the env variables (`ANTHROPIC_API_KEY` to `cujo` only, `MODEL_PROVIDER_*`) only seed a first boot.

**Why:** The OpenAI-compatible Anthropic endpoint caches no prompts, so a review re-billed its whole context on every step. One provider row could not hold two models from two hosts. A neutral check keeps an unconfigured deploy visible without blocking commits, and two owner routes list a draft provider's models and test it with one short call so a bad key fails on the form. An uncatalogued Claude id gets a fallback model with no price, and any other unknown `anthropic/` id is refused at session creation.

**Rejected:** A JSON list of providers in one env variable, because it is deploy configuration again. One key variable per vendor, because it drops arbitrary OpenAI-compatible hosts. Keys encrypted with a master key from the environment, because that key sits on the same host as the database.

**See:** decisions 127 (amended), 152 (amended).

## 175. A header, an owner's home, and the run page leads with what to do

**Status:** live

**Decision:** Every page gets a client-rendered header (Board and Manual for all, plus Activity, Repositories and Settings for an owner, sign-in or `@login`) that asks `/me` on mount and floats over the chamber on `/galaxy`; a signed-in owner on `/` goes to `/activity` (setup steps left, pull requests whose newest run is `blocked` or `error` with what to do, recent runs), Settings moves to `/settings` as one draft with one save bar and `/instance` 308-redirects. The run page leads with a status headline, the critical findings with a place each, and the next step, with timeline, evidence log and details as closed folds, and owner pages set text in Bricolage Grotesque as `--font-ui`.

**Why:** Owner pages had no navigation but back, and the run page most readers reach from a review put why it blocked and what lifts it a screen down. A layout that read the cookie would render every page per request, so the header stays a client component for decision 156's reason. Repository rows show state computed from the newest 100 runs of `/owner/runs`, and turning reviews off offers an eight-second Undo, because the common click is deliberate.

**Rejected:** A server-read session in the layout, for decision 156's reason. A setup wizard, because it blocks pages an owner may need first. Persisting "provider tested", because it adds a server field for a checklist line.

**See:** decisions 80, 98, 156, 157 (amended), 160 (reversed in part).

## 176. The images share one package store and take turns installing

**Status:** live

**Decision:** Every Dockerfile's `pnpm install`, and the harness's `pnpm deploy`, mounts one BuildKit cache `id=pnpm-store` with `sharing=locked`, so the images install in turn and each later install fetches only what the store lacks. `.npmrc` sets five fetch retries with a longer backoff and halves the parallel fetches.

**Why:** Coolify builds the seven images at once on the deploy box, and seven installs from empty stores dropped registry connections and exhausted the box. Installs in series are slower on an empty cache but finish. The cache lives on the box, so a `docker builder prune` costs one slow deploy.

**Rejected:** Images built in CI and pulled by Coolify, because it needs a registry, credentials on the box and a change to image names in the compose file (rejected for now). A `pnpm fetch` layer keyed on the lockfile, because the cache mount makes it mostly redundant.

## 177. The manual is six pages

**Status:** live

**Decision:** The manual at `/docs` is six pages: what Cujo is, install, configure, reading a review, blocking, and self-hosting. It keeps only what a developer acts on when they decide to install the App, install it, and read its reviews.

**Why:** Twelve pages and about 6,400 words explained sensors, trust zones, the harness and decision numbers to a reader who needs none of them to use Cujo. Two pages also contradicted the product: one said the board has no login while owners sign in, and one named an amber state that waits on a person when no state does. The design of record stays in `docs/`.

**See:** decisions 98, 175.

## 178. Decisions are short; history is in git and the archive

**Status:** live

**Decision:** Every entry uses the short template: status, decision, why, rejected options that matter, and references. An entry that a later decision fully reversed (1, 2, 6, 17, 19, 24, 28, 39, 42, 49, 55, 56, 60, 64) moves verbatim to `docs/decisions-archive.md` and keeps its heading and a status line here.

**Why:** The record had grown to about 9000 lines, mostly incident stories and measurement narrative, and a reader could not find the current rule. Code cites decisions by number and links cite them by title, so numbers and titles never change. Nothing is deleted: the full earlier text is in the archive or in the commit history. This amends the AGENTS.md rule "reverse, do not delete".

**Rejected:** Deleting reversed entries, because code and older entries cite their numbers.

**See:** decision 6; `CONTRIBUTING.md` for the template.
