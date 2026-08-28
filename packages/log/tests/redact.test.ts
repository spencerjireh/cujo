/**
 * The sentinel sweep, adapted from the public serializer's (decision 34).
 *
 * There it catches a withheld field nested inside a value. Here that failure
 * is structurally impossible — a field value is a scalar — so the sweep is
 * aimed at what a scalar *can* still carry: a secret inside a string somebody
 * was entitled to log.
 */

import { describe, expect, it } from "vitest";
import { CAP } from "../src/fields";
import { REDACTED, TRUNCATED, scrub } from "../src/redact";

/**
 * Every fixture is assembled from parts, and the bodies are deliberately dull.
 * The reason is worth stating, because the obvious tidy-up undoes both halves.
 *
 * A scrubber can only be tested by the shape it claims to match, so these have
 * to carry a real prefix. But a file holding something that *looks* like a live
 * credential is a file the scanners block, and they were right to: push
 * protection stopped this commit on a key prefix and a bot token, and
 * GitGuardian then stopped it on the PEM header. Two rules keep both sides
 * happy — no complete credential-shaped literal appears in the source, and the
 * random-looking parts are low-entropy filler, because entropy is the other
 * half of what a scanner scores.
 */
const join = (...parts: readonly string[]) => parts.join("");

/** Built rather than written, so the header never appears as a literal. */
const pemEdge = (edge: "BEGIN" | "END") => join("-----", edge, " RSA PRIVATE KEY", "-----");

const PEM = [pemEdge("BEGIN"), "AAAABBBB".repeat(8), "CCCCDDDD".repeat(8), pemEdge("END")].join(
  "\n",
);

const SECRETS: Record<string, string> = {
  "a PEM private key": PEM,
  "a GitHub installation token": join("ghs", "_", "0123456789abcdef0123456789abcdef0123"),
  "a GitHub user token": join("ghu", "_", "abcdef0123456789abcdef0123456789abcd"),
  "a fine-grained PAT": join("github", "_pat_", "11AAAAAAAA0aaaaaaaaaa_bbbbbbbbbbbbbbbbbbbb"),
  "a JWT": join("eyJ", "hbGciOiJIUzI1NiJ9", ".eyJhIjoxfQ", ".c2lnbmF0dXJlAAAA"),
  "a bearer header": join("Authorization: Bearer ", "aaaaaaaabbbbbbbbccccccccdddddddd"),
  "a model provider key": join("sk", "-", "or-v1-0123456789abcdef0123456789abcdef"),
  "a Discord bot token": join("MAAAAAAAABBBBBBBBCCCCCCC", ".DDDDDD", ".EEEEEEEEEEEEEEEEEEEEEEEEE"),
};

describe("scrub", () => {
  for (const [what, secret] of Object.entries(SECRETS)) {
    it(`replaces ${what}`, () => {
      const out = scrub(`upstream said: ${secret} (status 401)`, CAP.text);
      expect(out).toContain(REDACTED);
      // Not just "the whole string changed": no meaningful run of the original
      // may survive, because a partial credential is still a credential to
      // somebody who holds the rest.
      const longest = secret.split(/[\s\n]+/).sort((a, b) => b.length - a.length)[0] ?? "";
      expect(out).not.toContain(longest.slice(0, 12));
    });
  }

  it("leaves an ordinary message byte-identical", () => {
    // A scrubber that mangles normal text is a scrubber somebody turns off.
    const benign = "run 7f3a: check `tests` finished in 4210 ms with 2 findings (1 critical)";
    expect(scrub(benign, CAP.text)).toBe(benign);
  });

  it("truncates past the cap, and says that it did", () => {
    const long = "x".repeat(CAP.text + 50);
    const out = scrub(long, CAP.text);
    expect(out).toHaveLength(CAP.text + TRUNCATED.length);
    expect(out.endsWith(TRUNCATED)).toBe(true);
  });

  it("redacts before it truncates, so a cap cannot print the front of a secret", () => {
    // Derived from the fixture rather than written out, so changing a fixture
    // cannot leave this passing for the wrong reason.
    const token = SECRETS["a GitHub installation token"] as string;
    const out = scrub(`${token} ${"tail ".repeat(400)}`, CAP.id);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(token.slice(0, 12));
  });

  it("does not truncate when the class has no cap", () => {
    const long = "y".repeat(5_000);
    expect(scrub(long, CAP.count)).toBe(long);
  });

  it("replaces every occurrence, not only the first", () => {
    const token = SECRETS["a GitHub user token"] as string;
    const out = scrub(`${token} then again ${token}`, CAP.text);
    expect(out).not.toContain("ghu_");
    expect(out.split(REDACTED)).toHaveLength(3);
  });
});
