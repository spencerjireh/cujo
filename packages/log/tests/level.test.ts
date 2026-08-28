import { describe, expect, it } from "vitest";
import { RANK, parseLevel } from "../src/level";
import { createLogger } from "../src/logger";

describe("parseLevel", () => {
  it("reads the four levels", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(parseLevel(level)).toBe(level);
    }
  });

  it("falls back to info rather than to silence", () => {
    for (const raw of [undefined, "", "  ", "verbose", "trace", "off", "none"]) {
      expect(parseLevel(raw)).toBe("info");
    }
  });

  it("does not accept a name it inherited from Object", () => {
    // `in` would say yes to both of these and then index to undefined, which
    // compares false against every rank and silences the log.
    expect(parseLevel("constructor")).toBe("info");
    expect(parseLevel("toString")).toBe("info");
  });

  it("tolerates case and surrounding space, because a deploy variable will have both", () => {
    expect(parseLevel(" DEBUG ")).toBe("debug");
  });
});

describe("level filtering", () => {
  it("ranks the levels in order", () => {
    expect(RANK.debug).toBeLessThan(RANK.info);
    expect(RANK.info).toBeLessThan(RANK.warn);
    expect(RANK.warn).toBeLessThan(RANK.error);
  });

  it("suppresses anything below the configured level", () => {
    const lines: string[] = [];
    const log = createLogger({ service: "cujo", level: "warn", sink: (l) => lines.push(l) });
    log.debug("service.started");
    log.info("service.started");
    log.warn("service.stopping");
    log.error("service.fatal");
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(["service.stopping", "service.fatal"]);
  });

  it("does no work at all for a suppressed line", () => {
    // The clock throws, so anything that reaches line construction fails the
    // test. A suppressed `debug` sits on the public stream and the run poll.
    const log = createLogger({
      service: "cujo",
      level: "info",
      sink: () => {
        throw new Error("sink reached");
      },
      now: () => {
        throw new Error("clock reached");
      },
    });
    expect(() => log.debug("public.stream.opened", { run_id: "r1" })).not.toThrow();
  });
});
