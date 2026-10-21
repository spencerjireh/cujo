import { GET } from "@/app/api/auth/callback/route";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Every way a sign-in can end goes home (decision 153): with the session
 * cookie when it worked, and with a reason in the query when it did not, so
 * nobody is left on this URL reading JSON.
 */

vi.mock("@/lib/api/client", () => ({ CUJO_API_URL: () => "http://cujo.test" }));

const callback = (query: string) =>
  GET(new Request(`https://cujo.example/api/auth/callback?${query}`));

function upstream(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the sign-in callback", () => {
  it("sets the session and goes home when cujo accepts the code", async () => {
    upstream(200, { ok: true, session: "a".repeat(64), login: "octocat", is_owner: true });
    const res = await callback("code=c&state=s");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("a".repeat(64));
  });

  it("says expired when cujo refuses the state", async () => {
    upstream(400, { ok: false, error: "sign-in expired or was not started here" });
    const res = await callback("code=c&state=old");
    expect(res.headers.get("location")).toBe("/?signin=expired");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("says failed when GitHub did not complete it", async () => {
    upstream(502, { ok: false, error: "GitHub did not complete the sign-in" });
    expect((await callback("code=c&state=s")).headers.get("location")).toBe("/?signin=failed");
  });

  it("says failed when cujo cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect((await callback("code=c&state=s")).headers.get("location")).toBe("/?signin=failed");
  });

  it("says failed when the person cancelled on GitHub", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await callback("error=access_denied&state=s");
    expect(res.headers.get("location")).toBe("/?signin=failed");
    expect(fetch).not.toHaveBeenCalled();
  });
});
