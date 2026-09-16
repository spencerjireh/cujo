/**
 * The rules `sandbox-mcp` applies to `allow_hosts`, on this side too
 * (decision 161).
 *
 * A copy of `apps/sandbox-mcp/src/allowlist.ts`, and deliberately one: the
 * two services share no package for it, and a policy the executor would
 * hand a box is worth refusing here, with the repository named, rather than
 * as a tool refusal two calls later. `tests/review/allowlist.test.ts` holds
 * the two to the same answers.
 */

const MAX_HOST_CHARS = 253;
const MAX_HOSTS = 32;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type AllowlistResult =
  | { ok: true; hosts: string[] }
  | { ok: false; problem: string; host?: string };

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function problemWith(host: string): string | null {
  if (host.length === 0) return "is empty";
  if (host.length > MAX_HOST_CHARS) return `is longer than ${MAX_HOST_CHARS} characters`;
  if (host.includes("://")) return "carries a scheme; send a hostname";
  if (host.includes("/")) return "carries a path or a CIDR; send a hostname";
  if (host.includes(":")) return "carries a port; send a hostname";
  if (host.includes("*")) return "carries a wildcard, which is not supported";
  if (host.includes("@")) return "carries credentials";
  if (hasControlCharacter(host)) return "carries a control character";
  if (/^[0-9.]+$/.test(host) || host.includes("[")) return "is an address; send a hostname";
  const labels = host.split(".");
  if (labels.length < 2) return "is not a fully qualified hostname";
  for (const label of labels) if (!LABEL.test(label)) return `has an invalid label ${label}`;
  return null;
}

export function validateAllowlist(raw: unknown): AllowlistResult {
  if (raw === undefined || raw === null) return { ok: true, hosts: [] };
  if (!Array.isArray(raw)) return { ok: false, problem: "allow_hosts has to be an array" };
  if (raw.length > MAX_HOSTS) {
    return { ok: false, problem: `allow_hosts holds more than ${MAX_HOSTS} entries` };
  }
  const hosts: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      return { ok: false, problem: "every entry of allow_hosts has to be a string" };
    }
    const host = entry.trim().toLowerCase();
    const problem = problemWith(host);
    if (problem !== null) return { ok: false, problem: `allow_hosts entry ${problem}`, host };
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { ok: true, hosts };
}
