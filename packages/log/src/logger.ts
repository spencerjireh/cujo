/**
 * The logger itself (decision 37). One JSON object per line, on stdout.
 *
 * Everything it depends on is injected — the sink, the clock — which is this
 * repo's convention rather than a preference: `GitHubReader` takes its
 * `fetchImpl`, `bootstrapUntilReady` takes its `sleep`, and `createStreamLimit`
 * returns a fresh counter per app because module state "would leak between
 * tests and make `active()` unassertable". A module-level singleton logger
 * would reintroduce exactly that, so there is not one. A test passes a sink
 * that pushes into an array; nothing in this repo spies on `console`.
 *
 * The default sink writes to `process.stdout` rather than through `console`,
 * which skips a formatting layer and means this package needs no `noConsole`
 * exemption of its own.
 */

import type { EventName } from "./events";
import { CAP, FIELD_CLASS, type Fields, isFieldName } from "./fields";
import { type Level, RANK } from "./level";
import { scrub } from "./redact";

export type Sink = (line: string) => void;

export interface LoggerOptions {
  /** Bound once. `child()` cannot change it, because it is not a `Fields` key. */
  service: string;
  level?: Level;
  sink?: Sink;
  now?: () => string;
}

export interface Logger {
  debug(event: EventName, fields?: Fields): void;
  info(event: EventName, fields?: Fields): void;
  warn(event: EventName, fields?: Fields): void;
  error(event: EventName, fields?: Fields): void;
  /**
   * Bind context for every line from here on.
   *
   * Bound fields beat call-site fields on a collision, which is the one
   * non-obvious thing about this API. A run logger's `run_id` is its identity,
   * not a payload: a stray `log.info(…, { run_id })` inside a run scope must
   * not be able to relabel the line as some other run's. Collisions are rare
   * and this is the fail-safe direction for correlation.
   */
  child(fields: Fields): Logger;
}

interface Sanitized {
  kept: Record<string, unknown>;
  dropped: string[];
}

/**
 * Drop what is not declared, scrub and cap what is. The dropped **names** are
 * reported by `emit`; their values never are, so reporting them cannot leak.
 * A silent drop would be a debugging trap — the field simply would not appear
 * and nothing would say why.
 */
function sanitize(fields: Fields | undefined): Sanitized {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  if (!fields) return { kept, dropped };
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!isFieldName(name)) {
      dropped.push(name);
      continue;
    }
    kept[name] = typeof value === "string" ? scrub(value, CAP[FIELD_CLASS[name]]) : value;
  }
  return { kept, dropped };
}

const defaultSink: Sink = (line) => {
  process.stdout.write(`${line}\n`);
};

function make(
  options: Required<Omit<LoggerOptions, "level">> & { level: Level },
  bound: Sanitized,
): Logger {
  const { service, level, sink, now } = options;

  const emit = (at: Level, event: EventName, fields?: Fields): void => {
    // One integer comparison before any work at all. A suppressed `debug` has
    // to be free: the public stream and the run poll both sit on hot paths.
    if (RANK[at] < RANK[level]) return;
    try {
      const call = sanitize(fields);
      const line: Record<string, unknown> = { ts: now(), level: at, service, event };
      // A stack is the largest thing a line can carry and the least useful at
      // `info`, where the event name already says where it came from. Omitted
      // rather than removed afterwards, so it is never in the object at all —
      // and enforced here as well as in `errorFields`, so the rule holds
      // whoever passed the field.
      for (const [name, value] of Object.entries({ ...call.kept, ...bound.kept })) {
        if (name === "error_stack" && at !== "debug") continue;
        line[name] = value;
      }
      const dropped = [...new Set([...bound.dropped, ...call.dropped])];
      if (dropped.length > 0) line.dropped_fields = dropped;
      sink(JSON.stringify(line));
    } catch {
      // A logger must never fail its caller. `Runner.refold` already wraps its
      // own emit because "a subscriber must never be able to fail a run", and
      // this sits in that same path; `process.stdout.write` can also throw on
      // EPIPE when the container's log reader goes away.
    }
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child(fields) {
      const extra = sanitize(fields);
      return make(options, {
        // Later bindings win, so composing a run logger onto a request logger
        // reads left to right.
        kept: { ...bound.kept, ...extra.kept },
        dropped: [...bound.dropped, ...extra.dropped],
      });
    },
  };
}

export function createLogger(options: LoggerOptions): Logger {
  return make(
    {
      service: options.service,
      level: options.level ?? "info",
      sink: options.sink ?? defaultSink,
      now: options.now ?? (() => new Date().toISOString()),
    },
    { kept: {}, dropped: [] },
  );
}
