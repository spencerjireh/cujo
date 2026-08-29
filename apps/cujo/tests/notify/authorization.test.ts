import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { GitHubReader } from "../../src/clients/github";
import { authorizationFor } from "../../src/notify/authorization";
import { Store } from "../../src/store";

/** Tests assert on behaviour, not on log output; the sink swallows it. */
const silentLog = createLogger({ service: "cujo", sink: () => {} });

/** The deploy's own server, and somebody else's. */
const OURS = "222222222222222222";
const THEIRS = "333333333333333333";
const REPO = "spencerjireh/orders-api";

/** The repo's `.cujo.yml`; `"unreadable"` is GitHub being down, not a refusal. */
function fakeGithub(declared: string | null | "unreadable") {
  return {
    declaredGuild: vi.fn(async () => {
      if (declared === "unreadable") throw new Error("github is down");
      return declared;
    }),
  } as unknown as GitHubReader;
}

function deps(declared: string | null | "unreadable", defaultGuild: string | null) {
  const store = new Store(":memory:");
  return {
    store: store.notifications,
    deps: {
      log: silentLog,
      store: store.notifications,
      github: fakeGithub(declared),
      defaultGuild,
    },
  };
}

describe("authorizationFor", () => {
  it("allows the default server a repo that declares nothing", async () => {
    const { deps: d } = deps(null, OURS);
    expect(await authorizationFor(d, OURS, REPO)).toEqual({ allowed: true, source: "default" });
  });

  it("refuses every other server the same repo", async () => {
    // The whole point of one id rather than a list: a stranger who invited the
    // bot into their own server is refused by the comparison that allows ours.
    const { deps: d } = deps(null, OURS);
    expect(await authorizationFor(d, THEIRS, REPO)).toEqual({
      allowed: false,
      reason: "not_declared",
    });
  });

  it("lets a repo's own declaration overrule the default", async () => {
    const { deps: d } = deps(THEIRS, OURS);
    expect(await authorizationFor(d, OURS, REPO)).toEqual({
      allowed: false,
      reason: "declared_elsewhere",
    });
    expect(await authorizationFor(d, THEIRS, REPO)).toEqual({ allowed: true, source: "repo" });
  });

  it("keeps the declaration as the reason when it names the asking server", async () => {
    const { deps: d } = deps(OURS, OURS);
    expect(await authorizationFor(d, OURS, REPO)).toEqual({ allowed: true, source: "repo" });
  });

  it("does not rescue an unreadable declaration, even for the default", async () => {
    // `unknown` is GitHub being unreachable, and the two callers want opposite
    // things from it. Collapsing it into "allowed" here would decide for both.
    const { deps: d } = deps("unreadable", OURS);
    expect(await authorizationFor(d, OURS, REPO)).toEqual({ allowed: false, reason: "unknown" });
  });

  it("changes nothing when no default is configured", async () => {
    const { deps: d } = deps(null, null);
    expect(await authorizationFor(d, OURS, REPO)).toEqual({
      allowed: false,
      reason: "not_declared",
    });
  });

  it("has no override to answer from, so it always asks the repo", async () => {
    // The operator table used to short-circuit this and was the only way a
    // server could be allowed without the repo saying so. Decision 57 deleted
    // it, so repo write access is the whole authority now (decision 31) and
    // `.cujo.yml` is read on every question.
    const { deps: d } = deps(null, OURS);
    expect(await authorizationFor(d, THEIRS, REPO)).toEqual({
      allowed: false,
      reason: "not_declared",
    });
    expect(d.github.declaredGuild).toHaveBeenCalled();
  });
});
