import { fnv1a, uniforms } from "@/lib/board/hash";
import { describe, expect, it } from "vitest";

/**
 * One hash seeds a run's place and its tilts. The claim worth pinning is the
 * one that was false the first time: that successive draws from one id are
 * actually different numbers, and not one number plus a rounding error.
 */

const IDS = ["run-1", "a", "0f3c9e", "owner/repo#42:abc", "key", "z".repeat(40)];

describe("fnv1a", () => {
  it("is stable and well known", () => {
    // The FNV-1a 32-bit offset basis is the hash of the empty string.
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
  });
});

describe("uniforms", () => {
  it("draws the number asked for, each in [0, 1)", () => {
    for (const id of IDS) {
      const draws = uniforms(id, 9);
      expect(draws).toHaveLength(9);
      for (const d of draws) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(1);
      }
    }
    expect(uniforms("run-1", 0)).toEqual([]);
  });

  it("is a function of the id alone", () => {
    for (const id of IDS) expect(uniforms(id, 9)).toEqual(uniforms(id, 9));
  });

  it("keeps successive draws from one id well apart", () => {
    // Rehashing `id:2`, `id:3`, ... with FNV-1a alone put the draws a few
    // parts in a million apart, so four ring leans seeded that way were one
    // lean. Two draws may still land near each other by chance; seven of them
    // spanning less than a third of the interval cannot, for any id.
    for (const id of IDS) {
      const draws = uniforms(id, 9).slice(2);
      expect(Math.max(...draws) - Math.min(...draws)).toBeGreaterThan(0.3);
    }
  });

  it("keeps the first two draws as the halves of the id's own hash", () => {
    // `galaxy.ts` placed runs off these before there was a shared hash, and a
    // run must not move because the tilts arrived.
    const h = fnv1a("run-1");
    const [a, b] = uniforms("run-1", 2);
    expect(a).toBe((h & 0xffff) / 0x10000);
    expect(b).toBe(((h >>> 16) & 0xffff) / 0x10000);
  });
});
