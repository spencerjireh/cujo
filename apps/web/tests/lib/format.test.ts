import { bytes, duration, elapsedMs, prUrl, relativeTime, shortSha } from "@/lib/format";
import { describe, expect, it } from "vitest";

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
