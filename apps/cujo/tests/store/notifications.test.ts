import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

describe("notification store", () => {
  it("binds a repo to a Discord channel and replaces the binding on a re-bind", () => {
    const store = new Store(":memory:");
    const first = store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: "reviews",
      notifyRoleId: null,
    });
    expect(first).toMatchObject({ repo: "o/r", channelId: "c1", notifyRoleId: null });
    const second = store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c2",
      guildId: "g1",
      channelName: "elsewhere",
      notifyRoleId: "role1",
    });
    expect(second).toMatchObject({ channelId: "c2", notifyRoleId: "role1" });
    expect(second.createdAt).toBe(first.createdAt);
    expect(store.notifications.listDiscordChannels()).toHaveLength(1);
  });

  it("matches a binding whatever casing the repo name arrives in", () => {
    const store = new Store(":memory:");
    store.notifications.putDiscordChannel({
      repo: "O/R",
      channelId: "c1",
      guildId: null,
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.notifications.getDiscordChannel("o/r")?.channelId).toBe("c1");
    expect(store.notifications.getDiscordChannel("O/r")?.channelId).toBe("c1");
  });

  it("reports whether a binding was there to delete", () => {
    const store = new Store(":memory:");
    expect(store.notifications.deleteDiscordChannel("o/r")).toBe(false);
    store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: null,
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.notifications.deleteDiscordChannel("o/r")).toBe(true);
    expect(store.notifications.getDiscordChannel("o/r")).toBeNull();
  });

  it("records who bound a repo to a channel", () => {
    const store = new Store(":memory:");
    const stored = store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: "reviews",
      notifyRoleId: null,
      boundBy: "discord:42",
    });
    expect(stored.boundBy).toBe("discord:42");
    expect(store.notifications.getDiscordChannel("o/r")?.boundBy).toBe("discord:42");
  });
});
