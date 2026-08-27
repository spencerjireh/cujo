import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("re-claims a head whose run errored before it had a turn, and only then", () => {
    const store = new Store(":memory:");
    const { run } = store.createRun(head);
    store.updateRun(run.id, { status: "error" });
    const again = store.createRun(head);
    expect(again.created).toBe(true);
    expect(again.run.id).not.toBe(run.id);
    expect(store.getRun(run.id)).toBeNull();

    store.updateRun(again.run.id, { status: "error", turnIds: ["t1"] });
    const kept = store.createRun(head);
    expect(kept.created).toBe(false);
    expect(kept.run.id).toBe(again.run.id);
  });

  it("scopes unfinished runs to a PR and lists runs by session", () => {
    const store = new Store(":memory:");
    const a = store.createRun(head).run;
    const b = store.createRun({ ...head, headSha: "h2" }).run;
    const other = store.createRun({ ...head, prNumber: 8, sessionId: "s2" }).run;
    store.updateRun(b.id, { status: "clean" });
    const ids = (runs: { id: string }[]) => runs.map((r) => r.id).sort();
    expect(ids(store.listUnfinishedRuns({ repo: "o/r", prNumber: 7 }))).toEqual([a.id]);
    expect(ids(store.listUnfinishedRuns())).toEqual([a.id, other.id].sort());
    expect(ids(store.listRunsForSession("s1"))).toEqual([a.id, b.id].sort());
  });

  it("remembers which resume turns Cujo sent", () => {
    const store = new Store(":memory:");
    const { run } = store.createRun(head);
    store.addCujoTurn(run.id, "t2");
    store.addCujoTurn(run.id, "t2");
    expect(store.listCujoTurns(run.id)).toEqual(["t2"]);
    store.deleteRun(run.id);
    expect(store.listCujoTurns(run.id)).toEqual([]);
  });

  it("deletes a run and its projection", () => {
    const store = new Store(":memory:");
    const { run } = store.createRun(head);
    store.deleteRun(run.id);
    expect(store.getRun(run.id)).toBeNull();
    expect(store.createRun(head).created).toBe(true);
  });

  it("binds a repo to a Discord channel and replaces the binding on a re-bind", () => {
    const store = new Store(":memory:");
    const first = store.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: "reviews",
      notifyRoleId: null,
    });
    expect(first).toMatchObject({ repo: "o/r", channelId: "c1", notifyRoleId: null });
    const second = store.putDiscordChannel({
      repo: "o/r",
      channelId: "c2",
      guildId: "g1",
      channelName: "elsewhere",
      notifyRoleId: "role1",
    });
    expect(second).toMatchObject({ channelId: "c2", notifyRoleId: "role1" });
    expect(second.createdAt).toBe(first.createdAt);
    expect(store.listDiscordChannels()).toHaveLength(1);
  });

  it("matches a binding whatever casing the repo name arrives in", () => {
    const store = new Store(":memory:");
    store.putDiscordChannel({
      repo: "O/R",
      channelId: "c1",
      guildId: null,
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.getDiscordChannel("o/r")?.channelId).toBe("c1");
    expect(store.getDiscordChannel("O/r")?.channelId).toBe("c1");
  });

  it("reports whether a binding was there to delete", () => {
    const store = new Store(":memory:");
    expect(store.deleteDiscordChannel("o/r")).toBe(false);
    store.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: null,
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.deleteDiscordChannel("o/r")).toBe(true);
    expect(store.getDiscordChannel("o/r")).toBeNull();
  });

  it("keeps the run's Discord message and PR title, and drops both with the run", () => {
    const store = new Store(":memory:");
    const { run } = store.createRun(head);
    store.putRunPrTitle(run.id, "Add a thing");
    store.putRunDiscordMessage({
      runId: run.id,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: null,
      pingResolved: false,
      lastNotifiedStatus: "running",
    });
    store.putRunDiscordMessage({
      runId: run.id,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: "p1",
      pingResolved: true,
      lastNotifiedStatus: "blocked_posted",
    });
    expect(store.getRunDiscordMessage(run.id)).toEqual({
      runId: run.id,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: "p1",
      pingResolved: true,
      lastNotifiedStatus: "blocked_posted",
    });
    expect(store.getRunPrTitle(run.id)).toBe("Add a thing");
    store.deleteRun(run.id);
    expect(store.getRunDiscordMessage(run.id)).toBeNull();
    expect(store.getRunPrTitle(run.id)).toBeNull();
  });

  it("records who bound a repo to a channel", () => {
    const store = new Store(":memory:");
    const stored = store.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: "reviews",
      notifyRoleId: null,
      boundBy: "discord:42",
    });
    expect(stored.boundBy).toBe("discord:42");
    expect(store.getDiscordChannel("o/r")?.boundBy).toBe("discord:42");
  });

  it("migrates a database that already exists, and does it once", () => {
    // The whole point of the mechanism is a database that is already out
    // there, which :memory: cannot represent.
    const dir = mkdtempSync(join(tmpdir(), "cujo-store-"));
    const path = join(dir, "cujo.db");
    try {
      const first = new Store(path);
      first.putDiscordChannel({
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
      expect(second.getDiscordChannel("o/r")?.boundBy).toBe("op@example.com");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("authorizes a server for a repo, and lists it per server", () => {
    const store = new Store(":memory:");
    expect(store.isGuildAuthorized("g1", "o/r")).toBe(false);
    store.authorizeGuildRepo({
      guildId: "g1",
      repo: "O/R",
      guildName: "My Server",
      authorizedBy: "op@example.com",
    });
    store.authorizeGuildRepo({
      guildId: "g2",
      repo: "o/other",
      guildName: "Other",
      authorizedBy: "op@example.com",
    });
    expect(store.isGuildAuthorized("g1", "o/r")).toBe(true);
    expect(store.isGuildAuthorized("g2", "o/r")).toBe(false);
    expect(store.listGuildRepos("g1").map((a) => a.repo)).toEqual(["o/r"]);
    expect(store.listGuildRepos()).toHaveLength(2);
  });

  it("drops the binding a revoked authorization permitted", () => {
    const store = new Store(":memory:");
    store.authorizeGuildRepo({
      guildId: "g1",
      repo: "o/r",
      guildName: null,
      authorizedBy: "op@example.com",
    });
    store.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.revokeGuildRepo("g1", "o/r")).toBe(true);
    // Leaving it bound would keep the server receiving reviews it may no
    // longer see.
    expect(store.getDiscordChannel("o/r")).toBeNull();
    expect(store.revokeGuildRepo("g1", "o/r")).toBe(false);
  });

  it("leaves another server's binding alone when one is revoked", () => {
    const store = new Store(":memory:");
    store.authorizeGuildRepo({
      guildId: "g1",
      repo: "o/r",
      guildName: null,
      authorizedBy: "op@example.com",
    });
    store.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g2",
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.revokeGuildRepo("g1", "o/r")).toBe(true);
    expect(store.getDiscordChannel("o/r")?.guildId).toBe("g2");
  });
});
