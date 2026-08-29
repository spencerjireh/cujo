import { authorizationFor } from "../authorization";
import { type ChannelRefusal, checkChannel } from "../channel-check";
import type { CommandDeps } from "./index";

/**
 * The shared channel rule's refusals, said to a person rather than to a
 * machine. Each one names what to fix, since the invoker is the only one who
 * can fix it and a bare "that did not work" sends them looking for an operator.
 */
function refusalMessage(reason: ChannelRefusal, channelId: string): string {
  switch (reason) {
    case "unreadable_channel":
      return "Cujo cannot see that channel.";
    case "not_a_text_channel":
      return "That is not a text channel.";
    case "wrong_guild":
      return "That channel is not in this server.";
    case "unreadable_roles":
      return "Cujo could not read this server's roles.";
    case "no_such_role":
      return "That role is not in this server.";
    case "unreadable_permissions":
      return "Cujo could not check its permissions in that channel. Try again in a moment.";
    case "missing_permissions":
      return `Cujo needs View Channel, Send Messages and Embed Links in <#${channelId}>.`;
  }
}

export async function watch(
  deps: CommandDeps,
  input: {
    guildId: string;
    userId: string;
    repo: string;
    channelId: string | null;
    roleId: string | null;
  },
): Promise<string> {
  const channelId = input.channelId;
  if (!channelId) return "Pick a channel.";

  // One repo notifies one channel (Contract 7), so a repo another authorized
  // server already claimed is not this server's to redirect.
  const existing = deps.store.getDiscordChannel(input.repo);
  if (existing?.guildId && existing.guildId !== input.guildId) {
    return `\`${input.repo}\` is already being sent to another server. Change \`discord_guild\` in its \`.cujo.yml\` to move it.`;
  }

  // `expectGuildId`, because the option comes from this server's picker but a
  // request is a request: nothing stops a crafted one naming a channel
  // somewhere else.
  const check = await checkChannel(
    deps.discord,
    {
      channelId,
      roleId: input.roleId,
      expectGuildId: input.guildId,
    },
    deps.log,
  );
  if (!check.ok) return refusalMessage(check.reason, channelId);

  // Re-checked here, not only at dispatch: the Discord round trips above are
  // awaits, and a declaration reverted or an operator's allowance withdrawn in
  // the meantime must not end with a binding for a server that may no longer
  // see the repo.
  // `fresh`, so a declaration revoked while this command was awaiting Discord
  // is seen: a cached answer from before the command started would honour it.
  const still = await authorizationFor(deps, input.guildId, input.repo, { fresh: true });
  if (!still.allowed) return `This server is no longer allowed to watch \`${input.repo}\`.`;
  deps.store.putDiscordChannel({
    repo: input.repo,
    channelId,
    guildId: input.guildId,
    channelName: check.channelName,
    notifyRoleId: input.roleId,
    boundBy: `discord:${input.userId}`,
  });
  const role = input.roleId ? ` and ping <@&${input.roleId}> when one blocks` : "";
  return `\`${input.repo}\` review updates will go to <#${channelId}>${role}.`;
}
