import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1" };

describe("store", () => {
  it("claims one run per PR head", () => {
    const store = new Store(":memory:");
    const first = store.runs.createRun(head);
    const second = store.runs.createRun(head);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    expect(store.runs.createRun({ ...head, headSha: "h2" }).created).toBe(true);
  });

  /**
   * The one place the two stores genuinely meet. Reclaiming a stale run has to
   * delete its Discord message row, and not because the row is untidy: the
   * unique index on (repo, pr_number, head_sha) refuses the replacement while
   * the old run row is still there, so the whole cascade has to run first.
   *
   * Nothing else can catch this. The notifier refuses to post a card for a run
   * that is `error` with no turns, which is exactly the stale predicate, so the
   * state is unreachable end to end and only a store-level test reaches it.
   */
  it("drops the Discord message row when a stale run is reclaimed", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.notifications.putRunDiscordMessage({
      runId: run.id,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: null,
      pingResolved: false,
      lastNotifiedStatus: "error",
    });
    // A run that errored before it ever had a turn.
    store.runs.updateRun(run.id, { status: "error" });

    const again = store.runs.createRun(head);
    expect(again.created).toBe(true);
    expect(again.run.id).not.toBe(run.id);
    expect(store.notifications.getRunDiscordMessage(run.id)).toBeNull();
    store.close();
  });

  it("keeps the first session written for a PR", () => {
    const store = new Store(":memory:");
    expect(store.runs.putSession("o/r", 7, "s1")).toBe("s1");
    expect(store.runs.putSession("o/r", 7, "s2")).toBe("s1");
    expect(store.runs.getSession("o/r", 7)).toBe("s1");
  });

  it("lets exactly one caller claim the decision, and can release it", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    expect(store.runs.claimDecision(run.id, "a@x", "t")).toBe(false); // still running
    store.runs.updateRun(run.id, { status: "blocked_pending" });
    expect(store.runs.claimDecision(run.id, "a@x", "t")).toBe(true);
    expect(store.runs.claimDecision(run.id, "b@x", "t")).toBe(false);
    expect(store.runs.getRun(run.id)?.approver).toBe("a@x");
    store.runs.clearDecision(run.id);
    expect(store.runs.getRun(run.id)?.approver).toBeNull();
    expect(store.runs.claimDecision(run.id, "b@x", "t")).toBe(true);
  });

  it("re-claims a head whose run errored before it had a turn, and only then", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.runs.updateRun(run.id, { status: "error" });
    const again = store.runs.createRun(head);
    expect(again.created).toBe(true);
    expect(again.run.id).not.toBe(run.id);
    expect(store.runs.getRun(run.id)).toBeNull();

    store.runs.updateRun(again.run.id, { status: "error", turnIds: ["t1"] });
    const kept = store.runs.createRun(head);
    expect(kept.created).toBe(false);
    expect(kept.run.id).toBe(again.run.id);
  });

  it("scopes unfinished runs to a PR and lists runs by session", () => {
    const store = new Store(":memory:");
    const a = store.runs.createRun(head).run;
    const b = store.runs.createRun({ ...head, headSha: "h2" }).run;
    const other = store.runs.createRun({ ...head, prNumber: 8, sessionId: "s2" }).run;
    store.runs.updateRun(b.id, { status: "clean" });
    const ids = (runs: { id: string }[]) => runs.map((r) => r.id).sort();
    expect(ids(store.runs.listUnfinishedRuns({ repo: "o/r", prNumber: 7 }))).toEqual([a.id]);
    expect(ids(store.runs.listUnfinishedRuns())).toEqual([a.id, other.id].sort());
    expect(ids(store.runs.listRunsForSession("s1"))).toEqual([a.id, b.id].sort());
  });

  it("remembers which resume turns Cujo sent", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.runs.addCujoTurn(run.id, "t2");
    store.runs.addCujoTurn(run.id, "t2");
    expect(store.runs.listCujoTurns(run.id)).toEqual(["t2"]);
    store.runs.deleteRun(run.id);
    expect(store.runs.listCujoTurns(run.id)).toEqual([]);
  });

  it("deletes a run and its projection", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.runs.deleteRun(run.id);
    expect(store.runs.getRun(run.id)).toBeNull();
    expect(store.runs.createRun(head).created).toBe(true);
  });

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

  it("keeps the run's Discord message and PR title, and drops both with the run", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.runs.putRunPrTitle(run.id, "Add a thing");
    store.notifications.putRunDiscordMessage({
      runId: run.id,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: null,
      pingResolved: false,
      lastNotifiedStatus: "running",
    });
    store.notifications.putRunDiscordMessage({
      runId: run.id,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: "p1",
      pingResolved: true,
      lastNotifiedStatus: "blocked_posted",
    });
    expect(store.notifications.getRunDiscordMessage(run.id)).toEqual({
      runId: run.id,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: "p1",
      pingResolved: true,
      lastNotifiedStatus: "blocked_posted",
    });
    expect(store.runs.getRunPrTitle(run.id)).toBe("Add a thing");
    store.runs.deleteRun(run.id);
    expect(store.notifications.getRunDiscordMessage(run.id)).toBeNull();
    expect(store.runs.getRunPrTitle(run.id)).toBeNull();
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

  it("authorizes a server for a repo, and lists it per server", () => {
    const store = new Store(":memory:");
    expect(store.notifications.isGuildAuthorized("g1", "o/r")).toBe(false);
    store.notifications.authorizeGuildRepo({
      guildId: "g1",
      repo: "O/R",
      guildName: "My Server",
      authorizedBy: "op@example.com",
    });
    store.notifications.authorizeGuildRepo({
      guildId: "g2",
      repo: "o/other",
      guildName: "Other",
      authorizedBy: "op@example.com",
    });
    expect(store.notifications.isGuildAuthorized("g1", "o/r")).toBe(true);
    expect(store.notifications.isGuildAuthorized("g2", "o/r")).toBe(false);
    expect(store.notifications.listGuildRepos("g1").map((a) => a.repo)).toEqual(["o/r"]);
    expect(store.notifications.listGuildRepos()).toHaveLength(2);
  });

  it("drops the binding a revoked authorization permitted", () => {
    const store = new Store(":memory:");
    store.notifications.authorizeGuildRepo({
      guildId: "g1",
      repo: "o/r",
      guildName: null,
      authorizedBy: "op@example.com",
    });
    store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.notifications.revokeGuildRepo("g1", "o/r")).toBe(true);
    // Leaving it bound would keep the server receiving reviews it may no
    // longer see.
    expect(store.notifications.getDiscordChannel("o/r")).toBeNull();
    expect(store.notifications.revokeGuildRepo("g1", "o/r")).toBe(false);
  });

  it("leaves another server's binding alone when one is revoked", () => {
    const store = new Store(":memory:");
    store.notifications.authorizeGuildRepo({
      guildId: "g1",
      repo: "o/r",
      guildName: null,
      authorizedBy: "op@example.com",
    });
    store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g2",
      channelName: null,
      notifyRoleId: null,
    });
    expect(store.notifications.revokeGuildRepo("g1", "o/r")).toBe(true);
    expect(store.notifications.getDiscordChannel("o/r")?.guildId).toBe("g2");
  });
});
