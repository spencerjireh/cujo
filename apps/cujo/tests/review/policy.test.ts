/**
 * `.cujo.yml` as the executor reads it (decision 161): the spec's keys, the
 * spec's types, and nothing a malformed file can do but send the run down
 * the gather path.
 */
import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { parsePolicy, readPolicy } from "../../src/review/policy";

describe("parsePolicy", () => {
  it("reads the commands and the allowlist, and ignores keys it does not know", () => {
    const text = [
      "install: uv sync",
      "test: uv run pytest -q",
      "boot: uv run uvicorn app:app --port 8000",
      "smoke:",
      "  - GET /health",
      "  - GET /orders/1",
      "allow_hosts:",
      "  - API.Stripe.com",
      "mode: diff",
      'discord_guild: "1234"',
    ].join("\n");
    expect(parsePolicy(text)).toEqual({
      policy: {
        install: "uv sync",
        test: "uv run pytest -q",
        boot: "uv run uvicorn app:app --port 8000",
        smoke: ["GET /health", "GET /orders/1"],
        allowHosts: ["api.stripe.com"],
      },
    });
  });

  it("is a policy with no commands for an empty file, and only the keys present otherwise", () => {
    expect(parsePolicy("")).toEqual({ policy: { allowHosts: [] } });
    expect(parsePolicy("test: make test\n")).toEqual({
      policy: { test: "make test", allowHosts: [] },
    });
  });

  it("refuses a key of the wrong shape, naming it", () => {
    expect(parsePolicy("test:\n  - pytest\n")).toMatchObject({
      problem: expect.stringContaining("test"),
    });
    expect(parsePolicy("smoke: GET /health\n")).toMatchObject({
      problem: expect.stringContaining("smoke"),
    });
    expect(parsePolicy("test: ''\n")).toMatchObject({ problem: expect.stringContaining("test") });
  });

  it("refuses an allowlist the sandbox service would refuse", () => {
    expect(parsePolicy("test: x\nallow_hosts:\n  - https://pypi.org\n")).toMatchObject({
      problem: expect.stringContaining("scheme"),
    });
  });

  it("refuses what is not YAML or not a mapping", () => {
    expect(parsePolicy("- a\n- b\n")).toEqual({ problem: "not a mapping" });
    expect(parsePolicy("test: [unclosed\n")).toMatchObject({
      problem: expect.stringContaining("not YAML"),
    });
  });
});

describe("readPolicy", () => {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({ service: "cujo", sink: (line) => lines.push(JSON.parse(line)) });

  it("reads the file at the ref, and is null with a line when it cannot be acted on", async () => {
    const github = { readFile: vi.fn(async () => "test: pytest\n") };
    expect(await readPolicy(github, log, "o/r", "base")).toEqual({
      test: "pytest",
      allowHosts: [],
    });
    expect(github.readFile).toHaveBeenCalledWith("o/r", ".cujo.yml", "base");
    const broken = { readFile: vi.fn(async () => "test: [\n") };
    expect(await readPolicy(broken, log, "o/r", "base")).toBeNull();
    expect(lines.find((l) => l.event === "policy.invalid")).toMatchObject({ repo: "o/r" });
  });

  it("is null and silent for a repository with no file", async () => {
    const before = lines.length;
    expect(await readPolicy({ readFile: vi.fn(async () => null) }, log, "o/r", "b")).toBeNull();
    expect(lines.length).toBe(before);
  });
});
