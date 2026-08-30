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
import { checkMs } from "../review/digest";
import { type UiLinks, pullRequestUrl, runUrl } from "../review/links";
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
  author: 256,
  fields: 25,
  /** Across title, description, field names and values, footer, and author. */
  total: 6000,
} as const;

/**
 * Who a card names, and where (decision 78, reversing 55's allocation).
 *
 * The person who opened the pull request takes the author line — the one slot
 * on an embed that renders an icon in front of text, which is exactly the
 * affordance a channel needs on the variable party. Cujo was already named
 * twice above it: the app badge on the message header and its avatar. The Cujo
 * mark moves into the freed footer icon, so Cujo is still inside the embed and
 * no longer duplicated forty pixels beneath the header. An `Opened by` field
 * is gone rather than kept beside the line: one embed does not name the same
 * person twice.
 *
 * The mark is served from the repository over `raw.githubusercontent.com`
 * rather than from `apps/web`: Discord's media proxy has to fetch it
 * anonymously, and the operator hostname is gated while the public one is
 * configuration this process cannot depend on. `avatar-64.png` is committed
 * for exactly this (see `brand/tools/render.mjs`).
 */
const CUJO_NAME = "Cujo";
const CUJO_ICON_URL =
  "https://raw.githubusercontent.com/spencerjireh/cujo/main/brand/logo/avatar-64.png";

/**
 * A GitHub login, and nothing else. Alphanumeric with interior hyphens, 39
 * characters at most — GitHub cannot issue a login outside this set, so the
 * check should never fire; it is here so rule 7 of Contract 7 is enforced by
 * code rather than assumed. A bot login (`dependabot[bot]`) fails it by
 * design: its profile is at `/apps/<name>`, a second URL shape nobody needs,
 * so a bot is named and not linked.
 */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * Built from the numeric account id, never from the login: an avatar is a URL
 * and a login is a string somebody else chose. `s=64` because the author
 * line renders it around 24px and the extra pixels cost nothing.
 */
function avatarUrl(authorId: number | null): string | undefined {
  return authorId === null ? undefined : `https://avatars.githubusercontent.com/u/${authorId}?s=64`;
}

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
 * `escapeMarkdown` without the escape pass, for the one string on a payload
 * that renders no markdown: `author.name`. A backslash there defuses nothing —
 * Discord draws it — so `some_login` would read as `some\_login`. Everything
 * else still applies: invisible characters removed, addresses defanged, and
 * newlines and tabs folded to single spaces, because the author line is one
 * line whatever it contains.
 */
export function plainText(input: string, max: number): string {
  return truncate(
    input
      .replace(STRIP, "")
      .replace(/\r\n?|\n|\t/g, " ")
      .replace(DEFANG_SCHEME, "$1[:]//")
      .replace(DEFANG_HOST, "www[.]"),
    max,
  );
}

/**
 * The brand severity ramp, dark values, from `brand/tokens.css` (decision 36).
 * A Discord embed carries one colour and is read on a dark client, so the dark
 * column is the only one that applies.
 *
 * Two rules hold this map together, and both are worth keeping when a status is
 * added. Amber is on exactly one status — the one that needs a human — because
 * amber is the brand and `brand.md` spends it on the thing a person must act
 * on. Red means the pull request is dangerous and never that Cujo fell over,
 * which is why `error` is `--sev-info` blue: an infrastructure failure is a
 * status, not a verdict on someone's code.
 *
 * The three states nobody can act on form a deliberate ramp of decreasing
 * lightness: clean, then denied, then superseded.
 */
const COLOR: Record<RunStatus, number> = {
  running: 0xe6cf4a, // --sev-medium
  clean: 0xa39b90, // --fg-muted
  blocked_pending: 0xf2a900, // --accent / --sev-high
  blocked_unattended: 0xff5c45, // --sev-critical
  blocked_posted: 0xff5c45, // --sev-critical
  denied: 0x958d82, // --sev-low
  error: 0x66b0f0, // --sev-info
  superseded: 0x2c2924, // --line
};

const DESCRIPTION: Record<RunStatus, string> = {
  running: "Review running: tests, probes, a smoke boot, and dependency detonation.",
  clean: "No critical finding. The advisory review posted.",
  blocked_pending: "**Blocked — waiting for a human.** Approve or reject in Cujo.",
  blocked_unattended:
    "Blocking review posted as REQUEST_CHANGES. A correctness finding: no human was asked.",
  blocked_posted: "Blocking review posted as REQUEST_CHANGES.",
  denied: "The block was rejected. Nothing was posted.",
  error: "The run ended in error.",
  superseded: "Replaced by a newer commit on this PR.",
};

