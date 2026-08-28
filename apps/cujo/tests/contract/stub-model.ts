/**
 * A stub OpenAI-compatible model endpoint for the harness contract tests. It
 * answers /v1/chat/completions (streaming and not) with a canned reply built
 * from the last user message, so a TrueForge turn completes without a real
 * model. A message containing SLOW is answered after a delay, which is how
 * the tests hold a turn open long enough to cancel it. A message `SAY <text>`
 * is answered with that text verbatim, which is how a sub-agent spawned by
 * the stub ends with a check report.
 */

import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

const SLOW_MS = 20_000;

interface ChatRequest {
  model?: string;
  stream?: boolean;
  messages?: { role: string; content: unknown }[];
  tools?: { type: string; function: { name: string } }[];
}

/**
 * A user message `CALL <tool> <json args>` makes the stub call that tool
 * (matched by suffix, since the harness may prefix MCP tool names). Once a
 * tool result is in the conversation the stub answers with text.
 */
function plannedCall(
  prompt: string,
  tools: ChatRequest["tools"],
): { name: string; args: string } | null {
  const m = /CALL (\S+)\s*(\{[\s\S]*\})?/.exec(prompt);
  if (!m?.[1]) return null;
  const wanted = m[1];
  const tool = (tools ?? []).find(
    (t) => t.function.name === wanted || t.function.name.endsWith(wanted),
  );
  if (!tool) return null;
  return { name: tool.function.name, args: m[2] ?? "{}" };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

export interface StubModel {
  server: Server;
  port: number;
  /** Every chat request the harness sent, oldest first. */
  requests: ChatRequest[];
  close(): Promise<void>;
}

export async function startStubModel(): Promise<StubModel> {
  const requests: ChatRequest[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "stub-1", object: "model" }] }));
      return;
    }
    if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatRequest;
    requests.push(body);
    const last = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
    const prompt = textOf(last?.content);
    if (prompt.includes("SLOW")) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, SLOW_MS);
        req.on("close", () => {
          clearTimeout(t);
          resolve();
        });
      });
      if (req.destroyed) return;
    }
    // Only a tool result that answers this turn's call counts; earlier turns
    // in the history have their own.
    const messages = body.messages ?? [];
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const toolResultSeen = messages.slice(lastUser + 1).some((m) => m.role === "tool");
    const call = toolResultSeen ? null : plannedCall(prompt, body.tools);
    const say = /SAY ([\s\S]*)$/.exec(prompt);
    const reply = toolResultSeen ? "posted" : say?.[1] ? say[1] : `echo: ${prompt}`;
    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
    const toolCalls = call
      ? [
          {
            id: `call_${Date.now()}`,
            type: "function",
            function: { name: call.name, arguments: call.args },
          },
        ]
      : undefined;
    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: body.model ?? "stub-1",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      res.write(chunk({ role: "assistant", content: "" }, null));
      if (toolCalls) {
        res.write(chunk({ tool_calls: toolCalls.map((c, index) => ({ index, ...c })) }, null));
        res.write(chunk({}, "tool_calls"));
      } else {
        res.write(chunk({ content: reply }, null));
        res.write(chunk({}, "stop"));
      }
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: body.model ?? "stub-1", choices: [], usage })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        created,
        model: body.model ?? "stub-1",
        choices: [
          {
            index: 0,
            message: toolCalls
              ? { role: "assistant", content: null, tool_calls: toolCalls }
              : { role: "assistant", content: reply },
            finish_reason: toolCalls ? "tool_calls" : "stop",
          },
        ],
        usage,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    requests,
    close: () =>
      new Promise((resolve) => {
        // A SLOW request may still be open; do not wait for it.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
