import { describe, expect, it } from "vitest";
import { Store } from "./store";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1" };

describe("store", () => {
  it("claims one run per PR head", () => {
    const store = new Store(":memory:");
    const first = store.createRun(head);
    const second = store.createRun(head);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    expect(store.createRun({ ...head, headSha: "h2" }).created).toBe(true);
  });

  it("keeps the first session written for a PR", () => {
    const store = new Store(":memory:");
    expect(store.putSession("o/r", 7, "s1")).toBe("s1");
    expect(store.putSession("o/r", 7, "s2")).toBe("s1");
    expect(store.getSession("o/r", 7)).toBe("s1");
  });

  it("lets exactly one caller claim the decision, and can release it", () => {
    const store = new Store(":memory:");
    const { run } = store.createRun(head);
    expect(store.claimDecision(run.id, "a@x", "t")).toBe(false); // still running
    store.updateRun(run.id, { status: "blocked_pending" });
    expect(store.claimDecision(run.id, "a@x", "t")).toBe(true);
    expect(store.claimDecision(run.id, "b@x", "t")).toBe(false);
    expect(store.getRun(run.id)?.approver).toBe("a@x");
    store.clearDecision(run.id);
    expect(store.getRun(run.id)?.approver).toBeNull();
    expect(store.claimDecision(run.id, "b@x", "t")).toBe(true);
  });

  it("deletes a run and its projection", () => {
    const store = new Store(":memory:");
    const { run } = store.createRun(head);
    store.deleteRun(run.id);
    expect(store.getRun(run.id)).toBeNull();
    expect(store.createRun(head).created).toBe(true);
  });
});
