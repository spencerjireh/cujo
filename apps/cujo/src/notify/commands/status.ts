import type { CommandDeps } from "./index";
import { fitLines } from "./text";

/**
 * What this server is being sent. It does not try to enumerate every repo that
 * named this server: that would be one `.cujo.yml` read per installed repo, so
 * the closing line says how to add one instead.
 *
 * There is no longer an "allowed but not bound" state to report. The operator
 * override that produced it was deleted with its plane (decision 54), so a
 * repo either has a binding here or it does not.
 */
export function status(deps: CommandDeps, guildId: string): string {
  const repos = new Set<string>();
  for (const binding of deps.store.listDiscordChannels()) {
    if (binding.guildId === guildId) repos.add(binding.repo);
  }
  const lines = [...repos].sort().map((repo) => {
    const binding = deps.store.getDiscordChannel(repo);
    if (!binding || binding.guildId !== guildId) {
      return `• \`${repo}\` — not being sent anywhere`;
    }
    const role = binding.notifyRoleId ? `, pinging <@&${binding.notifyRoleId}>` : "";
    return `• \`${repo}\` → <#${binding.channelId}>${role}`;
  });
  const hint = `Any repo whose \`.cujo.yml\` says \`discord_guild: "${guildId}"\` can be watched here.`;
  if (lines.length === 0) return `Nothing is being sent to this server yet. ${hint}`;
  return fitLines([...lines, "", hint]);
}
