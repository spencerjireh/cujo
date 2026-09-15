import {
  SESSION_COOKIE,
  planeOf,
  sessionCookie,
  sessionFromCookie,
  verbAllowed,
} from "@/lib/api/owner";
import { describe, expect, it } from "vitest";

describe("the proxy's owner half (decision 153)", () => {
  it("knows the two planes and nothing else", () => {
    expect(planeOf(["public", "runs"])).toBe("public");
    expect(planeOf(["owner", "settings"])).toBe("owner");
    expect(planeOf(["auth", "login"])).toBeNull();
    expect(planeOf(["publicity"])).toBeNull();
    expect(planeOf([])).toBeNull();
  });

  it("lets the board read and the owner write", () => {
    expect(verbAllowed("public", "GET")).toBe(true);
    expect(verbAllowed("public", "PATCH")).toBe(false);
    expect(verbAllowed("owner", "PATCH")).toBe(true);
    expect(verbAllowed("owner", "PUT")).toBe(false);
  });

  it("reads only the session cookie, only in the shape the server issues", () => {
    const id = "a".repeat(64);
    expect(sessionFromCookie(`theme=dark; ${SESSION_COOKIE}=${id}; x=y`)).toBe(id);
    expect(sessionFromCookie(`${SESSION_COOKIE}=short`)).toBeNull();
    expect(sessionFromCookie("theme=dark")).toBeNull();
    expect(sessionFromCookie(null)).toBeNull();
  });

  it("issues a cookie the browser keeps for a week, and one that clears it", () => {
    const id = "b".repeat(64);
    expect(sessionCookie(id, true)).toBe(
      `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`,
    );
    expect(sessionCookie(null, false)).toBe(
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  });
});
