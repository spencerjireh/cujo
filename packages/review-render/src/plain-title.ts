/**
 * A finding title that is still a Contract 2 field name, rewritten as a
 * sentence (decision 74).
 *
 * The hard-rule findings in `apps/cujo/src/review/findings.ts` have carried
 * plain titles since they were written, and keep the field name in `evidence`
 * where it belongs. What this catches is the model's own findings, where
 * `secret_probe.decoy_read: true` reads as a claim only to somebody who has
 * read the sensor spec — which is what orders-api #19 posted.
 *
 * The rubric asks for a plain title too. This is the backstop, for the same
 * reason `body.ts` composes the footer rather than asking for it: a rule a
 * model applies is a rule that fails silently.
 */

/**
 * The sentence each field name means. Deliberately short of the check name —
 * `hardRuleFindings` says "during detonation" because it knows which check
 * reported; here the check rides on the finding's own `check` field and is
 * rendered beside the title, so repeating it would read twice.
 */
const FIELD_TITLES = new Map<string, string>([
  ["base_pass_head_fail", "a test passes on base and fails on head"],
  ["tests.base_pass_head_fail", "a test passes on base and fails on head"],
  ["secret_probe.decoy_read", "the seeded decoy secret was read"],
  ["secret_probe.decoy_in_egress", "the seeded decoy secret left the sandbox"],
  ["derived.wrote_sensitive", "a write landed in a sensitive path"],
  ["derived.wrote_outside_workspace", "a write landed outside the workspace"],
  ["derived.spawned_subprocess", "the run spawned a subprocess"],
  [
    "derived.egress_to_unknown_host",
    "an install contacted a host that is neither a package index nor allowlisted",
  ],
]);

/**
 * The whole title, and nothing but: a dotted identifier or a bare snake_case
 * key, optionally wrapped in backticks, optionally with a boolean tacked on.
 *
 * Anchored on purpose. A sentence that merely *mentions* a field —
 * "`secret_probe.decoy_read` was true during the install" — is a title somebody
 * wrote on purpose, and rewriting it would be this module editing prose rather
 * than translating jargon. Only a title that is the bare field name is
 * translated.
 */
const FIELD_ONLY =
  /^[`\s]*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)[`\s]*(?:[:=]\s*(?:true|false)|\s+is\s+(?:true|false))?[.\s]*$/i;

export interface PlainTitle {
  title: string;
  /** True when `title` is this module's sentence and not the model's text. */
  translated: boolean;
  /** The expression that was replaced, so the evidence can still carry it. */
  raw?: string;
}

/**
 * Translate a title that is nothing but a field name; otherwise pass it back
 * untouched.
 *
 * An unrecognised dotted key is returned as it arrived. Rewriting one into a
 * guessed sentence would be the renderer inventing a claim about somebody's
 * pull request, which is the one thing it must never do — better a reader sees
 * jargon and asks than sees fluent prose Cujo made up.
 */
export function plainTitle(title: string): PlainTitle {
  const match = FIELD_ONLY.exec(title);
  const key = match?.[1]?.toLowerCase();
  if (!key) return { title, translated: false };
  const plain = FIELD_TITLES.get(key);
  if (!plain) return { title, translated: false };
  return { title: plain, translated: true, raw: title.trim() };
}
