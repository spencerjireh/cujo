import { describe, expect, it } from "vitest";
import type { Fields } from "../src/fields";
import { createLogger, logFailureCount } from "../src/logger";

const AT = "2026-08-28T00:00:00.000Z";

function build(overrides: { level?: "debug" | "info" | "warn" | "error" } = {}) {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "cujo",
    now: () => AT,
    sink: (line) => lines.push(JSON.parse(line)),
    ...overrides,
  });
  return { log, lines, last: () => lines[lines.length - 1] ?? {} };
}

describe("a log line", () => {
  it("is one JSON object with the reserved keys always present", () => {
    const { log, last } = build();
    log.info("service.started", { port: 8080 });
    expect(last()).toEqual({
      ts: AT,
      level: "info",
      service: "cujo",
      event: "service.started",
      port: 8080,
    });
  });

  it("puts the reserved keys first, so a raw grep is stable", () => {
    const { log, last } = build();
    log.warn("webhook.deferred", { repo: "o/r", reason: "harness_not_ready" });
    expect(Object.keys(last()).slice(0, 4)).toEqual(["ts", "level", "service", "event"]);
  });

  it("carries the level it was emitted at", () => {
    const { log, lines } = build({ level: "debug" });
    log.debug("public.stream.opened");
    log.info("service.started");
    log.warn("webhook.rejected");
    log.error("service.fatal");
    expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("child", () => {
  it("binds context onto every later line", () => {
    const { log, last } = build();
    log.child({ run_id: "r1", repo: "o/r" }).info("run.status.changed", { to: "clean" });
    expect(last()).toMatchObject({ run_id: "r1", repo: "o/r", to: "clean" });
  });

  it("composes left to right, so a later binding rebinds", () => {
    const { log, last } = build();
    log.child({ ray: "edge" }).child({ ray: "delivery" }).info("webhook.accepted");
    expect(last().ray).toBe("delivery");
  });

  it("does not let a call site relabel bound context", () => {
    // A run logger's run_id is its identity, not a payload.
    const { log, last } = build();
    log.child({ run_id: "r1" }).info("run.status.changed", { run_id: "r2", to: "error" });
    expect(last().run_id).toBe("r1");
    expect(last().to).toBe("error");
  });

  it("leaves the parent alone", () => {
    const { log, lines } = build();
    const child = log.child({ run_id: "r1" });
    child.info("run.rehydrated");
    log.info("service.started");
    expect(lines[0]?.run_id).toBe("r1");
    expect(lines[1]?.run_id).toBeUndefined();
  });
});

describe("the field allowlist at runtime", () => {
  it("drops an undeclared field and names it, without printing its value", () => {
    const { log, last } = build();
    // The compiler stops this at a literal; the cast is how it would actually
    // slip past, and is the reason emit filters as well.
    log.info("service.started", { authorization: "Bearer hunter2", port: 8080 } as Fields);
    expect(last().authorization).toBeUndefined();
    expect(last().dropped_fields).toEqual(["authorization"]);
    expect(JSON.stringify(last())).not.toContain("hunter2");
    expect(last().port).toBe(8080);
  });

  it("reports a field dropped at bind time too", () => {
    const { log, last } = build();
    log.child({ secret: "s3cret" } as Fields).info("service.started");
    expect(last().dropped_fields).toEqual(["secret"]);
    expect(JSON.stringify(last())).not.toContain("s3cret");
  });

  it("says nothing when nothing was dropped", () => {
    const { log, last } = build();
    log.info("service.started", { port: 8080 });
    expect(last()).not.toHaveProperty("dropped_fields");
  });

  it("skips an undefined value rather than printing null", () => {
    const { log, last } = build();
    log.info("run.status.changed", { run_id: "r1", from: undefined });
    expect(last()).not.toHaveProperty("from");
  });

  it("drops a non-scalar even under a declared name", () => {
    // The type stops this at a literal and stops nothing after a cast, and the
    // whole security argument is that an object cannot reach a line — so the
    // check has to live where a cast cannot reach it either.
    const { log, last } = build();
    log.info("service.started", {
      repo: { nested: "s3cret" },
      run_id: ["also", "s3cret"],
      port: 8080,
    } as unknown as Fields);
    expect(last().repo).toBeUndefined();
    expect(last().run_id).toBeUndefined();
    expect(JSON.stringify(last())).not.toContain("s3cret");
    expect(last().dropped_fields).toEqual(["repo", "run_id"]);
    expect(last().port).toBe(8080);
  });

  it("drops a bigint rather than losing the whole line to JSON.stringify", () => {
    const { log, last } = build();
    log.info("service.started", { port: 10n as unknown as number, repo: "o/r" });
    expect(last().event).toBe("service.started");
    expect(last().repo).toBe("o/r");
    expect(last().dropped_fields).toEqual(["port"]);
  });

  it("drops a non-finite number, which JSON would have turned into null", () => {
    const { log, last } = build();
    log.info("check.finished", { duration_ms: Number.NaN, check: "tests" });
    expect(last()).not.toHaveProperty("duration_ms");
    expect(last().dropped_fields).toEqual(["duration_ms"]);
  });

  it("keeps a legitimate null, which is a declared scalar", () => {
    const { log, last } = build();
    log.info("run.status.changed", { from: null, to: "clean" });
    expect(last().from).toBeNull();
    expect(last()).not.toHaveProperty("dropped_fields");
  });

  it("scrubs a declared string field", () => {
    // Assembled rather than written out; see redact.test.ts for why.
    const token = ["ghs", "_", "0123456789abcdef0123456789abcdef0123"].join("");
    const { log, last } = build();
    log.error("run.prepare.failed", { error_message: `clone failed for ${token}` });
    expect(last().error_message).not.toContain(token.slice(0, 12));
  });
});

describe("the stack rule", () => {
  it("keeps a stack at debug and strips it above, whoever passed it", () => {
    const debug = build({ level: "debug" });
    debug.log.debug("run.prepare.failed", { error_stack: "Error: boom\n  at x" });
    expect(debug.last().error_stack).toContain("boom");

    const info = build();
    info.log.error("run.prepare.failed", { error_stack: "Error: boom\n  at x" });
    expect(info.last()).not.toHaveProperty("error_stack");
  });
});

describe("the logger never fails its caller", () => {
  it("counts a throwing sink rather than swallowing or rethrowing it", () => {
    const before = logFailureCount().emit;
    const log = createLogger({
      service: "cujo",
      sink: () => {
        throw new Error("EPIPE");
      },
    });
    expect(() => log.info("service.started")).not.toThrow();
    // Counted, because a logger cannot rethrow and cannot log its own failure,
    // and a dropped audit trail should not be invisible.
    expect(logFailureCount().emit).toBe(before + 1);
  });

  it("swallows a throwing clock", () => {
    const log = createLogger({
      service: "cujo",
      sink: () => {},
      now: () => {
        throw new Error("no clock");
      },
    });
    expect(() => log.error("service.fatal")).not.toThrow();
  });
});

describe("service", () => {
  it("is bound once and cannot be set through fields", () => {
    const { log, last } = build();
    log.child({ service: "not-cujo" } as unknown as Fields).info("service.started");
    expect(last().service).toBe("cujo");
    expect(last().dropped_fields).toEqual(["service"]);
  });
});
