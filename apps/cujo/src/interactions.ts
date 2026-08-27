/**
 * The Discord interactions endpoint (spec Contract 8): the `/cujo` slash
 * command, verified and handled over HTTP. No gateway — Discord posts here.
 *
 * It lives on the webhook host, not the UI host, for decision 7's reason:
 * Discord cannot solve a Cloudflare Access challenge. So, exactly like the
 * GitHub webhook, the signature is the only thing standing between this route
 * and the internet, and it is checked on the raw body before anything is
 * parsed.
 *
 * What this endpoint may do is deliberately bounded. It routes notifications:
 * which channel, which role. It cannot approve a blocking review, and adding
 * that is a change to the human gate, not a feature (decision 27).
 */

import { createPublicKey, verify as verifySignature } from "node:crypto";
import { Hono } from "hono";
import {
  GUILD_ANNOUNCEMENT,
  GUILD_TEXT,
  REQUIRED_PERMISSIONS,
  effectivePermissions,
  hasPermissions,
} from "./discord";
import type { DiscordClient } from "./discord";
import { buildRunCard } from "./discord-card";
import { MANAGE_GUILD } from "./discord-commands";
import { emptyProjection } from "./folder";
import type { GitHubReader } from "./github";
import type { Store } from "./store";

/** Interaction types. */
const PING = 1;
const APPLICATION_COMMAND = 2;
const AUTOCOMPLETE = 4;

/** Interaction callback types. */
const PONG = 1;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const AUTOCOMPLETE_RESULT = 8;

/** Only the invoker sees the reply, so configuring makes no channel noise. */
const EPHEMERAL = 1 << 6;

/** Discord's own cap on an autocomplete response. */
const MAX_CHOICES = 25;

/**
 * Autocomplete cannot be deferred and Discord allows three seconds, so a cold
 * repo cache must lose rather than hang the picker.
 */
const AUTOCOMPLETE_BUDGET_MS = 2_000;

const HEX = /^[0-9a-f]+$/i;
/** Ed25519 SPKI prefix, so a raw 32-byte key can become a KeyObject. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verify one interaction: Ed25519 over `timestamp + rawBody`, both header
 * values hex. Anything malformed is refused before reaching the crypto, since
 * a bad length there throws rather than returning false.
 */
export function verifyInteraction(input: {
  publicKey: string;
  signature: string | undefined;
  timestamp: string | undefined;
  body: string;
}): boolean {
  const { publicKey, signature, timestamp, body } = input;
  if (!signature || !timestamp) return false;
  if (!HEX.test(signature) || signature.length !== 128) return false;
  if (!HEX.test(publicKey) || publicKey.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, "hex")]),
      format: "der",
      type: "spki",
    });
    return verifySignature(
      null,
      Buffer.from(`${timestamp}${body}`, "utf8"),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
  focused?: boolean;
}

interface Interaction {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  member?: { user?: { id: string }; permissions?: string };
  data?: { name: string; options?: CommandOption[] };
}

function subcommand(interaction: Interaction): CommandOption | null {
  return interaction.data?.options?.[0] ?? null;
}

function optionValue(command: CommandOption | null, name: string): string | null {
  const found = command?.options?.find((o) => o.name === name);
  return found?.value === undefined ? null : String(found.value);
}

function focusedValue(interaction: Interaction): string {
  for (const option of subcommand(interaction)?.options ?? []) {
    if (option.focused) return String(option.value ?? "");
  }
  return "";
}

const REPO = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

export interface InteractionDeps {
  /** The application's Ed25519 public key, hex. */
  publicKey: string;
  store: Store;
  discord: DiscordClient;
  github: GitHubReader;
  uiBaseUrl: string;
  /** Test hook: called once a deferred command has been answered. */
  onSettled?: (name: string) => void;
}

