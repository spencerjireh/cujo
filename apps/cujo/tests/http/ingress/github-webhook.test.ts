import { createHmac } from "node:crypto";
import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { GitHubReader } from "../../../src/clients/github";
import { verifySignature } from "../../../src/http/ingress/github-webhook";
import { createApp } from "../../../src/http/router";
import type { Runner } from "../../../src/review/runner.service";
import { Store } from "../../../src/store";
import { HOOK, INTERNAL, build, prOf, req } from "../helpers";

describe("webhook", () => {
  const sign = (body: string) => `sha256=${createHmac("sha256", "s3").update(body).digest("hex")}`;
  const payload = JSON.stringify({
    action: "opened",
    number: 7,
    repository: { full_name: "o/r" },
    pull_request: { head: { sha: "h" } },
  });

  it("verifies signatures in constant time and rejects malformed ones", () => {
    expect(verifySignature("s3", payload, sign(payload))).toBe(true);
    expect(verifySignature("s3", payload, "sha256=00")).toBe(false);
    expect(verifySignature("s3", payload, `sha256=${"z".repeat(64)}`)).toBe(false);
    expect(verifySignature("s3", payload, undefined)).toBe(false);
    expect(verifySignature("other", payload, sign(payload))).toBe(false);
  });

  it("answers 503 while the harness is not ready", async () => {
    const store = new Store(":memory:");
    const runner = { view: () => null, start: vi.fn() } as unknown as Runner;
    const app = createApp({
      log: createLogger({ service: "cujo", sink: () => {} }),
      internalHost: INTERNAL,
      webhookHost: HOOK,
      public: { runs: store.runs, runner, streamLimit: 200 },
      webhook: {
        log: createLogger({ service: "cujo", sink: () => {} }),
        secret: "s3",
        github: {} as GitHubReader,
        store: store.runs,
        runner,
        createSession: async () => "sess-1",
        reviewRunId: () => "",
        isReady: () => false,
      },
    });
    const res = await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        headers: { "x-github-event": "pull_request", "x-hub-signature-256": sign(payload) },
        body: payload,
      }),
    );
    expect(res.status).toBe(503);
    expect(runner.start).not.toHaveBeenCalled();
  });

  const deliver = (app: ReturnType<typeof build>["app"], body = payload) =>
    app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        headers: { "x-github-event": "pull_request", "x-hub-signature-256": sign(body) },
        body,
      }),
    );

  it("ignores draft pull requests without claiming a run", async () => {
    const draft = JSON.stringify({
      action: "opened",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: { head: { sha: "h" }, draft: true },
    });
    const { app, runner } = build();
    const res = await deliver(app, draft);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "draft" });
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("ignores pull requests carrying the cujo:skip label", async () => {
    const labelled = JSON.stringify({
      action: "opened",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: {
        head: { sha: "h" },
        labels: [{ name: "bug" }, { name: "cujo:skip" }],
      },
    });
    const { app, runner } = build();
    const res = await deliver(app, labelled);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "label" });
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("reviews a draft PR that becomes ready_for_review", async () => {
    const ready = JSON.stringify({
      action: "ready_for_review",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: { head: { sha: "h" }, draft: false },
    });
    const { app, runner, nextSettled } = build();
    const done = nextSettled();
    const res = await deliver(app, ready);
    expect(res.status).toBe(202);
    await done;
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("reviews a non-draft PR without the skip label normally", async () => {
    const normal = JSON.stringify({
      action: "opened",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: {
        head: { sha: "h" },
        draft: false,
        labels: [{ name: "enhancement" }],
      },
    });
    const { app, runner, nextSettled } = build();
    const done = nextSettled();
    const res = await deliver(app, normal);
    expect(res.status).toBe(202);
    await done;
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("claims one run per head, so a duplicate delivery starts nothing", async () => {
    const { app, runner, nextSettled } = build();
    const done = nextSettled();
    const [a, b] = await Promise.all([deliver(app), deliver(app)]);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
    const dup = a.status === 200 ? a : b;
    expect(await dup.json()).toMatchObject({ ignored: "duplicate delivery" });
    await done;
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("stamps the model and the rubric digest onto the run it claims", async () => {
    // Decision 61 and Contract 6. Without these a verdict cannot be traced to
    // the prompt and the model that produced it, and two runs that disagreed
    // about the same head across a deploy look identical in the store.
    const { app, store, nextSettled } = build({
      provenance: { model: "vendor/pinned", rubricSha256: "b".repeat(64) },
    });
    const done = nextSettled();
    const res = await deliver(app);
    const { run_id } = (await res.json()) as { run_id: string };
    await done;
    expect(store.runs.getRun(run_id)).toMatchObject({
      model: "vendor/pinned",
      rubricSha256: "b".repeat(64),
    });
  });

  it("rejects an unsigned delivery and accepts a signed one with 202", async () => {
    const { app, store, runner, nextSettled } = build();
    const headers = { "x-github-event": "pull_request", "content-type": "application/json" };
    const unsigned = await app.fetch(
      req(HOOK, "/webhook", { method: "POST", headers, body: payload }),
    );
    expect(unsigned.status).toBe(401);
    const done = nextSettled();
    const signed = await deliver(app);
    expect(signed.status).toBe(202);
    const body = (await signed.json()) as { run_id: string };
    expect(store.runs.getRun(body.run_id)?.sessionId).toBe("sess-1");
    expect(store.runs.getSession("o/r", 7)).toBe("sess-1");
    await done;
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it("answers before the GitHub reads, then releases a head the bot already reviewed", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const github = {
      alreadyReviewed: vi.fn(async () => {
        await gate;
        return true;
      }),
      pullRequest: vi.fn(),
    } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });
    const done = nextSettled();
    const res = await deliver(app);
    // 202 arrived while alreadyReviewed is still pending.
    expect(res.status).toBe(202);
    expect(store.runs.listRuns()).toHaveLength(1);
    release();
    await done;
    expect(runner.start).not.toHaveBeenCalled();
    // The claimed row is released so a later real run for this head is possible.
    expect(store.runs.listRuns()).toHaveLength(0);
  });

  it("tells the pull request it was claimed, but only for a current head", async () => {
    const { app, claimed, nextSettled } = build();
    let done = nextSettled();
    await deliver(app);
    const started = await done;
    expect(claimed).toEqual([started]);

    // A head the bot already reviewed is released without a turn, so nothing
    // would ever clear a reaction placed on it.
    const reviewed = build({
      github: {
        alreadyReviewed: vi.fn(async () => true),
        pullRequest: vi.fn(),
      } as unknown as GitHubReader,
    });
    done = reviewed.nextSettled();
    await deliver(reviewed.app);
    await done;
    expect(reviewed.claimed).toEqual([]);

    // A delayed delivery for an older head is superseded. One pull request has
    // one reaction, so it must not reach for it: the run for the head GitHub
    // reports now may already have put its verdict there.
    const stale = build({
      github: {
        alreadyReviewed: vi.fn(async () => false),
        pullRequest: vi.fn(async () => prOf("h2")),
      } as unknown as GitHubReader,
    });
    done = stale.nextSettled();
    await deliver(stale.app);
    await done;
    expect(stale.claimed).toEqual([]);
  });

  it("ends a run whose preparation fails and lets a redelivery re-claim the head", async () => {
    const pullRequest = vi.fn().mockRejectedValueOnce(new Error("502 from GitHub"));
    pullRequest.mockResolvedValue(prOf("h"));
    const github = {
      alreadyReviewed: vi.fn(async () => false),
      pullRequest,
    } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });

    let done = nextSettled();
    const first = await deliver(app);
    expect(first.status).toBe(202);
    const firstId = await done;
    expect(runner.fail).toHaveBeenCalledWith(firstId, expect.stringContaining("502 from GitHub"));
    expect(store.runs.getRun(firstId)).toMatchObject({ status: "error", turnIds: [] });

    done = nextSettled();
    const second = await deliver(app);
    expect(second.status).toBe(202);
    const secondId = await done;
    expect(secondId).not.toBe(firstId);
    expect(runner.start).toHaveBeenCalledOnce();
    expect(store.runs.getRun(firstId)).toBeNull();
  });

  /**
   * The stamp the public plane reads (decision 34). `private` is optional on the
   * event type so this has to be an explicit `=== false`; the third case is the
   * one that matters, because `!private` would call a payload with no such field
   * public.
   */
  describe("repo visibility at claim time", () => {
    const visibilityPayload = (repository: Record<string, unknown>) =>
      JSON.stringify({
        action: "opened",
        number: 7,
        repository,
        pull_request: { head: { sha: "h" } },
      });

    it.each([
      ["public when the payload says private is false", { full_name: "o/r", private: false }, true],
      ["private when the payload says private is true", { full_name: "o/r", private: true }, false],
      ["private when the payload carries no private field", { full_name: "o/r" }, false],
    ])("is %s", async (_name, repository, expected) => {
      const { app, store, nextSettled } = build();
      const done = nextSettled();
      const body = (await (await deliver(app, visibilityPayload(repository))).json()) as {
        run_id: string;
      };
      await done;
      expect(store.runs.getRun(body.run_id)?.isPublic).toBe(expected);
    });
  });

  /**
   * The fast path for a visibility flip (decision 34). It rides the same route
   * and the same HMAC as the pull_request event, so the restructure into a real
   * event dispatch must not have moved the signature check behind it.
   */
  describe("the issue_comment event", () => {
    const commentEvent = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        action: "created",
        repository: { full_name: "o/r" },
        issue: { number: 7, pull_request: { url: "https://api.github.com/…/pulls/7" } },
        comment: { id: 55, body: "/cujo confirm", user: { login: "maintainer" } },
        ...over,
      });

    const send = (app: ReturnType<typeof build>["app"], body: string) =>
      app.fetch(
        req(HOOK, "/webhook", {
          method: "POST",
          headers: { "x-github-event": "issue_comment", "x-hub-signature-256": sign(body) },
          body,
        }),
      );

    const withCommands = () => {
      const handled: Record<string, unknown>[] = [];
      const harness = build({
        prCommands: {
          handle: async (command) => {
            handled.push(command as Record<string, unknown>);
          },
        },
      });
      return { ...harness, handled };
    };

    it("hands a pull request comment to the command service and answers at once", async () => {
      const { app, handled } = withCommands();
      const res = await send(app, commentEvent());
      expect(res.status).toBe(200);
      expect(handled[0]).toMatchObject({
        repo: "o/r",
        prNumber: 7,
        commentId: 55,
        actor: "maintainer",
        body: "/cujo confirm",
      });
    });

    it("refuses an unsigned comment, like every other event on this route", async () => {
      const { app, handled } = withCommands();
      const res = await app.fetch(
        req(HOOK, "/webhook", {
          method: "POST",
          headers: { "x-github-event": "issue_comment", "x-hub-signature-256": "sha256=00" },
          body: commentEvent(),
        }),
      );
      expect(res.status).toBe(401);
      expect(handled).toEqual([]);
    });

    it("answers 200 and does nothing on a payload that is not the documented shape", async () => {
      // A signed delivery is trustworthy about its origin, not about its
      // shape. This is the one route that turns a stranger's JSON into a
      // decision on a review, so every field it reads is checked before
      // anything reads one.
      const bad = [
        "not json at all",
        JSON.stringify([1, 2, 3]),
        commentEvent({ repository: { full_name: 42 } }),
        commentEvent({ issue: { number: "7", pull_request: {} } }),
        commentEvent({ comment: { id: 55, body: null, user: { login: "m" } } }),
        commentEvent({ comment: { id: 55, body: "/cujo confirm", user: { login: 7 } } }),
      ];
      for (const body of bad) {
        const { app, handled } = withCommands();
        const res = await send(app, body);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ignored: "malformed" });
        expect(handled).toEqual([]);
      }
    });

    it("accepts a comment whose author was deleted, naming nobody", async () => {
      const { app, handled } = withCommands();
      const res = await send(app, commentEvent({ comment: { id: 55, body: "hi", user: null } }));
      expect(res.status).toBe(200);
      expect(handled[0]).toMatchObject({ actor: "" });
    });

    it("ignores a comment on an issue, which is not a pull request", async () => {
      const { app, handled } = withCommands();
      const res = await send(app, commentEvent({ issue: { number: 7 } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ignored: "issue" });
      expect(handled).toEqual([]);
    });

    it("ignores an edited comment, whose author is not who typed it", async () => {
      const { app, handled } = withCommands();
      const res = await send(app, commentEvent({ action: "edited" }));
      expect(await res.json()).toMatchObject({ ignored: "action" });
      expect(handled).toEqual([]);
    });

    it("answers 200 when commands are not configured, rather than failing the delivery", async () => {
      const { app } = build();
      const res = await send(app, commentEvent());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ignored: "not_configured" });
    });

    it("offers the comment to both services, each ignoring what is not its shape", async () => {
      // A comment is a command or a question and never both — the two syntaxes
      // were chosen to be unmistakable — so which one it was is decided by the
      // service that owns the syntax, not by a branch here.
      const commands: Record<string, unknown>[] = [];
      const questions: Record<string, unknown>[] = [];
      const { app } = build({
        prCommands: {
          handle: async (c) => {
            commands.push(c as Record<string, unknown>);
          },
        },
        converse: {
          handle: async (r) => {
            questions.push(r as Record<string, unknown>);
          },
        },
      });
      await send(app, commentEvent({ comment: { id: 55, body: "@cujo-guard why?", user: null } }));
      expect(commands).toHaveLength(1);
      expect(questions[0]).toMatchObject({
        repo: "o/r",
        prNumber: 7,
        body: "@cujo-guard why?",
        surface: { kind: "issue" },
      });
    });
  });

  /**
   * A reply inside a review thread. A different GitHub event from
   * `issue_comment`, and the one flow C needs: "prove it" is asked under the
   * finding it doubts, not at the bottom of the page.
   */
  describe("the pull_request_review_comment event", () => {
    const reviewComment = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        action: "created",
        repository: { full_name: "o/r" },
        pull_request: { number: 7 },
        comment: { id: 88, body: "@cujo-guard seed the db", user: { login: "maintainer" } },
        ...over,
      });

    const send = (app: ReturnType<typeof build>["app"], body: string) =>
      app.fetch(
        req(HOOK, "/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "pull_request_review_comment",
            "x-hub-signature-256": sign(body),
          },
          body,
        }),
      );

    const withConverse = () => {
      const questions: Record<string, unknown>[] = [];
      const commands: Record<string, unknown>[] = [];
      const harness = build({
        converse: {
          handle: async (r) => {
            questions.push(r as Record<string, unknown>);
          },
        },
        prCommands: {
          handle: async (c) => {
            commands.push(c as Record<string, unknown>);
          },
        },
      });
      return { ...harness, questions, commands };
    };

    it("hands the reply to conversation, naming the thread to answer in", async () => {
      const { app, questions } = withConverse();
      const res = await send(app, reviewComment());
      expect(res.status).toBe(200);
      expect(questions[0]).toMatchObject({
        repo: "o/r",
        prNumber: 7,
        commentId: 88,
        actor: "maintainer",
        surface: { kind: "review_thread", commentId: 88 },
      });
    });

    it("never routes a privileged verb through this surface", async () => {
      // `/cujo confirm` decides a review, and narrowing the surfaces that can
      // do that costs nothing: the command belongs on the pull request's own
      // thread, where it is about the run rather than about one line.
      const { app, commands, questions } = withConverse();
      await send(app, reviewComment({ comment: { id: 88, body: "/cujo confirm", user: null } }));
      expect(commands).toEqual([]);
      expect(questions).toHaveLength(1);
    });

    it("refuses an unsigned delivery, like every other event on this route", async () => {
      const { app, questions } = withConverse();
      const body = reviewComment();
      const res = await app.fetch(
        req(HOOK, "/webhook", {
          method: "POST",
          headers: {
            "x-github-event": "pull_request_review_comment",
            "x-hub-signature-256": "sha256=00",
          },
          body,
        }),
      );
      expect(res.status).toBe(401);
      expect(questions).toEqual([]);
    });

    it("acts on `created` only", async () => {
      const { app, questions } = withConverse();
      const res = await send(app, reviewComment({ action: "edited" }));
      expect(await res.json()).toMatchObject({ ignored: "action" });
      expect(questions).toEqual([]);
    });

    it("answers 200 and does nothing on a payload that is not the documented shape", async () => {
      const { app, questions } = withConverse();
      for (const body of [
        "not json",
        reviewComment({ pull_request: { number: "7" } }),
        reviewComment({ comment: { id: 88, body: 42, user: null } }),
      ]) {
        const res = await send(app, body);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ignored: "malformed" });
      }
      expect(questions).toEqual([]);
    });

    it("answers 200 when conversation is not configured", async () => {
      const { app } = build();
      const res = await send(app, reviewComment());
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ignored: "not_configured" });
    });
  });

  describe("the repository event", () => {
    const repoEvent = (action: string, fullName = "o/r") =>
      JSON.stringify({ action, repository: { full_name: fullName } });

    const send = (app: ReturnType<typeof build>["app"], body: string, signature = sign(body)) =>
      app.fetch(
        req(HOOK, "/webhook", {
          method: "POST",
          headers: { "x-github-event": "repository", "x-hub-signature-256": signature },
          body,
        }),
      );

    const publicRun = async (
      app: ReturnType<typeof build>["app"],
      nextSettled: () => Promise<string>,
    ) => {
      const done = nextSettled();
      const payloadWithVisibility = JSON.stringify({
        action: "opened",
        number: 7,
        repository: { full_name: "Owner/Repo", private: false },
        pull_request: { head: { sha: "h" } },
      });
      const body = (await (await deliver(app, payloadWithVisibility)).json()) as { run_id: string };
      await done;
      return body.run_id;
    };

    it("hides a repo's runs when it is privatized, whatever the casing", async () => {
      const { app, store, nextSettled } = build();
      const runId = await publicRun(app, nextSettled);
      expect(store.runs.listPublicRuns().map((r) => r.run.id)).toEqual([runId]);

      // GitHub sends the name in the casing it holds; the runs stored another.
      const res = await send(app, repoEvent("privatized", "owner/repo"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, is_public: false, changed: 1 });
      expect(store.runs.getRun(runId)?.isPublic).toBe(false);
      expect(store.runs.listPublicRuns()).toEqual([]);
    });

    it("brings them back when it is publicized", async () => {
      const { app, store, nextSettled } = build();
      const runId = await publicRun(app, nextSettled);
      await send(app, repoEvent("privatized", "owner/repo"));
      const res = await send(app, repoEvent("publicized", "owner/repo"));
      expect(await res.json()).toMatchObject({ is_public: true, changed: 1 });
      expect(store.runs.getRun(runId)?.isPublic).toBe(true);
    });

    it("ignores an action that is not a visibility change", async () => {
      const { app } = build();
      const res = await send(app, repoEvent("renamed"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ignored: "action" });
    });

    it("still refuses a bad signature, rather than ignoring the event", async () => {
      const { app, store, nextSettled } = build();
      const runId = await publicRun(app, nextSettled);
      const res = await send(app, repoEvent("privatized", "owner/repo"), "sha256=00");
      expect(res.status).toBe(401);
      expect(store.runs.getRun(runId)?.isPublic).toBe(true);
    });
  });

  const headPayload = (sha: string) =>
    JSON.stringify({
      action: "synchronize",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: { head: { sha } },
    });

  it("supersedes the unfinished run of an older head when a newer one arrives", async () => {
    const pullRequest = vi.fn(async () => prOf("h"));
    const github = { alreadyReviewed: async () => false, pullRequest } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });
    let done = nextSettled();
    const first = (await (await deliver(app)).json()) as { run_id: string };
    await done;
    store.runs.updateRun(first.run_id, { status: "blocked_pending" });

    // GitHub now reports h2 as the head.
    pullRequest.mockResolvedValue(prOf("h2"));
    done = nextSettled();
    const second = (await (await deliver(app, headPayload("h2"))).json()) as { run_id: string };
    await done;
    expect(runner.supersede).toHaveBeenCalledWith(first.run_id);
    expect(runner.supersede).not.toHaveBeenCalledWith(second.run_id);
    expect(store.runs.getRun(first.run_id)?.status).toBe("superseded");
    expect(runner.start).toHaveBeenCalledTimes(2);
  });

  it("does not let a delayed delivery for an older head replace the current run", async () => {
    // GitHub's head is h2 throughout; the h1 delivery arrives late.
    const pullRequest = vi.fn(async () => prOf("h2"));
    const github = { alreadyReviewed: async () => false, pullRequest } as unknown as GitHubReader;
    const { app, runner, store, nextSettled } = build({ github });
    let done = nextSettled();
    const current = (await (await deliver(app, headPayload("h2"))).json()) as { run_id: string };
    await done;
    expect(runner.start).toHaveBeenCalledOnce();

    done = nextSettled();
    const stale = (await (await deliver(app, headPayload("h1"))).json()) as { run_id: string };
    await done;
    expect(runner.supersede).toHaveBeenCalledWith(stale.run_id);
    expect(runner.supersede).not.toHaveBeenCalledWith(current.run_id);
    expect(store.runs.getRun(stale.run_id)?.status).toBe("superseded");
    expect(store.runs.getRun(current.run_id)?.status).toBe("running");
    expect(runner.start).toHaveBeenCalledOnce();
  });
});

