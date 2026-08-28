/**
 * The Discord payloads Cujo posts for a run (spec Contract 7). Pure: no I/O,
 * no clock, no store, so every rule below is testable on its own.
 *
 * Every string that reaches a payload is attacker-controlled (decision 26).
 * The PR title comes from GitHub, and finding titles, evidence, the summary
 * and the error were written by a model that had just read the code in a
 * stranger's pull request. So each one is stripped of invisible characters,
 * markdown-escaped, truncated, and finally clamped against Discord's total
 * embed budget — and no derived string is ever written into a URL field.
 */

import type { DiscordEmbed, DiscordEmbedField, DiscordMessagePayload } from "../clients/discord";
import { CHECK_NAMES } from "../review/types";
import type { Finding, Projection, RunRecord, RunStatus } from "../review/types";

/** Discord's documented maxima (docs.discord.com, read 2026-08-27). */
export const LIMITS = {
  content: 2000,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  fields: 25,
  /** Across title, description, field names and values, footer, and author. */
  total: 6000,
} as const;

/**
 * Controls, and the zero-width and bidi ranges. Escaping does not defuse a
 * bidi override — it can still render "not critical" as "critical", or hide
 * text entirely — so these are removed rather than escaped. Tab, newline and
 * carriage return are deliberately kept. Written as a constructed pattern so
 * no control character appears in this source file.
 */
const STRIP = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F" +
    "\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "g",
);