export function interactionRoutes(deps: InteractionDeps): Hono {
  const app = new Hono();

  /** Every command answers with one ephemeral line of text. */
  const run = async (interaction: Interaction): Promise<string> => {
    const command = subcommand(interaction);
    const guildId = interaction.guild_id;
    const userId = interaction.member?.user?.id;
    if (!guildId || !userId) return "Run this in a server, not a direct message.";
    // Discord already hides the command from members below Manage Server, but
    // that default can be changed per server, so it is checked here too.
    const permissions = BigInt(interaction.member?.permissions ?? "0");
    if ((permissions & BigInt(MANAGE_GUILD)) === 0n) {
      return "You need Manage Server to change Cujo's notifications here.";
    }
    if (command?.name === "status") return status(deps, guildId);

    const repo = optionValue(command, "repo");
    if (!repo || !REPO.test(repo)) return "That does not look like an `owner/name` repository.";
    const normalized = repo.toLowerCase();
    if (!deps.store.isGuildAuthorized(guildId, normalized)) {
      // Which repos a server may reach is an operator's decision, made over
      // the Access-gated API where it carries an email (decision 27).
      return `This server is not authorized for \`${normalized}\`. A Cujo operator has to allow it first.`;
    }

    if (command?.name === "unwatch") {
      const removed = deps.store.deleteDiscordChannel(normalized);
      return removed
        ? `Stopped sending \`${normalized}\` review updates here.`
        : `\`${normalized}\` was not being sent anywhere.`;
    }
    if (command?.name === "watch") {
      return watch(deps, { guildId, userId, repo: normalized, command });
    }
    if (command?.name === "test") return test(deps, guildId, normalized);
    return "Unknown command.";
  };

  app.post("/discord/interactions", async (c) => {
    // Raw body, before any parse: the signature covers the exact bytes sent.
    const body = await c.req.text();
    const ok = verifyInteraction({
      publicKey: deps.publicKey,
      signature: c.req.header("x-signature-ed25519"),
      timestamp: c.req.header("x-signature-timestamp"),
      body,
    });
    // Discord probes this with a deliberately bad signature when the endpoint
    // is saved, and refuses the URL unless it answers 401.
    if (!ok) return c.json({ ok: false, error: "bad signature" }, 401);

    let interaction: Interaction;
    try {
      interaction = JSON.parse(body) as Interaction;
    } catch {
      return c.json({ ok: false, error: "bad body" }, 400);
    }

    if (interaction.type === PING) return c.json({ type: PONG });

    if (interaction.type === AUTOCOMPLETE) {
      const choices = await repoChoices(deps, interaction);
      return c.json({ type: AUTOCOMPLETE_RESULT, data: { choices } });
    }

    if (interaction.type !== APPLICATION_COMMAND) {
      return c.json({ type: MESSAGE, data: { content: "Unsupported.", flags: EPHEMERAL } });
    }

    // Three seconds is not enough for the Discord round trips a bind needs, so
    // the reply is deferred and filled in once the work is done.
    void (async () => {
      let content: string;
      try {
        content = await run(interaction);
      } catch (error) {
        console.error("discord: command failed", error);
        content = "Something went wrong. The details are in Cujo's log.";
      }
      try {
        await deps.discord.editInteractionReply(interaction.application_id, interaction.token, {
          content,
          allowed_mentions: { parse: [] },
        });
      } catch (error) {
        console.error("discord: could not answer the command", error);
      }
      deps.onSettled?.(subcommand(interaction)?.name ?? "unknown");
    })();
    return c.json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  });

  return app;
}

/**
 * Complete the `repo:` box from the repos the App is installed on, narrowed to
 * the ones this server is authorized for — the list doubles as the answer to
 * "what can I bind here".
 */
async function repoChoices(
  deps: InteractionDeps,
  interaction: Interaction,
): Promise<{ name: string; value: string }[]> {
  const guildId = interaction.guild_id;
  if (!guildId) return [];
  const authorized = new Set(deps.store.listGuildRepos(guildId).map((a) => a.repo));
  if (authorized.size === 0) return [];
  let installed: string[];
  try {
    installed = await Promise.race([
      deps.github.installedRepos(),
      new Promise<string[]>((resolve) => {
        setTimeout(() => resolve([]), AUTOCOMPLETE_BUDGET_MS).unref();
      }),
    ]);
  } catch (error) {
    console.error("discord: could not list installed repos", error);
    installed = [];
  }
  // A cold cache or a GitHub hiccup falls back to what Cujo already knows,
  // rather than showing an empty picker.
  const candidates = installed.length > 0 ? installed : [...authorized];
  const typed = focusedValue(interaction).toLowerCase();
  return candidates
    .filter((repo) => authorized.has(repo.toLowerCase()))
    .filter((repo) => repo.toLowerCase().includes(typed))
    .slice(0, MAX_CHOICES)
    .map((repo) => ({ name: repo, value: repo }));
}

