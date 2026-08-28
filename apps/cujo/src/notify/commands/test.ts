import { emptyProjection } from "../../review/fold";
import { buildRunCard } from "../card";
import type { CommandDeps } from "./index";

/**
 * Post a real card built from a placeholder run. It exercises the token, the
 * channel permissions and the rendering in one go, which nothing else can do
 * without waiting for an actual pull request.
 */
export async function test(deps: CommandDeps, guildId: string, repo: string): Promise<string> {
  const binding = deps.store.getDiscordChannel(repo);
  if (!binding || binding.guildId !== guildId) {
    return `\`${repo}\` is not being sent anywhere yet. Run \`/cujo watch\` first.`;
  }
  const now = new Date().toISOString();
  const card = buildRunCard({
    run: {
      id: "00000000-0000-0000-0000-000000000000",
      repo,
      prNumber: 0,
      headSha: "0000000",
      sessionId: "sample",
      turnIds: [],
      status: "clean",
      approver: null,
      decidedAt: null,
      isPublic: true,
      deliveryId: null,
      createdAt: now,
      updatedAt: now,
    },
    projection: { ...emptyProjection(), status: "clean", summary: "Sample card from /cujo test." },
    prTitle: "Sample card",
    links: deps.links,
  });
  try {
    await deps.discord.createMessage(binding.channelId, card);
  } catch (error) {
    console.error("discord: test card failed", error);
    return `Cujo could not post to <#${binding.channelId}>. Check its permissions there.`;
  }
  return `Posted a sample card to <#${binding.channelId}>.`;
}
