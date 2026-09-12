/**
 * The own runtime, against a fake `docker` (decisions 114, 116).
 *
 * The properties asserted here are the ones the whole track exists for, and none
 * of them is visible from a passing integration test: the sandbox's network has
 * no route out, the gateway exists before the sandbox does, the gateway is the
 * only container with a capability, and a half-provisioned sandbox is cleaned up
 * rather than left holding a network.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { Docker, DockerResult } from "../src/docker";
import { SandboxError } from "../src/runtime";
import { LocalRuntime } from "../src/runtimes/local";

const ok: DockerResult = { stdout: "id\n", stderr: "", exitCode: 0, timedOut: false };

function fakeDocker(over: (args: readonly string[]) => DockerResult | null = () => null) {
  const calls: string[][] = [];
  const docker: Docker = vi.fn(async (args) => {
    calls.push([...args]);
    return over(args) ?? ok;
  });
  return { docker, calls };
}

function runtime(docker: Docker) {
  return new LocalRuntime({
    image: "cujo/sandbox:pinned",
    gatewayImage: "cujo/sandbox-gateway:pinned",
    containerRuntime: "runsc",
    egressNetwork: "cujo-egress",
    docker,
    log: createLogger({ service: "sandbox-mcp", sink: () => {} }),
  });
}

/** The index of the first call whose argv starts with these words. */
function indexOf(calls: string[][], ...words: string[]): number {
  return calls.findIndex((call) => words.every((word, i) => call[i] === word));
}

