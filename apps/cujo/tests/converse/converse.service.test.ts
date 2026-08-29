/**
 * `@cujo-guard` on a pull request (Design 3).
 *
 * The assertions that repeat are the two properties the design rests on: the
 * conversation never touches the review's session, and the person always gets
 * a reply — including when the turn fails, which is the case a reply tool
 * inside the agent could not have covered.
 */

import { createLogger } from "@cujo/log";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it, vi } from "vitest";
import type { SessionEvent, StreamEvent } from "../../src/clients/trueforge";
import { ConverseService } from "../../src/converse/converse.service";
import { ConverseRateLimit } from "../../src/converse/rate-limit";
import type { Projection } from "../../src/review/types";
import { Store } from "../../src/store";

const at = "2026-08-29T10:00:00Z";

const said = (text: string, id = "m1"): SessionEvent =>
  ({
    type: "model.message",
    id,
    createdAt: at,
    threadId: "main",
    content: text,
  }) as SessionEvent;

const turnDone = (status = "done"): StreamEvent =>
  ({
    type: "turn.done",
    id: "td",
    createdAt: at,
    threadId: null,
    state: { status, completedAt: at, output: null, requiredActions: [] },
  }) as StreamEvent;

async function* streamOf(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) yield event;
}

function harness(
  over: {
    permission?: "admin" | "write" | "read" | "none" | "unknown";
    events?: { turnId: string; event: SessionEvent }[];
    startTurn?: () => Promise<string>;
    subscribe?: () => Promise<AsyncIterable<StreamEvent>>;
    limit?: number;
    seedRun?: boolean;
    projection?: Partial<Projection>;
    /** What GitHub reports as the current head; null means unreadable. */
    head?: string | null;
    isPublic?: boolean;
  } = {},
) {
  const store = new Store(":memory:");
  if (over.seedRun !== false) {
    const { run } = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h1",
      sessionId: "review-session",
      isPublic: over.isPublic ?? true,
      deliveryId: "d1",
    });
    store.runs.putProjection(run.id, {
      status: "clean",
      turnIds: ["t1"],
      checks: [],
      review: null,
      gatedReview: null,
      hardRuleHits: [],
      findings: [],
      approval: null,
      decision: null,
      externalResume: false,
      gatedResponseSeen: false,
      error: null,
      summary: null,
      ...over.projection,
    } as Projection);
  }
  const replies: string[] = [];
  const threadReplies: { commentId: number; body: string }[] = [];
  const lines: Record<string, unknown>[] = [];
  const created: TrueForgeApi.AgentSpec[] = [];
  const started: { sessionId: string; message: string }[] = [];
  const cancelled: string[] = [];
  const service = new ConverseService({
    runs: store.runs,
    harness: {
      createSession: async (spec: TrueForgeApi.AgentSpec) => {
        created.push(spec);
        return "converse-session";
      },
      startTurn:
        over.startTurn ??
        (async (sessionId: string, message: string) => {
          started.push({ sessionId, message });
          return "turn-1";
        }),
      subscribe: over.subscribe ?? (async () => streamOf([turnDone()])),
      listEvents: async () => over.events ?? [{ turnId: "turn-1", event: said("340 ms on head.") }],
      cancelTurn: async (sessionId: string) => {
        cancelled.push(sessionId);
      },
    } as never,
    github: {
      permissionFor: async () => over.permission ?? "write",
      pullRequestHead: async () => (over.head === null ? null : { headSha: over.head ?? "h1" }),
      createComment: async (_repo: string, _pr: number, body: string) => {
        replies.push(body);
        return 1;
      },
      replyToReviewComment: async (_repo: string, _pr: number, commentId: number, body: string) => {
        threadReplies.push({ commentId, body });
        return 2;
      },
    },
    spec: { model: { name: "m" }, mcpServers: [] } as TrueForgeApi.AgentSpec,
    limit: new ConverseRateLimit({ limit: over.limit ?? 3, windowMs: 60_000 }),
    turnTimeoutMs: 50,
  });
  // Each call is a distinct comment, as two questions on a pull request are.
  // Passing an id explicitly is how a redelivery of one comment is written.
  let nextComment = 55;
  const ask = (body: string, actor = "maintainer", commentId = nextComment++) =>
    service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId,
      actor,
      body,
      surface: { kind: "issue" },
      log: createLogger({ service: "cujo", sink: (l) => lines.push(JSON.parse(l)) }),
    });
  const askInThread = (body: string) =>
    service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId: 88,
      actor: "maintainer",
      body,
      surface: { kind: "review_thread", commentId: 88 },
      log: createLogger({ service: "cujo", sink: (l) => lines.push(JSON.parse(l)) }),
    });
  return {
    service,
    store,
    ask,
    askInThread,
    replies,
    threadReplies,
    lines,
    created,
    started,
    cancelled,
  };
}

