/**
 * The human gate, from a pull request comment (decisions 44 and 45).
 *
 * Every case here is one of the flows `docs/architecture.md` "User flows" D and F
 * describe: a maintainer confirms, the author cannot dismiss, a stale head is
 * refused, a second confirm loses the CAS. The assertion that repeats is that **the pull
 * request is told** — a refusal nobody can see is the failure mode the operator
 * UI never had, because it at least answered 409.
 */

import { createLogger } from "@cujo/log";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_LOGIN } from "../../src/clients/github";
import { PrCommandService } from "../../src/review/pr-command.service";
import type { ApproveResult } from "../../src/review/runner.service";
import type { RunRecord } from "../../src/review/types";

const HEAD = "abcdef1234567890";

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: "run-1",
  repo: "o/r",
  prNumber: 7,
  headSha: HEAD,
  sessionId: "s1",
  turnIds: ["t1"],
  status: "blocked_pending",
  approver: null,
  decidedAt: null,
  isPublic: true,
  deliveryId: "d1",
  prTitle: null,
  prAuthorLogin: null,
  prAuthorId: null,
  model: null,
  rubricSha256: null,
  createdAt: "2026-08-29T00:00:00Z",
  updatedAt: "2026-08-29T00:00:00Z",
  ...over,
});

function harness(
  over: {
    latest?: RunRecord | null;
    head?: { headSha: string; author: string } | null;
    permission?: "admin" | "write" | "read" | "none" | "unknown";
    approve?: ApproveResult;
    startReview?: { ok: true } | { ok: false; detail: string };
    /** Compose the service without the callback, as a deploy with the verb off. */
    noStartReview?: boolean;
  } = {},
) {
  const comments: string[] = [];
  const reacted: string[] = [];
  const lines: Record<string, unknown>[] = [];
  const approve = vi.fn(async () => over.approve ?? ({ ok: true } as ApproveResult));
  const startReview = vi.fn(async () => over.startReview ?? ({ ok: true } as const));
  // The store is keyed by commit, not by insertion order, so the fake is too:
  // `runForPrHead` answers only for the commit its run actually reviewed.
  const latest = "latest" in over ? over.latest : run();
  const service = new PrCommandService({
    runs: {
      latestRunForPr: vi.fn(() => latest),
      runForPrHead: vi.fn((_repo: string, _pr: number, headSha: string) =>
        latest && latest.headSha === headSha ? latest : null,
      ),
    } as never,
    runner: { approve } as never,
    ...(over.noStartReview ? {} : { startReview }),
    github: {
      pullRequestHead: vi.fn(async () =>
        "head" in over ? (over.head ?? null) : { headSha: HEAD, author: "contributor" },
      ),
      permissionFor: vi.fn(async () => over.permission ?? "write"),
      createComment: vi.fn(async (_repo: string, _pr: number, body: string) => {
        comments.push(body);
        return 1;
      }),
    },
    reactions: {
      addToComment: vi.fn(async (_repo: string, _id: number, content: string) => {
        reacted.push(content);
      }),
    },
  });
  const log = createLogger({ service: "cujo", sink: (l) => lines.push(JSON.parse(l)) });
  const send = (body: string, actor = "maintainer") =>
    service.handle({ repo: "o/r", prNumber: 7, commentId: 55, actor, body, log });
  return { send, comments, reacted, approve, startReview, lines };
}

