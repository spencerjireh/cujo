/**
 * Runtime validation for the harness's session events (decision 105).
 *
 * The shapes are the contract's own Zod schemas (`@cujo/harness-contract`),
 * so this file no longer declares a field list of its own: what `fold.ts`
 * reads and what the harness writes are the same package. What stays from 105
 * is the policy:
 *
 * **Warn, never reject.** `safeParse`, and an event that fails is logged as
 * `run.event.invalid` and kept in the fold — never dropped, never fatal. A
 * malformed event should be visible, not silent.
 *
 * **Unknown types pass.** A type the contract does not name is checked for an
 * id and a timestamp only, so a harness that is one deploy ahead of this
 * process does not produce a warning per event.
 */

import { SessionEventSchema as ContractEventSchema } from "@cujo/harness-contract";
import { z } from "zod";

const KNOWN_TYPES = new Set<string>(
  ContractEventSchema.options.map((option) => option.shape.type.value),
);

const UnreadBase = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    type: z.string(),
  })
  .passthrough();

/**
 * Route by type: known types go through the contract's discriminated union
 * (so a `turn.created` missing `turnId` is rejected, not swallowed by a loose
 * catch-all); unknown types go through the base-only schema.
 */
const SessionEventSchema = z.any().superRefine((val, ctx) => {
  if (typeof val !== "object" || val === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected an object" });
    return;
  }
  const type = (val as Record<string, unknown>).type;
  const schema =
    typeof type === "string" && KNOWN_TYPES.has(type) ? ContractEventSchema : UnreadBase;
  const result = schema.safeParse(val);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue(issue);
  }
});

/** Long enough to name the path; short enough for a log field. */
const PROBLEM_MAX = 200;

/**
 * Same `flatten` heuristic as `report-schema.ts`: pick the union branch with
 * the fewest issues, since that is the one the event was trying to be.
 */
function flatten(issue: z.ZodIssue): z.ZodIssue[] {
  if (issue.code !== z.ZodIssueCode.invalid_union) return [issue];
  const branches = issue.unionErrors.map((error) => error.issues.flatMap(flatten));
  let best: z.ZodIssue[] = [];
  for (const branch of branches) {
    if (branch.length > 0 && (best.length === 0 || branch.length < best.length)) best = branch;
  }
  return best.length > 0 ? best : [issue];
}

export interface EventValidation {
  valid: boolean;
  problem?: string;
}

/**
 * Validate a single event. Returns `{ valid: true }` on success, or
 * `{ valid: false, problem }` with a diagnostic string on failure.
 *
 * The event is never dropped — the caller keeps it regardless.
 */
export function validateEvent(event: unknown): EventValidation {
  const result = SessionEventSchema.safeParse(event);
  if (result.success) return { valid: true };
  const issues = result.error.issues.flatMap(flatten);
  const issue = issues[0];
  if (!issue) return { valid: false, problem: "did not match any event schema" };
  const path = issue.path.join(".");
  const named = path ? `${path}: ${issue.message}` : issue.message;
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
  return { valid: false, problem: named.slice(0, PROBLEM_MAX - more.length) + more };
}
