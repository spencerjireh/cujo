import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";

const head = { repo: "o/r", prNumber: 7, headSha: "h1", sessionId: "s1", isPublic: true };

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

describe("deleting a run to claim its head again", () => {
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

  it("frees a finished head so it can be claimed again", () => {
    // `runs_head` is UNIQUE on (repo, pr_number, head_sha) and createRun's own
    // stale reclaim only takes error rows with no turn, so a finished run
    // cannot be displaced by accident. `/cujo review` displaces it on purpose,
    // by id.
    const store = new Store(":memory:");
    const { run: first } = store.runs.createRun(claim);
    store.runs.updateRun(first.id, { status: "clean", turnIds: ["t1"] });
    expect(store.runs.createRun(claim).created).toBe(false);

    store.runs.deleteRun(first.id);
    const { run: second, created } = store.runs.createRun(claim);
    expect(created).toBe(true);
    expect(second.id).not.toBe(first.id);
    // The old run goes completely, which is what makes its board page stop
    // resolving rather than showing a verdict nothing produced.
    expect(store.runs.getRun(first.id)).toBeNull();
    expect(store.runs.getProjection(first.id)).toBeNull();
  });

  it("lets the unique index arbitrate two commands racing for one head", () => {
    // The shape `/cujo review` relies on. Both callers snapshot the same run
    // and both delete it by id; the second insert loses and its caller refuses
    // rather than starting a second turn on the same commit.
    const store = new Store(":memory:");
    const { run: first } = store.runs.createRun(claim);
    store.runs.updateRun(first.id, { status: "clean", turnIds: ["t1"] });

    store.runs.deleteRun(first.id);
    store.runs.deleteRun(first.id); // idempotent: the slower command's delete
    const a = store.runs.createRun(claim);
    const b = store.runs.createRun(claim);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.run.id).toBe(b.run.id);
  });

  it("deleting a run that is gone is a no-op, not a throw", () => {
    const store = new Store(":memory:");
    expect(() => store.runs.deleteRun("nope")).not.toThrow();
  });
});
