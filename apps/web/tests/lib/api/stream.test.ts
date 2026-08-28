import { parseSnapshot, reduceList, reduceRun } from "@/lib/api/stream";
import type { Run, RunList, RunSummary } from "@/lib/api/types";
import { describe, expect, it } from "vitest";

const summary: RunSummary = {
  id: "r1",
  repo: "o/r",
  pr_number: 7,
  head_sha: "a1f9c3e",
  status: "running",
  approver: null,
  created_at: "2026-08-28T10:00:00.000Z",
  updated_at: "2026-08-28T10:00:00.000Z",
};

const run = (over: Partial<Run> = {}): Run => ({
  ...summary,
  session_id: "s1",
  turn_ids: ["t1"],
  decided_at: null,
  checks: [],
  findings: [],
  hard_rule_hits: [],
  review: null,
  approval: null,
  external_resume: false,
  error: null,
  summary: null,
  ...over,
});

describe("parseSnapshot", () => {
  it("reads a well-formed snapshot", () => {
    expect(parseSnapshot(JSON.stringify(run()))?.id).toBe("r1");
  });

  it("returns null rather than throwing on junk", () => {
    expect(parseSnapshot("not json")).toBeNull();
    expect(parseSnapshot("null")).toBeNull();
    expect(parseSnapshot("[]")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ id: "r1" }))).toBeNull();
  });
});

describe("reduceRun", () => {
  it("keeps the previous object when a snapshot repeats", () => {
    // The stream is documented to deliver a duplicate rather than risk a drop,
    // so identity here is what stops every repeat re-rendering the page.
    const previous = run();
    expect(reduceRun(previous, run())).toBe(previous);
  });

  it("takes the new snapshot when the status moves", () => {
    const previous = run();
    const next = run({ status: "blocked_pending", updated_at: "2026-08-28T10:01:00.000Z" });
    expect(reduceRun(previous, next)).toBe(next);
  });

  it("takes the new snapshot when only updated_at moves", () => {
    const previous = run();
    const next = run({ updated_at: "2026-08-28T10:00:30.000Z" });
    expect(reduceRun(previous, next)).toBe(next);
  });

  it("adopts the snapshot when there is nothing cached", () => {
    const next = run();
    expect(reduceRun(undefined, next)).toBe(next);
  });
});

describe("reduceList", () => {
  const list: RunList = { runs: [summary] };

  it("patches the matching row in place", () => {
    const next = reduceList(list, run({ status: "blocked_posted", approver: "op@example.com" }));
    expect(next?.runs[0]?.status).toBe("blocked_posted");
    expect(next?.runs[0]?.approver).toBe("op@example.com");
    // Untouched fields survive: the stream carries the detail shape, not the row.
    expect(next?.runs[0]?.head_sha).toBe("a1f9c3e");
  });

  it("keeps the previous list when the row already matches", () => {
    expect(reduceList(list, run())).toBe(list);
  });

  it("leaves a list that has not seen the run for the poll to correct", () => {
    expect(reduceList(list, run({ id: "r2" }))).toBe(list);
  });

  it("does nothing when the list is not cached", () => {
    expect(reduceList(undefined, run())).toBeUndefined();
  });
});