const signLog = (body: string) => `sha256=${createHmac("sha256", "s3").update(body).digest("hex")}`;

const DELIVERY = "12345678-90ab-cdef-1234-567890abcdef";

const prBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: "opened",
    number: 7,
    repository: { full_name: "o/r", private: false },
    pull_request: { head: { sha: "abc1234def" } },
    ...overrides,
  });

function post(body: string, headers: Record<string, string> = {}) {
  return req(HOOK, "/webhook", {
    method: "POST",
    body,
    headers: {
      "x-hub-signature-256": signLog(body),
      "x-github-event": "pull_request",
      "x-github-delivery": DELIVERY,
      ...headers,
    },
  });
}

describe("the webhook logs every branch it takes", () => {
  it("records an accepted delivery, joining the delivery id to the run id", async () => {
    // The head of the audit trail, and the only line that carries both ids.
    const { app, logged, nextSettled } = build();
    const settled = nextSettled();
    await app.fetch(post(prBody()));
    await settled;
    const [line] = logged("webhook.accepted");
    expect(line).toMatchObject({
      delivery_id: DELIVERY,
      ray: DELIVERY,
      repo: "o/r",
      pr_number: 7,
      head_sha: "abc1234def",
      is_public: true,
      session_created: true,
    });
    expect(typeof line?.run_id).toBe("string");
  });

  it("files the run under the delivery, keeping the edge id beside it", async () => {
    // Two different facts: which delivery GitHub sent, and which edge request
    // carried it. The delivery wins because it is what you redeliver from.
    const { app, logged, nextSettled } = build();
    const settled = nextSettled();
    await app.fetch(post(prBody(), { "cf-ray": "edge-9" }));
    await settled;
    expect(logged("webhook.accepted")[0]).toMatchObject({ ray: DELIVERY, cf_ray: "edge-9" });
  });

  it("names no repo and no PR on a bad signature", async () => {
    // Nothing is parsed at that point, and an unsigned body is not evidence of
    // anything. The absence is the security property.
    const { app, logged } = build();
    const body = prBody();
    await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        body,
        headers: {
          "x-hub-signature-256": "sha256=00",
          "x-github-event": "pull_request",
          "x-github-delivery": DELIVERY,
        },
      }),
    );
    const [line] = logged("webhook.rejected");
    expect(line).toMatchObject({ reason: "bad_signature", delivery_id: DELIVERY });
    expect(line).not.toHaveProperty("repo");
    expect(line).not.toHaveProperty("pr_number");
    expect(line).not.toHaveProperty("head_sha");
  });

  it("warns rather than whispers when the harness is not ready", async () => {
    // A review that did not happen is not the same as an event we ignore.
    const { app, logged } = build({ isReady: () => false });
    await app.fetch(post(prBody()));
    expect(logged("webhook.deferred")[0]).toMatchObject({
      level: "warn",
      reason: "harness_not_ready",
      repo: "o/r",
      pr_number: 7,
    });
  });

  it("answers 502 and says why when the session cannot be created", async () => {
    // Found by driving the real stack: TrueForge refused the model, the
    // exception escaped the handler, and the only record was a stack trace on
    // stderr carrying the whole upstream response body — unstructured, and the
    // one thing the standard says never to put in a message.
    const { app, logged } = build({
      createSession: async () => {
        throw new Error('Unknown model "x/y" - provider not configured');
      },
    });
    const response = await app.fetch(post(prBody()));
    expect(response.status).toBe(502);
    expect(logged("webhook.failed")[0]).toMatchObject({
      level: "error",
      reason: "session_create_failed",
      repo: "o/r",
      pr_number: 7,
      error_kind: "error",
    });
    // Nothing was claimed, so a redelivery can still take the head.
    expect(logged("webhook.accepted")).toEqual([]);
  });

  it("records a duplicate delivery against the run that already owns the head", async () => {
    const { app, logged, nextSettled } = build();
    const first = nextSettled();
    await app.fetch(post(prBody()));
    await first;
    await app.fetch(post(prBody(), { "x-github-delivery": "second-delivery" }));
    const [line] = logged("webhook.ignored").filter((l) => l.reason === "duplicate_delivery");
    expect(line).toMatchObject({
      reason: "duplicate_delivery",
      delivery_id: "second-delivery",
      repo: "o/r",
    });
    expect(logged("webhook.accepted")).toHaveLength(1);
  });

  it("keeps noisy ignored branches at debug so they do not dominate the log", async () => {
    // The App is subscribed to events it does not act on; at info these would
    // dominate the log and hide everything this vocabulary exists to show.
    const quiet = build();
    await quiet.app.fetch(post(prBody(), { "x-github-event": "push" }));
    expect(quiet.logged("webhook.ignored")).toEqual([]);

    const loud = build({ level: "debug" });
    await loud.app.fetch(post(prBody(), { "x-github-event": "push" }));
    expect(loud.logged("webhook.ignored")[0]).toMatchObject({
      reason: "event",
      event_type: "push",
    });
  });

  it("logs draft and label skips at info — explicit human choices, not noise", async () => {
    const draftBody = JSON.stringify({
      action: "opened",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: { head: { sha: "h" }, draft: true },
    });
    const labelBody = JSON.stringify({
      action: "opened",
      number: 7,
      repository: { full_name: "o/r" },
      pull_request: { head: { sha: "h" }, labels: [{ name: "cujo:skip" }] },
    });
    const { app, logged } = build();
    await app.fetch(post(draftBody));
    await app.fetch(post(labelBody));
    const ignored = logged("webhook.ignored");
    expect(ignored).toHaveLength(2);
    expect(ignored[0]).toMatchObject({ level: "info", reason: "draft" });
    expect(ignored[1]).toMatchObject({ level: "info", reason: "label" });
  });

  it("keeps the delivery on a repository event too", async () => {
    // handleRepository used the base request logger, so every repository
    // event silently lost delivery_id and cf_ray while every pull_request
    // event kept them — a correlation gap only visible by comparing two
    // lines side by side.
    const { app, logged } = build();
    const body = JSON.stringify({ action: "publicized", repository: { full_name: "o/r" } });
    await app.fetch(post(body, { "x-github-event": "repository", "cf-ray": "edge-3" }));
    expect(logged("repo.visibility.changed")[0]).toMatchObject({
      delivery_id: DELIVERY,
      ray: DELIVERY,
      cf_ray: "edge-3",
    });
  });

  it("records a visibility change and how many runs it re-stamped", async () => {
    const { app, store, logged } = build();
    store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h",
      sessionId: "s",
      isPublic: true,
      deliveryId: null,
    });
    const body = JSON.stringify({ action: "privatized", repository: { full_name: "o/r" } });
    await app.fetch(post(body, { "x-github-event": "repository" }));
    expect(logged("repo.visibility.changed")[0]).toMatchObject({
      repo: "o/r",
      is_public: false,
      runs_restamped: 1,
    });
  });
});

