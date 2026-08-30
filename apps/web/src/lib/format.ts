/** Presentation helpers. Pure, so they are covered by the data-layer tests. */

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function duration(startedAt?: string | null, endedAt?: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function elapsedMs(startedAt?: string | null, endedAt?: string | null): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

const UNITS: [limit: number, divisor: number, name: Intl.RelativeTimeFormatUnit][] = [
  [60_000, 1_000, "second"],
  [3_600_000, 60_000, "minute"],
  [86_400_000, 3_600_000, "hour"],
  [Number.POSITIVE_INFINITY, 86_400_000, "day"],
];

export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  const delta = now - at;
  const magnitude = Math.abs(delta);
  const unit = UNITS.find(([limit]) => magnitude < limit) ?? UNITS[UNITS.length - 1];
  if (!unit) return "unknown";
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  return formatter.format(-Math.round(delta / unit[1]), unit[2]);
}

/**
 * A timestamp rendered from the ISO string alone — no clock, no locale, no
 * timezone — so the server and the browser always produce the same characters.
 * This is what a relative time shows before hydration; `relativeTime` reads the
 * clock and would otherwise mismatch.
 */
export function absoluteTime(iso: string): string {
  if (!Number.isFinite(Date.parse(iso))) return "unknown";
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * A token count, short enough to sit in a table cell.
 *
 * Rounded to one decimal and never to zero: a count that exists is drawn as
 * something, because `0` on this scale would read as "cost nothing" when the
 * thing it means is "fewer than a hundred". Below a thousand the exact number
 * fits, so it is kept.
 */
export function compactCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude < 1_000) return String(Math.round(value));
  if (magnitude < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * A cost, at the precision the number deserves. TrueForge's estimates land in
 * fractions of a cent, and `$0.00` beside a real figure is the same misreading
 * `compactCount` avoids — so anything under a cent gets four places.
 *
 * Four places is not enough on its own. A provider that priced a short call at
 * three hundredths of a cent rounds to `$0.0000`, which says free about a
 * number that is not — the exact failure the extra places were added to avoid,
 * moved two decimals down. Below what four places can show, the answer is a
 * bound rather than a rounding. Zero itself still prints as zero: an estimate
 * of nothing is a reading, not a value too small to draw.
 */
export function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.0001) return "<$0.0001";
  return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function bytes(value?: number): string {
  if (value === undefined) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** `owner/repo` plus a PR number is enough to address GitHub. */
export function prUrl(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

/**
 * A GitHub login, and nothing else. The same allowlist `apps/cujo` applies
 * before a login reaches a Discord card's URL (decision 55), restated here
 * because these types are mirrored by hand and a login arrives as text from an
 * API response. A bot login (`dependabot[bot]`) fails it by design: its
 * profile lives at `/apps/<name>`, so a bot is named and not linked.
 */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Null when the login must not become a link. */
export function profileUrl(login?: string | null): string | null {
  return login && LOGIN.test(login) ? `https://github.com/${login}` : null;
}

/**
 * Built from the numeric account id, never from the login. `s` is the rendered
 * width in CSS pixels doubled, which is what a retina display asks for.
 */
export function avatarUrl(authorId?: number | null, size = 40): string | null {
  return typeof authorId === "number"
    ? `https://avatars.githubusercontent.com/u/${authorId}?s=${size * 2}`
    : null;
}

// Signal numbers as `subprocess` reports them: a negative exit is the signal
// that ended the process. Only SIGTERM is marked expected, because the smoke
// check stops the server it booted with SIGTERM, so `-15` on that command is
// the check ending the run and not the run dying. A SIGKILL or SIGINT is
// nothing the check did on purpose.
const SIGNALS: Record<number, string> = {
  15: "SIGTERM, expected",
  9: "SIGKILL",
  2: "SIGINT",
};

/** An exit code in words a PR author can read without knowing signal numbers. */
export function describeExit(code: number | null | undefined): string {
  if (code === null || code === undefined) return "no exit";
  if (code >= 0) return `exit ${code}`;
  const signal = SIGNALS[-code] ?? `signal ${-code}`;
  return `exit ${code} (${signal})`;
}
