/**
 * The egress allowlist, validated on the trusted side.
 *
 * Moving egress enforcement out of the sandbox creates a crossing that did not
 * exist before (decision 116). The list comes from a repository's own
 * `.cujo.yml`, which is untrusted text, and it used to reach a process *inside*
 * the box — where getting it wrong could only weaken a control the pull request
 * already sat next to. It now configures a control outside the box, so the same
 * text is one step from the thing that decides what the sandbox may dial.
 *
 * So it is validated here, and refused rather than repaired. Hostnames only: no
 * CIDR, no port, no scheme, no path, no wildcard. A caller that sends one of
 * those has its request rejected, because silently dropping the part that did
 * not parse would leave a caller believing in an allowance it does not have —
 * the same argument `policy.py` makes for refusing half a policy.
 */

/** Long enough for any real hostname and short enough to bound a rule. */
const MAX_HOST_CHARS = 253;
/** Past this, a repository is describing a network rather than its dependencies. */
const MAX_HOSTS = 32;

/**
 * One label of a hostname: letters, digits and hyphens, not starting or ending
 * with one. Deliberately not a URL parser — `new URL()` accepts a scheme, a
 * port, credentials and an embedded newline, and every one of those is a thing
 * this must not take.
 */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type AllowlistResult =
  | { ok: true; hosts: string[] }
  | { ok: false; problem: string; host?: string };

/**
 * Whether any codepoint is a C0 control, DEL, or a C1 control.
 *
 * A codepoint scan rather than a regex: a regex holding a literal control
 * character is refused by the linter, and an escaped-range regex is the same
 * check written less plainly. The newline is the one that matters — the
 * allowlist reaches a gateway as one argument, and a newline inside an entry
 * would be a second rule nobody wrote.
 */
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
  // Named before the label check, because each of these has its own wrong idea
  // about what the field is for and a reader deserves to know which.
  if (host.includes("://")) return "carries a scheme; send a hostname";
  if (host.includes("/")) return "carries a path or a CIDR; send a hostname";
  if (host.includes(":")) return "carries a port; send a hostname";
  if (host.includes("*")) return "carries a wildcard, which is not supported";
  if (host.includes("@")) return "carries credentials";
  // Any control character, including the newline that would let one entry
  // become two in whatever config file a runtime writes.
  if (hasControlCharacter(host)) return "carries a control character";
  // Not an address. An allowlist of hostnames is resolved and filtered by name,
  // and an address would bypass the name it was supposed to stand for.
  if (/^[0-9.]+$/.test(host) || host.includes("[")) return "is an address; send a hostname";
  const labels = host.split(".");
  if (labels.length < 2) return "is not a fully qualified hostname";
  for (const label of labels) if (!LABEL.test(label)) return `has an invalid label ${label}`;
  return null;
}

/**
 * Normalise and check a list. Lowercased and de-duplicated, order preserved.
 *
 * Order is kept because a caller reading its own list back should see what it
 * sent; de-duplication is silent because two identical entries ask for the same
 * thing and refusing that would be pedantry rather than safety.
 */
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
