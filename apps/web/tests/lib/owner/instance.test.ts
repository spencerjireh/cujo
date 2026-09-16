import type { BotState } from "@/lib/api/owner-client";
import {
  changedKeys,
  deliveryTone,
  describeHealth,
  describePermissions,
} from "@/lib/owner/instance";
import { describe, expect, it } from "vitest";

describe("the instance page's sentences (decision 157)", () => {
  it("names what the App is short of, or says it holds everything", () => {
    const all: BotState["permissions"] = [
      { name: "contents", needed: "read", held: "read", ok: true },
      { name: "checks", needed: "write", held: "write", ok: true },
    ];
    expect(describePermissions(all)).toContain("every permission");
    const short: BotState["permissions"] = [
      { name: "checks", needed: "write", held: "read", ok: false },
      { name: "issues", needed: "read", held: null, ok: false },
    ];
    const line = describePermissions(short);
    expect(line).toContain("checks (write, holds read)");
    expect(line).toContain("issues (read, holds none)");
  });

  it("colours a delivery by what this process answered", () => {
    const base = {
      id: 1,
      event: "pull_request",
      action: "opened",
      deliveredAt: "t",
      status: "OK",
      durationS: 0.1,
      redelivery: false,
    };
    expect(deliveryTone({ ...base, statusCode: 202 })).toBe("ok");
    expect(deliveryTone({ ...base, statusCode: 503 })).toBe("warn");
    expect(deliveryTone({ ...base, statusCode: 500 })).toBe("critical");
    expect(deliveryTone({ ...base, statusCode: null })).toBe("critical");
  });

  it("says what the process is waiting on", () => {
    expect(describeHealth({ harness: "ready", store: "ok", uptimeMs: 1, ready: true })).toContain(
      "Ready",
    );
    expect(
      describeHealth({ harness: "bootstrapping", store: "ok", uptimeMs: 1, ready: false }),
    ).toContain("harness");
    expect(
      describeHealth({ harness: "ready", store: "error", uptimeMs: 1, ready: false }),
    ).toContain("store");
  });

  it("lists the keys an owner changed", () => {
    expect(
      changedKeys({
        model: "owner",
        modelReasoningEffort: "seed",
        modelTemperature: "seed",
        modelMaxTokens: "seed",
        diffModel: "owner",
        diffBudgetTokens: "seed",
        reviewMode: "seed",
        modelProvider: "seed",
        turnTimeoutMs: "owner",
        diffTimeoutMs: "seed",
        diffBytes: "seed",
        pushDebounceMs: "seed",
        converseLimit: "seed",
        converseWindowMs: "seed",
        converseTimeoutMs: "seed",
        ocrEnabled: "seed",
      }),
    ).toEqual(["model", "diffModel", "turnTimeoutMs"]);
  });
});
