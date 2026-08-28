/**
 * The vocabulary, closed in both directions (decision 37).
 *
 * This reads source files, which is unusual, and it is the same trick and the
 * same justification as the public plane's import guard: no linter can express
 * "the first argument to `log.info` is a member of this list". The type system
 * covers half of it — the parameter is `EventName`, a union of string
 * literals, so an *undeclared* name is already a build error — and this covers
 * the half a type cannot: a declared name that nothing emits.
 *
 * That direction is the one worth having. A name nobody emits is a query
 * somebody will write and get no rows from, and conclude the thing never
 * happened. Two such names existed when this test was first run:
 * `public.stream.*` was declared and never implemented, and
 * `proxy.stream.degraded` was emitted through a computed `log[level](event)`
 * that no scan can see. Both were fixed rather than exempted.
 *
 * It lives here rather than in an app because the vocabulary is this package's
 * and the emitters are spread across three of them.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "../src/events";

const REPO = join(import.meta.dirname, "../../..");
const APPS = ["apps/cujo/src", "apps/github-mcp/src", "apps/web/src"];

/**
 * Any receiver ending in `log` or `logger`, so `c.get("log").warn(…)`,
 * `this.log.child({…}).error(…)` and `s.log.info(…)` are all seen. A computed
 * call is deliberately *not* matched: making it invisible here is the reason
 * the two web SSE routes spell their branches out.
 */
const EMIT = /(?:\blog|\blogger|\)|\})\s*\.\s*(?:debug|info|warn|error)\(\s*"([^"]+)"/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const emitted = new Set<string>();
const files: string[] = [];
for (const app of APPS) {
  for (const file of walk(join(REPO, app))) {
    files.push(file);
    const source = readFileSync(file, "utf8");
    for (const [, event] of source.matchAll(EMIT)) {
      if (event) emitted.add(event);
    }
  }
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

describe("the event vocabulary", () => {
  it("emits nothing it has not declared", () => {
    // Already a compile error, since the parameter is typed `EventName`. Kept
    // because a cast would slip past the type and not past this.
    expect(sorted([...emitted].filter((event) => !EVENT_NAMES.includes(event as never)))).toEqual(
      [],
    );
  });

  it("declares nothing it does not emit", () => {
    // The half no type system covers, and the one that keeps the vocabulary
    // from becoming a list of things that sound like they happen.
    expect(sorted(EVENT_NAMES.filter((event) => !emitted.has(event)))).toEqual([]);
  });

  it("finds the calls it is checking, so the guard cannot pass vacuously", () => {
    // Without this, deleting every log call in the repo would make the two
    // assertions above pass in one direction and the file look healthy.
    expect(files.length).toBeGreaterThan(40);
    expect(emitted.size).toBeGreaterThan(40);
    for (const anchor of ["webhook.accepted", "run.status.changed", "review.posted"]) {
      expect(emitted).toContain(anchor);
    }
  });

  it("keeps one spelling per plane, so a query can ask about a trust boundary", () => {
    for (const event of EVENT_NAMES) {
      expect(event).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });
});
