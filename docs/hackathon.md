# The hackathon

Cujo is built for the Agent Harness Hackathon, run by WeMakeDevs with
TrueFoundry.

## When and who

- Runs August 24–30, 2026. Submission deadline: August 30, 8 PM London time.
- Hybrid: online from anywhere, with an optional in-person day on August 29 in
  San Francisco.
- Teams are solo or up to four; every member registers individually.
- Only code written during the event counts. Pre-existing libraries and
  frameworks are allowed.

## The premise

Every entry is built on TrueForge, TrueFoundry's open-source agent harness.
Judges weigh how well a project uses the harness rather than what it wraps around
it.

## Hard requirements

Every submission must demonstrate:

1. Tool integration through MCP servers — real tools, not simulated.
2. Code execution in an isolated sandbox.
3. Human approval before an irreversible action.

And it must ship:

- A public GitHub repo with a README a judge can run.
- Qodo (AI code review) installed from the start, with a PR workflow whose review
  trails are visible — judges read them.
- A demo video (our notes say ~3 minutes) showing the agent working.
- A written description of what the agent does and how it uses TrueForge.

Two standing rules: keep API keys and personal data out of the repo and video,
and use only tools, data, and accounts the team owns — no third-party credentials.

Daytona is the sandbox provider TrueForge integrates and the kickoff blog names
for requirement 2. Its $200 signup credit is Daytona's standard free tier
(available to anyone, not a hackathon grant); at per-second billing, short
detonation runs cost well under a cent each.

## Judging criteria

Six criteria, weighted equally:

1. Practical utility and real-world applicability.
2. Inventiveness and novel approach.
3. Implementation completeness and reliability.
4. Meaningful integration of sponsor tools — TrueForge centrality and Qodo reviews.
5. Safety mechanisms and human oversight.
6. Clear, compelling demonstration and explanation.

## Tracks and prizes

Tracks are not exclusive; one project is considered for all, but wins at most one
track award.

| Track | Prize | What it rewards |
|-------|-------|-----------------|
| **Double-O** (TrueFoundry) | NVIDIA DGX Spark | Best use of TrueForge: real MCP tools, sandboxed execution, human approvals, subagents, persistent sessions. **Cujo's primary target.** |
| **Q Branch** (Qodo) | Mac Mini | Best code quality; Qodo installed from day one with visible PR reviews. |
| **Savile Row** | iPad per member | Best UI: usability and visible control, judged on the video and the running project. |
| **Field Report** | Keychron keyboard | A blog post on the problem, the build, and where TrueForge helped or got in the way. |
| **Radio Traffic** | Swag (10 winners) | Progress posts tagging WeMakeDevs, TrueFoundry, and Qodo. |
| **Universal Exports** | TrueFoundry job interviews | Top projects overall, independent of track wins. |

## Where Cujo fits

Cujo aims at Double-O. The product is one flow that covers all three hard
requirements at once, plus subagents: check subagents run the PR in a sandbox,
the parent posts through an MCP review tool, and a human gates the block.
Running Qodo on the repo also contests Q Branch, and the build can seed a
Field Report post.

## Practical notes

- Qodo is free for open-source projects and covers VS Code, JetBrains, GitHub
  PRs, and a CLI.
- Qodo is required only to win Q Branch, not to enter the hackathon overall.

## Links

Hackathon:

- Hackathon page — https://www.wemakedevs.org/hackathons/trueforge
- Kickoff blog (rules, tracks, setup) — https://www.wemakedevs.org/blogs/agent-harness-hackathon-kick-off

TrueForge (the harness):

- Repo — https://github.com/truefoundry/trueforge
- Product page — https://www.truefoundry.com/trueforge
- SDK overview (how to drive it programmatically) — https://www.truefoundry.com/docs/agent-platform/agent-harness/sdk/overview
- Docs index — https://trueforge.dev/llms.txt
- SDK / API reference (sessions, turns, approval-gate resume) — https://trueforge.dev/api/use-agent

Tools we depend on:

- Qodo Merge (Q Branch requirement) — https://github.com/marketplace/qodo-merge-pro and sign-in at https://app.qodo.ai/signin
- Daytona (sandbox provider) — https://www.daytona.io
- Model provider API key (bring your own; any provider TrueForge supports, most
  have a free tier)

This project:

- Submission repo — https://github.com/spencerjireh/cujo
- Live harness — https://cujo.spencerjireh.com
