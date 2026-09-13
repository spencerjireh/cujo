import { describe, expect, it } from "vitest";
import { type RepoPermission, authorizeCommand } from "../../../src/review/commands/authorization";

const ask = (over: Partial<Parameters<typeof authorizeCommand>[0]> = {}) =>
  authorizeCommand({
    verb: "dismiss",
    permission: "write",
    actor: "maintainer",
    actorIsBot: false,
    prAuthor: "contributor",
    ...over,
  });

describe("authorizeCommand", () => {
  it("lets a maintainer dismiss", () => {
    for (const permission of ["write", "admin"] as const) {
      expect(ask({ permission })).toEqual({ allowed: true });
    }
  });

  it("refuses anyone without push access, including a fork contributor", () => {
    for (const permission of ["read", "none"] as const) {
      expect(ask({ permission })).toEqual({ allowed: false, reason: "not_a_maintainer" });
    }
  });

  it("says it could not check rather than refusing, when GitHub did not answer", () => {
    // `unknown` is not a refusal — GitHub being unreachable says nothing about
    // who someone is — and it is not permission either.
    expect(ask({ permission: "unknown" })).toEqual({ allowed: false, reason: "unknown" });
  });

  it("will not let the pull request's author lift the block on it", () => {
    // The scenario the product exists for is hostile code in a pull request,
    // and repo write includes whoever opened it. Dismissing is the direction
    // that lifts a block on one's own change.
    expect(ask({ actor: "author", prAuthor: "author" })).toEqual({
      allowed: false,
      reason: "author_may_not_dismiss",
    });
  });

  it("will not let a Bot account lift a block, whatever access it holds (decision 138)", () => {
    // The unlock exists to be the one thing a coding agent cannot do to the
    // block it earned. Refused before the permission is even read, so a bot
    // with admin is refused for the reason that names it.
    for (const permission of ["admin", "write", "read", "unknown"] as const) {
      expect(ask({ permission, actorIsBot: true })).toEqual({
        allowed: false,
        reason: "bot_may_not_decide",
      });
    }
  });

  it("matches the author regardless of casing, since GitHub logins are case-insensitive", () => {
    expect(ask({ actor: "OctoCat", prAuthor: "octocat" })).toEqual({
      allowed: false,
      reason: "author_may_not_dismiss",
    });
  });

  it("checks the permission before the author rule", () => {
    // A fork contributor dismissing their own pull request is refused for the
    // reason that generalises, not the one that happens to also apply.
    expect(ask({ permission: "read", actor: "author", prAuthor: "author" })).toEqual({
      allowed: false,
      reason: "not_a_maintainer",
    });
  });

  it("refuses every permission it does not recognise as push access", () => {
    const every: RepoPermission[] = ["admin", "write", "read", "none", "unknown"];
    const allowed = every.filter((permission) => ask({ permission }).allowed);
    expect(allowed).toEqual(["admin", "write"]);
  });
});

describe("who may ask for a review", () => {
  const ask = (permission: RepoPermission, actor = "maintainer", actorIsBot = false) =>
    authorizeCommand({ verb: "review", permission, actor, actorIsBot, prAuthor: "author" });

  it("needs the same principal as dismiss", () => {
    expect(ask("admin").allowed).toBe(true);
    expect(ask("write").allowed).toBe(true);
    expect(ask("read")).toEqual({ allowed: false, reason: "not_a_maintainer" });
    expect(ask("none")).toEqual({ allowed: false, reason: "not_a_maintainer" });
    expect(ask("unknown")).toEqual({ allowed: false, reason: "unknown" });
  });

  it("lets the pull request's author ask, unlike dismiss", () => {
    // The author guard exists because `dismiss` lifts a block on one's own
    // change. Asking to be looked at again buries nothing.
    expect(ask("write", "Author").allowed).toBe(true);
    expect(
      authorizeCommand({
        verb: "dismiss",
        permission: "write",
        actor: "Author",
        actorIsBot: false,
        prAuthor: "author",
      }),
    ).toEqual({ allowed: false, reason: "author_may_not_dismiss" });
  });

  it("lets a Bot account with write ask, since a re-review buries nothing", () => {
    expect(ask("write", "dependabot[bot]", true).allowed).toBe(true);
  });
});
