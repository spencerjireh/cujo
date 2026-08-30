/**
 * The review body, composed here rather than written by the model (decision 74).
 *
 * Decision 36 moved the evidence footer out of the rubric and into `body.ts`,
 * on the argument that a rule telling a model to end its body a particular way
 * is a rule that fails silently. Everything above the footer was still the
 * model's, and the posted reviews showed what that bought: the verdict nowhere
 * near the top, provenance before conclusions, sensor field names used as
 * claims, the coverage caveat inside a parenthesis, an `info` finding and a
 * credential read set in the same weight.
 *
 * So the model supplies findings and judgment, and this file decides what a
 * review looks like. Two properties fall out of that and both are the point:
 * the shape is testable prose rather than something to hope for, and it
 * applies to every session at once — `github-mcp` is stateless with a fresh
 * server per request, so a session pinned to the old rubric (decision 16) gets
 * the new rendering on its next review.
 *
 * The verdict word is a function of the tool, never of the model. A model
 * cannot write "blocked" onto an advisory review, because the word is not a
 * thing it supplies.
 *
 * Everything here is pure. `apps/github-mcp` calls it to build the body it
 * posts; `apps/cujo` calls it to reproduce that body, and those comments, for
 * the board. See `index.ts` for why that is one package and not two copies.
 */

import { plainTitle } from "./plain-title";

/** Which side of the diff a line is on. `RIGHT` is head and is the default. */
export type Side = "LEFT" | "RIGHT";

/** One inline review comment, as GitHub's review API takes it. */
export interface ReviewComment {
  path: string;
  line: number;
  side?: Side;
  body: string;
}

/** The tools that post a review. The verdict word is a function of this. */
export type ReviewTool = "post_advisory_review" | "post_blocking_review" | "post_gated_review";

/** What the headline calls this review. Matched literally, like the severities. */
export type Verdict = "advisory" | "blocked" | "accusation";

export type Severity = "info" | "warn" | "critical";

/** One finding as the tool schema produces it. */
export interface RenderFinding {
  check: string;
  severity: Severity;
  title: string;
  evidence?: string;
  detail?: string;
  next?: string;
  held?: boolean;
  path?: string;
  line?: number;
  side?: Side;
}

export interface Coverage {
  ran: { check: string; note?: string }[];
  skipped: { check: string; reason: string }[];
}

export interface EgressHost {
  host: string;
  port?: number;
  known: boolean;
  note?: string;
}

/** Structurally what the review tool's schema produces. */
export interface RenderInput {
  body: string;
  findings: RenderFinding[];
  coverage?: Coverage;
  egress?: EgressHost[];
}

export interface RenderOptions {
  tool: ReviewTool;
  accusationFollows: boolean;
  /** The run's page, or null when there is none (private repo, or no board). */
  runUrl: string | null;
  /** `path:line:side` keys `validateAnchors` refused, so the body can say so. */
  unanchored?: ReadonlySet<string>;
}

