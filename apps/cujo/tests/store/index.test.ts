import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

describe("store", () => {
  it("migrates a database that already exists, and does it once", () => {
    // The whole point of the mechanism is a database that is already out
    // there, which :memory: cannot represent.
    const dir = mkdtempSync(join(tmpdir(), "cujo-store-"));
    const path = join(dir, "cujo.db");
    try {
      const first = new Store(path);
      first.notifications.putDiscordChannel({
        repo: "o/r",
        channelId: "c1",
        guildId: "g1",
        channelName: "reviews",
        notifyRoleId: null,
        boundBy: "op@example.com",
      });
      first.close();

      // Re-opening must not try to add the column a second time.
      const second = new Store(path);
      expect(second.notifications.getDiscordChannel("o/r")?.boundBy).toBe("op@example.com");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
