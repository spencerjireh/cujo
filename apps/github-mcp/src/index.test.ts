import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp } from "./index";

describe("github-mcp health", () => {
  it("responds 200 ok on /healthz", async () => {
    const server = createApp();
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await res.json();
    server.close();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, service: "github-mcp" });
  });
});
