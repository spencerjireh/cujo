/**
 * The integration half of the redaction guard (decision 37).
 *
 * `packages/log` proves the scrubber replaces a credential *shape* and that the
 * field allowlist drops an undeclared key. Neither proves the thing an operator
 * actually cares about: that driving this service does not put one of its own
 * configured secrets into a line.
 *
 * **Scope, stated precisely, because the first version of this file did not
 * have it and was largely vacuous.** A sentinel is only evidence if the app is
 * really holding it, so this covers exactly the two secrets the composed test
 * app is configured with — the webhook HMAC secret, injected for real, and the
 * Access assertion, which arrives on the request. The App private key, the
 * Discord token and the provider keys are held by clients this harness fakes,
 * so asserting they do not leak here would be asserting nothing. Those are
 * covered by the field allowlist and the scalar-only value type, which is why
 * this is the third layer and not the only one.
 *
 * Nothing is asserted about *how* redaction happened — only that no sentinel
 * came out. That is what makes it catch a field somebody adds later, on a path
 * nobody thought about.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HOOK, UI, build, req } from "./helpers";

/** The HMAC secret the app is actually configured with, below. */
const WEBHOOK_SECRET = "SENTINEL_githubWebhookSecret";
/** An assertion the caller sends. Nothing in it is verified, so nothing in it may be logged. */
const ASSERTION = "SENTINEL_cfAccessAssertion";

const signedWith = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const prBody = JSON.stringify({
  action: "opened",
  number: 7,
  repository: { full_name: "o/r", private: false },
  pull_request: { head: { sha: "h" } },
});

describe("no configured secret reaches a log line", () => {
  it("survives a delivery, a forgery, a denied read and an unknown host", async () => {
    const { app, nextSettled, lines } = build({
      level: "debug",
      // The real thing: every signature below is checked against this value,
      // so the secret is genuinely in scope for the whole request.
      webhookSecret: WEBHOOK_SECRET,
    });

    // A delivery that verifies.
    const settled = nextSettled();
    await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        body: prBody,
        headers: {
          "x-hub-signature-256": signedWith(WEBHOOK_SECRET, prBody),
          "x-github-event": "pull_request",
          "x-github-delivery": "d1",
        },
      }),
    );
    await settled;

    // One that does not, so the rejection path runs with the secret in scope.
    await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        body: prBody,
        headers: {
          "x-hub-signature-256": signedWith("the-wrong-secret", prBody),
          "x-github-event": "pull_request",
          // Not a sentinel: the delivery id is *designed* to be logged, even
          // on a rejection where it is a hint rather than a fact. Putting a
          // secret here would make this sweep fail for the one reason that is
          // not a leak, which is how a guard gets weakened to make it pass.
          "x-github-delivery": "d-forged",
        },
      }),
    );

    // A refused read. On a failed verification nothing in that token has been
    // checked, so no claim from it — and not the token itself — may be logged.
    await app.fetch(req(UI, "/runs", { headers: { "cf-access-jwt-assertion": ASSERTION } }));

    // And a request nobody routed, which is the one most likely to be queried.
    await app.fetch(req("stranger.test", "/runs"));

    const printed = JSON.stringify(lines);
    expect(lines.length).toBeGreaterThan(4);
    expect(printed, "the webhook secret reached the log").not.toContain(WEBHOOK_SECRET);
    expect(printed, "the assertion reached the log").not.toContain(ASSERTION);
    expect(printed).not.toContain("SENTINEL_");
  });

  it("would have caught a leak, on the paths it drives", async () => {
    // The sweep above only means something if a value in that position could
    // reach a line at all. This is the witness: the same paths, with the same
    // driving, do produce output that carries request-scoped detail.
    const { app, logged, nextSettled } = build({ webhookSecret: WEBHOOK_SECRET });
    const settled = nextSettled();
    await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        body: prBody,
        headers: {
          "x-hub-signature-256": signedWith(WEBHOOK_SECRET, prBody),
          "x-github-event": "pull_request",
          "x-github-delivery": "d-witness",
        },
      }),
    );
    await settled;
    expect(logged("webhook.accepted")[0]).toMatchObject({
      delivery_id: "d-witness",
      repo: "o/r",
    });
    await app.fetch(req(UI, "/runs", { headers: { "cf-access-jwt-assertion": ASSERTION } }));
    expect(logged("access.denied")[0]).toMatchObject({ path: "/runs" });
  });
});
