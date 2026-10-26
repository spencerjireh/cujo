/**
 * The boot-time image build (decision 118) and the keeper that rebuilds a pruned
 * image after it (decision 181), against a fake `docker`.
 *
 * What matters is not that `docker build` runs but what it is told: the tag
 * the runtime will later `docker run`, a context inside this container and
 * never a caller's, and no `--pull`, so a registry that is down does not stop
 * a deploy whose layers are already cached.
 */

import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { Docker, DockerResult } from "../src/docker";
import { buildImages, imageKeeper } from "../src/images";

const ok: DockerResult = { stdout: "", stderr: "", exitCode: 0, timedOut: false };
const log = createLogger({ service: "sandbox-mcp", sink: () => {} });

function fakeDocker(over: (args: readonly string[]) => DockerResult | null = () => null) {
  const calls: { args: string[]; timeoutMs?: number }[] = [];
  const docker: Docker = vi.fn(async (args, options) => {
    calls.push({ args: [...args], timeoutMs: options?.timeoutMs });
    return over(args) ?? ok;
  });
  return { docker, calls };
}

const builds = [
  { tag: "cujo-sandbox:latest", context: "/app/images/sandbox" },
  { tag: "cujo-sandbox-gateway:latest", context: "/app/images/gateway" },
];

describe("buildImages", () => {
  it("builds each context under the tag the runtime will run, in order", async () => {
    const { docker, calls } = fakeDocker();
    await buildImages(builds, { docker, log });
    expect(calls.map((c) => c.args)).toEqual([
      ["build", "--tag", "cujo-sandbox:latest", "/app/images/sandbox"],
      ["build", "--tag", "cujo-sandbox-gateway:latest", "/app/images/gateway"],
    ]);
  });

  it("never pulls, so a cached build survives a registry outage", async () => {
    const { docker, calls } = fakeDocker();
    await buildImages(builds, { docker, log });
    for (const call of calls) expect(call.args).not.toContain("--pull");
  });

  it("gives a build minutes, not the sixty seconds a `docker run` gets", async () => {
    const { docker, calls } = fakeDocker();
    await buildImages(builds, { docker, log });
    for (const call of calls) expect(call.timeoutMs).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  it("stops at the first failure and names the image and the tail of its log", async () => {
    const { docker, calls } = fakeDocker((args) =>
      args[2] === "cujo-sandbox:latest"
        ? {
            stdout: "",
            stderr: "Step 4/9 : RUN pip install\nerror: no matching",
            exitCode: 1,
            timedOut: false,
          }
        : null,
    );
    await expect(buildImages(builds, { docker, log })).rejects.toThrow(
      /docker build cujo-sandbox:latest exited 1: [\s\S]*no matching/,
    );
    expect(calls).toHaveLength(1);
  });

  it("reports a timeout as one, not as an exit code", async () => {
    const { docker } = fakeDocker(() => ({
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: true,
    }));
    await expect(buildImages(builds, { docker, log })).rejects.toThrow(/timed out/);
  });
});

describe("imageKeeper", () => {
  const inspect = (args: readonly string[]) => args[0] === "image" && args[1] === "inspect";
  const gone = (tag: string) => (args: readonly string[]) =>
    inspect(args) && args[4] === tag
      ? { stdout: "", stderr: `Error: No such image: ${tag}`, exitCode: 1, timedOut: false }
      : null;

  it("asks the daemon for each tag and builds nothing when both are present", async () => {
    const { docker, calls } = fakeDocker();
    await imageKeeper(builds, { docker, log }).ensure();
    expect(calls.map((c) => c.args[0])).toEqual(["image", "image"]);
    expect(calls.map((c) => c.args[4])).toEqual(builds.map((b) => b.tag));
  });

  it("rebuilds only the tag the host pruned, from its own context", async () => {
    const { docker, calls } = fakeDocker(gone("cujo-sandbox-gateway:latest"));
    await imageKeeper(builds, { docker, log }).ensure();
    const built = calls.filter((c) => c.args[0] === "build").map((c) => c.args);
    expect(built).toEqual([
      ["build", "--tag", "cujo-sandbox-gateway:latest", "/app/images/gateway"],
    ]);
  });

  it("lets concurrent callers share one rebuild", async () => {
    let release: () => void = () => {};
    const { docker, calls } = fakeDocker((args) => {
      if (args[0] === "build") return null;
      return gone("cujo-sandbox:latest")(args);
    });
    // Only the first build waits to be released; the later one is ordinary.
    let first = true;
    const slow: Docker = async (args, options) => {
      if (args[0] === "build" && first) {
        first = false;
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return docker(args, options);
    };
    const keeper = imageKeeper(builds, { docker: slow, log });
    const one = keeper.ensure();
    const two = keeper.ensure();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([one, two]);
    expect(calls.filter((c) => c.args[0] === "build")).toHaveLength(1);
    // A later call asks again rather than reusing a settled sweep.
    await keeper.ensure();
    expect(calls.filter((c) => c.args[0] === "build")).toHaveLength(2);
  });

  it("surfaces a failed rebuild to the caller", async () => {
    const { docker } = fakeDocker((args) =>
      args[0] === "build"
        ? { stdout: "", stderr: "no space left on device", exitCode: 1, timedOut: false }
        : gone("cujo-sandbox:latest")(args),
    );
    await expect(imageKeeper(builds, { docker, log }).ensure()).rejects.toThrow(
      /docker build cujo-sandbox:latest exited 1/,
    );
  });
});
