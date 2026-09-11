/**
 * The MCP surface, driven by a real client over a real socket.
 *
 * The same shape as `github-mcp/tests/server.test.ts`, because two MCP servers in
 * one deployment should answer the same way about transport and errors. What this
 * adds is the pair of properties the tools exist to guarantee: a caller cannot
 * choose the image, and a refusal comes back as something the model can act on
 * rather than as a dead transport.
 */

import type { AddressInfo } from "node:net";
import { createLogger } from "@cujo/log";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecRequest, Sandbox, SandboxRuntime, SandboxSpec } from "../src/runtime";
import { SandboxError } from "../src/runtime";
import { createApp } from "../src/server";

/** A runtime that records what it was asked for and provisions nothing. */
class FakeRuntime implements SandboxRuntime {
  readonly name = "fake";
  readonly specs: SandboxSpec[] = [];
  readonly execs: ExecRequest[] = [];
  failWith: SandboxError | null = null;

  async create(spec: SandboxSpec): Promise<Sandbox> {
    if (this.failWith) throw this.failWith;
    this.specs.push(spec);
    return { id: "sbx-1", provisionedMs: 1234 };
  }
  async exec(id: string, request: ExecRequest) {
    if (id !== "sbx-1") throw new SandboxError("no_such_sandbox", "no such sandbox");
    this.execs.push(request);
    return { exitCode: 0, stdout: "out", stderr: "", durationMs: 7, timedOut: false };
  }
  async writeFile() {}
  async readFile() {
    return "contents";
  }
  async destroy() {}
}

const runtime = new FakeRuntime();
const server = createApp({
  runtime,
  log: createLogger({ service: "sandbox-mcp", sink: () => {} }),
});
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connect(): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

/** A tool result's JSON payload, which is where every answer here lives. */
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]?.text ?? "{}");
}

describe("the HTTP surface", () => {
  it("answers the healthcheck with the runtime it is holding", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "sandbox-mcp", runtime: "fake" });
  });

  it("404s anything that is not /mcp", async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/sandbox`)).status).toBe(404);
  });
});

describe("the tools", () => {
  it("offers exactly the five operations the interface has", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "sandbox_create",
      "sandbox_destroy",
      "sandbox_exec",
      "sandbox_read_file",
      "sandbox_write_file",
    ]);
    await client.close();
  });

  it("takes no image, so a caller cannot choose what it runs in", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === "sandbox_create");
    // The deployment's image comes from this process's own environment, for the
    // reason `github-mcp` holds `publicBaseUrl` in its env rather than taking it.
    expect(Object.keys(create?.inputSchema.properties ?? {})).toEqual(["allow_hosts"]);
    await client.close();
  });

  it("returns a minted id and how long provisioning took", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "sandbox_create", arguments: {} });
    expect(payload(result)).toEqual({
      ok: true,
      sandbox_id: "sbx-1",
      provisioned_ms: 1234,
      allowed_hosts: [],
    });
    await client.close();
  });

  it("validates the allowlist before any runtime sees it", async () => {
    const client = await connect();
    const before = runtime.specs.length;
    const result = await client.callTool({
      name: "sandbox_create",
      arguments: { allow_hosts: ["https://pypi.org"] },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(payload(result).problem).toContain("scheme");
    // Nothing was provisioned, which is the point of validating here.
    expect(runtime.specs.length).toBe(before);
    await client.close();
  });

  it("normalises the allowlist it accepts", async () => {
    const client = await connect();
    await client.callTool({
      name: "sandbox_create",
      arguments: { allow_hosts: ["PyPI.org", "pypi.org"] },
    });
    expect(runtime.specs.at(-1)?.allowHosts).toEqual(["pypi.org"]);
    await client.close();
  });

  it("runs a command and reports what it did", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "sandbox_exec",
      arguments: { sandbox_id: "sbx-1", argv: ["echo", "hi"], cwd: "/work/head" },
    });
    expect(payload(result)).toMatchObject({ ok: true, exit_code: 0, stdout: "out" });
    expect(runtime.execs.at(-1)).toMatchObject({ argv: ["echo", "hi"], cwd: "/work/head" });
    await client.close();
  });

  it("refuses an empty argv at the schema, before the runtime", async () => {
    const client = await connect();
    const before = runtime.execs.length;
    const result = await client.callTool({
      name: "sandbox_exec",
      arguments: { sandbox_id: "sbx-1", argv: [] },
    });
    // The SDK turns a schema violation into an error result rather than a thrown
    // transport error, which is the same shape a refusal takes -- so a model sees
    // one kind of "no" whether the shape or the request was wrong.
    expect((result as { isError?: boolean }).isError).toBe(true);
    const content = (result as { content: { text: string }[] }).content;
    expect(content[0]?.text).toContain("at least 1 element");
    expect(runtime.execs.length).toBe(before);
    await client.close();
  });

  it("hands a refusal back as something the model can act on", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "sandbox_exec",
      arguments: { sandbox_id: "nope", argv: ["true"] },
    });
    // `isError` rather than a thrown transport error: a model that asked for the
    // wrong box should be told which part was wrong and try again.
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(payload(result).problem).toContain("no such sandbox");
    await client.close();
  });

  it("marks only destroy as destructive", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
    expect(destructive).toEqual(["sandbox_destroy"]);
    await client.close();
  });

  it("says what went wrong when provisioning fails", async () => {
    runtime.failWith = new SandboxError("provision_failed", "no such image");
    const client = await connect();
    const result = await client.callTool({ name: "sandbox_create", arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(payload(result).problem).toContain("no such image");
    runtime.failWith = null;
    await client.close();
  });
});
