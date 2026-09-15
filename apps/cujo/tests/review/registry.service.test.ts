import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { RegistryService } from "../../src/review/registry.service";
import { Store } from "../../src/store";
import type { InstalledRepo } from "../../src/store/repositories";

function harness(listing: InstalledRepo[] | Error, intervalMs = 60_000) {
  const store = new Store(":memory:");
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });
  const listInstalledRepos = vi.fn(async () => {
    if (listing instanceof Error) throw listing;
    return listing;
  });
  const service = new RegistryService({
    log,
    repositories: store.repositories,
    github: { listInstalledRepos },
    intervalMs,
    now: () => new Date("2026-09-15T12:00:00.000Z"),
  });
  const logged = (event: string) => lines.filter((l) => l.event === event);
  return { store, service, listInstalledRepos, logged };
}

describe("RegistryService.sync (decision 151)", () => {
  it("fills an empty table from the listing and removes what GitHub no longer lists", async () => {
    const h = harness([
      { repo: "o/a", installationId: 1, isPrivate: false },
      { repo: "o/b", installationId: 1, isPrivate: true },
    ]);
    h.store.repositories.upsertInstalled(
      [
        { repo: "o/stale", installationId: 1, isPrivate: false },
        { repo: "o/b", installationId: 1, isPrivate: false },
      ],
      "2026-09-14T00:00:00.000Z",
    );
    h.store.repositories.setEnabled("o/b", false, "2026-09-14T00:00:00.000Z");
    expect(await h.service.sync()).toEqual({ seen: 2, removed: 1 });
    expect(h.store.repositories.listActive().map((r) => r.repo)).toEqual(["o/a", "o/b"]);
    expect(h.store.repositories.get("o/stale")).toMatchObject({
      removedAt: "2026-09-15T12:00:00.000Z",
    });
    // The owner's switch is not GitHub's to reset.
    expect(h.store.repositories.get("o/b")?.enabled).toBe(false);
    expect(h.logged("registry.removed")).toMatchObject([{ repo: "o/stale", reason: "sync" }]);
    expect(h.logged("registry.synced")).toMatchObject([{ count: 2, active: 2 }]);
  });

  it("starts with an immediate pass, never overlaps, and stops cleanly", async () => {
    const h = harness([{ repo: "o/a", installationId: 1, isPrivate: false }], 50);
    h.service.start();
    h.service.start();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.listInstalledRepos).toHaveBeenCalledTimes(1);
    expect(h.store.repositories.listActive()).toHaveLength(1);
    h.service.stop();
    await new Promise((r) => setTimeout(r, 120));
    expect(h.listInstalledRepos).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the interval is zero", () => {
    const h = harness([{ repo: "o/a", installationId: 1, isPrivate: false }], 0);
    h.service.start();
    expect(h.listInstalledRepos).not.toHaveBeenCalled();
  });

  it("logs a failed pass and keeps the table it had", async () => {
    const h = harness(new Error("GitHub 502"), 50);
    h.store.repositories.upsertInstalled(
      [{ repo: "o/kept", installationId: 1, isPrivate: false }],
      "2026-09-14T00:00:00.000Z",
    );
    h.service.start();
    await new Promise((r) => setTimeout(r, 10));
    h.service.stop();
    expect(h.logged("registry.sync.failed")).toHaveLength(1);
    expect(h.store.repositories.listActive()).toHaveLength(1);
  });
});
