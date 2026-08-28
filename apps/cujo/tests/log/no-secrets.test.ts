/**
 * The integration half of the redaction guard (decision 37).
 *
 * `packages/log` proves the scrubber replaces a credential *shape* and that the
 * field allowlist drops an undeclared key. Neither proves the thing an operator
 * actually cares about: that driving this service does not put one of its own
 * configured secrets into a line.
 *
 * So every secret this process holds is set to a distinct sentinel, the app is
 * driven through the paths that touch them, and nothing is asserted about how
 * the redaction happened — only that no sentinel came out. That is the direct
 * descendant of `sentinelView()` in the public serializer's test, and it fails
 * for a reason the unit tests cannot see: a field somebody adds later that
 * carries config through a path nobody thought about.
 *
 * Known limit, and it is the reason this is the third layer rather than the
 * only one: it covers the paths it drives. The allowlist and the scalar-only
 * value type are what cover the rest.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HOOK, UI, build, req } from "../http/helpers";

/** Every secret `config.ts` reads, one distinguishable value each. */
const SECRETS = {
  webhookSecret: "SENTINEL_githubWebhookSecret",
  appPrivateKey: "SENTINEL_githubAppPrivateKey",
  botToken: "SENTINEL_discordBotToken",
  modelProviderKey: "SENTINEL_modelProviderApiKey",
  daytonaKey: "SENTINEL_daytonaApiKey",
  accessAud: "SENTINEL_cfAccessAud",
  appId: "SENTINEL_githubAppId",
};

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
    const { app, nextSettled, lines } = build({ level: "debug" });

    // A real delivery, signed with the sentinel secret. The HMAC is derived
    // from it, so the secret is in scope for the whole request.
    const settled = nextSettled();
    await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        body: prBody,
        headers: {
          "x-hub-signature-256": signedWith("s3", prBody),
          "x-github-event": "pull_request",
          "x-github-delivery": "d1",
        },
      }),
    );
    await settled;

    // A forged one, where the header carries a sentinel and nothing verifies.
    await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        body: prBody,
        headers: {
          "x-hub-signature-256": signedWith(SECRETS.webhookSecret, prBody),
          "x-github-event": "pull_request",
          // Not a sentinel: the delivery id is *designed* to be logged, even
          // on a rejection where it is a hint rather than a fact. Putting a
          // secret here would make this sweep fail for the one reason that is
          // not a leak, which is how a guard gets weakened to make it pass.
          "x-github-delivery": "d-forged",
        },
      }),
    );

    // A refused read, carrying an assertion that is itself a sentinel. On a
    // failed verification nothing in that token has been checked, so nothing
    // from it may be logged.
    await app.fetch(
      req(UI, "/runs", { headers: { "cf-access-jwt-assertion": SECRETS.accessAud } }),
    );

    // And a request nobody routed, which is the one most likely to be queried.
    await app.fetch(req("stranger.test", "/runs"));

    const printed = JSON.stringify(lines);
    expect(lines.length).toBeGreaterThan(4);
    for (const [name, sentinel] of Object.entries(SECRETS)) {
      expect(printed, `${name} reached the log`).not.toContain(sentinel);
    }
    // Nothing that merely looks like a secret, either.
    expect(printed).not.toContain("SENTINEL_");
  });

  it("logs the delivery it was given, so the sweep is not passing vacuously", async () => {
    // If the app stopped logging entirely the assertions above would still
    // hold. This is the witness that it did not.
    const { app, logged, nextSettled } = build();
    const settled = nextSettled();
    await app.fetch(
      req(HOOK, "/webhook", {
        method: "POST",
        body: prBody,
        headers: {
          "x-hub-signature-256": signedWith("s3", prBody),
          "x-github-event": "pull_request",
          "x-github-delivery": "d-witness",
        },
      }),
    );
    await settled;
    expect(logged("webhook.accepted")[0]).toMatchObject({ delivery_id: "d-witness" });
  });
});
