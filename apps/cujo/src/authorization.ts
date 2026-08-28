/**
 * May this Discord server manage this repo's review notifications
 * (spec Contract 8)?
 *
 * The answer comes from the repository first. A repo names its server in
 * `.cujo.yml` on the default branch, which makes the authority repo write
 * access — the thing that actually correlates with owning the repo — rather
 * than "someone holds a Cujo login". It is self-serve, auditable in git
 * history, and revoked by a commit (decision 31).
 *
 * The operator table stays as an override, for moving a repo between servers
 * or allowing one whose `.cujo.yml` cannot be changed.
 *
 * Neither half alone does anything: the server still has to run `/cujo watch`.
 * Without the repo's declaration anyone could point your repo's reviews at
 * their channel; without the server's command anyone could spam a server they
 * do not belong to.
 */

import type { GitHubReader } from "./github";
import type { Store } from "./store";

export type Authorization =
  | { allowed: true; source: "repo" | "operator" }
  | { allowed: false; reason: "not_declared" | "declared_elsewhere" };

export interface AuthorizationDeps {
  store: Store;
  github: GitHubReader;
}

export async function authorizationFor(
  deps: AuthorizationDeps,
  guildId: string,
  repo: string,
): Promise<Authorization> {
  if (deps.store.isGuildAuthorized(guildId, repo)) return { allowed: true, source: "operator" };
  const declared = await deps.github.declaredGuild(repo);
  if (declared === guildId) return { allowed: true, source: "repo" };
  // A repo that named a different server is a different message from one that
  // named none: the first is someone else's, the second is a missing line.
  return { allowed: false, reason: declared ? "declared_elsewhere" : "not_declared" };
}

/**
 * What to tell the person who ran the command. A refusal that does not say how
 * to fix it just sends them to find an operator, which is the errand this
 * whole change removes.
 */
export function explain(
  repo: string,
  guildId: string,
  authorization: Authorization & { allowed: false },
): string {
  if (authorization.reason === "declared_elsewhere") {
    return `\`${repo}\` names a different Discord server in its \`.cujo.yml\`. Change it there, or ask a Cujo operator to move it.`;
  }
  return [
    `\`${repo}\` has not named this server. Add this to \`.cujo.yml\` on its default branch:`,
    "```yaml",
    `discord_guild: "${guildId}"`,
    "```",
    "Merging that is what proves you control the repo.",
  ].join("\n");
}
