/**
 * The egress allowlist (decision 116).
 *
 * This list used to reach a process inside the sandbox, where getting it wrong
 * could only weaken a control the pull request already sat beside. It now
 * configures a gateway outside the sandbox, so the same untrusted text is one
 * step from the thing that decides what the box may dial. Every case here is a
 * shape a `.cujo.yml` could plausibly hold.
 */

import { describe, expect, it } from "vitest";
import { validateAllowlist } from "../src/allowlist";

describe("validateAllowlist", () => {
  it("takes an absent list as no hosts rather than an error", () => {
    // A repository with no `allow_hosts` key is the common case, not a mistake.
    expect(validateAllowlist(undefined)).toEqual({ ok: true, hosts: [] });
    expect(validateAllowlist(null)).toEqual({ ok: true, hosts: [] });
  });

  it("lowercases, trims and de-duplicates, keeping the order sent", () => {
    expect(validateAllowlist([" API.Stripe.com ", "api.stripe.com", "pypi.org"])).toEqual({
      ok: true,
      hosts: ["api.stripe.com", "pypi.org"],
    });
  });

  it.each([
    ["https://api.stripe.com", "scheme"],
    ["api.stripe.com/v1", "path or a CIDR"],
    ["10.0.0.0/8", "path or a CIDR"],
    ["api.stripe.com:443", "port"],
    ["*.stripe.com", "wildcard"],
    ["user@api.stripe.com", "credentials"],
    ["localhost", "not a fully qualified hostname"],
    ["93.184.216.34", "is an address"],
    ["", "is empty"],
    ["-leading.example.com", "invalid label"],
  ])("refuses %s rather than repairing it", (host, because) => {
    const result = validateAllowlist([host]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain(because);
  });

  it("refuses a newline, which would make one entry two", () => {
    // The gateway receives this list as one argv entry; a newline inside it
    // would be a second rule nobody wrote.
    const result = validateAllowlist(["api.stripe.com\nevil.example.com"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain("control character");
  });

  it("refuses a list that is not a list", () => {
    expect(validateAllowlist("api.stripe.com").ok).toBe(false);
    expect(validateAllowlist({ host: "api.stripe.com" }).ok).toBe(false);
  });

  it("refuses a non-string entry", () => {
    const result = validateAllowlist(["api.stripe.com", 443]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain("has to be a string");
  });

  it("refuses a list longer than a dependency set plausibly is", () => {
    const many = Array.from({ length: 33 }, (_, i) => `h${i}.example.com`);
    expect(validateAllowlist(many).ok).toBe(false);
  });

  it("names the entry it refused, so a repository can fix the right line", () => {
    const result = validateAllowlist(["pypi.org", "https://files.pythonhosted.org"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.host).toBe("https://files.pythonhosted.org");
  });
});
