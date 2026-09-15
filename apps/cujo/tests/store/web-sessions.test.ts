import { describe, expect, it } from "vitest";
import { Store } from "../../src/store";
import { LOGIN_TTL_MS, SESSION_TTL_MS } from "../../src/store/web-sessions";

const t0 = new Date("2026-09-15T12:00:00.000Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

describe("web sessions (decision 153)", () => {
  it("issues a state that can be finished once, and only while young", () => {
    const store = new Store(":memory:");
    const state = store.webSessions.startLogin(t0);
    expect(state).toMatch(/^[0-9a-f]{48}$/);
    expect(store.webSessions.finishLogin("not-a-state", t0)).toBe(false);
    expect(store.webSessions.finishLogin(state, later(LOGIN_TTL_MS - 1))).toBe(true);
    // Consumed: a second finish with the same state is refused.
    expect(store.webSessions.finishLogin(state, t0)).toBe(false);
    const stale = store.webSessions.startLogin(t0);
    expect(store.webSessions.finishLogin(stale, later(LOGIN_TTL_MS + 1))).toBe(false);
  });

  it("creates a session the browser id finds, hashed at rest, until it expires", () => {
    const store = new Store(":memory:");
    const id = store.webSessions.create({ login: "octocat", userId: 583231, isOwner: true }, t0);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(store.webSessions.get(id, later(1000))).toEqual({
      login: "octocat",
      userId: 583231,
      isOwner: true,
      createdAt: t0.toISOString(),
      expiresAt: later(SESSION_TTL_MS).toISOString(),
    });
    expect(store.webSessions.get(id, later(SESSION_TTL_MS))).toBeNull();
    expect(store.webSessions.get("c".repeat(64), t0)).toBeNull();
    expect(store.webSessions.delete(id)).toBe(true);
    expect(store.webSessions.delete(id)).toBe(false);
    expect(store.webSessions.get(id, t0)).toBeNull();
  });

  it("sweeps what has expired and leaves the rest", () => {
    const store = new Store(":memory:");
    const live = store.webSessions.create(
      { login: "a", userId: 1, isOwner: false },
      later(SESSION_TTL_MS - 1000),
    );
    store.webSessions.create({ login: "b", userId: 2, isOwner: false }, t0);
    store.webSessions.startLogin(t0);
    expect(store.webSessions.sweep(later(SESSION_TTL_MS + 1))).toBe(2);
    expect(store.webSessions.get(live, later(SESSION_TTL_MS + 1))).not.toBeNull();
  });
});
