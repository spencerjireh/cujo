/**
 * Staging a private repository's trees for its sandbox (decision 158).
 *
 * The sandbox holds no credential and never will, so a private repository
 * cannot be cloned in it. Instead the base and head trees are fetched here
 * with the installation token and streamed to `sandbox-mcp` under a ticket
 * minted per run; the brief carries the ticket where a public repository's
 * brief carries a clone URL, and `sandbox_create` with it copies both trees
 * into the box. The ticket is single use and short-lived, and nothing that
 * holds it can read the trees back.
 */
import { randomBytes } from "node:crypto";
import type { Logger } from "@cujo/log";
import type { GitHubReader } from "../clients/github";
import type { SandboxStager } from "../clients/sandbox-stage";

export interface StageDeps {
  github: Pick<GitHubReader, "archive">;
  stager: Pick<SandboxStager, "put">;
  log: Logger;
}

export function mintTicket(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Fetch and stage both trees; resolves to the ticket the brief carries.
 * Base first, then head, one at a time: two archives in flight would double
 * the memory a slow sandbox service makes this process hold.
 */
export async function stageTrees(
  deps: StageDeps,
  input: { repo: string; baseSha: string; headSha: string },
): Promise<string> {
  const ticket = mintTicket();
  let bytes = 0;
  for (const [tree, sha] of [
    ["base", input.baseSha],
    ["head", input.headSha],
  ] as const) {
    const archive = await deps.github.archive(input.repo, sha);
    bytes += await deps.stager.put(ticket, tree, archive);
  }
  deps.log.info("run.staged", { bytes });
  return ticket;
}
