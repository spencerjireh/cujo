import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

describe("the board's per-repository layer (decision 155)", () => {
  it("says nothing for a repository nobody set, and keeps what a patch leaves out", () => {
    const store = new Store(":memory:");
    expect(store.repositorySettings.get("o/r")).toEqual({
      mode: null,
      instructions: null,
      updatedAt: null,
    });
    expect(store.repositorySettings.set("O/R", { mode: "diff" }, "t0")).toEqual({
      mode: "diff",
      instructions: null,
      updatedAt: "t0",
    });
    expect(
      store.repositorySettings.set("o/r", { instructions: "Skip generated files." }, "t1"),
    ).toEqual({
      mode: "diff",
      instructions: "Skip generated files.",
      updatedAt: "t1",
    });
    expect(store.repositorySettings.set("o/r", { mode: null }, "t2")).toMatchObject({
      mode: null,
      instructions: "Skip generated files.",
    });
    expect(store.repositorySettings.get("o/R").mode).toBeNull();
  });
});
