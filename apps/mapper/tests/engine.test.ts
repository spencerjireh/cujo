import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@cujo/log";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Engine, EngineError } from "../src/engine";

const log = createLogger({ service: "mapper", sink: () => {} });
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cujo-mapper-engine-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the engine: a script that behaves however a test needs. */
function binary(body: string): string {
  const path = join(dir, "fake-engine");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function engineOf(bin: string, timeoutMs = 5000): Engine {
  return new Engine({ bin, cacheDir: join(dir, "cache"), allowedRoot: dir, timeoutMs, log });
}

describe("the one place that runs the engine", () => {
  it("passes the tool, the json format and the arguments as flags", async () => {
    const bin = binary('printf \'{"argv":"%s"}\' "$*"');
    const answer = await engineOf(bin).run<{ argv: string }>("search_graph", {
      project: "p",
      max_depth: 3,
      detail: true,
      absent: undefined,
    });
    // snake_case becomes kebab-case, `true` is a bare flag, `undefined` is
    // left out entirely.
    expect(answer.argv).toBe(
      "cli --quiet search_graph --format json --project p --max-depth 3 --detail",
    );
  });

  it("does not tell index_repository about a flag it has no schema for", async () => {
    const bin = binary('printf \'{"argv":"%s"}\' "$*"');
    const answer = await engineOf(bin).run<{ argv: string }>("index_repository", {
      repo_path: "/x",
    });
    // The real binary exits non-zero on `--format` here; the live test is
    // what found that and this is what keeps it found.
    expect(answer.argv).toBe("cli --quiet index_repository --repo-path /x");
  });

  it("passes the cache and the confinement root in the environment", async () => {
    const bin = binary(
      'printf \'{"cache":"%s","root":"%s"}\' "$CBM_CACHE_DIR" "$CBM_ALLOWED_ROOT"',
    );
    const answer = await engineOf(bin).run<{ cache: string; root: string }>("list_projects");
    expect(answer.cache).toBe(join(dir, "cache"));
    expect(answer.root).toBe(dir);
  });

  it("carries the engine's own first line of complaint when it exits non-zero", async () => {
    const bin = binary('echo "error: unknown flag --nope" >&2\nexit 2');
    await expect(engineOf(bin).run("search_graph")).rejects.toMatchObject({
      name: "EngineError",
      code: 2,
      message: expect.stringContaining("unknown flag --nope"),
    });
  });

  it("says so when the answer is not JSON, rather than passing rubbish on", async () => {
    const bin = binary('echo "not json at all"');
    await expect(engineOf(bin).run("search_graph")).rejects.toThrow(EngineError);
  });

  it("kills a tool that never answers", async () => {
    const bin = binary("sleep 30");
    await expect(engineOf(bin, 150).run("search_graph")).rejects.toMatchObject({
      message: expect.stringContaining("no answer in 150 ms"),
    });
  });
});
