import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyProjection } from "../../src/review/fold";
import { Store } from "../../src/store";
import type { Db } from "../../src/store/db";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };

/**
 * The connection behind a `Store`, for the two tests that have to break the
 * database on purpose. Reached rather than exposed: making `db` public would
 * widen the store's surface for every caller so that two tests could drop a
 * table, and `private` is a compile-time word only.
 */
function sqlite(store: Store): Db {
  return (store as unknown as { db: Db }).db;
}

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
   * An error run with no turns is excluded from the partial unique index
   * (decision 104), so a new createRun for the same head inserts without
   * needing to delete the old row. The old row and its Discord message
   * survive — the evidence page stays reachable.
   */
  it("allows a new run beside a stale error run without deleting it", () => {
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
    store.runs.updateRun(run.id, { status: "error" });

    const again = store.runs.createRun(head);
    expect(again.created).toBe(true);
    expect(again.run.id).not.toBe(run.id);
    // Old row and its Discord message survive.
    expect(store.runs.getRun(run.id)).not.toBeNull();
    expect(store.notifications.getRunDiscordMessage(run.id)).not.toBeNull();
    store.close();
  });

  it("keeps the first session written for a PR", () => {
    const store = new Store(":memory:");
    expect(store.runs.putSession("o/r", 7, "s1")).toBe("s1");
    expect(store.runs.putSession("o/r", 7, "s2")).toBe("s1");
    expect(store.runs.getSession("o/r", 7)).toBe("s1");
  });

  it("holds the conversation session apart from the review's", () => {
    // The whole of decision 47 rests on these never being the same id: a turn
    // on the review's session cancels a live review, is refused while its
    // approval is pending, and corrupts the run's projection.
    const store = new Store(":memory:");
    store.runs.putSession("o/r", 7, "review");
    expect(store.runs.getConversationSession("o/r", 7)).toBeNull();
    expect(store.runs.putConversationSession("o/r", 7, "talk")).toBe("talk");
    expect(store.runs.getSession("o/r", 7)).toBe("review");
    expect(store.runs.getConversationSession("o/r", 7)).toBe("talk");
    // First writer wins here too, so two questions at once agree on one.
    expect(store.runs.putConversationSession("o/r", 7, "other")).toBe("talk");
    // `repo` is whatever casing GitHub sent, and a comment delivery is not
    // guaranteed to match the pull request delivery that made the review.
    expect(store.runs.getConversationSession("O/R", 7)).toBe("talk");
    expect(store.runs.getConversationSession("o/r", 8)).toBeNull();
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

  it("re-claims a head whose run errored, since error is excluded from the partial index", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    store.runs.updateRun(run.id, { status: "error" });
    const again = store.runs.createRun(head);
    expect(again.created).toBe(true);
    expect(again.run.id).not.toBe(run.id);
    // Old run survives — the partial index excludes error rows.
    expect(store.runs.getRun(run.id)).not.toBeNull();

    // An error with turns is also excluded from the index.
    store.runs.updateRun(again.run.id, { status: "error", turnIds: ["t1"] });
    const third = store.runs.createRun(head);
    expect(third.created).toBe(true);
    expect(third.run.id).not.toBe(again.run.id);
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

  it("finds the newest run for a pull request, in any state and any casing", () => {
    // What a comment can ask for: a comment names a pull request and nothing
    // else, and the run it means is the current one whatever state it reached.
    const store = new Store(":memory:");
    const first = store.runs.createRun(head).run;
    const second = store.runs.createRun({ ...head, headSha: "h2" }).run;
    store.runs.updateRun(second.id, { status: "blocked_pending" });
    store.runs.updateRun(first.id, { status: "superseded" });
    expect(store.runs.latestRunForPr("o/r", 7)?.id).toBe(second.id);
    // `runs.repo` holds whatever casing GitHub sent, and a later delivery is
    // not guaranteed to send the same.
    expect(store.runs.latestRunForPr("O/R", 7)?.id).toBe(second.id);
    expect(store.runs.latestRunForPr("o/r", 8)).toBeNull();
    expect(store.runs.latestRunForPr("other/repo", 7)).toBeNull();
  });

  it("finds the run for one commit, whatever order the deliveries arrived in", () => {
    // The hazard this exists for: a delivery for an older head that arrives
    // late is the newest row, so insertion order is not commit order and a
    // command resolved by `latestRunForPr` would answer the wrong run.
    const store = new Store(":memory:");
    const current = store.runs.createRun({ ...head, headSha: "h2" }).run;
    const lateOldHead = store.runs.createRun(head).run;
    expect(store.runs.latestRunForPr("o/r", 7)?.id).toBe(lateOldHead.id);
    expect(store.runs.runForPrHead("o/r", 7, "h2")?.id).toBe(current.id);
    expect(store.runs.runForPrHead("O/R", 7, "h2")?.id).toBe(current.id);
    expect(store.runs.runForPrHead("o/r", 7, "h3")).toBeNull();
    expect(store.runs.runForPrHead("other/repo", 7, "h2")).toBeNull();
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

  /**
   * The projection and its digest are one fact, so they commit together
   * (decision 61).
   *
   * Failing the digest write and finding the projection unchanged is the only
   * way to see that. A new projection left beside the *previous* digest is
   * worse than one left beside no digest at all: `listPublicRuns` backfills
   * only when the joined digest is null, so a stale row is taken as current
   * and the board serves measurements from a superseded fold indefinitely.
   *
   * The failure is injected by dropping the table the second statement writes,
   * which is the shape of any error it could raise.
   */
  it("leaves the projection alone when the digest cannot be written", () => {
    const store = new Store(":memory:");
    const run = store.runs.createRun(head).run;
    store.runs.putProjection(run.id, { ...emptyProjection(), summary: "the first fold" });
    expect(store.runs.getProjection(run.id)?.summary).toBe("the first fold");

    sqlite(store).exec("DROP TABLE run_digests");
    expect(() =>
      store.runs.putProjection(run.id, { ...emptyProjection(), summary: "the second fold" }),
    ).toThrow();
    expect(store.runs.getProjection(run.id)?.summary).toBe("the first fold");
  });

  it("derives a digest beside every projection, and backfills a missing one", () => {
    const store = new Store(":memory:");
    const run = store.runs.createRun(head).run;
    store.runs.putProjection(run.id, {
      ...emptyProjection(),
      checks: [
        {
          threadId: "t1",
          title: "tests",
          isCheck: true,
          status: "done",
          report: null,
          error: null,
          startedAt: "2026-08-28T10:00:00.000Z",
          endedAt: "2026-08-28T10:00:30.000Z",
        },
      ],
    });
    expect(store.runs.listPublicRuns()[0]?.digest?.checks.tests).toEqual({
      status: "done",
      ms: 30_000,
      sandboxMs: null,
    });

    // A run folded before `run_digests` existed. It never refolds, so the list
    // has to derive and store the digest itself or the row stays blank forever.
    sqlite(store).exec("DELETE FROM run_digests");
    expect(store.runs.listPublicRuns()[0]?.digest?.durationMs).toBe(30_000);
    const backfilled = sqlite(store).prepare("SELECT COUNT(*) AS n FROM run_digests").get() as {
      n: number;
    };
    expect(backfilled.n).toBe(1);
  });

  it("persists repo visibility and lists only the public runs", () => {
    const store = new Store(":memory:");
    const open = store.runs.createRun(head).run;
    const shut = store.runs.createRun({ ...head, repo: "o/secret", isPublic: false }).run;
    expect(store.runs.getRun(open.id)?.isPublic).toBe(true);
    expect(store.runs.getRun(shut.id)?.isPublic).toBe(false);
    expect(store.runs.listPublicRuns().map((r) => r.run.id)).toEqual([open.id]);
    expect(
      store.runs
        .listRuns()
        .map((r) => r.id)
        .sort(),
    ).toEqual([open.id, shut.id].sort());
  });

  /**
   * `runs.repo` holds `repository.full_name` verbatim, so the flip has to match
   * the casing GitHub happened to send rather than the casing it stored.
   */
  it("flips visibility for a repo whatever the casing, and reports the row count", () => {
    const store = new Store(":memory:");
    const run = store.runs.createRun({ ...head, repo: "Owner/Repo" }).run;
    expect(store.runs.setRepoVisibility("owner/repo", false)).toBe(1);
    expect(store.runs.getRun(run.id)?.isPublic).toBe(false);
    expect(store.runs.listPublicRuns()).toEqual([]);
    // Idempotent: a redelivery of the same flip changes nothing.
    expect(store.runs.setRepoVisibility("OWNER/REPO", false)).toBe(0);
    expect(store.runs.setRepoVisibility("owner/repo", true)).toBe(1);
    expect(store.runs.getRun(run.id)?.isPublic).toBe(true);
  });

  it("lists each repo that has a run exactly once, for the visibility sweep", () => {
    const store = new Store(":memory:");
    store.runs.createRun(head);
    store.runs.createRun({ ...head, headSha: "h2" });
    store.runs.createRun({ ...head, repo: "o/other" });
    expect(store.runs.listRunRepos().sort()).toEqual(["o/other", "o/r"]);
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

  it("keeps the run's Discord message and PR meta, and drops both with the run", () => {
    const store = new Store(":memory:");
    const { run } = store.runs.createRun(head);
    // Nothing is stored yet, so a fresh run carries no title and no author.
    expect(run.prTitle).toBeNull();
    expect(run.prAuthorLogin).toBeNull();
    expect(run.prAuthorId).toBeNull();
    store.runs.putRunPrMeta(run.id, {
      title: "Add a thing",
      authorLogin: "octocat",
      authorId: 583231,
    });
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
    // Joined onto the run read, so a caller with a RunRecord already has it.
    const stored = store.runs.getRun(run.id);
    expect(stored?.prTitle).toBe("Add a thing");
    expect(stored?.prAuthorLogin).toBe("octocat");
    expect(stored?.prAuthorId).toBe(583231);
    store.runs.deleteRun(run.id);
    expect(store.notifications.getRunDiscordMessage(run.id)).toBeNull();
    expect(store.runs.getRun(run.id)).toBeNull();
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
});

describe("superseding a run to re-review its head (decision 104)", () => {
  const claim = {
    repo: "o/r",
    prNumber: 1,
    headSha: "h",
    sessionId: "s",
    isPublic: true,
    deliveryId: null,
    model: null,
    rubricSha256: null,
  };

  it("superseding a finished run frees its head for a new insert", () => {
    const store = new Store(":memory:");
    const { run: first } = store.runs.createRun(claim);
    store.runs.updateRun(first.id, { status: "clean", turnIds: ["t1"] });

    // A clean run is excluded from the partial index, so a new run inserts.
    const { run: second, created } = store.runs.createRun(claim);
    expect(created).toBe(true);
    expect(second.id).not.toBe(first.id);
    // The old run survives — its evidence page stays reachable.
    expect(store.runs.getRun(first.id)).not.toBeNull();
  });

  it("marks an existing run superseded instead of deleting it", () => {
    const store = new Store(":memory:");
    const { run: first } = store.runs.createRun(claim);
    store.runs.updateRun(first.id, { status: "clean", turnIds: ["t1"] });
    store.runs.updateRun(first.id, { status: "superseded" });

    const { run: second, created } = store.runs.createRun(claim);
    expect(created).toBe(true);
    expect(second.id).not.toBe(first.id);
    // The superseded run and its data survive.
    const old = store.runs.getRun(first.id);
    expect(old).not.toBeNull();
    expect(old?.status).toBe("superseded");
  });

  it("lets the partial unique index arbitrate two commands racing for one head", () => {
    const store = new Store(":memory:");
    const { run: first } = store.runs.createRun(claim);
    store.runs.updateRun(first.id, { status: "clean", turnIds: ["t1"] });

    // Both commands supersede the same run.
    store.runs.updateRun(first.id, { status: "superseded" });
    // First insert wins.
    const a = store.runs.createRun(claim);
    expect(a.created).toBe(true);
    // Second insert bounces — there is already a running row.
    const b = store.runs.createRun(claim);
    expect(b.created).toBe(false);
    expect(b.run.id).toBe(a.run.id);
  });

  it("deleting a run that is gone is a no-op, not a throw", () => {
    const store = new Store(":memory:");
    expect(() => store.runs.deleteRun("nope")).not.toThrow();
  });

  it("runForPrHead returns the latest run for a head with multiple rows", () => {
    const store = new Store(":memory:");
    const { run: first } = store.runs.createRun(claim);
    store.runs.updateRun(first.id, { status: "superseded" });
    const { run: second } = store.runs.createRun(claim);
    expect(store.runs.runForPrHead("o/r", 1, "h")?.id).toBe(second.id);
    // The old run is still reachable by id.
    expect(store.runs.getRun(first.id)?.status).toBe("superseded");
  });
});
