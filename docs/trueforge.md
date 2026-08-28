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

### Driving it headless

Cujo never shows a person the bundled UI (decision 17). Everything `apps/cujo` needs was verified against the TrueForge source, SDK 0.1.3, on 2026-08-27:

- **Inline agent per session.** `sessions.create({ agent: { spec: { model, instructions, mcpServers: [{ name }], config: { sandbox }, skills } } })`. `mcpServers` entries reference a server by the name it was registered under (Settings > Connectors or the MCP servers API), so register `github-mcp` once with `require_approval_for_tools: ['post_blocking_review']`.
- **Every event carries `thread_id`.** `main` for the parent; a unique id per subagent. `thread.created` has `parent.{thread_id, tool_call_id}` and `title`; `thread.done` has `state: {status: 'done', output}` or `{status: 'error', error, output?}`, where `output` is the subagent's final `model.message`. Child-thread `tool.response` events arrive in the same turn stream.
- **The approval pause.** `tool.approval_required` with `thread_id` and `tool_calls[{id, source_event_id}]`; `source_event_id` names the `model.message` that holds the tool call's name and arguments. The turn then ends with `turn.done` and `required_actions`.
- **Resume.** `sessions.createTurnStream(sessionId, { input: [{ type: 'user.tool_approval', threadId, toolCallId, approval: { status: 'allow' } }] })`, or `{ status: 'deny', reason }`. One send must answer every pending approval on that thread; a second answer for an already-decided call is rejected.
- **Rebuild after a restart.** `sessions.listEvents(sessionId)`, `sessions.listTurnEvents(sessionId, turnId)`, and `sessions.subscribeToTurn(sessionId, turnId)` for a turn still running.
- **Auth.** OIDC when `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` are set; otherwise a fixed local admin identity with no token. There is no API-key mode. Cujo runs without OIDC and reaches the server only on the compose network.
- **Subagent spawn is not gated.** The dynamic sub-agent tool has `is_approval_required: false`; only tools marked for approval pause a turn.

### Verified against a running server

The harness contract tests (`make test-int`, `apps/cujo/tests/contract/trueforge.contract.test.ts`) run `apps/cujo` against the published server image with a stub model provider. What they established, beyond the source reading above:

- **The model sees meta-tools, not the MCP tools.** The tool list a turn sends to the model is `list_tools`, `get_tool_info`, `call_tool`, `create_sub_agent`, and a few built-ins; an MCP tool is invoked as `call_tool({mcp_server, tool_name, input})`. The approval gate keys on the inner `tool_name`, so `requireApprovalForTools: ['post_blocking_review']` still pauses the turn. The folder reads a review out of either shape.
- **The streamed `model.message` is a stub.** On the turn stream it carries only `id`, `threadId`, `createdAt`; the text arrives as `model.message.delta` and the tool calls do not arrive at all. The persisted event from `listEvents` has both, so `apps/cujo` re-reads the session's events at every decision point (`tool.approval_required`, `turn.done`) before folding.
- **`listEvents` caps `limit` at 100** and the SDK page iterates the rest.
- **A paused turn ends.** `tool.approval_required` is followed by `turn.done` with `status: 'done'`, `output: null`, and the approval under `requiredActions`.
- **A denied call still gets a `tool.response`** carrying the refusal, so the fold checks the decision before the response.
- **Creating a turn while one runs cancels the old one** (`cancelled-for-next-turn`), but a subscriber to the old turn is never told; only `sessions.cancel` (`client-cancelled`) closes the stream. `apps/cujo` cancels explicitly before starting a newer head's turn.
- **`createTurn` then `subscribeToTurn`** gives the turn id before any event; a later subscribe replays the turn from `turn.created`, finished or not.
- **The server bounds a turn at 10 minutes by default** (`SERVER_EXECUTION_TIMEOUT_SECONDS`, 600; the turn ends `cancelled` with reason `server-execution-timeout`), and a subscription stream at 10 minutes too (`TURN_SUBSCRIBE_TIMEOUT_MS`, 600000; the stream ends cleanly with no terminal event). Seen on the first real review (2026-08-27, `smoke` still running at the cut). The compose file raises both to the 30-minute turn budget, and `apps/cujo` treats a clean stream end without `turn.done` as a drop and resubscribes.

Source files, for the reader who wants to check: `packages/trueforge-core/src/core/events/schema.ts` (event shapes), `packages/trueforge-core/src/core/runtime/AgentThread.ts` (resume validation), `packages/trueforge-core/src/core/capabilities/builtins/DynamicSubAgents.ts` (spawn tool), `packages/trueforge/src/config.ts` (OIDC), `packages/trueforge-sdk/src/api/resources/sessions/client/Client.ts` (SDK methods).

## Repo layout

`/packages` (modular components), `/docs`, `/benchmark`, `/scripts`, `/charts/trueforge` (Helm). TypeScript, pnpm workspaces, ESLint, Prettier.
