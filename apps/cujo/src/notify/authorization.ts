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
 * A deploy that serves one Discord server can name it in
 * `CUJO_DEFAULT_DISCORD_GUILD`, and a repo that declares nothing then belongs
 * to that server (decision 40). That is the deploy operator asserting something
 * about their own deploy, held in one id: every other server is refused by the
 * same comparison, so the declaration keeps working for anyone who needs it.
 *
 * Neither half alone does anything: the server still has to run `/cujo watch`.
 * Without the repo's declaration anyone could point your repo's reviews at
 * their channel; without the server's command anyone could spam a server they
 * do not belong to.
 */

import { type Logger, errorFields } from "@cujo/log";
import type { GitHubReader } from "../clients/github";
import type { NotificationStore } from "../store";

/**
 * `unknown` is not a refusal. GitHub being unreachable says nothing about what
 * a repo declares, and the two callers want opposite things from that: a
 * command refuses and asks for a retry, while the notifier keeps delivering to
 * a binding that was legitimately created. Collapsing it into "not allowed"
 * would let a GitHub hiccup silence a team's reviews.
 */
export type Authorization =
  | { allowed: true; source: "repo" | "operator" | "default" }
  | { allowed: false; reason: "not_declared" | "declared_elsewhere" | "unknown" };

export interface AuthorizationDeps {
  /** The process logger; every line names the plane it came from (decision 37). */
  log: Logger;
  store: NotificationStore;
  github: GitHubReader;
  /**
   * The server an undeclared repo belongs to, or null for none (decision 40).
   * This is one id and not a list, so it answers "is this *my* server?" and
   * never "is this any server?" — a stranger who invited the bot is refused by
   * the same comparison that allows the operator's own.
   */
  defaultGuild: string | null;
}

export async function authorizationFor(
  deps: AuthorizationDeps,
  guildId: string,
  repo: string,
  options: { fresh?: boolean } = {},
): Promise<Authorization> {
  if (deps.store.isGuildAuthorized(guildId, repo)) return { allowed: true, source: "operator" };
  let declared: string | null;
  try {
    declared = await deps.github.declaredGuild(repo, options);
  } catch (error) {
    deps.log.warn("discord.channel.unreadable", {
      repo,
      reason: "cujo_yml",
      ...errorFields(error),
    });
    return { allowed: false, reason: "unknown" };
  }
  if (declared === guildId) return { allowed: true, source: "repo" };
  // A repo that declared nothing falls to the deploy's own server, when it has
  // one. Deliberately after the read and not before it: a repo that named a
  // server has spoken, and the default must not overrule it (decision 40).
  if (!declared && deps.defaultGuild && guildId === deps.defaultGuild) {
    return { allowed: true, source: "default" };
  }
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
  if (authorization.reason === "unknown") {
    return `Cujo could not read \`${repo}\`'s \`.cujo.yml\` just now. Try again in a moment.`;
  }
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
