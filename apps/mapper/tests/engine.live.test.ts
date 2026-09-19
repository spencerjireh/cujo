/**
 * The engine's own contract, against the real binary.
 *
 * Every other test here stubs the engine, which proves this service's logic
 * and proves nothing about the thing it wraps. The output shapes this code
 * reads — `impacted_next_cursor`, `rows`, `nodes` — are an external
 * project's, and a version bump is exactly when they move. A stub would keep
 * passing through that.
 *
 * Skipped unless `CUJO_MAPPER_BIN` names a binary, so CI and a fresh clone
 * stay green without a 1.4 GB build. Run it after changing the pin:
 *
 *   CUJO_MAPPER_BIN=/path/to/codebase-memory-mcp pnpm --filter @cujo/mapper test
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@cujo/log";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import { buildSlice, usersOf } from "../src/slice";

const bin = process.env.CUJO_MAPPER_BIN;
const log = createLogger({ service: "mapper", sink: () => {} });

describe.skipIf(!bin)("the engine, for real", () => {
  it("indexes a small repository and answers about it in the shapes this code reads", async () => {
    const root = mkdtempSync(join(tmpdir(), "cujo-mapper-live-"));
    const repo = join(root, "repo");
    const cache = join(root, "cache");
    mkdirSync(repo, { recursive: true });
    mkdirSync(cache, { recursive: true });
    try {
      writeFileSync(join(repo, "a.ts"), "export function used(x: number) {\n  return x > 1;\n}\n");
      // One direct call and one reference passed as a value: the second is
      // the edge `trace_path` drops, and the reason this service queries the
      // graph instead.
      writeFileSync(
        join(repo, "b.ts"),
        "import { used } from './a';\n\n" +
          "export function direct(x: number) {\n  return used(x);\n}\n\n" +
          "export function passed(xs: number[]) {\n  return xs.filter(used);\n}\n",
      );
      const git = (...argv: string[]) =>
        execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...argv]);
      git("init", "--quiet", "--initial-branch", "main");
      git("add", "--all");
      git("commit", "--quiet", "--message", "base");
      writeFileSync(
        join(repo, "b.ts"),
        "import { used } from './a';\n\n" +
          "export function direct(x: number) {\n  return used(x + 1);\n}\n\n" +
          "export function passed(xs: number[]) {\n  return xs.filter(used);\n}\n",
      );
      git("add", "--all");
      git("commit", "--quiet", "--message", "head");
      const base = String(execFileSync("git", ["-C", repo, "rev-parse", "HEAD~1"])).trim();

      const engine = new Engine({
        bin: bin as string,
        cacheDir: cache,
        allowedRoot: root,
        timeoutMs: 120_000,
        log,
      });

      const indexed = await engine.run<{ nodes?: number; status?: string }>("index_repository", {
        repo_path: repo,
      });
      expect(indexed.status).toBe("indexed");
      expect(indexed.nodes ?? 0).toBeGreaterThan(0);

      const projects = await engine.run<{ projects?: { name?: string }[] }>("list_projects");
      const project = projects.projects?.[0]?.name ?? "";
      expect(project).not.toBe("");

      // The slice reads these keys by name; this is the assertion that a
      // version bump has not renamed them underneath us.
      const slice = await buildSlice(engine, { project, base });
      expect(slice.changed_files).toContain("b.ts");
      expect(typeof slice.impacted_total).toBe("number");

      // And that a function used as a value is still reachable by an edge
      // `trace_path` would not have followed.
      const users = await usersOf(engine, project, "used");
      const edges = users.map((u) => u.edge);
      expect(edges).toContain("CALLS");
      expect(edges).toContain("CALL_REFERENCE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
