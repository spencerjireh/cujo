import {
  avatarUrl,
  bytes,
  compactCount,
  duration,
  elapsedMs,
  prUrl,
  profileUrl,
  relativeTime,
  shortSha,
  usd,
} from "@/lib/format";
import { describe, expect, it } from "vitest";

describe("compactCount", () => {
  it("keeps a small count exact", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(940)).toBe("940");
  });

  it("shortens thousands and millions", () => {
    expect(compactCount(1_000)).toBe("1.0k");
    expect(compactCount(12_400)).toBe("12.4k");
    expect(compactCount(1_250_000)).toBe("1.3M");
  });
});

describe("usd", () => {
  it("gives a sub-cent estimate the places it needs", () => {
    // `$0.00` beside a real figure reads as free, which is the one thing this
    // number must never say by accident.
    expect(usd(0.0037)).toBe("$0.0037");
    expect(usd(0)).toBe("$0.00");
  });

  it("bounds an estimate too small for four places instead of rounding it away", () => {
    // Four decimals moved the failure down rather than fixing it: a call
    // priced at three hundredths of a cent still rendered `$0.0000`, which is
    // the same lie about the same number.
    expect(usd(0.00003)).toBe("<$0.0001");
    expect(usd(0.000_000_9)).toBe("<$0.0001");
    // The boundary itself is representable, so it is printed.
    expect(usd(0.0001)).toBe("$0.0001");
  });

  it("uses cents above a cent", () => {
    expect(usd(0.37)).toBe("$0.37");
    expect(usd(12.5)).toBe("$12.50");
  });
});

describe("duration", () => {
  it("formats minutes and seconds", () => {
    expect(duration("2026-08-28T10:00:00Z", "2026-08-28T10:01:48Z")).toBe("1m 48s");
    expect(duration("2026-08-28T10:00:00Z", "2026-08-28T10:00:52Z")).toBe("52s");
  });

  it("returns null when a timestamp is missing or nonsensical", () => {
    // A run recorded before apps/cujo stamped these fields has neither, and the
    // timeline has to render anyway.
    expect(duration(null, "2026-08-28T10:00:00Z")).toBeNull();
    expect(duration("2026-08-28T10:00:00Z", null)).toBeNull();
    expect(duration("nonsense", "2026-08-28T10:00:00Z")).toBeNull();
    expect(duration("2026-08-28T10:01:00Z", "2026-08-28T10:00:00Z")).toBeNull();
  });
});

describe("elapsedMs", () => {
  it("measures a closed interval", () => {
    expect(elapsedMs("2026-08-28T10:00:00Z", "2026-08-28T10:00:10Z")).toBe(10_000);
  });

  it("returns null without a start", () => {
    expect(elapsedMs(null, "2026-08-28T10:00:10Z")).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-28T12:00:00Z");

  it("scales the unit to the distance", () => {
    expect(relativeTime("2026-08-28T11:59:30Z", now)).toBe("30 seconds ago");
    expect(relativeTime("2026-08-28T11:30:00Z", now)).toBe("30 minutes ago");
    expect(relativeTime("2026-08-28T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-08-26T12:00:00Z", now)).toBe("2 days ago");
  });

  it("does not throw on an unparseable timestamp", () => {
    expect(relativeTime("nope", now)).toBe("unknown");
  });
});

describe("misc formatting", () => {
  it("shortens a sha", () => {
    expect(shortSha("a1f9c3e4d5b6")).toBe("a1f9c3e");
  });

  it("scales byte counts", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(3200)).toBe("3.1 kB");
    expect(bytes(5_242_880)).toBe("5.0 MB");
    expect(bytes(undefined)).toBe("");
  });

  it("builds the pull request url", () => {
    expect(prUrl("o/r", 7)).toBe("https://github.com/o/r/pull/7");
  });
});

describe("the author of a pull request", () => {
  it("builds an avatar url from the account id, at twice the rendered width", () => {
    expect(avatarUrl(583231, 20)).toBe("https://avatars.githubusercontent.com/u/583231?s=40");
  });

  it("has no avatar without an id, including for a deleted account", () => {
    expect(avatarUrl(null)).toBeNull();
    expect(avatarUrl(undefined)).toBeNull();
  });

  it("links a login GitHub could actually have issued", () => {
    expect(profileUrl("octocat")).toBe("https://github.com/octocat");
    expect(profileUrl("a-b-9")).toBe("https://github.com/a-b-9");
  });

  it("links nothing else, so no login of any shape becomes a url", () => {
    // A bot is the real case: its profile is at /apps/<name>, not /<login>.
    for (const login of [
      "dependabot[bot]",
      "a b",
      "-lead",
      "a_b",
      "o/r",
      "https://evil.example",
      "x".repeat(40),
      "",
      null,
      undefined,
    ]) {
      expect(profileUrl(login), String(login)).toBeNull();
    }
  });
});
