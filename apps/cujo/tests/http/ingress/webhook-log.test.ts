/**
 * What the ingress plane says about itself (decision 37).
 *
 * The route was entirely silent before this: five branches, five different
 * outcomes, and nothing on the box to tell them apart. The assertions here are
 * as much about what a line must *not* carry as what it must.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HOOK, build, req } from "../helpers";

const sign = (body: string) => `sha256=${createHmac("sha256", "s3").update(body).digest("hex")}`;

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
      "x-hub-signature-256": sign(body),
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

  it("keeps the ignored branches at debug, because they are the loud ones", async () => {
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