describe("ConverseService", () => {
  it("answers a mention with what the agent said last", async () => {
    const h = harness();
    await h.ask("@cujo-guard seed the database first, that route needs orders");
    expect(h.replies).toEqual(["340 ms on head."]);
  });

  it("never touches the review's session", async () => {
    // The whole design. A turn on `review-session` cancels a live review, is
    // refused 422 while an approval is pending, and corrupts the projection.
    const h = harness();
    await h.ask("@cujo-guard why?");
    expect(h.started.map((s) => s.sessionId)).toEqual(["converse-session"]);
    expect(h.store.runs.getSession("o/r", 7)).not.toBe("converse-session");
    expect(h.cancelled).not.toContain("review-session");
  });

  it("reuses the pull request's conversation session on the next question", async () => {
    const h = harness();
    await h.ask("@cujo-guard one");
    await h.ask("@cujo-guard two");
    expect(h.created).toHaveLength(1);
    expect(h.store.runs.getConversationSession("o/r", 7)).toBe("converse-session");
  });

  it("hands the agent the run's evidence and the question, and nothing else", async () => {
    const h = harness({
      projection: {
        status: "blocked_unattended",
        checks: [
          {
            threadId: "th1",
            title: "smoke",
            isCheck: true,
            status: "done",
            report: { endpoint: "/api/orders", head: 500 },
            error: null,
            startedAt: at,
            endedAt: at,
          },
        ],
        findings: [
          {
            source: "agent",
            check: "smoke",
            severity: "critical",
            title: "orders returns 500",
            evidence: "head 500, base 200",
          },
        ],
      },
    });
    await h.ask("@cujo-guard seed the db first");
    const payload = JSON.parse(
      /```json\n([\s\S]*?)\n```/.exec(h.started[0]?.message ?? "")?.[1] ?? "{}",
    );
    expect(payload).toMatchObject({
      repo: "o/r",
      pr_number: 7,
      head_sha: "h1",
      run_status: "blocked_unattended",
      question: "@cujo-guard seed the db first",
    });
    expect(payload.checks[0]).toMatchObject({ name: "smoke", report: { head: 500 } });
    expect(payload.findings[0]).toMatchObject({ title: "orders returns 500" });
    // The clone URL is public and carries no credential, like the review's.
    expect(payload.clone_url).toBe("https://github.com/o/r.git");
    expect(JSON.stringify(payload)).not.toContain("review-session");
  });

  it("says nothing at all when the comment does not mention it", async () => {
    const h = harness();
    await h.ask("looks good to me");
    expect(h.replies).toEqual([]);
    expect(h.started).toEqual([]);
  });

  it("ignores its own replies, so an answer cannot re-trigger itself", async () => {
    const h = harness();
    await h.ask("@cujo-guard as you asked, here it is", "cujo-guard[bot]");
    expect(h.replies).toEqual([]);
    expect(h.started).toEqual([]);
  });

  it("refuses a fork contributor and says what they can still read", async () => {
    const h = harness({ permission: "none" });
    await h.ask("@cujo-guard run it again");
    expect(h.started).toEqual([]);
    expect(h.replies[0]).toContain("write access");
    expect(h.replies[0]).toContain("readable by anyone");
  });

  it("says it could not check when GitHub does not answer, rather than running", async () => {
    const h = harness({ permission: "unknown" });
    await h.ask("@cujo-guard run it again");
    expect(h.started).toEqual([]);
    expect(h.replies[0]).toContain("could not check");
  });

  it("refuses when there is no review to talk about", async () => {
    const h = harness({ seedRun: false });
    await h.ask("@cujo-guard what happened?");
    expect(h.started).toEqual([]);
    expect(h.replies[0]).toContain("not reviewed this pull request");
  });

  it("refuses past the ceiling and says roughly when to come back", async () => {
    const h = harness({ limit: 1 });
    await h.ask("@cujo-guard one");
    await h.ask("@cujo-guard two");
    expect(h.started).toHaveLength(1);
    expect(h.replies[1]).toContain("sandbox");
    expect(h.replies[1]).toMatch(/\d+ minute/);
  });

  it("replies even when the turn cannot start", async () => {
    // A reply tool inside the agent could not do this: the agent never ran.
    const h = harness({
      startTurn: async () => {
        throw new Error("harness unreachable");
      },
    });
    await h.ask("@cujo-guard why?");
    expect(h.replies[0]).toContain("could not start a sandbox");
  });

  it("replies when the agent finished but said nothing usable", async () => {
    const h = harness({ events: [] });
    await h.ask("@cujo-guard why?");
    expect(h.replies[0]).toContain("did not get to an answer");
  });

  it("takes the last plain message, not one that carries a tool call", async () => {
    const h = harness({
      events: [
        { turnId: "turn-1", event: said("thinking about it", "m1") },
        {
          turnId: "turn-1",
          event: {
            ...said("ran the command", "m2"),
            toolCalls: [{ id: "c1" }],
          } as SessionEvent,
        },
        { turnId: "turn-1", event: said("the final answer", "m3") },
        // Another turn's message must not be mistaken for this one's.
        { turnId: "turn-9", event: said("a different question's answer", "m4") },
      ],
    });
    await h.ask("@cujo-guard why?");
    expect(h.replies).toEqual(["the final answer"]);
  });

  it("answers in the review thread when that is where it was asked", async () => {
    // Flow C: the question is asked under the finding it doubts, so the answer
    // belongs there rather than at the bottom of the page.
    const h = harness();
    await h.askInThread("@cujo-guard seed the db first");
    expect(h.threadReplies).toEqual([{ commentId: 88, body: "340 ms on head." }]);
    expect(h.replies).toEqual([]);
  });

  it("releases the in-flight slot even when the turn throws", async () => {
    const h = harness({
      subscribe: async () => {
        throw new Error("stream refused");
      },
    });
    await h.ask("@cujo-guard one");
    // Not "still working on the last question": the slot was released.
    await h.ask("@cujo-guard two");
    expect(h.started).toHaveLength(2);
  });

  it("apologises rather than throwing when something breaks underneath", async () => {
    const broken = new ConverseService({
      runs: {
        latestRunForPr: () => {
          throw new Error("database is gone");
        },
      } as never,
      harness: {} as never,
      github: {
        permissionFor: async () => "write" as const,
        pullRequestHead: async () => ({ headSha: "h1" }),
        createComment: async () => 1,
        replyToReviewComment: async () => 2,
      },
      spec: {} as TrueForgeApi.AgentSpec,
      limit: new ConverseRateLimit({ limit: 3, windowMs: 60_000 }),
      turnTimeoutMs: 50,
    });
    const replies: string[] = [];
    await expect(
      broken.handle({
        repo: "o/r",
        prNumber: 7,
        commentId: 55,
        actor: "maintainer",
        body: "@cujo-guard why?",
        surface: { kind: "issue" },
        log: createLogger({ service: "cujo", sink: () => {} }),
      }),
    ).resolves.toBeUndefined();
    expect(replies).toEqual([]);
  });

  it("logs the question and the answer, which is the audit trail for a sandbox", async () => {
    const h = harness();
    await h.ask("@cujo-guard why?");
    expect(h.lines.find((l) => l.event === "converse.started")).toMatchObject({
      repo: "o/r",
      pr_number: 7,
      actor: "maintainer",
      session_id: "converse-session",
    });
    expect(h.lines.some((l) => l.event === "converse.answered")).toBe(true);
  });

  it("does not read a mention out of a code fence", async () => {
    const h = harness();
    await h.ask("here is how you ask:\n\n```\n@cujo-guard do the thing\n```\n");
    expect(h.started).toEqual([]);
    expect(h.replies).toEqual([]);
  });

  it("answers one comment once, however many times GitHub delivers it", async () => {
    // A redelivery is not a second question. Without this it starts a second
    // sandbox, posts a second reply and spends a second slot; the in-flight
    // flag covers only deliveries that overlap.
    const h = harness();
    await h.ask("@cujo-guard why?", "maintainer", 4242);
    await h.ask("@cujo-guard why?", "maintainer", 4242);
    expect(h.started).toHaveLength(1);
    expect(h.replies).toHaveLength(1);
  });

  it("answers about the commit GitHub reports, not the row inserted last", async () => {
    // Delivery order is not commit order, so a late delivery for an older head
    // is the newest row while being the oldest commit.
    const h = harness();
    h.store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h2",
      sessionId: "review-session",
      isPublic: true,
      deliveryId: "d2",
    });
    // `latestRunForPr` would give h2; GitHub says the pull request is on h1.
    await h.ask("@cujo-guard which commit is this about?");
    const payload = JSON.parse(
      /```json\n([\s\S]*?)\n```/.exec(h.started[0]?.message ?? "")?.[1] ?? "{}",
    );
    expect(payload.head_sha).toBe("h1");
  });

  it("still answers about the newest run when the head has moved past every run", async () => {
    // Unlike a command, a question about a review the pull request has been
    // pushed past is worth answering: the evidence was real when collected.
    const h = harness({ head: "h-unreviewed" });
    await h.ask("@cujo-guard what did you see?");
    const payload = JSON.parse(
      /```json\n([\s\S]*?)\n```/.exec(h.started[0]?.message ?? "")?.[1] ?? "{}",
    );
    expect(payload.head_sha).toBe("h1");
  });

  it("does not post an answer from a turn that ended badly", async () => {
    // A terminal event is not a successful one. `fold` treats `error` and
    // `cancelled` as failures for a review, and a half-written thought from a
    // turn that died is not an answer here either.
    for (const status of ["error", "cancelled"] as const) {
      const h = harness({
        subscribe: async () => streamOf([turnDone(status)]),
        events: [{ turnId: "turn-1", event: said("half a thought") }],
      });
      await h.ask("@cujo-guard why?");
      expect(h.replies[0]).toContain("did not finish cleanly");
      expect(h.replies[0]).not.toContain("half a thought");
    }
  });

  it("lets a redelivery retry when the reply itself failed to post", async () => {
    // A claim that outlives a failed write is worse than no claim: the person
    // got nothing, and redelivery — the thing that would have recovered
    // it — is then ignored as already answered.
    let failNext = true;
    const posted: string[] = [];
    const store = new Store(":memory:");
    store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h1",
      sessionId: "review-session",
      isPublic: true,
      deliveryId: "d1",
    });
    const service = new ConverseService({
      runs: store.runs,
      harness: {
        createSession: async () => "converse-session",
        startTurn: async () => "turn-1",
        subscribe: async () => streamOf([turnDone()]),
        listEvents: async () => [{ turnId: "turn-1", event: said("340 ms on head.") }],
        cancelTurn: async () => {},
      } as never,
      github: {
        permissionFor: async () => "write" as const,
        pullRequestHead: async () => ({ headSha: "h1" }),
        createComment: async (_repo: string, _pr: number, body: string) => {
          if (failNext) {
            failNext = false;
            throw new Error("502 from GitHub");
          }
          posted.push(body);
          return 1;
        },
        replyToReviewComment: async () => 2,
      },
      spec: {} as TrueForgeApi.AgentSpec,
      limit: new ConverseRateLimit({ limit: 5, windowMs: 60_000 }),
      turnTimeoutMs: 5_000,
    });
    const deliver = () =>
      service.handle({
        repo: "o/r",
        prNumber: 7,
        commentId: 900,
        actor: "maintainer",
        body: "@cujo-guard why?",
        surface: { kind: "issue" },
        log: createLogger({ service: "cujo", sink: () => {} }),
      });

    await deliver();
    await deliver();

    expect(posted).toEqual(["340 ms on head."]);
  });

  it("gives a private repo no clone URL, rather than one that cannot be cloned", async () => {
    // The sandbox never holds a credential, so there is no URL that would
    // work. Omitted rather than blanked, the way `run_id` is (decision 36).
    const h = harness({ isPublic: false });
    await h.ask("@cujo-guard re-run it");
    const payload = JSON.parse(
      /```json\n([\s\S]*?)\n```/.exec(h.started[0]?.message ?? "")?.[1] ?? "{}",
    );
    expect(payload).not.toHaveProperty("clone_url");
    expect(JSON.stringify(payload)).not.toContain("github.com");
  });
});

