import type { CommandDeps } from "./index";
import { fitLines } from "./text";

/**
 * What this server is sending, plus anything an operator allowed that is not
 * being sent yet. It does not try to enumerate every repo that named this
 * server: that would be one `.cujo.yml` read per installed repo, so the
 * closing line says how to add one instead.
 */
export function status(deps: CommandDeps, guildId: string): string {
  const repos = new Set(deps.store.listGuildRepos(guildId).map((a) => a.repo));
  for (const binding of deps.store.listDiscordChannels()) {
    if (binding.guildId === guildId) repos.add(binding.repo);
  }
  const lines = [...repos].sort().map((repo) => {
    const binding = deps.store.getDiscordChannel(repo);
    if (!binding || binding.guildId !== guildId) {
      return `• \`${repo}\` — allowed, not being sent anywhere`;
    }
    const role = binding.notifyRoleId ? `, pinging <@&${binding.notifyRoleId}>` : "";
    return `• \`${repo}\` → <#${binding.channelId}>${role}`;
  });
  const hint = `Any repo whose \`.cujo.yml\` says \`discord_guild: "${guildId}"\` can be watched here.`;
  if (lines.length === 0) return `Nothing is being sent to this server yet. ${hint}`;
  return fitLines([...lines, "", hint]);
}