describe("PrCommandService", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("confirms for a maintainer, records the GitHub login, and says so", async () => {
    await h.send("/cujo confirm");
    expect(h.approve).toHaveBeenCalledWith("run-1", "allow", "github:maintainer");
    expect(h.comments[0]).toContain("Confirmed");
    expect(h.reacted).toEqual(["+1"]);
  });

  it("dismisses as a deny, and says the observation stands", async () => {
    await h.send("/cujo dismiss");
    expect(h.approve).toHaveBeenCalledWith("run-1", "deny", "github:maintainer");
    // The half that already posted is the half that survives a dismissal, and
    // the person answering has to be told that rather than left to guess.
    expect(h.comments[0]).toContain("observation stands");
  });

  it("says nothing at all when the comment is not a command", async () => {
    await h.send("looks good to me");
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.comments).toEqual([]);
    expect(h.reacted).toEqual([]);
  });

  it("ignores its own comments, so a reply cannot re-trigger itself", async () => {
    // The success reply prints the verbs, and a review body can quote them.
    await h.send("/cujo confirm", BOT_LOGIN);
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.comments).toEqual([]);
  });

  it("refuses the pull request's author a dismissal, out loud", async () => {
    const own = harness({ head: { headSha: HEAD, author: "author" } });
    await own.send("/cujo dismiss", "author");
    expect(own.approve).not.toHaveBeenCalled();
    expect(own.comments[0]).toContain("cannot dismiss");
    expect(own.reacted).toEqual(["confused"]);
  });

  it("lets the author confirm, because that acts against their own interest", async () => {
    const own = harness({ head: { headSha: HEAD, author: "author" } });
    await own.send("/cujo confirm", "author");
    expect(own.approve).toHaveBeenCalledWith("run-1", "allow", "github:author");
  });

  it("refuses a fork contributor and points at what they can still read", async () => {
    const outsider = harness({ permission: "none" });
    await outsider.send("/cujo confirm", "stranger");
    expect(outsider.approve).not.toHaveBeenCalled();
    expect(outsider.comments[0]).toContain("write access");
    expect(outsider.comments[0]).toContain("anyone can read it");
  });

  it("says it could not check when GitHub does not answer, rather than refusing", async () => {
    const blind = harness({ permission: "unknown" });
    await blind.send("/cujo confirm");
    expect(blind.approve).not.toHaveBeenCalled();
    expect(blind.comments[0]).toContain("could not check");
    expect(blind.comments[0]).toContain("Try again");
  });

  it("refuses a confirm aimed at a commit the pull request has moved past", async () => {
    // Read the block, push a fix, come back and confirm: without this, the
    // confirm answers the new head's block, which nobody has read.
    const moved = harness({ head: { headSha: "9999999aaaaaaa", author: "contributor" } });
    await moved.send("/cujo confirm");
    expect(moved.approve).not.toHaveBeenCalled();
    expect(moved.comments[0]).toContain("moved on");
    expect(moved.comments[0]).toContain("abcdef1");
    expect(moved.comments[0]).toContain("9999999");
  });

  it("answers the run for the current commit, not the row inserted last", async () => {
    // A delivery for an older head that arrived late is the newest row here
    // while being the oldest commit on GitHub. Selecting by insertion order
    // would refuse a command aimed at the run the person is reading.
    const runs = {
      latestRunForPr: vi.fn(() => run({ id: "late-old-head", headSha: "0000000bbbbbbb" })),
      runForPrHead: vi.fn((_repo: string, _pr: number, headSha: string) =>
        headSha === HEAD ? run({ id: "current" }) : null,
      ),
    };
    const approve = vi.fn(async () => ({ ok: true }) as ApproveResult);
    const service = new PrCommandService({
      runs: runs as never,
      runner: { approve } as never,
      github: {
        pullRequestHead: async () => ({ headSha: HEAD, author: "contributor" }),
        permissionFor: async () => "write" as const,
        createComment: async () => 1,
      },
      reactions: null,
    });
    await service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId: 55,
      actor: "maintainer",
      body: "/cujo confirm",
      log: createLogger({ service: "cujo", sink: () => {} }),
    });
    expect(approve).toHaveBeenCalledWith("current", "allow", "github:maintainer");
    expect(runs.runForPrHead).toHaveBeenCalledWith("o/r", 7, HEAD);
  });

  it("says so when a second confirm loses the claim", async () => {
    const raced = harness({
      approve: { ok: false, reason: "already_decided", detail: "already decided" },
    });
    await raced.send("/cujo confirm");
    expect(raced.comments[0]).toContain("already");
  });

  it("gives every approve refusal its own sentence", async () => {
    const reasons = ["no_such_run", "not_blocked_pending", "already_decided", "resume_failed"];
    const said = new Set<string>();
    for (const reason of reasons) {
      const one = harness({
        approve: { ok: false, reason, detail: "x" } as ApproveResult,
      });
      await one.send("/cujo confirm");
      said.add(one.comments[0] ?? "");
    }
    // Distinct, because "it did not work" tells the person nothing about
    // whether to retry, push a commit, or go and read the run.
    expect(said.size).toBe(reasons.length);
  });

  it("refuses a comment that says both verbs", async () => {
    await h.send("/cujo confirm\n/cujo dismiss");
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.comments[0]).toContain("Say one");
  });

  it("says there is nothing to answer when the pull request was never reviewed", async () => {
    const fresh = harness({ latest: null });
    await fresh.send("/cujo confirm");
    expect(fresh.approve).not.toHaveBeenCalled();
    expect(fresh.comments[0]).toContain("not reviewed this pull request");
  });

  it("answers even when the pull request cannot be read", async () => {
    const blind = harness({ head: null });
    await blind.send("/cujo confirm");
    expect(blind.approve).not.toHaveBeenCalled();
    expect(blind.comments[0]).toContain("could not read");
  });

  it("still replies when the acknowledgement fails, because the reply is the answer", async () => {
    const service = new PrCommandService({
      runs: { latestRunForPr: () => run(), runForPrHead: () => run() } as never,
      runner: { approve: async () => ({ ok: true }) } as never,
      github: {
        pullRequestHead: async () => ({ headSha: HEAD, author: "contributor" }),
        permissionFor: async () => "write" as const,
        createComment: vi.fn(async () => 1),
      },
      reactions: {
        addToComment: async () => {
          throw new Error("403");
        },
      },
    });
    const lines: Record<string, unknown>[] = [];
    await service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId: 55,
      actor: "maintainer",
      body: "/cujo confirm",
      log: createLogger({ service: "cujo", sink: (l) => lines.push(JSON.parse(l)) }),
    });
    expect(lines.some((l) => l.event === "comment.reaction.failed")).toBe(true);
    expect(lines.some((l) => l.event === "comment.command.applied")).toBe(true);
  });

  it("logs who decided what, which is the audit trail the gate exists for", async () => {
    await h.send("/cujo confirm");
    expect(h.lines.find((l) => l.event === "comment.command.applied")).toMatchObject({
      repo: "o/r",
      pr_number: 7,
      comment_id: "55",
      actor: "maintainer",
      decision: "confirm",
    });
  });

  it("apologises rather than throwing when something breaks underneath", async () => {
    // The delivery is already answered, so a throw here would be a silent
    // failure with a person waiting on a comment that never comes.
    const said: string[] = [];
    const broken = new PrCommandService({
      runs: {
        latestRunForPr: () => {
          throw new Error("database is gone");
        },
      } as never,
      runner: { approve: vi.fn() } as never,
      github: {
        pullRequestHead: async () => ({ headSha: HEAD, author: "a" }),
        permissionFor: async () => "write" as const,
        createComment: async (_repo: string, _pr: number, body: string) => {
          said.push(body);
          return 1;
        },
      },
      reactions: null,
    });
    await expect(
      broken.handle({
        repo: "o/r",
        prNumber: 7,
        commentId: 55,
        actor: "maintainer",
        body: "/cujo confirm",
        log: createLogger({ service: "cujo", sink: () => {} }),
      }),
    ).resolves.toBeUndefined();
    expect(said[0]).toContain("Something broke");
  });
});