function status(deps: InteractionDeps, guildId: string): string {
  const authorizations = deps.store.listGuildRepos(guildId);
  if (authorizations.length === 0) {
    return "This server is not authorized for any repository yet.";
  }
  const lines = authorizations.map((authorization) => {
    const binding = deps.store.getDiscordChannel(authorization.repo);
    if (!binding || binding.guildId !== guildId) {
      return `• \`${authorization.repo}\` — authorized, not being sent anywhere`;
    }
    const role = binding.notifyRoleId ? `, pinging <@&${binding.notifyRoleId}>` : "";
    return `• \`${authorization.repo}\` → <#${binding.channelId}>${role}`;
  });
  return lines.join("\n");
}

async function watch(
  deps: InteractionDeps,
  input: { guildId: string; userId: string; repo: string; command: CommandOption | null },
): Promise<string> {
  const channelId = optionValue(input.command, "channel");
  if (!channelId) return "Pick a channel.";
  const roleId = optionValue(input.command, "role");

  const channel = await deps.discord.getChannel(channelId).catch(() => null);
  if (!channel) return "Cujo cannot see that channel.";
  if (channel.type !== GUILD_TEXT && channel.type !== GUILD_ANNOUNCEMENT) {
    return "That is not a text channel.";
  }
  // The option comes from this server's picker, but a request is a request:
  // nothing stops a crafted one naming a channel somewhere else.
  if (channel.guild_id !== input.guildId) return "That channel is not in this server.";

  const roles = await deps.discord.listRoles(input.guildId).catch(() => null);
  if (!roles) return "Cujo could not read this server's roles.";
  if (roleId && !roles.some((r) => r.id === roleId)) return "That role is not in this server.";

  // Reading a channel is not permission to post an embed in it.
  const me = await deps.discord.currentUser();
  const member = await deps.discord.guildMember(input.guildId, me.id);
  const permissions = effectivePermissions({
    guildId: input.guildId,
    memberId: me.id,
    memberRoles: member.roles,
    roles,
    overwrites: channel.permission_overwrites ?? [],
  });
  if (!hasPermissions(permissions, REQUIRED_PERMISSIONS)) {
    return `Cujo needs View Channel, Send Messages and Embed Links in <#${channelId}>.`;
  }

  deps.store.putDiscordChannel({
    repo: input.repo,
    channelId,
    guildId: input.guildId,
    channelName: channel.name ?? null,
    notifyRoleId: roleId,
    boundBy: `discord:${input.userId}`,
  });
  const role = roleId ? ` and ping <@&${roleId}> when one blocks` : "";
  return `\`${input.repo}\` review updates will go to <#${channelId}>${role}.`;
}

/**
 * Post a real card built from a placeholder run. It exercises the token, the
 * channel permissions and the rendering in one go, which nothing else can do
 * without waiting for an actual pull request.
 */
async function test(deps: InteractionDeps, guildId: string, repo: string): Promise<string> {
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
      createdAt: now,
      updatedAt: now,
    },
    projection: { ...emptyProjection(), status: "clean", summary: "Sample card from /cujo test." },
    prTitle: "Sample card",
    uiBaseUrl: deps.uiBaseUrl,
  });
  try {
    await deps.discord.createMessage(binding.channelId, card);
  } catch (error) {
    console.error("discord: test card failed", error);
    return `Cujo could not post to <#${binding.channelId}>. Check its permissions there.`;
  }
  return `Posted a sample card to <#${binding.channelId}>.`;
}
