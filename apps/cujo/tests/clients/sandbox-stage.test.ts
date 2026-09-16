/**
 * The staging client (decision 158): bytes up, a count or a reason back.
 */
import { describe, expect, it, vi } from "vitest";
import { SandboxStager, StageError } from "../../src/clients/sandbox-stage";

const TICKET = "0123456789abcdef0123456789abcdef";

function stream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

describe("SandboxStager.put", () => {
  it("streams the archive to the staging route beside the MCP endpoint", async () => {
    const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(`http://sandbox-mcp:8082/stage/${TICKET}/base`);
      expect(init?.method).toBe("PUT");
      expect((init as { duplex?: string }).duplex).toBe("half");
      expect(await new Response(init?.body as ReadableStream).text()).toBe("tar");
      return new Response(JSON.stringify({ ok: true, bytes: 3 }), { status: 201 });
    });
    const stager = new SandboxStager("http://sandbox-mcp:8082/mcp", 1000, impl as typeof fetch);
    await expect(stager.put(TICKET, "base", stream("tar"))).resolves.toBe(3);
  });

  it("turns a refusal into an error carrying the status and the tree", async () => {
    const impl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "head is over 10 bytes" }), {
          status: 413,
        }),
    );
    const stager = new SandboxStager("http://sandbox-mcp:8082/mcp", 1000, impl as typeof fetch);
    const failure = await stager.put(TICKET, "head", stream("x")).catch((e) => e);
    expect(failure).toBeInstanceOf(StageError);
    expect(failure).toMatchObject({ status: 413, tree: "head" });
    expect(String(failure.message)).toContain("head is over 10 bytes");
  });

  it("reports a service that did not answer as status 0", async () => {
    const impl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const stager = new SandboxStager("http://sandbox-mcp:8082/mcp", 1000, impl as typeof fetch);
    await expect(stager.put(TICKET, "base", stream("x"))).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("fetch failed"),
    });
  });
});
