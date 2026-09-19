import { createLogger } from "@cujo/log";
import { describe, expect, it } from "vitest";
import type { Engine } from "../src/engine";
import { BadSymbolError, buildSlice, usersOf } from "../src/slice";

const log = createLogger({ service: "mapper", sink: () => {} });
void log;

/** An engine that answers from a script and records what it was asked. */
function fake(answers: Record<string, unknown>[]): Engine & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  let next = 0;
  const engine = {
    calls,
    run: async (tool: string, args: unknown) => {
      calls.push([tool, args]);
      const answer = answers[next] ?? {};
      next += 1;
      return answer;
    },
  };
  return engine as unknown as Engine & { calls: unknown[][] };
}

describe("the slice a review reads (decision 172)", () => {
  it("pages until the engine says there is no more", async () => {
    const engine = fake([
      {
        changed_files: ["a.ts"],
        impacted: [{ qn: "one", label: "Function", file: "a.ts", hop: 1 }],
        impacted_total: 2,
        impacted_has_more: true,
        impacted_next_cursor: "c1",
      },
      {
        changed_files: ["b.ts"],
        impacted: [{ qn: "two", label: "Function", file: "b.ts", hop: 2 }],
        impacted_total: 2,
        impacted_has_more: false,
      },
    ]);
    const slice = await buildSlice(engine, { project: "p", base: "abc" });
    // One call is a silently partial answer: on this repository's own diff
    // the engine returned 72 of 141 impacted symbols in the first page.
    expect(engine.calls).toHaveLength(2);
    expect((engine.calls[1]?.[1] as { impact_cursor?: string }).impact_cursor).toBe("c1");
    expect(slice.impacted.map((s) => s.qn)).toEqual(["one", "two"]);
    expect(slice.changed_files).toEqual(["a.ts", "b.ts"]);
    expect(slice.truncated).toBe(false);
  });

  it("stops at the cap and says it stopped", async () => {
    const engine = fake([
      {
        impacted: [
          { qn: "one", file: "a.ts", hop: 1 },
          { qn: "two", file: "b.ts", hop: 1 },
        ],
        impacted_total: 9,
        impacted_has_more: true,
        impacted_next_cursor: "c1",
      },
    ]);
    const slice = await buildSlice(engine, { project: "p", base: "abc", maxImpacted: 2 });
    expect(slice.impacted).toHaveLength(2);
    expect(slice.impacted_total).toBe(9);
    expect(slice.truncated).toBe(true);
    expect(engine.calls).toHaveLength(1);
  });

  it("asks for callers by every edge, not by calls alone", async () => {
    const engine = fake([
      {
        columns: ["user", "edge", "file"],
        rows: [["heldClaims", "CALL_REFERENCE", "a.ts"]],
      },
    ]);
    const users = await usersOf(engine, "p", "isMaliceClaim");
    const query = String((engine.calls[0]?.[1] as { query: string }).query);
    // `trace_path` would have answered with the two direct callers and left
    // out the one that passes the function as a value.
    expect(query).toContain("MATCH (a)-[r]->(b)");
    expect(query).not.toContain("CALLS");
    expect(users[0]?.edge).toBe("CALL_REFERENCE");
  });

  it("refuses a symbol name it would have to splice blindly", async () => {
    const engine = fake([{}]);
    // The engine's Cypher subset takes no parameters, so the name is spliced;
    // a quote in it would end the string literal.
    await expect(usersOf(engine, "p", "a' OR '1'='1")).rejects.toThrow(BadSymbolError);
    expect(engine.calls).toHaveLength(0);
  });
});
