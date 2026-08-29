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
 * This file is the envelope: verify, answer the PING, complete the repo box,
 * defer the reply, pull the options out, and hand plain values to
 * `notify/commands`. What the commands may do is bounded there — they route
 * notifications, and none of them can approve a blocking review (decision 28).
 */

import { createPublicKey, verify as verifySignature } from "node:crypto";
import { errorFields } from "@cujo/log";
import { Hono } from "hono";
import type { DiscordClient } from "../../clients/discord";
import type { GitHubReader } from "../../clients/github";
import { type CommandDeps, runCommand } from "../../notify/commands";
import { MANAGE_GUILD } from "../../notify/commands/definitions";
import type { NotificationStore } from "../../store";
import type { RequestEnv } from "../request-log";

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

/** Discord's own caps: choices per response, and the length of each. */
const MAX_CHOICES = 25;
const MAX_CHOICE_LENGTH = 100;

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

export interface InteractionDeps extends CommandDeps {
  /** The application's Ed25519 public key, hex. */
  publicKey: string;
  store: NotificationStore;
  discord: DiscordClient;
  github: GitHubReader;
  /** Test hook: called once a deferred command has been answered. */
  onSettled?: (name: string) => void;
}

export function interactionRoutes(deps: InteractionDeps): Hono<RequestEnv> {
  const app = new Hono<RequestEnv>();

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
    return runCommand(deps, {
      name: command?.name ?? "",
      guildId,
      userId,
      repo: optionValue(command, "repo"),
      channelId: optionValue(command, "channel"),
      roleId: optionValue(command, "role"),
    });
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
        c.get("log").error("discord.command.failed", {
          guild_id: interaction.guild_id ?? null,
          ...errorFields(error),
        });
        content = "Something went wrong. The details are in Cujo's log.";
      }
      try {
        await deps.discord.editInteractionReply(interaction.application_id, interaction.token, {
          content,
          allowed_mentions: { parse: [] },
        });
      } catch (error) {
        c.get("log").error("discord.command.failed", {
          guild_id: interaction.guild_id ?? null,
          reason: "reply_failed",
          ...errorFields(error),
        });
      }
      deps.onSettled?.(subcommand(interaction)?.name ?? "unknown");
    })();
    return c.json({ type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
  });

  return app;
}

/**
 * Complete the `repo:` box from the repos the App is installed on. It stays
 * here rather than in notify/commands because it is not a command: it cannot
 * be deferred, it answers within three seconds or not at all, and it is part
 * of what this endpoint owes Discord rather than something a person invoked.
 */
async function repoChoices(
  deps: InteractionDeps,
  interaction: Interaction,
): Promise<{ name: string; value: string }[]> {
  const guildId = interaction.guild_id;
  if (!guildId) return [];
  let installed: string[];
  try {
    installed = await Promise.race([
      deps.github.installedRepos(),
      new Promise<string[]>((resolve) => {
        setTimeout(() => resolve([]), AUTOCOMPLETE_BUDGET_MS).unref();
      }),
    ]);
  } catch (error) {
    deps.log.error("discord.command.failed", {
      guild_id: guildId,
      reason: "installed_repos",
      ...errorFields(error),
    });
    installed = [];
  }
  // Everything Cujo could review, not everything this server may watch:
  // narrowing by authorization would mean reading each repo's `.cujo.yml` on
  // every keystroke. `watch` does one targeted read and says exactly what to
  // add if the repo has not named this server, which teaches more than a
  // missing row in a dropdown.
  //
  // The fallback for an unreachable GitHub is what this server already has
  // bound. It used to be the operator authorization table, which decision 57
  // deleted; the bindings are the nearest thing left that is local, and they
  // are the repos whose names the person typing already knows.
  const bound = deps.store
    .listDiscordChannels()
    .filter((binding) => binding.guildId === guildId)
    .map((binding) => binding.repo);
  const candidates = installed.length > 0 ? installed : bound;
  const typed = focusedValue(interaction).toLowerCase();
  return (
    candidates
      .filter((repo) => repo.toLowerCase().includes(typed))
      // A choice value must be the exact repo, and Discord caps it at 100
      // characters, so a longer name cannot be offered — it can still be
      // typed, and the bind accepts it.
      .filter((repo) => repo.length <= MAX_CHOICE_LENGTH)
      .slice(0, MAX_CHOICES)
      .map((repo) => ({ name: repo, value: repo }))
  );
}
