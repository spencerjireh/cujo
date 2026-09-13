# harness — sessions, turns and the gate, over pi

The agent runtime `apps/cujo` drives (decision 123). pi (`@earendil-works/pi-coding-agent`,
pinned) is the loop, the provider layer, the retry and the compaction; this
service is everything around it that a review needs and pi does not have: a
session that outlives a process, an event log a client can replay, an approval
that suspends a turn until a person answers, and a sub-agent tool. One port,
one client, no console.

**Eight operations, one contract.** The routes in `http.ts` are the whole API:
two `PUT /settings/*` to register MCP servers and model providers, `POST
/sessions`, `POST /sessions/:id/turns`, `POST /sessions/:id/cancel`, `GET
/sessions/:id/turns`, `GET /sessions/:id/events`, and the SSE `GET
/sessions/:id/turns/:turnId/subscribe`. Every body and every event is a Zod
schema in `packages/harness-contract`, which both sides compile against; the
event vocabulary (`turn.created`, `model.message`, `thread.*`,
`tool.approval_required`, `tool.response`, `turn.done`) is what `fold.ts` and
the board already spoke, kept on purpose.

**No auth on the port.** Like `github-mcp` and `sandbox-mcp`: nothing outside
the compose network can reach it, and there is no credential to present
(decision 57). Every secret it holds — provider keys, MCP server URLs — arrives
through the settings routes from `apps/cujo` and stays in `store.ts`.

**pi reads nothing from the home directory.** `pi.ts` supplies every
collaborator: no extension, skill, prompt template, context file or built-in
tool is loaded, and the credential store is in memory (`model.ts`). What the
model can do is exactly the tool list the session was built with, which is the
MCP bridge (`mcp.ts`, decision 128) plus `create_sub_agent`.

**The gate is `beforeToolCall`.** A tool whose exact name is gated suspends the
turn with the call held inside pi; the answer arrives as the next turn's input
and either lets the call run or hands the model the deny reason as the tool
result (decision 125). A new user message ends whatever runs on the session
first, children included, so there is no wedge (decision 124).

## Files

| file | holds |
| --- | --- |
| `index.ts` | boot: open the store, register the providers it remembers, serve |
| `http.ts` | the eight routes, request logging, SSE keepalive |
| `engine.ts` | sessions, turns, the approval gate, restart recovery (decision 130) |
| `events.ts` | pi events in, contract events out; pure |
| `mcp.ts` | one pi tool per MCP tool, by name |
| `subagent.ts` | `create_sub_agent`: a child pi session on its own thread |
| `model.ts` | one pi `ModelRuntime`, fed only by registered manifests |
| `pi.ts` | how a pi session is built with nothing implicit |
| `store.ts` | `node:sqlite`: manifests, sessions, turns, the event log, pending approvals |
| `ids.ts` | `newId`, `now` |

`tests/` mirrors `src/`; `stub-model.ts` there is a scripted model registered
straight into pi, so a turn completes without a provider. The contract tests
in `apps/cujo/tests/contract/` drive the real service from the compose file
(`make test-int`).