/**
 * A duration the digest also computes, in the few characters a field row has.
 * The words are deliberately plain — `41s`, `1.2s`, `2m03s` — because a
 * compact notation is a second vocabulary to learn and this field already has
 * one (the status words).
 */
function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  // Rounded once, as a whole, and only then split: flooring the minutes and
  // rounding the remainder independently renders 119.6s as `1m60s`, a
  // duration nobody ran for.
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, "0")}s`;
}

/**
 * What each check measured, not a verdict. A tick here always meant "the
 * thread finished", and under a `Critical (3)` heading everybody read it as
 * "passed" — the last surface still showing a bare glyph (decision 78, on
 * decision 65's precedent for the list row). So each check carries its
 * terminal state in words, the criticals attributed to it through
 * `Finding.check`, and how long it watched. `0 critical` rather than nothing:
 * an absent count next to a `done` would read as a pass again, which is the
 * reading this exists to prevent.
 *
 * Only threads the folder matched to a check name are rendered, so the names
 * come from the fixed CHECK_NAMES allowlist rather than a model-chosen thread
 * title. The text is escaped anyway, because the finding attribution is not
 * from that allowlist.
 */
function checksField(projection: Projection): DiscordEmbedField | null {
  const checks = projection.checks.filter((c) => c.isCheck);
  if (checks.length === 0) return null;
  const parts = CHECK_NAMES.map((name) => {
    const check = checks.find((c) => c.title === name);
    if (!check) return `${name} —`;
    const critical = projection.findings.filter(
      (f) => f.check === name && f.severity === "critical",
    ).length;
    return [`${name} ${check.status}`, `${critical} critical`, formatMs(checkMs(check))].join(", ");
  });
  return { name: "Checks", value: clean(parts.join(" · "), LIMITS.fieldValue) };
}

/**
 * Counts by severity. Inline, so it completes the identity row beside `Head`
 * and `Pull request` rather than standing alone further down: with `Opened by`
 * gone (decision 78), this is what keeps that row from holding one orphaned
 * field.
 */
function countsField(findings: Finding[]): DiscordEmbedField | null {
  const parts: string[] = [];
  for (const severity of ["critical", "warn", "info"] as const) {
    const n = findings.filter((f) => f.severity === severity).length;
    if (n > 0) parts.push(`${n} ${severity}`);
  }
  if (parts.length === 0) return null;
  return { name: "Findings", value: parts.join(" · "), inline: true };
}

const MAX_CRITICAL_SHOWN = 3;
const MAX_EVIDENCE = 160;

/**
 * Critical findings grouped for display, so one fact reported by three checks
 * costs one line rather than three. A group is the finding's whole displayed
 * identity — title, anchor, evidence, after cleaning — because findings that
 * differ in any of those are different facts however similar. The check names
 * that produced a group are the checks that saw it.
 *
 * Display-level only (decision 78): the fold still records one finding per
 * check, because what the review *recorded* is the evidence trail and what the
 * card *shows* is a summary of it. The heading keeps the raw count, so three
 * lines are still three findings and a reader can see the repetition for the
 * noise it is.
 */
function criticalField(findings: Finding[]): DiscordEmbedField | null {
  const critical = findings.filter((f) => f.severity === "critical");
  if (critical.length === 0) return null;

  const groups = new Map<
    string,
    { title: string; where: string; evidence: string; checks: string[]; count: number }
  >();
  for (const f of critical) {
    const title = clean(f.title, 180);
    const path = f.path ? clean(f.path, 120) : "";
    const where = path ? ` \`${path}${f.line ? `:${f.line}` : ""}\`` : "";
    const evidence = f.evidence ? clean(f.evidence, MAX_EVIDENCE) : "";
    const key = `${title}\u0000${where}\u0000${evidence}`;
    const check = clean(f.check, 60);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (!group.checks.includes(check)) group.checks.push(check);
    } else {
      groups.set(key, { title, where, evidence, checks: [check], count: 1 });
    }
  }

  const shown = [...groups.values()].slice(0, MAX_CRITICAL_SHOWN);
  const lines = shown.map((g) => {
    const who = g.checks.length > 1 ? ` — ${g.checks.join(", ")}` : "";
    return `• ${g.title}${g.where}${who}${g.evidence ? `\n  ${g.evidence}` : ""}`;
  });
  const findingsShown = shown.reduce((n, g) => n + g.count, 0);
  if (critical.length > findingsShown) {
    lines.push(`+${critical.length - findingsShown} more in Cujo`);
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

/**
 * The author line: the pull request's opener when the run records one, Cujo
 * when it does not (decision 78). Null for a run recorded before the author
 * was stored, or one whose PR read never completed, in which case the line is
 * exactly what it was before the opener took it.
 *
 * The profile link is assembled rather than escaped, and only for a login the
 * allowlist below accepts: `clean` defangs `://`, which is the whole point of
 * it. The name goes through `plainText`, because the author line renders no
 * markdown and a backslash there is only litter. The avatar is still built
 * from the numeric account id, never the login, so a bot opener
 * (`dependabot[bot]`) keeps its icon while losing the link its login cannot
 * have.
 */
function authorLine(login: string | null, authorId: number | null): DiscordEmbed["author"] {
  if (!login) {
    // The fixed party, as before 76: name and mark together, and no footer
    // icon, which would repeat the mark one line below itself.
    return { name: truncate(CUJO_NAME, LIMITS.author), icon_url: CUJO_ICON_URL };
  }
  const icon = avatarUrl(authorId);
  const url = LOGIN.test(login) ? `https://github.com/${login}` : undefined;
  return {
    name: plainText(`@${login}`, LIMITS.author),
    ...(icon ? { icon_url: icon } : {}),
    ...(url ? { url } : {}),
  };
}

/** Everything Discord counts against the 6000-character embed budget. */
export function embedLength(embed: DiscordEmbed): number {
  let total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
  total += embed.footer?.text.length ?? 0;
  // Counted by Discord like any other text. Neither icon URL is.
  total += embed.author?.name.length ?? 0;
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
  links: UiLinks;
}

/**
 * `repo #n — <pr title>`, or `repo #n` when the run never recorded one. The
 * one shape both a card and a ping title take: the ping sits directly under
 * the card in the channel, and two spellings of the same run would read as
 * two runs.
 */
function runTitle(run: RunRecord): string {
  const heading = escapeMarkdown(`${run.repo} #${run.prNumber}`);
  return run.prTitle
    ? truncate(`${heading} — ${escapeMarkdown(run.prTitle)}`, LIMITS.title)
    : truncate(heading, LIMITS.title);
}

/**
 * One embed per run, edited in place as the run's status moves. The `running`
 * card carries only immutable facts, because the card is rewritten on a status
 * change and any progress count would freeze and then lie.
 *
 * The title and the author come off the run, which joins them from the store,
 * so this stays pure and every status renders from one read.
 */
export function buildRunCard(input: CardInput): DiscordMessagePayload {
  const { run, projection, links } = input;
  const status = run.status;
  const title = runTitle(run);

  let description = DESCRIPTION[status];
  if ((status === "blocked_posted" || status === "denied") && run.approver) {
    description +=
      run.approver === "external"
        ? " Decided outside Cujo."
        : ` Decided by ${clean(run.approver, 120)}.`;
  }

  const prUrl = pullRequestUrl(run);
  const fields: DiscordEmbedField[] = [
    { name: "Head", value: `\`${run.headSha.slice(0, 7)}\``, inline: true },
    // Structural, not derived: the repo was validated when the channel was
    // bound and shape-checked in `pullRequestUrl`, so the field is omitted
    // rather than risked when the stored repo is not `owner/name`. On a
    // private run, whose title points nowhere (decision 57), this is the
    // card's only live link.
    ...(prUrl ? [{ name: "Pull request", value: prUrl, inline: true }] : []),
  ];
  // A superseded run describes a commit nobody is looking at any more, so it
  // shows no findings: acting on them would mean acting on a stale review.
  if (status !== "running" && status !== "superseded") {
    // Inline and adjacent to Head and Pull request, because Discord only
    // shares a row between neighbouring inline fields, and first in the
    // clamp's drop order: the identity row is what every status must keep.
    const counts = countsField(projection.findings);
    if (counts) fields.push(counts);
    const critical = criticalField(projection.findings);
    if (critical) fields.push(critical);
    const checks = checksField(projection);
    if (checks) fields.push(checks);
    const error = textField("Error", projection.error);
    if (error) fields.push(error);
    const summary = status === "clean" ? textField("Summary", projection.summary) : null;
    if (summary) fields.push(summary);
  }

  const footer = `run ${run.id.slice(0, 8)} · ${run.headSha.slice(0, 7)}`;
  const url = runUrl(links, run);
  const embed = clamp({
    title,
    // Ours, never derived. No projection string may reach a URL field, or a
    // hostile PR chooses where the card's title points. The key is omitted
    // rather than set to null when there is no page — a private run has none
    // (decision 57), and Discord refuses a null `url`. The title still renders,
    // just not as a hyperlink.
    ...(url ? { url } : {}),
    description: truncate(description, LIMITS.description),
    color: COLOR[status],
    author: authorLine(run.prAuthorLogin, run.prAuthorId),
    fields,
    footer: {
      text: truncate(footer, LIMITS.footer),
      // The Cujo mark while the opener holds the author line (decision 78),
      // so Cujo stays inside the embed without being named twice above it.
      // Absent on the fallback, where the author line already carries it: the
      // same icon twice on one card reads as a bug.
      ...(run.prAuthorLogin ? { icon_url: CUJO_ICON_URL } : {}),
    },
    timestamp: run.updatedAt,
  });

  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

export interface PingInput {
  run: RunRecord;
  /** The ping's description counts criticals, so it reads the same fold. */
  projection: Projection;
  links: UiLinks;
  /** Null pings the channel without mentioning anyone. */
  roleId: string | null;
}

/**
 * A Discord edit notifies nobody, so the one moment that needs a human — a run
 * waiting on approval — gets its own message, and its own card (decision 78):
 * a slim embed in the run's colour, sitting directly under the run card in the
 * channel and carrying only the pull request, the critical count and the fact
 * that a person is blocked. Anything it repeated from the card above it would
 * be noise.
 *
 * `content` stays structural (rule 8): the repo was validated when the channel
 * was bound, the number is a number, and the link is ours — wrapped in angle
 * brackets so Discord does not unfurl it beside the embed Cujo just built. The
 * embed is not structural: its title carries the pull request's title, which
 * is stranger-authored text on a payload for the first time, so it goes
 * through the same escaping, truncation and clamping as the run card's.
 *
 * A private run has no page (decision 57), so its ping renders with the title
 * unlinked — the same rule the card applies. That is where the answer is
 * anyway: the decision is `/cujo confirm` on the pull request, not a button
 * on a board.
 *
 * Once the run leaves `blocked_pending` this same message is edited in place:
 * the embed is recoloured to the outcome and the content says resolved, so
 * nobody chases a link to a run that can no longer be decided.
 */
export function buildPing(input: PingInput): DiscordMessagePayload {
  const { run, projection, links, roleId } = input;
  const blocked = run.status === "blocked_pending";
  // Escaped the same way the embed heading is: a repo name may hold `_`, which
  // Discord reads as emphasis. Not `clean`, and not applied to the whole
  // string, because `escapeMarkdown` also defangs URLs — running it over the
  // finished content would break Cujo's own link.
  const where = escapeMarkdown(`${run.repo} #${run.prNumber}`);
  const link = runUrl(links, run);
  // Angle brackets rather than a bare URL: the brackets keep the link
  // clickable and stop Discord previewing the site beneath the embed, which
  // was a grey box saying nothing for every run that has ever been posted.
  // The suffix is built rather than interpolated so no trailing space is
  // left when there is no link.
  const suffix = link ? ` <${link}>` : "";
  const mention = blocked && roleId ? `<@&${roleId}> ` : "";
  const content = truncate(
    blocked
      ? `${mention}Cujo is blocked on ${where} and needs a human.${suffix}`
      : `Resolved (${run.status}) — ${where}.${suffix}`,
    LIMITS.content,
  );

  const critical = projection.findings.filter((f) => f.severity === "critical").length;
  const counted =
    critical === 0
      ? "No critical finding recorded."
      : critical === 1
        ? "1 critical finding."
        : `${critical} critical findings.`;
  const description = blocked
    ? `**Blocked — waiting for a human.** ${counted}`
    : `Resolved — ${DESCRIPTION[run.status]}`;

  const embed = clamp({
    title: runTitle(run),
    ...(link ? { url: link } : {}),
    description: truncate(description, LIMITS.description),
    color: COLOR[run.status],
  });

  return {
    content,
    embeds: [embed],
    allowed_mentions: blocked && roleId ? { parse: [], roles: [roleId] } : { parse: [] },
  };
}