describe("LocalRuntime.create", () => {
  it("gives the sandbox a network with no route off it", async () => {
    const { docker, calls } = fakeDocker();
    await runtime(docker).create({ allowHosts: ["pypi.org"] });
    const create = calls[indexOf(calls, "network", "create")];
    // `--internal` is the load-bearing flag: Docker installs no default route on
    // an internal network, so the only way out is a container on a second one.
    expect(create).toContain("--internal");
  });

  it("starts the gateway before the sandbox, so there is never an unfiltered window", async () => {
    const { docker, calls } = fakeDocker();
    await runtime(docker).create({ allowHosts: ["pypi.org"] });
    const gateway = calls.findIndex((c) => c.includes("cujo/sandbox-gateway:pinned"));
    const sandbox = calls.findIndex((c) => c.includes("cujo/sandbox:pinned"));
    expect(gateway).toBeGreaterThanOrEqual(0);
    expect(sandbox).toBeGreaterThan(gateway);
  });

  it("hands the allowlist to the gateway as one argument", async () => {
    const { docker, calls } = fakeDocker();
    await runtime(docker).create({ allowHosts: ["pypi.org", "files.pythonhosted.org"] });
    const gateway = calls.find((c) => c.includes("cujo/sandbox-gateway:pinned")) ?? [];
    // One argv entry, so no hostname can become a second flag or a second rule.
    expect(gateway).toContain("CUJO_ALLOW_HOSTS=pypi.org,files.pythonhosted.org");
  });

  it("gives the gateway its one capability and the sandbox none", async () => {
    const { docker, calls } = fakeDocker();
    await runtime(docker).create({ allowHosts: [] });
    const gateway = calls.find((c) => c.includes("cujo/sandbox-gateway:pinned")) ?? [];
    const sandbox = calls.find((c) => c.includes("cujo/sandbox:pinned")) ?? [];
    // NET_ADMIN is for writing nftables rules, in the one container that holds
    // no pull request code.
    expect(gateway).toContain("NET_ADMIN");
    expect(sandbox).not.toContain("NET_ADMIN");
    // And the container that does hold that code gets nothing.
    expect(sandbox).toContain("--cap-drop");
    expect(sandbox).toContain("ALL");
    expect(sandbox).toContain("no-new-privileges:true");
  });

  it("runs the sandbox under the configured container runtime", async () => {
    const { docker, calls } = fakeDocker();
    await runtime(docker).create({ allowHosts: [] });
    const sandbox = calls.find((c) => c.includes("cujo/sandbox:pinned")) ?? [];
    expect(sandbox).toContain("--runtime");
    expect(sandbox).toContain("runsc");
  });

  it("connects the gateway to the egress network, which is its only second leg", async () => {
    const { docker, calls } = fakeDocker();
    await runtime(docker).create({ allowHosts: [] });
    const connect = calls[indexOf(calls, "network", "connect")];
    expect(connect).toContain("cujo-egress");
  });

  it("reports how long provisioning took, because no harness event does now", async () => {
    const { docker } = fakeDocker();
    const sandbox = await runtime(docker).create({ allowHosts: [] });
    // Decision 115: `sandbox.created` was a harness event and the harness stopped
    // provisioning, so this number is what keeps `sandboxMs` from going null.
    expect(sandbox.provisionedMs).toBeGreaterThanOrEqual(0);
    expect(typeof sandbox.id).toBe("string");
  });

  it("mints its own id rather than returning a vendor handle", async () => {
    const { docker } = fakeDocker();
    const sandbox = await runtime(docker).create({ allowHosts: [] });
    // Never a container name, never a network name, never a host.
    expect(sandbox.id).not.toContain("cujo-sbx");
    expect(sandbox.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("cleans up after a failure, rather than leaving half a sandbox", async () => {
    // Half a sandbox is worse than none: it holds a network and a container
    // nobody will ever ask about again.
    const { docker, calls } = fakeDocker((args) =>
      args.includes("cujo/sandbox:pinned")
        ? { stdout: "", stderr: "no such image", exitCode: 125, timedOut: false }
        : null,
    );
    await expect(runtime(docker).create({ allowHosts: [] })).rejects.toThrow(SandboxError);
    expect(indexOf(calls, "rm", "--force")).toBeGreaterThanOrEqual(0);
    expect(indexOf(calls, "network", "rm")).toBeGreaterThanOrEqual(0);
  });

  it("warns when no container runtime is configured instead of refusing to start", async () => {
    // A host that has not had gVisor installed still runs reviews, with weaker
    // isolation and a line saying so. A service that refuses to start on a
    // half-provisioned host is the worse failure.
    const lines: Record<string, unknown>[] = [];
    const { docker, calls } = fakeDocker();
    const weak = new LocalRuntime({
      image: "i",
      gatewayImage: "g",
      docker,
      log: createLogger({ service: "sandbox-mcp", sink: (l) => lines.push(JSON.parse(l)) }),
    });
    await weak.create({ allowHosts: [] });
    expect(lines.some((l) => l.event === "sandbox.runtime.default")).toBe(true);
    expect((calls.find((c) => c.includes("i")) ?? []).includes("--runtime")).toBe(false);
  });
});

describe("LocalRuntime.exec", () => {
  it("refuses an id it never minted", async () => {
    const { docker } = fakeDocker();
    await expect(runtime(docker).exec("not-mine", { argv: ["true"] })).rejects.toThrow(
      "no such sandbox",
    );
  });

  it("passes argv through without a shell", async () => {
    const { docker, calls } = fakeDocker();
    const r = runtime(docker);
    const box = await r.create({ allowHosts: [] });
    await r.exec(box.id, { argv: ["python3", "-c", "print(1 && 2)"], cwd: "/work/head" });
    const exec = calls[indexOf(calls, "exec")] ?? [];
    // The `&&` is data inside one argv entry, not an operator.
    expect(exec).toContain("print(1 && 2)");
    expect(exec).toContain("--workdir");
    expect(exec).toContain("/work/head");
    expect(exec.join(" ")).not.toContain("sh -c");
  });

  it("passes each env pair as one argument", async () => {
    const { docker, calls } = fakeDocker();
    const r = runtime(docker);
    const box = await r.create({ allowHosts: [] });
    await r.exec(box.id, { argv: ["true"], env: { HTTPS_PROXY: "http://127.0.0.1:8899" } });
    const exec = calls[indexOf(calls, "exec")] ?? [];
    expect(exec).toContain("HTTPS_PROXY=http://127.0.0.1:8899");
  });

  it("reports a timeout as a timeout, which an exit code cannot say", async () => {
    const { docker } = fakeDocker((args) =>
      args[0] === "exec" ? { stdout: "", stderr: "", exitCode: null, timedOut: true } : null,
    );
    const r = runtime(docker);
    const box = await r.create({ allowHosts: [] });
    const result = await r.exec(box.id, { argv: ["sleep", "1000"], timeoutMs: 5 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it("refuses an empty command", async () => {
    const { docker } = fakeDocker();
    const r = runtime(docker);
    const box = await r.create({ allowHosts: [] });
    await expect(r.exec(box.id, { argv: [] })).rejects.toThrow("argv is empty");
  });
});

describe("LocalRuntime.destroy", () => {
  it("removes the sandbox, the gateway and the network", async () => {
    const { docker, calls } = fakeDocker();
    const r = runtime(docker);
    const box = await r.create({ allowHosts: [] });
    calls.length = 0;
    await r.destroy(box.id);
    expect(calls.filter((c) => c[0] === "rm")).toHaveLength(2);
    expect(indexOf(calls, "network", "rm")).toBeGreaterThanOrEqual(0);
  });

  it("is safe to call twice", async () => {
    const { docker } = fakeDocker();
    const r = runtime(docker);
    const box = await r.create({ allowHosts: [] });
    await r.destroy(box.id);
    await expect(r.destroy(box.id)).resolves.toBeUndefined();
  });
});

describe("LocalRuntime.reapExpired", () => {
  it("drops a sandbox whose caller went away", async () => {
    const { docker } = fakeDocker();
    const r = new LocalRuntime({
      image: "i",
      gatewayImage: "g",
      docker,
      maxLifetimeMs: 1000,
      log: createLogger({ service: "sandbox-mcp", sink: () => {} }),
    });
    const box = await r.create({ allowHosts: [] });
    expect(await r.reapExpired(Date.now())).toBe(0);
    expect(await r.reapExpired(Date.now() + 2000)).toBe(1);
    // And it is gone, so a later call finds nothing rather than reaping twice.
    expect(await r.reapExpired(Date.now() + 4000)).toBe(0);
    await expect(r.exec(box.id, { argv: ["true"] })).rejects.toThrow("no such sandbox");
  });
});