/** Formatting and the `[label](url)` syntax. */
const ESCAPE = /([\\`*_~|[\]()])/g;

/**
 * Escaping the link syntax is not enough. Discord also linkifies a bare web
 * address and an `<https://…>` autolink, and a backslash does not stop either.
 * So the scheme and the bare `www.` form are defanged the way a malware report
 * defangs them: the address stays readable as evidence and cannot be clicked.
 * Defanged before the escape pass, so the brackets it inserts are escaped too
 * and cannot themselves start a link.
 */
const DEFANG_SCHEME = /([A-Za-z][A-Za-z0-9+.-]*):\/\//g;
const DEFANG_HOST = /\bwww\./gi;

export function escapeMarkdown(input: string): string {
  return (
    input
      .replace(STRIP, "")
      .replace(/\r\n?/g, "\n")
      // A model-authored evidence blob must not make one card forty lines tall.
      .replace(/\n{3,}/g, "\n\n")
      .replace(DEFANG_SCHEME, "$1[:]//")
      .replace(DEFANG_HOST, "www[.]")
      .replace(ESCAPE, "\\$1")
  );
}

/**
 * Truncate by code point, not UTF-16 unit: slicing a 4-byte emoji in half
 * leaves a lone surrogate that Discord may reject.
 */
export function truncate(input: string, max: number): string {
  const chars = [...input];
  if (chars.length <= max) return input;
  if (max <= 1) return max <= 0 ? "" : "…";
  return `${chars.slice(0, max - 1).join("")}…`;
}

/** The one way untrusted text enters a payload. */
function clean(input: string, max: number): string {
  return truncate(escapeMarkdown(input), max);
}

/**
 * Where the two hostnames live, since a card has to choose between them.
 */
export interface UiLinks {
  /** The Access-gated operator UI, where a decision is actually made. */
  uiBaseUrl: string;
  /** The anonymous board. Empty falls back to the operator UI. */
  publicBaseUrl: string;
}

/**
 * A card links to the public board when the run is public, and to the operator
 * UI when it is not (decision 34).
 *
 * A repo's Discord channel holds its team, not Cujo's operators, and most of
 * them cannot pass Access — pointing every card at the gated hostname would
 * answer them with a login page. The public run page carries its own link on to
 * `cujo-admin` when a decision is pending, so an approver is one click further
 * and nobody else is stopped. A private repo has no public page, so its cards
 * have only the one place to go.
 */
export function runUrl(links: UiLinks, run: { id: string; isPublic: boolean }): string {
  const base = run.isPublic && links.publicBaseUrl ? links.publicBaseUrl : links.uiBaseUrl;
  return `${base}/runs/${run.id}`;
}

const COLOR: Record<RunStatus, number> = {
  running: 0x5865f2,
  clean: 0x57f287,
  blocked_pending: 0xfee75c,
  blocked_posted: 0xed4245,
  denied: 0x99aab5,
  error: 0xe67e22,
  superseded: 0x4f545c,
};

const DESCRIPTION: Record<RunStatus, string> = {
  running: "Review running: tests, probes, a smoke boot, and dependency detonation.",
  clean: "No critical finding. The advisory review posted.",
  blocked_pending: "**Blocked — waiting for a human.** Approve or reject in Cujo.",
  blocked_posted: "Blocking review posted as REQUEST_CHANGES.",
  denied: "The block was rejected. Nothing was posted.",
  error: "The run ended in error.",
  superseded: "Replaced by a newer commit on this PR.",
};

const CHECK_MARK = { done: "✅", error: "❌", running: "⏳" } as const;

/**
 * Only threads the folder matched to a check name are rendered, so the names
 * come from the fixed CHECK_NAMES allowlist rather than a model-chosen thread
 * title. The text is escaped anyway.
 */
function checksField(projection: Projection): DiscordEmbedField | null {
  const checks = projection.checks.filter((c) => c.isCheck);
  if (checks.length === 0) return null;
  const parts = CHECK_NAMES.map((name) => {
    const check = checks.find((c) => c.title === name);
    return `${name} ${check ? CHECK_MARK[check.status] : "—"}`;
  });
  return { name: "Checks", value: clean(parts.join(" · "), LIMITS.fieldValue) };
}

function countsField(findings: Finding[]): DiscordEmbedField | null {
  const parts: string[] = [];
  for (const severity of ["critical", "warn", "info"] as const) {
    const n = findings.filter((f) => f.severity === severity).length;
    if (n > 0) parts.push(`${n} ${severity}`);
  }
  if (parts.length === 0) return null;
  return { name: "Findings", value: parts.join(" · ") };
}

const MAX_CRITICAL_SHOWN = 3;
const MAX_EVIDENCE = 160;

function criticalField(findings: Finding[]): DiscordEmbedField | null {
  const critical = findings.filter((f) => f.severity === "critical");
  if (critical.length === 0) return null;
  const lines = critical.slice(0, MAX_CRITICAL_SHOWN).map((f) => {
    const where = f.path ? ` \`${clean(f.path, 120)}${f.line ? `:${f.line}` : ""}\`` : "";
    const evidence = f.evidence ? `\n  ${clean(f.evidence, MAX_EVIDENCE)}` : "";
    return `• ${clean(f.title, 180)}${where}${evidence}`;
  });
  if (critical.length > MAX_CRITICAL_SHOWN) {
    lines.push(`+${critical.length - MAX_CRITICAL_SHOWN} more in Cujo`);
  }
  return {
    name: `Critical (${critical.length})`,
    value: truncate(lines.join("\n"), LIMITS.fieldValue),
  };
}

function textField(name: string, text: string | null): DiscordEmbedField | null {
  if (!text?.trim()) return null;
  return { name, value: clean(text, LIMITS.fieldValue) };
}

/** Everything Discord counts against the 6000-character embed budget. */
export function embedLength(embed: DiscordEmbed): number {
  let total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
  total += embed.footer?.text.length ?? 0;
  for (const field of embed.fields ?? []) total += field.name.length + field.value.length;
  return total;
}

/**
 * The 6000 total is a cliff, not a soft limit: exceed it and Discord answers
 * 400, the card is lost for the whole run, and every later edit fails too
 * because there is no message id to edit. Fields are appended in priority
 * order, so dropping from the end drops the least important first.
 */
function clamp(embed: DiscordEmbed): DiscordEmbed {
  const fields = (embed.fields ?? []).slice(0, LIMITS.fields);
  const clamped: DiscordEmbed = { ...embed, fields };
  while (fields.length > 0 && embedLength(clamped) > LIMITS.total) fields.pop();
  if (embedLength(clamped) > LIMITS.total) {
    const over = embedLength(clamped) - LIMITS.total;
    const kept = Math.max(0, (clamped.description?.length ?? 0) - over);
    clamped.description = truncate(clamped.description ?? "", kept);
  }
  return fields.length === 0 ? { ...clamped, fields: undefined } : clamped;
}

export interface CardInput {
  run: RunRecord;
  projection: Projection;
  /** From GitHub, so untrusted. Null when the PR read never completed. */
  prTitle: string | null;
  links: UiLinks;
}

/**
 * One embed per run, edited in place as the run's status moves. The `running`
 * card carries only immutable facts, because the card is rewritten on a status
 * change and any progress count would freeze and then lie.
 */
export function buildRunCard(input: CardInput): DiscordMessagePayload {
  const { run, projection, prTitle, links } = input;
  const status = run.status;
  const heading = escapeMarkdown(`${run.repo} #${run.prNumber}`);
  const title = prTitle
    ? truncate(`${heading} — ${escapeMarkdown(prTitle)}`, LIMITS.title)
    : truncate(heading, LIMITS.title);

  let description = DESCRIPTION[status];
  if ((status === "blocked_posted" || status === "denied") && run.approver) {
    description +=
      run.approver === "external"
        ? " Decided outside Cujo."
        : ` Decided by ${clean(run.approver, 120)}.`;
  }

  const fields: DiscordEmbedField[] = [
    { name: "Head", value: `\`${run.headSha.slice(0, 7)}\``, inline: true },
  ];
  // A superseded run describes a commit nobody is looking at any more, so it
  // shows no findings: acting on them would mean acting on a stale review.
  if (status !== "running" && status !== "superseded") {
    const critical = criticalField(projection.findings);
    if (critical) fields.push(critical);
    const checks = checksField(projection);
    if (checks) fields.push(checks);
    const counts = countsField(projection.findings);
    if (counts) fields.push(counts);
    const error = textField("Error", projection.error);
    if (error) fields.push(error);
    const summary = status === "clean" ? textField("Summary", projection.summary) : null;
    if (summary) fields.push(summary);
  }

  const footer = `run ${run.id.slice(0, 8)} · ${run.headSha.slice(0, 7)}`;
  const embed = clamp({
    title,
    // Ours, never derived. No projection string may reach a URL field, or a
    // hostile PR chooses where the card's title points.
    url: runUrl(links, run),
    description: truncate(description, LIMITS.description),
    color: COLOR[status],
    fields,
    footer: { text: truncate(footer, LIMITS.footer) },
    timestamp: run.updatedAt,
  });

  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

export interface PingInput {
  run: RunRecord;
  links: UiLinks;
  /** Null pings the channel without mentioning anyone. */
  roleId: string | null;
}

/**
 * A Discord edit notifies nobody, so the one moment that needs a human — a run
 * waiting on approval — gets its own message. Every part of `content` is
 * structural: the repo was validated when the channel was bound, the number is
 * a number, and the link is ours. Nothing untrusted reaches it.
 *
 * Once the run leaves `blocked_pending` this same message is edited to say so,
 * so nobody chases a link to a run that can no longer be decided.
 */
export function buildPing(input: PingInput): DiscordMessagePayload {
  const { run, links, roleId } = input;
  const where = `${run.repo} #${run.prNumber}`;
  const link = runUrl(links, run);
  if (run.status !== "blocked_pending") {
    return {
      content: truncate(`Resolved (${run.status}) — ${where}. ${link}`, LIMITS.content),
      allowed_mentions: { parse: [] },
    };
  }
  const mention = roleId ? `<@&${roleId}> ` : "";
  return {
    content: truncate(
      `${mention}Cujo is blocked on ${where} and needs a human. ${link}`,
      LIMITS.content,
    ),
    allowed_mentions: roleId ? { parse: [], roles: [roleId] } : { parse: [] },
  };
}
