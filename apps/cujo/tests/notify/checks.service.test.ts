import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import type { CheckPayload, GitHubChecks } from "../../src/clients/github-checks";
import { PrChecks, type PrChecksDeps } from "../../src/notify/checks.service";
import { emptyProjection } from "../../src/review/fold";
import type { RunView } from "../../src/review/runner.service";
import type { Finding, RunRecord, RunStatus } from "../../src/review/types";

const silentLog = createLogger({ service: "cujo", sink: () => {} });
/** Every status, spelled out here so a new one fails this file until mapped. */
const RUN_STATUSES: RunStatus[] = [
  "running",
  "clean",
  "unproven",
  "blocked",
  "dismissed",
  "error",
  "superseded",
];
const LINKS = { publicBaseUrl: "https://cujo.example.com" };

const run = (status: RunStatus, over: Partial<RunRecord> = {}): RunRecord => ({
  id: "run-1",
  repo: "o/r",
  prNumber: 7,
  headSha: "h",
  sessionId: "sess-1",
  deliveryId: null,
  model: null,
  rubricSha256: null,
  mode: "sandbox",
  budgetTokens: null,
  prTitle: null,
  prAuthorLogin: null,
  prAuthorId: null,
  turnIds: [],
  status,
  approver: null,
  decidedAt: null,
  isPublic: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const critical: Finding = {
  source: "hard_rule",
  check: "tests",
  severity: "critical",
  title: "a test fails on head",
  evidence: "t_x",
};

const view = (
  status: RunStatus,
  over: Partial<RunRecord> = {},
  findings: Finding[] = [],
): RunView => ({
  run: run(status, over),
  projection: { ...emptyProjection(), status, findings },
});

function fake(write?: () => Promise<void>) {
  const writes: { sha: string; payload: CheckPayload; knownId: number | null }[] = [];
  let next = 500;
  const checks = {
    write: vi.fn(
      async (_repo: string, sha: string, payload: CheckPayload, knownId: number | null) => {
        writes.push({ sha, payload, knownId });
        await write?.();
        return knownId ?? next++;
      },
    ),
  } as unknown as GitHubChecks;
  return { checks, writes };
}

const build = (checks: GitHubChecks, extra: Partial<PrChecksDeps> = {}) =>
  new PrChecks({
    log: silentLog,
    checks,
    links: LINKS,
    runs: { runForPrHead: () => run("superseded") },
    retryDelaysMs: [],
    ...extra,
  });

describe("PrChecks", () => {
  it("writes an in-progress check on the head as soon as the run is claimed", async () => {
    const { checks, writes } = fake();
    const service = build(checks);
    service.markClaimed(run("running"));
    await service.flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.sha).toBe("h");
    expect(writes[0]?.payload).toMatchObject({
      runId: "run-1",
      status: "in_progress",
      detailsUrl: "https://cujo.example.com/runs/run-1",
    });
  });

  it("maps every status, and gives each verdict its conclusion", async () => {
    const { checks, writes } = fake();
    const service = build(checks);
    for (const status of RUN_STATUSES) {
      if (status === "superseded") continue;
      service.onRunChanged(view(status, { id: `run-${status}` }, [critical]));
    }
    await service.flush();
    const by = Object.fromEntries(writes.map((w) => [w.payload.runId, w.payload]));
    expect(by["run-running"]).toMatchObject({ status: "in_progress" });
    expect(by["run-clean"]).toMatchObject({ status: "completed", conclusion: "success" });
    expect(by["run-unproven"]).toMatchObject({ status: "completed", conclusion: "neutral" });
    expect(by["run-blocked"]).toMatchObject({ status: "completed", conclusion: "failure" });
    expect(by["run-dismissed"]).toMatchObject({ status: "completed", conclusion: "neutral" });
    expect(by["run-error"]).toMatchObject({ status: "completed", conclusion: "neutral" });
    expect(by["run-blocked"]?.output.summary).toBe("1 critical, 0 warn, 0 info.");
  });

  it("titles a dismissed check with who lifted it, as a login", async () => {
    const { checks, writes } = fake();
    const service = build(checks);
    service.onRunChanged(view("dismissed", { approver: "github:octocat" }));
    await service.flush();
    expect(writes[0]?.payload.output.title).toBe("Dismissed by @octocat");
  });

  it("links nothing for a private run", async () => {
    const { checks, writes } = fake();
    const service = build(checks);
    service.onRunChanged(view("clean", { isPublic: false }));
    await service.flush();
    expect(writes[0]?.payload.detailsUrl).toBeNull();
  });

  it("writes once per payload, so a fold storm costs one call", async () => {
    const { checks, writes } = fake();
    const service = build(checks);
    service.markClaimed(run("running"));
    service.onRunChanged(view("running"));
    service.onRunChanged(view("running"));
    service.onRunChanged(view("blocked", {}, [critical]));
    await service.flush();
    expect(writes.map((w) => w.payload.status)).toEqual(["in_progress", "completed"]);
    // The id from the first write is reused, so the second read nothing.
    expect(writes[1]?.knownId).toBe(500);
  });

  it("writes skipped for a superseded run only while it is still the latest for its head", async () => {
    const { checks, writes } = fake();
    const old = run("superseded", { id: "old" });
    const latest = build(checks, { runs: { runForPrHead: () => old } });
    latest.onRunChanged({ run: old, projection: emptyProjection() });
    await latest.flush();
    expect(writes[0]?.payload).toMatchObject({ status: "completed", conclusion: "skipped" });

    // `/cujo review`: a newer run owns the same commit and writes its own.
    const replaced = build(checks, { runs: { runForPrHead: () => run("running", { id: "new" }) } });
    replaced.onRunChanged({ run: old, projection: emptyProjection() });
    await replaced.flush();
    expect(writes).toHaveLength(1);
  });

  it("retries a failed write and gives up without throwing", async () => {
    let calls = 0;
    const { checks, writes } = fake(async () => {
      calls += 1;
      if (calls < 3) throw new Error("403");
    });
    const service = build(checks, { retryDelaysMs: [0, 0], sleepImpl: async () => {} });
    service.onRunChanged(view("clean"));
    await service.flush();
    expect(writes).toHaveLength(3);

    const failing = fake(async () => {
      throw new Error("403");
    });
    const gaveUp = build(failing.checks, { retryDelaysMs: [0], sleepImpl: async () => {} });
    gaveUp.onRunChanged(view("clean"));
    await gaveUp.flush();
    expect(failing.writes).toHaveLength(2);
    // A later status tries again: the key was forgotten with the failure.
    gaveUp.onRunChanged(view("clean"));
    await gaveUp.flush();
    expect(failing.writes).toHaveLength(4);
  });

  it("never throws into the fold path", () => {
    const { checks } = fake(async () => {
      throw new Error("boom");
    });
    const service = build(checks);
    expect(() => service.onRunChanged(view("clean"))).not.toThrow();
    expect(() => service.onRunChanged(null)).not.toThrow();
  });
});
