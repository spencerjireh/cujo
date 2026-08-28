/**
 * The second layer under the field allowlist (decision 37).
 *
 * The allowlist decides which fields exist and the scalar type stops a whole
 * object being spread into a call. What neither can catch is a secret that
 * arrives *inside* a string somebody was entitled to log — an upstream error
 * message, most of all. `github-mcp` was interpolating GitHub's raw response
 * body into an `Error` message that reached the logs, which is exactly that
 * shape.
 *
 * Rejected: handing the logger the process's real secrets and replacing them
 * by exact match. It is more precise than a pattern, and it makes a bug in the
 * logging path a total disclosure. The logger is given nothing to lose.
 */

/** Literal, so grepping for it tells you the scrubber fired. */
export const REDACTED = "[redacted]";

export const TRUNCATED = "…(truncated)";

/**
 * Shapes, not values. Each is anchored on a prefix a real credential carries,
 * so a benign string does not match: the test asserts an ordinary sentence
 * comes back byte-identical, because a scrubber that mangles normal text gets
 * turned off.
 */
const PATTERNS: readonly RegExp[] = [
  // Any PEM block, which is how the GitHub App private key would arrive.
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_.
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  // A JWT, which is the shape of a Cloudflare Access assertion.
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  // An Authorization header value that survived into a message.
  /\bBearer\s+[A-Za-z0-9._-]{16,}/g,
  // Model provider keys (OpenRouter, OpenAI-compatible).
  /\bsk-[A-Za-z0-9-]{16,}/g,
  // A Discord bot token. The trailing segment is open-ended on purpose: it was
  // 27 characters historically and is longer on tokens minted since, and a
  // pattern pinned to one length silently stops matching the newer shape.
  /\b[MNO][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{25,}/g,
];

/**
 * Replace first, then truncate. The other order would let a cap slice a secret
 * in half and print the front of it, which is the one outcome worth avoiding:
 * a partial credential is still a credential to somebody who has the rest.
 */
export function scrub(value: string, cap: number): string {
  let out = value;
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
  if (cap > 0 && out.length > cap) out = out.slice(0, cap) + TRUNCATED;
  return out;
}