/** The shape of a prepared finding: normalized once, read by both phases. */
interface Prepared extends RenderFinding {
  evidence: string;
  held: boolean;
  titleTranslated: boolean;
  /** `path:line:side`, or null when this finding has no usable anchor. */
  anchorKey: string | null;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

const VERDICT_WORDS: Record<Verdict, string> = {
  advisory: "Advisory",
  blocked: "Blocked",
  accusation: "Accusation, pending confirmation",
};

/** How many unknown hosts the summary line names before it stops counting. */
const MAX_HOSTS_NAMED = 3;

/**
 * Text from the model, made safe to drop into a composed body.
 *
 * Two escapes, both structural rather than cosmetic. `<details>`/`<summary>`
 * would close a fold this file opened and spill the rest of the review out of
 * it. `<!--` and `-->` would let a model that echoed attacker text out of a
 * pull request forge a `<!-- cujo:... -->` marker, and `alreadyPosted` reads
 * that marker to decide a review was already posted — so a forged one
 * suppresses the real review. That hazard exists today, because the body is
 * passed through verbatim; this closes it.
 *
 * Everything else is left alone. The body is Markdown by design and escaping
 * it wholesale would turn every backtick and asterisk the model meant into
 * literal punctuation.
 */
export function safeText(value: string): string {
  return (
    value
      // The whole tag where there is one, so the escaped form reads as text
      // rather than as `&lt;/details>` with a stray bracket…
      .replace(/<(\/?)(details|summary)\b([^>]*)>/gi, "&lt;$1$2$3&gt;")
      // …and the opening bracket where the tag is unterminated, which would
      // otherwise be swallowed by whatever `>` came next.
      .replace(/<(\/?)(details|summary)\b/gi, "&lt;$1$2")
      .replace(/<!--/g, "&lt;!--")
      .replace(/-->/g, "--&gt;")
      .trim()
  );
}

/** Safe inside a table cell, where a newline ends the row and `|` ends the cell. */
function cell(value: string): string {
  return safeText(value)
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ");
}

function isSeverity(value: unknown): value is Severity {
  return value === "info" || value === "warn" || value === "critical";
}

/**
 * An array, or an empty one.
 *
 * Every value reaching this file was written by a model, and only one of the
 * two callers has a schema in front of it: `apps/github-mcp` parses with Zod,
 * while `apps/cujo` reads the raw `model.message` tool call so it can project a
 * run the server never saw. A `coverage: {}` from a confused model would throw
 * on `.map` there — inside `fold`, which is pure and replayed on every
 * rehydration, so the run could never be projected again. Nothing here may
 * throw on a shape; a malformed section renders as absent instead.
 */
function list<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalize the findings once, for both the body and the inline comments.
 *
 * One normalizer and not two, because the alternative is an inline comment and
 * the body line about the same finding disagreeing about its title — which is
 * exactly the failure that having `comments[]` beside `findings[]` produced.
 */
function prepareFindings(
  findings: readonly RenderFinding[],
  accusationFollows: boolean,
): Prepared[] {
  const prepared: Prepared[] = [];
  const seen = new Set<string>();

  for (const finding of list(findings)) {
    if (typeof finding?.title !== "string" || finding.title.trim() === "") continue;
    if (!isSeverity(finding.severity)) continue;

    const plain = plainTitle(finding.title);
    const title = safeText(plain.title);
    if (title === "") continue;

    const check = safeText(typeof finding.check === "string" ? finding.check : "review");
    // The raw expression is not lost when a title is translated: it moves to
    // the evidence, which is where a field name was always supposed to live.
    const rawEvidence = safeText(typeof finding.evidence === "string" ? finding.evidence : "");
    const evidence =
      plain.translated && plain.raw
        ? rawEvidence
          ? `${safeText(plain.raw)}; ${rawEvidence}`
          : safeText(plain.raw)
        : rawEvidence;

    const path =
      typeof finding.path === "string" && finding.path.trim() !== ""
        ? finding.path.trim()
        : undefined;
    const line =
      Number.isInteger(finding.line) && (finding.line ?? 0) > 0 ? finding.line : undefined;
    const side: Side = finding.side === "LEFT" ? "LEFT" : "RIGHT";
    const anchorKey = path && line ? `${path}:${line}:${side}` : null;

    const key = `${check}|${title.toLowerCase()}|${anchorKey ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    prepared.push({
      check,
      severity: finding.severity,
      title,
      evidence,
      detail:
        typeof finding.detail === "string" && finding.detail.trim() !== ""
          ? safeText(finding.detail)
          : undefined,
      next:
        typeof finding.next === "string" && finding.next.trim() !== ""
          ? safeText(finding.next)
          : undefined,
      // Only meaningful beside `accusation_follows`: a held marker on a review
      // that holds nothing back would promise a second review nobody will post.
      held: accusationFollows && finding.held === true,
      titleTranslated: plain.translated,
      path,
      line,
      side: path && line ? side : undefined,
      anchorKey,
    });
  }

  // Stable: `sort` is stable in every runtime this ships to, so findings of one
  // severity keep the order the model chose to list them in.
  return prepared.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** The verdict this tool posts. The one place the word is decided. */
export function verdictOf(tool: ReviewTool): Verdict {
  if (tool === "post_gated_review") return "accusation";
  if (tool === "post_blocking_review") return "blocked";
  return "advisory";
}

export interface Counts {
  critical: number;
  warn: number;
  info: number;
  held: number;
}

export function severityCounts(findings: readonly RenderFinding[]): Counts {
  const counts: Counts = { critical: 0, warn: 0, info: 0, held: 0 };
  for (const finding of list(findings)) {
    if (isSeverity(finding.severity)) counts[finding.severity] += 1;
    if (finding.held === true) counts.held += 1;
  }
  return counts;
}

/**
 * Every finding carrying a usable anchor, as an inline review comment.
 *
 * There is no `comments[]` on the tool input any more. It was always a second
 * copy of an anchor the finding already carried, and keeping two copies is how
 * a review posts a critical finding in the body with no comment on the line.
 *
 * The body text here is pinned by a test on both sides of the system: the same
 * literal appears in `apps/cujo/tests/review/findings.test.ts`, because
 * `apps/cujo` derives this same list for the board (decision 74) and the two
 * must not describe one finding differently.
 */
export function reviewComments(input: RenderInput): ReviewComment[] {
  const prepared = prepareFindings(input.findings ?? [], false);
  const comments: ReviewComment[] = [];
  for (const finding of prepared) {
    if (!finding.path || !finding.line) continue;
    comments.push({
      path: finding.path,
      line: finding.line,
      side: finding.side,
      body: commentBody(finding),
    });
  }
  return comments;
}

/**
 * One finding as an inline comment.
 *
 * The severity leads, because an inline comment arrives with no headline above
 * it: on the Files changed tab this line is the whole context there is. No run
 * link — it is on the review body, and repeating it on every anchored line is
 * noise.
 */
export function commentBody(finding: {
  severity: Severity;
  title: string;
  evidence?: string;
  detail?: string;
  next?: string;
}): string {
  const blocks = [`**${finding.severity} — ${finding.title}**`];
  if (finding.evidence) blocks.push(quote(finding.evidence));
  if (finding.detail) blocks.push(finding.detail);
  if (finding.next) blocks.push(`Next: ${finding.next}`);
  return blocks.join("\n\n");
}

function quote(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * A body written against the old rubric, rather than the one-sentence lede the
 * new one asks for.
 *
 * Conservative on purpose, and the only heuristic in this file. A lede is one
 * sentence and has no newline in it; an old-rubric body always carries
 * headings. Every false negative — a legacy body treated as a lede — puts a
 * paragraph where a sentence should be and costs nothing else, which is the
 * direction to be wrong in.
 */
function isLegacyBody(input: RenderInput, prepared: readonly Prepared[]): boolean {
  if (input.coverage || input.egress) return false;
  if (typeof input.body !== "string") return false;
  if (prepared.some((f) => f.detail || f.next || f.held)) return false;
  return input.body.trim().includes("\n");
}

/**
 * Push legacy headings below the ones this file writes, so a body carrying
 * `## Results` cannot outrank the composed `### Critical` above it.
 */
function demoteHeadings(markdown: string): string {
  return markdown.replace(/^(#{1,6})(\s)/gm, (_match, hashes: string, space: string) => {
    const level = Math.min(hashes.length + 2, 6);
    return `${"#".repeat(level)}${space}`;
  });
}

function fold(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

/** One finding, as it reads in the body. */
function findingBlock(finding: Prepared, unanchored: ReadonlySet<string>): string {
  const meta = [`\`${finding.check}\``];
  if (finding.path && finding.line) {
    const moved = unanchored.has(finding.anchorKey ?? "") ? " (not in this diff)" : "";
    meta.push(`\`${finding.path}:${finding.line}\`${moved}`);
  }
  if (finding.held) meta.push("held");

  const blocks = [`**${finding.title}** · ${meta.join(" · ")}`];
  if (finding.evidence) blocks.push(quote(finding.evidence));
  if (finding.detail) blocks.push(finding.detail);
  if (finding.next) blocks.push(`Next: ${finding.next}`);
  return blocks.join("\n\n");
}

function coverageSection(coverage: Coverage): string {
  const ran = list(coverage.ran).map((entry) => {
    const note = entry.note ? ` (${safeText(entry.note)})` : "";
    return `${safeText(entry.check)}${note}`;
  });
  const skipped = list(coverage.skipped).map(
    (entry) => `${safeText(entry.check)} — ${safeText(entry.reason)}`,
  );
  const lines = [`Ran: ${ran.length > 0 ? `${ran.join(", ")}.` : "nothing."}`];
  // Named rather than omitted when empty: "not run: nothing" is a claim worth
  // making, and an absent line reads as an unanswered question.
  lines.push(`Not run: ${skipped.length > 0 ? `${skipped.join("; ")}.` : "nothing."}`);
  return `### Coverage\n\n${lines.join("\n")}`;
}

function egressSection(input: readonly EgressHost[]): string {
  const hosts = list(input).filter((host) => host && typeof host.host === "string");
  if (hosts.length === 0) return "Egress: no host was contacted.";

  const unknown = hosts.filter((host) => !host.known);
  const named = unknown
    .slice(0, MAX_HOSTS_NAMED)
    .map((host) => `${safeText(host.host)}${host.port ? `:${host.port}` : ""}`)
    .join(", ");
  const rest = unknown.length - MAX_HOSTS_NAMED;
  const summary =
    unknown.length > 0
      ? `Egress: ${unknown.length} ${plural(unknown.length, "unknown host", "unknown hosts")} — ${named}${rest > 0 ? `, and ${rest} more` : ""}.`
      : `Egress: ${hosts.length} known ${plural(hosts.length, "host", "hosts")}.`;

  // A fourth column only when something fills it, so the common case — every
  // host known, nothing to say about any of them — is three narrow columns.
  const noted = hosts.some((host) => host.note);
  const rows = hosts.map((host) => {
    const cells = [
      `\`${cell(host.host)}\``,
      String(host.port ?? ""),
      host.known ? "yes" : "**no**",
    ];
    if (noted) cells.push(host.note ? cell(host.note) : "");
    return `| ${cells.join(" | ")} |`;
  });
  const header = noted ? "| host | port | known | note |" : "| host | port | known |";
  const rule = noted ? "| --- | --- | --- | --- |" : "| --- | --- | --- |";
  const table = [header, rule, ...rows].join("\n");
  return `${summary}\n\n${fold(`Hosts contacted (${hosts.length})`, table)}`;
}

/**
 * The block an agent reads instead of the prose.
 *
 * Additive only, in the sense decision 54 gives the phrase: a key may be added,
 * never renamed or removed, and `schema_version` bumps only if that is broken.
 * Absent input is `null` and never a missing key, the same promise
 * `PUBLIC_RUN_FIELDS` makes on the board and for the same reason — a consumer
 * should not have to tell "not reported" from "not in this version".
 *
 * One line rather than pretty-printed: the audience parses it, and the humans
 * have the folds above.
 */
function machineBlock(
  coverage: Coverage | undefined,
  egress: readonly EgressHost[] | undefined,
  options: RenderOptions,
  prepared: readonly Prepared[],
  counts: Counts,
  unanchored: ReadonlySet<string>,
): string {
  const payload = {
    schema_version: 1,
    verdict: verdictOf(options.tool),
    tool: options.tool,
    counts,
    coverage: coverage ?? null,
    egress: egress ?? null,
    findings: prepared.map((finding) => ({
      check: finding.check,
      severity: finding.severity,
      title: finding.title,
      evidence: finding.evidence,
      detail: finding.detail ?? null,
      next: finding.next ?? null,
      held: finding.held,
      anchored: finding.anchorKey !== null && !unanchored.has(finding.anchorKey),
      path: finding.path ?? null,
      line: finding.line ?? null,
      side: finding.side ?? null,
      title_translated: finding.titleTranslated,
    })),
    run_url: options.runUrl,
  };

  const json = JSON.stringify(payload);
  // A payload carrying a run of backticks would close a three-backtick fence
  // early and spill JSON into the page as prose.
  const longest = Math.max(0, ...[...json.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return fold("Machine-readable summary", `${fence}json\n${json}\n${fence}`);
}

/**
 * The whole body, minus the three blocks `body.ts` appends after it.
 *
 * Section order is fixed and an empty section is omitted, so two reviews of the
 * same shape read the same way and a reader learns where to look once.
 */
export function renderReviewBody(input: RenderInput, options: RenderOptions): string {
  const unanchored = options.unanchored ?? new Set<string>();
  const prepared = prepareFindings(input.findings ?? [], options.accusationFollows);
  const counts = severityCounts(prepared);
  const legacy = isLegacyBody(input, prepared);

  const headline = `**${VERDICT_WORDS[verdictOf(options.tool)]}** — ${
    counts.critical + counts.warn === 0
      ? "no findings above info"
      : `${counts.critical} critical, ${counts.warn} warn`
  }${counts.held > 0 ? ` (${counts.held} held)` : ""}`;

  const blocks: string[] = [headline];

  const lede = typeof input.body === "string" ? safeText(input.body) : "";
  if (lede && !legacy) blocks.push(lede);

  const critical = prepared.filter((f) => f.severity === "critical");
  if (critical.length > 0) {
    blocks.push("### Critical");
    for (const finding of critical) blocks.push(findingBlock(finding, unanchored));
  }

  const warn = prepared.filter((f) => f.severity === "warn");
  if (warn.length > 0) {
    blocks.push("### Warn");
    // Said once, above the findings it governs. Without it a held observation
    // and "changed code no test covers" are the same word in the same weight,
    // which is the reading the two-call design exists to prevent.
    if (counts.held > 0) {
      blocks.push(
        "Findings marked *held* are observations. Cujo is not publishing a conclusion about them until a maintainer answers.",
      );
    }
    for (const finding of warn) blocks.push(findingBlock(finding, unanchored));
  }

  const info = prepared.filter((f) => f.severity === "info");
  if (info.length > 0) {
    blocks.push(
      fold(
        `${info.length} info ${plural(info.length, "finding", "findings")}`,
        info.map((finding) => findingBlock(finding, unanchored)).join("\n\n"),
      ),
    );
  }

  // Rendered only when the value is the shape it claims: a section built from
  // a malformed one would be a claim nobody made.
  const coverage =
    input.coverage && typeof input.coverage === "object" && !Array.isArray(input.coverage)
      ? input.coverage
      : undefined;
  const egress = Array.isArray(input.egress) ? input.egress : undefined;
  if (coverage) blocks.push(coverageSection(coverage));
  if (egress) blocks.push(egressSection(egress));

  // Visible, and deliberately not a fold. For a session still pinned to the old
  // rubric this prose is the entire substance of the review, and collapsing it
  // would hide the only thing the run produced.
  if (lede && legacy) blocks.push(`### Notes\n\n${demoteHeadings(lede)}`);

  blocks.push(machineBlock(coverage, egress, options, prepared, counts, unanchored));

  return blocks.join("\n\n");
}
