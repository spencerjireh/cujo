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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ExecRequest, Sandbox, SandboxRuntime, SandboxSpec } from "../src/runtime";
import { SandboxError } from "../src/runtime";
import { createApp } from "../src/server";

/** A runtime that records what it was asked for and provisions nothing. */
class FakeRuntime implements SandboxRuntime {
  readonly name = "fake";
  readonly specs: SandboxSpec[] = [];
  readonly execs: ExecRequest[] = [];
  readonly writes: { path: string; contents: string }[] = [];
  failWith: SandboxError | null = null;
  /** What the next `exec` answers with; the default is a short, whole output. */
  nextOutput = { stdout: "out", stderr: "" };
  writeFails = false;

  async create(spec: SandboxSpec): Promise<Sandbox> {
    if (this.failWith) throw this.failWith;
    this.specs.push(spec);
    return { id: "sbx-1", provisionedMs: 1234 };
  }
  async exec(id: string, request: ExecRequest) {
    if (id !== "sbx-1") throw new SandboxError("no_such_sandbox", "no such sandbox");
    this.execs.push(request);
    return { exitCode: 0, ...this.nextOutput, durationMs: 7, timedOut: false };
  }
  async writeFile(_id: string, path: string, contents: string) {
    if (this.writeFails) throw new SandboxError("io_failed", "disk full");
    this.writes.push({ path, contents });
  }
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

  describe("bounds each output stream (decision 142)", () => {
    // 40 KB of numbered lines: over the 32 KB cap, and every line says where
    // it sits, so the head and the tail can be told apart from the middle.
    const long = Array.from({ length: 4000 }, (_, i) => `line ${String(i).padStart(5, "0")}`).join(
      "\n",
    );
    const exec = async (client: Awaited<ReturnType<typeof connect>>) =>
      payload(
        await client.callTool({
          name: "sandbox_exec",
          arguments: { sandbox_id: "sbx-1", argv: ["pytest", "-v"] },
        }),
      ) as { stdout: string; stderr: string };

    afterEach(() => {
      runtime.nextOutput = { stdout: "out", stderr: "" };
      runtime.writeFails = false;
      runtime.writes.length = 0;
    });

    it("keeps a short output whole", async () => {
      const client = await connect();
      runtime.nextOutput = { stdout: "x".repeat(32 * 1024), stderr: "" };
      const result = await exec(client);
      expect(result.stdout).toHaveLength(32 * 1024);
      expect(result.stdout).not.toContain("truncated");
      expect(runtime.writes).toHaveLength(0);
      await client.close();
    });

    it("keeps the head and the tail of a long one and writes the whole to the box", async () => {
      const client = await connect();
      runtime.nextOutput = { stdout: long, stderr: "" };
      const result = await exec(client);
      expect(result.stdout.startsWith("line 00000")).toBe(true);
      expect(result.stdout.endsWith("line 03999")).toBe(true);
      expect(result.stdout).not.toContain("line 01000");
      expect(result.stdout.length).toBeLessThan(33 * 1024);
      expect(runtime.writes).toHaveLength(1);
      expect(runtime.writes[0]?.contents).toBe(long);
      expect(runtime.writes[0]?.path).toMatch(/^\/tmp\/cujo-state\/exec\/\d+-stdout\.log$/);
      await client.close();
    });

    it("names the file and the size in the marker, on the stream that was cut", async () => {
      const client = await connect();
      runtime.nextOutput = { stdout: "fine", stderr: long };
      const result = await exec(client);
      expect(result.stdout).toBe("fine");
      const marker = result.stderr.match(
        /\[cujo: truncated, (\d+) bytes total; sandbox_read_file (\S+) for the rest\]/,
      );
      expect(marker?.[1]).toBe(String(Buffer.byteLength(long)));
      expect(marker?.[2]).toBe(runtime.writes[0]?.path);
      expect(marker?.[2]).toMatch(/-stderr\.log$/);
      await client.close();
    });

    it("hands back a long stream whole when it is one JSON object (decision 147)", async () => {
      const client = await connect();
      const report = JSON.stringify({
        check: "detonation",
        runs: [{ pad: "x".repeat(40 * 1024) }],
      });
      runtime.nextOutput = { stdout: report, stderr: "" };
      const result = await exec(client);
      expect(result.stdout).toBe(report);
      expect(runtime.writes).toHaveLength(0);
      await client.close();
    });

    it("still cuts, and says the rest was not kept, when the write fails", async () => {
      const client = await connect();
      runtime.nextOutput = { stdout: long, stderr: "" };
      runtime.writeFails = true;
      const result = await exec(client);
      expect(result.stdout).toContain("the rest was not kept");
      expect(result.stdout).not.toContain("sandbox_read_file");
      expect(result.stdout).not.toContain("line 01000");
      await client.close();
    });
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

describe("readiness (decision 118)", () => {
  /** A server whose runtime is still building its images. */
  async function notReadyServer() {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createApp({
      runtime: new FakeRuntime(),
      log: createLogger({ service: "sandbox-mcp", sink: () => {} }),
      ready,
    });
    await new Promise<void>((resolve) => app.listen(0, () => resolve()));
    const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    const close = () => new Promise<void>((resolve) => app.close(() => resolve()));
    return { url, release, close };
  }

  it("answers 503 on /healthz and /mcp until the images exist, then 200", async () => {
    const { url, release, close } = await notReadyServer();
    try {
      const health = await fetch(`${url}/healthz`);
      expect(health.status).toBe(503);
      expect(await health.json()).toMatchObject({ ok: false, reason: "not_ready" });
      // The MCP surface too: a `create` now would `docker run` a tag that does
      // not exist, and Docker would answer by trying to pull it.
      const mcp = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(mcp.status).toBe(503);

      release();
      await new Promise((resolve) => setImmediate(resolve));
      expect((await fetch(`${url}/healthz`)).status).toBe(200);
    } finally {
      await close();
    }
  });

  it("is ready at once when no readiness promise is given", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});
