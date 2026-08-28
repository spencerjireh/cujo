import type { CommandDeps } from "./index";

/**
 * Stop sending a repo's reviews here.
 *
 * Reachable without authorization on purpose (see the ordering in index.ts): a
 * server must always be able to stop receiving, even for a repo that revoked
 * its declaration or whose App installation is gone.
 */
export function unwatch(deps: CommandDeps, input: { guildId: string; repo: string }): string {
  // A binding is global to the repo, so a server may only take down its own:
  // otherwise one server could silence another's reviews.
  const existing = deps.store.getDiscordChannel(input.repo);
  if (!existing) return `\`${input.repo}\` was not being sent anywhere.`;
  if (existing.guildId !== input.guildId) {
    return `\`${input.repo}\` is being sent to another server. A Cujo operator can move it.`;
  }
  deps.store.deleteDiscordChannel(input.repo);
  return `Stopped sending \`${input.repo}\` review updates here.`;
}
