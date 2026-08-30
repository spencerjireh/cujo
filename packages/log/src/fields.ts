/**
 * What a log line may carry (decision 37).
 *
 * Two rules, and the second is the one that does the work:
 *
 * 1. A field name must be declared in `FIELD_NAMES` and classified in
 *    `FIELD_CLASS`. `Record<FieldName, FieldClass>` is exhaustive, so adding a
 *    name here stops this file compiling until somebody says what it is — the
 *    same fail-closed shape as `PUBLIC_SOURCE_FIELDS` in the public serializer.
 * 2. A field value is a scalar. Not an object, not an array, not an `Error`,
 *    not the `Config`. This process holds the App private key, the webhook
 *    secret and the bot token, and the way a logger leaks is that somebody
 *    spreads a wide object into a call. `agent-spec.ts` already reasons this
 *    way — it takes two fields rather than a config, "which turns a future
 *    `...config` spread into a compile error instead of a leak". This takes
 *    zero.
 *
 * The class decides the length cap and nothing else. Every string value is
 * scrubbed regardless of class, because a scrub/no-scrub split would have a
 * "somebody forgot to mark this one" failure mode and this does not.
 */

export type FieldValue = string | number | boolean | null;

/** Written by `emit`, so no caller can forge one through `Fields`. */
export const RESERVED_NAMES = ["ts", "level", "service", "event", "dropped_fields"] as const;

export const FIELD_NAMES = [
  // Identifiers. Handles, not content.
  "run_id",
  "repo",
  "pr_number",
  "head_sha",
  "session_id",
  "turn_id",
  "thread_id",
  "delivery_id",
  "comment_id",
  "ray",
  "cf_ray",
  "review_id",
  "channel_id",
  "guild_id",
  "path",
  "html_url",
  "port",
  // Closed sets. A value here is one of a handful of words this repo chose.
  "status",
  "from",
  "to",
  "check",
  "tool",
  "event_type",
  "action",
  "method",
  "plane",
  "mode",
  "reason",
  "label",
  "decision",
  "rule",
  "severity",
  "claim",
  "error_kind",
  // Numbers. Never capped, never scrubbed, safe by type.
  "attempt",
  "attempts",
  "round",
  "active",
  "limit",
  "http_status",
  "error_status",
  "error_code",
  "duration_ms",
  "elapsed_ms",
  "delay_ms",
  "retry_in_ms",
  "timeout_ms",
  "uptime_ms",
  "steps",
  "posted_inline",
  "moved_to_body",
  "findings",
  "runs_restamped",
  // Booleans.
  "ready",
  "is_public",
  "session_created",
  // Free text. The only fields an upstream string can reach, and the reason
  // the scrubber exists.
  "error_message",
  "error_stack",
  // Names a person.
  "actor",
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

/**
 * The call-site type. `Partial<Record<FieldName, …>>` makes an undeclared key
 * an excess-property error where it is written, which is the right place for
 * it: the person adding the field sees the error.
 *
 * Known limit: excess-property checks fire on object literals only, so a value
 * widened to `Fields` elsewhere slips past the compiler. That is why `emit`
 * also filters at runtime, where in the public serializer the equivalent
 * runtime check is belt-and-braces.
 */
export type Fields = Partial<Record<FieldName, FieldValue>>;

export type FieldClass = "id" | "enum" | "count" | "flag" | "text" | "pii";

/** How much of a string value may be printed, by class. */
export const CAP: Record<FieldClass, number> = {
  id: 128,
  enum: 64,
  count: 0,
  flag: 0,
  text: 1024,
  // An email address is at most 320 characters, and this class holds exactly
  // one field.
  pii: 320,
};

/**
 * Exhaustive by type. `pii` still has one member on purpose. `actor` is who
 * made a decision: an Access email, or — since the gate moved to the pull
 * request — a GitHub login (decision 44). Either way the store already
 * persists it as `approver` and the public serializer already withholds it,
 * and logging it is the point of the audit trail. The class exists so a second
 * one cannot arrive without being written down.
 */
export const FIELD_CLASS: Record<FieldName, FieldClass> = {
  run_id: "id",
  repo: "id",
  pr_number: "id",
  head_sha: "id",
  session_id: "id",
  turn_id: "id",
  thread_id: "id",
  delivery_id: "id",
  comment_id: "id",
  ray: "id",
  cf_ray: "id",
  review_id: "id",
  channel_id: "id",
  guild_id: "id",
  path: "id",
  html_url: "id",
  port: "id",
  status: "enum",
  from: "enum",
  to: "enum",
  check: "enum",
  tool: "enum",
  event_type: "enum",
  action: "enum",
  method: "enum",
  plane: "enum",
  mode: "enum",
  reason: "enum",
  label: "enum",
  decision: "enum",
  rule: "enum",
  severity: "enum",
  claim: "enum",
  error_kind: "enum",
  attempt: "count",
  attempts: "count",
  round: "count",
  active: "count",
  limit: "count",
  http_status: "count",
  error_status: "count",
  error_code: "count",
  duration_ms: "count",
  elapsed_ms: "count",
  delay_ms: "count",
  retry_in_ms: "count",
  timeout_ms: "count",
  uptime_ms: "count",
  steps: "count",
  posted_inline: "count",
  moved_to_body: "count",
  findings: "count",
  runs_restamped: "count",
  ready: "flag",
  is_public: "flag",
  session_created: "flag",
  error_message: "text",
  error_stack: "text",
  actor: "pii",
};

const DECLARED = new Set<string>(FIELD_NAMES);

export function isFieldName(name: string): name is FieldName {
  return DECLARED.has(name);
}