describe("the turn timeout", () => {
  it("tells the person it ran out of time, and cancels the turn", async () => {
    // A turn that produces nothing. `cancelTurn` is what closes the stream on
    // the real harness, so the stub ends the same way the server would.
    let closeStream: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      closeStream = resolve;
    });
    const cancelled: string[] = [];
    const replies: string[] = [];
    const store = new Store(":memory:");
    store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h1",
      sessionId: "review-session",
      isPublic: true,
      deliveryId: "d1",
    });
    const service = new ConverseService({
      runs: store.runs,
      harness: {
        createSession: async () => "converse-session",
        startTurn: async () => "turn-1",
        subscribe: async () =>
          // biome-ignore lint/correctness/useYield: a turn that produces nothing is the case under test
          (async function* () {
            await closed;
          })(),
        listEvents: async () => [],
        cancelTurn: async (sessionId: string) => {
          cancelled.push(sessionId);
          closeStream();
        },
      } as never,
      github: {
        permissionFor: async () => "write" as const,
        pullRequestHead: async () => ({ headSha: "h1" }),
        createComment: async (_repo: string, _pr: number, body: string) => {
          replies.push(body);
          return 1;
        },
        replyToReviewComment: async () => 2,
      },
      spec: {} as TrueForgeApi.AgentSpec,
      limit: new ConverseRateLimit({ limit: 3, windowMs: 60_000 }),
      turnTimeoutMs: 20,
    });

    await service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId: 55,
      actor: "maintainer",
      body: "@cujo-guard why?",
      surface: { kind: "issue" },
      log: createLogger({ service: "cujo", sink: () => {} }),
    });

    expect(cancelled).toEqual(["converse-session"]);
    expect(replies[0]).toContain("ran out of time");
  });

  it("fires even when the cancel fails and the stream never closes", async () => {
    // The reason the deadline is raced against the stream rather than only
    // setting a flag beside it: cancelling is what closes the stream, so a
    // cancel that fails would otherwise leave `for await` blocked forever and
    // the configured timeout would bound nothing at all.
    const replies: string[] = [];
    const store = new Store(":memory:");
    store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h1",
      sessionId: "review-session",
      isPublic: true,
      deliveryId: "d1",
    });
    const service = new ConverseService({
      runs: store.runs,
      harness: {
        createSession: async () => "converse-session",
        startTurn: async () => "turn-1",
        // A stream that never yields and never ends, which is what the race
        // has to survive: the cancel below cannot close it.
        subscribe: async () => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
        }),
        listEvents: async () => [],
        cancelTurn: async () => {
          throw new Error("harness unreachable");
        },
      } as never,
      github: {
        permissionFor: async () => "write" as const,
        pullRequestHead: async () => ({ headSha: "h1" }),
        createComment: async (_repo: string, _pr: number, body: string) => {
          replies.push(body);
          return 1;
        },
        replyToReviewComment: async () => 2,
      },
      spec: {} as TrueForgeApi.AgentSpec,
      limit: new ConverseRateLimit({ limit: 3, windowMs: 60_000 }),
      turnTimeoutMs: 20,
    });

    await service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId: 56,
      actor: "maintainer",
      body: "@cujo-guard why?",
      surface: { kind: "issue" },
      log: createLogger({ service: "cujo", sink: () => {} }),
    });

    expect(replies[0]).toContain("ran out of time");
  });

  it("stops the consumer when the deadline wins, rather than leaving it resubscribing", async () => {
    // Losing the race does not stop `consume` on its own. Without a signal it
    // would resubscribe *after* the person had already been answered, holding
    // a stream and the request's state for as long as the server kept it open.
    let subscribes = 0;
    const replies: string[] = [];
    const store = new Store(":memory:");
    store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h1",
      sessionId: "review-session",
      isPublic: true,
      deliveryId: "d1",
    });
    const service = new ConverseService({
      runs: store.runs,
      harness: {
        createSession: async () => "converse-session",
        startTurn: async () => "turn-1",
        subscribe: async () => {
          subscribes += 1;
          // Ends without a terminal event, so `consume` would ordinarily go
          // round again — but the deadline is about to fire.
          await new Promise((r) => setTimeout(r, 40));
          return streamOf([]);
        },
        listEvents: async () => [],
        cancelTurn: async () => {},
      } as never,
      github: {
        permissionFor: async () => "write" as const,
        pullRequestHead: async () => ({ headSha: "h1" }),
        createComment: async (_repo: string, _pr: number, body: string) => {
          replies.push(body);
          return 1;
        },
        replyToReviewComment: async () => 2,
      },
      spec: {} as TrueForgeApi.AgentSpec,
      limit: new ConverseRateLimit({ limit: 3, windowMs: 60_000 }),
      turnTimeoutMs: 20,
    });

    await service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId: 901,
      actor: "maintainer",
      body: "@cujo-guard why?",
      surface: { kind: "issue" },
      log: createLogger({ service: "cujo", sink: () => {} }),
    });
    expect(replies[0]).toContain("ran out of time");

    // Long enough for a second subscribe to have happened if nothing stopped it.
    await new Promise((r) => setTimeout(r, 120));
    expect(subscribes).toBe(1);
  });

  it("does not post a partial answer when the stream drops without finishing", async () => {
    // A stream that ends without `turn.done` says nothing about the turn —
    // `Runner.consume` resubscribes on exactly this. Reading whatever is
    // persisted would post half a thought as though it were the whole one.
    const replies: string[] = [];
    let subscribes = 0;
    const store = new Store(":memory:");
    store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h1",
      sessionId: "review-session",
      isPublic: true,
      deliveryId: "d1",
    });
    const service = new ConverseService({
      runs: store.runs,
      harness: {
        createSession: async () => "converse-session",
        startTurn: async () => "turn-1",
        subscribe: async () => {
          subscribes += 1;
          return streamOf([]);
        },
        listEvents: async () => [{ turnId: "turn-1", event: said("half a thought") }],
        cancelTurn: async () => {},
      } as never,
      github: {
        permissionFor: async () => "write" as const,
        pullRequestHead: async () => ({ headSha: "h1" }),
        createComment: async (_repo: string, _pr: number, body: string) => {
          replies.push(body);
          return 1;
        },
        replyToReviewComment: async () => 2,
      },
      spec: {} as TrueForgeApi.AgentSpec,
      limit: new ConverseRateLimit({ limit: 3, windowMs: 60_000 }),
      turnTimeoutMs: 5_000,
    });

    await service.handle({
      repo: "o/r",
      prNumber: 7,
      commentId: 57,
      actor: "maintainer",
      body: "@cujo-guard why?",
      surface: { kind: "issue" },
      log: createLogger({ service: "cujo", sink: () => {} }),
    });

    expect(subscribes).toBe(2);
    expect(replies[0]).toContain("lost track");
    expect(replies[0]).not.toContain("half a thought");
  });
});
