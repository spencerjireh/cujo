/**
 * `.cujo.yml` at the base commit, as the executor reads it (decision 161).
 *
 * The file is the repository's own word on how to install and test itself
 * (spec Contract 2). Until now only the model read these keys, out of
 * `sniff.py prepare`'s output inside the box; the two scalar keys the trusted
 * side needed, `mode` and `discord_guild`, are still read by their own
 * regexes in `clients/github.ts`, which run earlier and have their own
 * tests. This reader is for the commands.
 *
 * Strict where it matters and lenient where it does not: a key the spec names
 * has to be the type the spec says, and a key it does not name is ignored.
 * A file that does not parse, or a key of the wrong shape, is `null` with a
 * line -- the run then takes the gather path, where the model reads the file
 * itself and says what it makes of it, which is what happened to every such
 * file before there was a reader here.
 */
import type { Logger } from "@cujo/log";
import { parse } from "yaml";
import { z } from "zod";
import type { GitHubReader } from "../clients/github";
import { validateAllowlist } from "./allowlist";

export interface Policy {
  install?: string;
  test?: string;
  boot?: string;
  smoke?: string[];
  allowHosts: string[];
}

/** A shell line, as the repository wrote it. Bounded: a command is not a script. */
const command = z.string().trim().min(1).max(4096);

const shape = z
  .object({
    install: command.optional(),
    test: command.optional(),
    boot: command.optional(),
    smoke: z.array(z.string().trim().min(1).max(512)).max(64).optional(),
    allow_hosts: z.unknown().optional(),
  })
  .passthrough();

/** Parse the file's text. Exposed for the tests; `readPolicy` is the caller. */
export function parsePolicy(text: string): { policy: Policy } | { problem: string } {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { problem: `not YAML: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (raw === null || raw === undefined) return { policy: { allowHosts: [] } };
  if (typeof raw !== "object" || Array.isArray(raw)) return { problem: "not a mapping" };
  const parsed = shape.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { problem: `${issue?.path.join(".") || "file"} ${issue?.message ?? "is invalid"}` };
  }
  const hosts = validateAllowlist(parsed.data.allow_hosts);
  if (!hosts.ok) return { problem: hosts.problem };
  const policy: Policy = { allowHosts: hosts.hosts };
  if (parsed.data.install !== undefined) policy.install = parsed.data.install;
  if (parsed.data.test !== undefined) policy.test = parsed.data.test;
  if (parsed.data.boot !== undefined) policy.boot = parsed.data.boot;
  if (parsed.data.smoke !== undefined) policy.smoke = parsed.data.smoke;
  return { policy };
}

/**
 * The policy at `ref`, or null: absent, or present and not something the
 * executor may act on. Only the second logs, since a repository with no file
 * is the common case and not a condition.
 */
export async function readPolicy(
  github: Pick<GitHubReader, "readFile">,
  log: Logger,
  repo: string,
  ref: string,
): Promise<Policy | null> {
  const text = await github.readFile(repo, ".cujo.yml", ref);
  if (text === null) return null;
  const result = parsePolicy(text);
  if ("problem" in result) {
    log.warn("policy.invalid", { repo, reason: result.problem });
    return null;
  }
  return result.policy;
}
