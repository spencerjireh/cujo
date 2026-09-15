import { describe, expect, it, vi } from "vitest";
import { resolveOwner } from "../../src/auth/owner";
import type { OAuthInstallation } from "../../src/clients/github-oauth";

const me = { login: "octocat", id: 1 };
const mine: OAuthInstallation = {
  id: 10,
  appId: 7,
  account: { login: "octocat", id: 1, type: "User" },
};
const theirs: OAuthInstallation = {
  id: 11,
  appId: 7,
  account: { login: "hubot", id: 9, type: "User" },
};
const org: OAuthInstallation = {
  id: 12,
  appId: 7,
  account: { login: "acme", id: 2, type: "Organization" },
};
const otherApp: OAuthInstallation = {
  id: 13,
  appId: 99,
  account: { login: "octocat", id: 1, type: "User" },
};

describe("resolveOwner (decision 153)", () => {
  it("is the account itself for a user installation, and an org admin for an org one", async () => {
    const orgRole = vi.fn(async (_t: string, o: string) =>
      o === "acme" ? ("admin" as const) : null,
    );
    const verdict = await resolveOwner(7, me, [mine, theirs, org, otherApp], { orgRole }, "tok");
    expect(verdict).toEqual({ isOwner: true, through: ["octocat", "acme"] });
    // Only the organisation needed asking; user installations decide by id, the other App is ignored.
    expect(orgRole).toHaveBeenCalledTimes(1);
  });

  it("is not an owner as a member, a stranger, or with no installation of this App", async () => {
    const member = await resolveOwner(7, me, [org], { orgRole: async () => "member" }, "tok");
    expect(member).toEqual({ isOwner: false, through: [] });
    const stranger = await resolveOwner(
      7,
      me,
      [theirs, otherApp],
      { orgRole: async () => "admin" },
      "tok",
    );
    expect(stranger).toEqual({ isOwner: false, through: [] });
    expect(await resolveOwner(7, me, [], { orgRole: async () => "admin" }, "tok")).toEqual({
      isOwner: false,
      through: [],
    });
  });
});
