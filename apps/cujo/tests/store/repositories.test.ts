import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

const t0 = "2026-09-15T10:00:00.000Z";
const t1 = "2026-09-15T11:00:00.000Z";

describe("the repository registry (decision 151)", () => {
  it("upserts what an installation carries and reads it back by any casing", () => {
    const store = new Store(":memory:");
    store.repositories.upsertInstalled(
      [
        { repo: "Owner/Repo", installationId: 42, isPrivate: false },
        { repo: "owner/other", installationId: 42, isPrivate: true },
      ],
      t0,
    );
    expect(store.repositories.get("OWNER/REPO")).toEqual({
      repo: "owner/repo",
      displayName: "Owner/Repo",
      installationId: 42,
      isPrivate: false,
      enabled: true,
      addedAt: t0,
      removedAt: null,
      updatedAt: t0,
    });
    expect(store.repositories.listActive().map((r) => r.repo)).toEqual([
      "owner/other",
      "owner/repo",
    ]);
    expect(store.repositories.get("nobody/nothing")).toBeNull();
  });

  it("keeps enabled across a removal and a reinstall, and follows GitHub for the rest", () => {
    const store = new Store(":memory:");
    store.repositories.upsertInstalled([{ repo: "o/r", installationId: 1, isPrivate: false }], t0);
    expect(store.repositories.setEnabled("O/R", false, t0)).toBe(true);
    expect(store.repositories.setEnabled("o/none", false, t0)).toBe(false);
    expect(store.repositories.markRemoved(["o/r", "o/none"], t1)).toEqual(["o/r"]);
    expect(store.repositories.get("o/r")).toMatchObject({ enabled: false, removedAt: t1 });
    expect(store.repositories.listActive()).toEqual([]);
    // A second removal of the same row changes nothing.
    expect(store.repositories.markRemoved(["o/r"], t1)).toEqual([]);
    store.repositories.upsertInstalled([{ repo: "O/R", installationId: 2, isPrivate: true }], t1);
    expect(store.repositories.get("o/r")).toMatchObject({
      displayName: "O/R",
      installationId: 2,
      isPrivate: true,
      enabled: false,
      addedAt: t0,
      removedAt: null,
      updatedAt: t1,
    });
    expect(store.repositories.listAll()).toHaveLength(1);
  });

  it("removes every active row under an installation at once", () => {
    const store = new Store(":memory:");
    store.repositories.upsertInstalled(
      [
        { repo: "a/one", installationId: 7, isPrivate: false },
        { repo: "a/two", installationId: 7, isPrivate: false },
        { repo: "b/one", installationId: 8, isPrivate: false },
      ],
      t0,
    );
    expect(store.repositories.markInstallationRemoved(7, t1)).toBe(2);
    expect(store.repositories.listActive().map((r) => r.repo)).toEqual(["b/one"]);
    expect(store.repositories.markInstallationRemoved(7, t1)).toBe(0);
  });

  it("calls a repository disabled only when a row says so", () => {
    const store = new Store(":memory:");
    expect(store.repositories.isDisabled("o/unknown")).toBe(false);
    store.repositories.upsertInstalled([{ repo: "o/r", installationId: 1, isPrivate: false }], t0);
    expect(store.repositories.isDisabled("o/r")).toBe(false);
    store.repositories.setEnabled("o/r", false, t0);
    expect(store.repositories.isDisabled("O/R")).toBe(true);
    // Removed but disabled still reads disabled: the flag is the owner's.
    store.repositories.markRemoved(["o/r"], t1);
    expect(store.repositories.isDisabled("o/r")).toBe(true);
  });
});
