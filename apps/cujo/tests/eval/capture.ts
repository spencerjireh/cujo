/**
 * Record a real run's event stream as an eval fixture.
 *
 * Every other test in this repo is a pure function or a stream of events
 * somebody imagined. That leaves `agent/SKILL.md` — the file with more leverage
 * over a verdict than anything in `src/` — as the only one with no test at all,
 * and a session pins its rubric at creation (decision 16), so a rubric edit is
 * not exercised until a new pull request arrives in production. This is how a
 * rubric edit becomes a diff instead of a hope.
 *
 * Usage, against a deployment whose TrueForge this process can reach:
 *
 *   TRUEFORGE_BASE_URL=http://localhost:8790 \
 *     node apps/cujo/tests/eval/capture.ts <session-id> <slug> [--verdict]
 *
 * It lives under `tests/` rather than `src/` for three reasons, all of them
 * enforced by something: `biome.json` makes `console` an error outside
 * `tests/**`, `tsconfig.json` type-checks `tests` and would not check a
 * `scripts/`, and `tsup.config.ts` builds only `src/index.ts`, so nothing here
 * ships in the image. Vitest ignores it because it is not a `*.test.ts`.
 *
 * **It never writes a verdict.** `--verdict` prints what the current fold makes
 * of the events, for a human to read, decide about and paste in. A verdict that
 * a tool could refresh is a verdict nobody chose, and the whole point of the
 * corpus is that changing one is a reviewable diff.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import type { Event } from "../../src/review/fold";
import { verdictOf } from "./verdict";

/**
 * The event types `fold` switches on, and nothing else.
 *
 * Deltas are never persisted anyway, and dropping everything the fold cannot
 * read keeps a fixture a few tens of KB and its diff readable. The cost is that
 * a future fold reading a new event type cannot be tested against an old
 * fixture — which is the right trade while the alternative is a review nobody
 * can read.
 */
const KEPT = new Set([
  "turn.created",
  "model.message",
  "thread.created",
  "thread.done",
  "tool.approval_required",
  "tool.response",
  "turn.done",
]);

/** Chain-of-thought is bulky, model-specific, and read by nothing here. */
function stripReasoning<T>(event: T): T {
  const copy = structuredClone(event) as Record<string, unknown>;
  copy.reasoningContent = undefined;
  const state = copy.state as { output?: Record<string, unknown> } | undefined;
  if (state?.output) state.output.reasoningContent = undefined;
  return JSON.parse(JSON.stringify(copy)) as T;
}

async function main(): Promise<void> {
  const [sessionId, slug, ...flags] = process.argv.slice(2);
  if (!sessionId || !slug) {
    console.error("usage: capture.ts <session-id> <slug> [--verdict]");
    process.exitCode = 1;
    return;
  }

  const client = new TrueForge({
    baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790",
  });
  const page = await client.sessions.listEvents(sessionId, { limit: 100 });
  const all: Event[] = [];
  for await (const item of page) all.push(item.event as Event);
  // The API lists newest first, exactly as `Harness.listEvents` handles it.
  all.reverse();

  const events = all.filter((e) => KEPT.has(e.type)).map(stripReasoning);
  const verdict = verdictOf(events);

  if (flags.includes("--verdict")) {
    console.log(JSON.stringify(verdict, null, 2));
    return;
  }

  const fixture = {
    _comment: [
      "A recorded run, replayed through `fold` by corpus.test.ts.",
      "",
      "`expected` is written by a person and never by the capture script. When a",
      "change moves a verdict the test fails, and somebody decides whether the",
      "new verdict is better before editing this block — which is what makes",
      "the change reviewable. Run capture.ts --verdict to see the current one.",
      "",
      "Capture only from public demo repositories. Every string in a check",
      "report is written by the code under review (spec Contract 2), and this",
      "file is in a public repository.",
    ],
    captured_at: new Date().toISOString(),
    session_id: sessionId,
    // What produced this stream. A corpus outlives several rubrics, so a case
    // has to say which one it describes rather than being read as current.
    model: null,
    rubric_sha256: null,
    expected: verdict,
    events,
  };

  const path = join(import.meta.dirname, "cases", `${slug}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${path} (${events.length} events of ${all.length})`);
  console.log("Now read `expected` and decide whether it is the verdict you want.");
}

await main();
