import { describe, expect, it } from "vitest";
import { type RepoPermission, authorizeCommand } from "../../src/review/command-authorization";

const ask = (over: Partial<Parameters<typeof authorizeCommand>[0]> = {}) =>
  authorizeCommand({
    verb: "confirm",
    permission: "write",
    actor: "maintainer",
    prAuthor: "contributor",
    ...over,
  });

describe("authorizeCommand", () => {
  it("lets a maintainer confirm or dismiss", () => {
    for (const permission of ["write", "admin"] as const) {
      expect(ask({ permission, verb: "confirm" })).toEqual({ allowed: true });
      expect(ask({ permission, verb: "dismiss" })).toEqual({ allowed: true });
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
    expect(ask({ permission: "unknown", verb: "dismiss" })).toEqual({
      allowed: false,
      reason: "unknown",
    });
  });

  it("will not let the pull request's author dismiss the accusation against it", () => {
    // The scenario the product exists for is hostile code in a pull request,
    // and repo write includes whoever opened it. A denied gate posts nothing,
    // so this is the direction that buries the finding.
    expect(ask({ verb: "dismiss", actor: "author", prAuthor: "author" })).toEqual({
      allowed: false,
      reason: "author_may_not_dismiss",
    });
  });

  it("lets the author confirm, because acting against your own interest needs no guard", () => {
    expect(ask({ verb: "confirm", actor: "author", prAuthor: "author" })).toEqual({
      allowed: true,
    });
  });

  it("matches the author regardless of casing, since GitHub logins are case-insensitive", () => {
    expect(ask({ verb: "dismiss", actor: "OctoCat", prAuthor: "octocat" })).toEqual({
      allowed: false,
      reason: "author_may_not_dismiss",
    });
  });

  it("checks the permission before the author rule", () => {
    // A fork contributor dismissing their own pull request is refused for the
    // reason that generalises, not the one that happens to also apply.
    expect(
      ask({ verb: "dismiss", permission: "read", actor: "author", prAuthor: "author" }),
    ).toEqual({ allowed: false, reason: "not_a_maintainer" });
  });

  it("refuses every permission it does not recognise as push access", () => {
    const every: RepoPermission[] = ["admin", "write", "read", "none", "unknown"];
    const allowed = every.filter((permission) => ask({ permission }).allowed);
    expect(allowed).toEqual(["admin", "write"]);
  });
});
