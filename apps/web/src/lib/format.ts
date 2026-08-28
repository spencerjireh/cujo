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
