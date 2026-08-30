/**
 * The backstop that rewrites a finding title which is still a Contract 2 field
 * name (decision 74).
 *
 * The rubric asks for a plain title too. The interesting tests here are the
 * negative ones: this must never fire on a title somebody wrote on purpose,
 * because rewriting prose is editing a claim rather than translating jargon.
 */

import { describe, expect, it } from "vitest";
import { plainTitle } from "../src/plain-title";

/**
 * Every hard-rule title `apps/cujo/src/review/findings.ts` builds, copied here
 * verbatim. Those findings have carried plain language since they were written
 * and keep the field name in `evidence`; if this backstop ever rewrote one, it
 * would be replacing a sentence that names its check with one that does not.
 */
const HARD_RULE_TITLES = [
  "the decoy sensor was not watching during tests",
  "1 test passes on base and fails on head",
  "3 tests pass on base and fail on head",
  "the seeded decoy secret was read during detonation",
  "the seeded decoy secret left the sandbox during smoke",
  "a write landed in a sensitive path during detonation",
  "an install contacted a host that is neither a package index nor allowlisted",
  "the tests check returned no report",
  "the probes report does not match the report schema",
];

describe("plainTitle", () => {
  it("rewrites a title that is nothing but a field name", () => {
    expect(plainTitle("secret_probe.decoy_read").title).toBe("the seeded decoy secret was read");
    expect(plainTitle("derived.wrote_sensitive").title).toBe("a write landed in a sensitive path");
    expect(plainTitle("base_pass_head_fail").title).toBe("a test passes on base and fails on head");
  });

  it("rewrites the shapes a model actually writes: backticks, colons, booleans", () => {
    // orders-api #19 posted the first of these as a finding title.
    for (const written of [
      "secret_probe.decoy_read: true",
      "`secret_probe.decoy_read`",
      "secret_probe.decoy_read = true",
      "secret_probe.decoy_read is true",
      "  secret_probe.decoy_read: true.  ",
    ]) {
      expect(plainTitle(written).title).toBe("the seeded decoy secret was read");
      expect(plainTitle(written).translated).toBe(true);
    }
  });

  it("keeps the raw expression, so the evidence can still carry it", () => {
    const result = plainTitle("secret_probe.decoy_read: true");
    expect(result.raw).toBe("secret_probe.decoy_read: true");
  });

  it("leaves every hard-rule title exactly as it was written", () => {
    for (const title of HARD_RULE_TITLES) {
      expect(plainTitle(title)).toEqual({ title, translated: false });
    }
  });

  it("leaves a sentence that merely mentions a field alone", () => {
    // A title with a field name in it is a title somebody wrote. Only a title
    // that *is* the field name is jargon standing in for a claim.
    const written = "`secret_probe.decoy_read` was true during the install";
    expect(plainTitle(written)).toEqual({ title: written, translated: false });
  });

  it("returns an unknown dotted key unchanged rather than guessing a sentence", () => {
    // Inventing prose here would be the renderer making a claim about somebody
    // else's pull request. Better a reader sees jargon and asks.
    expect(plainTitle("derived.some_future_flag")).toEqual({
      title: "derived.some_future_flag",
      translated: false,
    });
  });
});
