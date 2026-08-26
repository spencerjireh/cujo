# TrueForge Reference

Sources: https://github.com/truefoundry/trueforge, https://trueforge.dev (fetched 2026-08-23). Full docs index: https://trueforge.dev/llms.txt.

## What it is

Open-source agent harness (MIT): the runtime layer that turns an LLM into a working agent. The server owns the full execution loop — planning, tool routing and execution, context management, sandboxing, human-in-the-loop approvals, and session state that survives reconnects and restarts. Model providers, MCP servers, and sandbox environments are bring-your-own; TrueForge orchestrates them.

Three interfaces: bundled Chat UI, HTTP API with TypeScript SDK (`@truefoundry/trueforge-sdk`), and embeddable UI component (`@truefoundry/trueforge-ui`).

## Running it

| Mode | Storage | Command | Port |
|---|---|---|---|
| Local (dev only, localhost-only) | SQLite | `npx @truefoundry/trueforge` | 8790 |
| Hosted | Postgres + Redis | `docker compose up --build` (after cloning repo and copying `packages/trueforge/.env.example` to `.env`) | 8791 |

Prerequisites: Node.js >= 22.14 (local mode), model provider API key, Daytona API key for sandbox and skills. Helm chart: `oci://tfy.jfrog.io/tfy-helm/trueforge`.

Setup sequence in the web UI: Settings > Models (provider key), Settings > Connectors (MCP servers), Settings > Skills, Settings > Sandbox providers (Daytona key), then chat and "Save Agent".

Configuration is backed by YAML catalogs (`model-catalog.yaml`, `mcp-catalog.yaml`, `skill-catalog.yaml`, `sandbox-catalog.yaml`); self-hosted instances override them with `MODEL_CATALOG_PATH`, `MCP_CATALOG_PATH`, `SKILL_CATALOG_PATH`, `SANDBOX_CATALOG_PATH`. Any OpenAI-compatible endpoint works alongside OpenAI, Anthropic, and Gemini.

## Agent spec

An agent is a saved, reusable definition: model, instructions, tools/skills, runtime behaviors. Data model hierarchy: one Agent -> many Sessions -> many Turns -> many Events -> some Deltas. Turns chain automatically (`previous_turn_id` defaults to `"auto"`).

Fields (only `model.name` is required, FQN format `provider/model-name`):

- `instructions` — system prompt.
- `mcp_servers` — array with `enable_tools`, `require_approval_for_tools`, `preload`.
- `skills` — instruction packs (requires sandbox).
- `config.sandbox` — enable code execution and skills.
- `config.generative_ui`, `config.ask_user_questions`, `config.dynamic_sub_agents` — all default on.
- `iteration_limit` — runaway-loop stop, default 100.
- `response_format` — constrain output to JSON or a schema.
- `messages` — seed messages per session.

Approvals: set `require_approval_for_tools` per MCP server. By default the harness gates from the tool's own MCP annotations via `["@write", "@destructive"]` markers. This is the mechanism that satisfies the hackathon's "human approval before irreversible actions" requirement.

## Key features (the ones judges look for)

- Sandbox-as-tool: the agent loop stays on the server; the sandbox (Daytona provider, extensible) is used only for code, files, and shell. Secrets never enter the sandbox; compute is provisioned only when needed.
- Skills: Git-backed SKILL.md instruction packs with progressive disclosure — only name and description sit in context; the full doc is read from the sandbox on demand.
- Subagents: fresh context per subagent (instructions and tools, no shared history); only the final result returns to the parent.
- Deferred tool loading: MCP servers contribute only name and description by default; tool schemas are discovered on demand (`preload` toggles this).
- Code Mode: the agent runs a Python script in the sandbox that calls MCP tools directly — data processing in code, not context.
- Context compaction: above a threshold (default 50,000 tokens) an LLM writes a structured summary (intent, decisions, files, errors, next steps).
- Large tool responses: oversized output is written to a sandbox file and replaced by a short preview plus the file path.
- Generative UI: charts, tables, and cards streamed into chat.

## SDK quickstart

```bash
npm i @truefoundry/trueforge-sdk
```

```typescript
const client = new TrueForge({
  baseUrl: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790',
  timeoutInSeconds: 600,
  // token: process.env.TRUEFORGE_TOKEN, // only when OIDC login is enabled
});

const { data: session } = await client.sessions.create({
  agent: {
    spec: {
      model: { name: 'anthropic/claude-sonnet-4-6' },
      instructions: 'You are a concise, helpful assistant.',
    },
  },
});

const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: 'user.message', content: 'In two sentences, what is TrueForge?' }],
});
for await (const { data: event } of stream.withMetadata()) {
  // key events: turn.created, model.message.delta (event.content), turn.done (event.state.status)
}
```

Named reusable agents: `client.agents.create({ name, manifest: { model, instructions } })`, then reference by name when creating sessions.

Deeper SDK docs: https://trueforge.dev/api/use-agent (streaming, approvals, reconnects) and the API Reference tab (OpenAPI).

## Repo layout

`/packages` (modular components), `/docs`, `/benchmark`, `/scripts`, `/charts/trueforge` (Helm). TypeScript, pnpm workspaces, ESLint, Prettier.
