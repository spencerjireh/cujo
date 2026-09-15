import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

describe("the settings rows (decision 152)", () => {
  it("puts, replaces, and lists by key", () => {
    const store = new Store(":memory:");
    expect(store.settings.get("model")).toBeNull();
    store.settings.put("model", JSON.stringify("p/m"), "seed", "t0");
    expect(store.settings.get("model")).toEqual({
      key: "model",
      value: '"p/m"',
      source: "seed",
      updatedAt: "t0",
    });
    store.settings.put("model", JSON.stringify("p/other"), "owner", "t1");
    expect(store.settings.get("model")).toMatchObject({
      value: '"p/other"',
      source: "owner",
      updatedAt: "t1",
    });
    store.settings.put("diffModel", '"p/flash"', "seed", "t0");
    expect(store.settings.all().map((r) => r.key)).toEqual(["diffModel", "model"]);
  });
});