describe("/cujo review", () => {
  it("starts a review of the current head for a maintainer", async () => {
    const h = harness();
    await h.send("/cujo review");
    expect(h.startReview).toHaveBeenCalledWith({
      repo: "o/r",
      prNumber: 7,
      headSha: HEAD,
      actor: "maintainer",
    });
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.comments[0]).toContain("Reviewing this pull request again");
    expect(h.reacted).toEqual(["+1"]);
  });

  it("says the earlier run for that commit is replaced", async () => {
    // Reclaiming the head deletes the old run's projection, its board page and
    // its Discord card. Somebody typing this should be told that, not find out.
    const h = harness();
    await h.send("/cujo review");
    expect(h.comments[0]).toContain("replaced");
  });

  it("works on a pull request Cujo has never seen", async () => {
    // The main case for the verb: opened before the App was installed, or one
    // whose run the already-reviewed guard deleted. `confirm` and `dismiss`
    // still refuse it, because they answer a run and there is none.
    const h = harness({ latest: null });
    await h.send("/cujo review");
    expect(h.startReview).toHaveBeenCalled();
    const other = harness({ latest: null });
    await other.send("/cujo confirm");
    expect(other.comments[0]).toContain("nothing to answer");
  });

  it("targets the current head rather than refusing it as stale", async () => {
    // `stale_head` stops somebody answering an old commit's finding. This verb
    // asks about whatever is there now, so being out of date is the reason to
    // run it, not a reason to refuse.
    const h = harness({ head: { headSha: "0000000000000000", author: "contributor" } });
    await h.send("/cujo review");
    expect(h.startReview).toHaveBeenCalledWith(
      expect.objectContaining({ headSha: "0000000000000000" }),
    );
    expect(h.comments[0]).not.toContain("moved on since");
  });

  it("needs repo write, and the author may ask for one", async () => {
    const reader = harness({ permission: "read" });
    await reader.send("/cujo review");
    expect(reader.startReview).not.toHaveBeenCalled();
    expect(reader.reacted).toEqual(["confused"]);

    const author = harness();
    await author.send("/cujo review", "contributor");
    expect(author.startReview).toHaveBeenCalled();
  });

  it("says so when the pull request cannot be read, and starts nothing", async () => {
    const h = harness({ head: null });
    await h.send("/cujo review");
    expect(h.startReview).not.toHaveBeenCalled();
    expect(h.comments[0]).toContain("could not read this pull request");
  });

  it("passes the failure through when the claim does not take", async () => {
    const h = harness({ startReview: { ok: false, detail: "A run for this commit is starting." } });
    await h.send("/cujo review");
    expect(h.comments[0]).toContain("A run for this commit is starting.");
    expect(h.reacted).toEqual(["confused"]);
  });

  it("refuses politely where the verb is not composed at all", async () => {
    const h = harness({ noStartReview: true });
    await h.send("/cujo review");
    expect(h.comments[0]).toContain("cannot start a review from a comment");
  });

  it("passes an unconfirmed stop through as a refusal, and starts nothing", async () => {
    // The composed callback refuses when it cannot confirm the current run's
    // turn has stopped, because the next thing it would do is delete that
    // run's row — and a live turn with no row can still post a review.
    const h = harness({
      startReview: {
        ok: false,
        detail:
          "I could not confirm the current run for this commit has stopped, so I have left it alone. Try again shortly.",
      },
    });
    await h.send("/cujo review");
    expect(h.comments[0]).toContain("could not confirm");
    expect(h.comments[0]).toContain("left it alone");
    expect(h.reacted).toEqual(["confused"]);
  });

  it("still refuses a comment giving two different verbs", async () => {
    const h = harness();
    await h.send("/cujo review\n/cujo confirm");
    expect(h.startReview).not.toHaveBeenCalled();
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.comments[0]).toContain("more than one command");
  });
});