describe("a superseded run is logged as itself", () => {
  it("carries the older run's own head and delivery, not the newer run's", async () => {
    // Two mistakes are available and the second is the subtle one. A call-site
    // run_id is ignored outright, because a bound field beats it; and
    // rebinding only run_id files the line under the old run while still
    // carrying the new run's head, ray and delivery — worse than silence,
    // because it reads as fact.
    const { app, store, logged, nextSettled } = build();
    const first = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "oldhead",
      sessionId: "s",
      isPublic: true,
      deliveryId: "old-delivery",
    }).run;

    // build()'s fake PR reports head "h", so the delivery has to name that
    // head — otherwise this takes the stale-head branch and never reaches the
    // loop under test.
    const settled = nextSettled();
    await app.fetch(post(prBody({ pull_request: { head: { sha: "h" } } })));
    await settled;

    const line = logged("run.superseded").find((l) => l.reason === "newer_head");
    expect(line).toMatchObject({
      run_id: first.id,
      head_sha: "oldhead",
      delivery_id: "old-delivery",
      ray: "old-delivery",
      to: expect.any(String),
    });
    expect(line?.to).not.toBe(first.id);
  });
});

describe("the run carries its delivery past the request", () => {
  it("persists it, so a restart still knows which delivery started the run", async () => {
    // The request answers 202 and returns while the run outlives it, and a
    // rehydrate has no request at all — so the id has to be on the row.
    const { app, store, nextSettled } = build();
    const settled = nextSettled();
    await app.fetch(post(prBody()));
    const runId = await settled;
    expect(store.runs.getRun(runId)?.deliveryId).toBe(DELIVERY);
  });

  it("stores null rather than an empty string when there was no delivery", async () => {
    // A run claimed before the column existed genuinely has no delivery, which
    // is a different fact from an empty one.
    const { store } = build();
    const { run } = store.runs.createRun({
      repo: "o/r",
      prNumber: 1,
      headSha: "h",
      sessionId: "s",
      isPublic: false,
      deliveryId: null,
    });
    expect(store.runs.getRun(run.id)?.deliveryId).toBeNull();
  });
});
