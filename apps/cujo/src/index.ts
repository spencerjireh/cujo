import { serve } from "@hono/node-server";
import { DiscordClient } from "./clients/discord";
import { GitHubReader } from "./clients/github";
import { Harness } from "./clients/trueforge";
import { loadConfig } from "./config";
import { createAccessVerifier, devVerifier } from "./http/operator/access";
import { createApp } from "./http/router";
import { COMMANDS } from "./notify/commands/definitions";
import { DiscordNotifier } from "./notify/notifier.service";
import { buildAgentSpec } from "./review/agent-spec";
import { ANY_RUN, type RunView, Runner } from "./review/runner.service";
import { Store } from "./store";

export { createApp } from "./http/router";

/**
 * Put `/cujo` in every server the bot is in. Per-guild rather than global,
 * because a guild command appears at once where a global one takes up to an
 * hour (decision 29); a full PUT, so the definition cannot drift from the code
 * across deploys. A server the bot joins later gets its commands at the next
 * start. Never fatal: the service notifies fine without commands.
 */
async function registerCommands(discord: DiscordClient): Promise<void> {
  try {
    const application = await discord.application();
    const guilds = await discord.listGuilds();
    for (const guild of guilds) {
      try {
        await discord.putGuildCommands(application.id, guild.id, COMMANDS);
        console.log(`discord: registered /cujo in ${guild.name}`);
      } catch (error) {
        console.error(`discord: could not register commands in ${guild.name}`, error);
      }
    }
  } catch (error) {
    console.error("discord: could not register slash commands", error);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const harness = new Harness(config);
  const runner = new Runner(store.runs, harness, { turnTimeoutMs: config.turnTimeoutMs });
  const github = new GitHubReader(config.githubAppId, config.githubAppPrivateKey);
  const spec = buildAgentSpec(config);

  // Contract 7. Optional: with no token the service runs and simply does not
  // notify. Subscribed before the rehydrate loop so a run that changed status
  // while the process was down is still reported.
  const discord = config.discordBotToken ? new DiscordClient(config.discordBotToken) : null;
  const notifier = discord
    ? new DiscordNotifier({ store, client: discord, github, uiBaseUrl: config.uiBaseUrl })
    : null;
  if (notifier) {
    runner.changes.on(ANY_RUN, (view: RunView | null) => notifier.onRunChanged(view));
  }

  // Contract 8. The slash commands need the application's public key as well
  // as the bot token; with either missing, notifications still work and the
  // interactions route is not mounted at all.
  const interactions =
    discord && config.discordPublicKey
      ? {
          publicKey: config.discordPublicKey,
          store: store.notifications,
          discord,
          github,
          uiBaseUrl: config.uiBaseUrl,
        }
      : null;
  if (interactions && discord) {
    void registerCommands(discord);
  }

  if (config.devNoAccess) {
    console.warn("CUJO_DEV_NO_ACCESS=1: the Access check is off; every operator route is open");
  }
  const verify = config.devNoAccess
    ? devVerifier
    : createAccessVerifier({ teamDomain: config.cfAccessTeamDomain, audience: config.cfAccessAud });

  // The server may still be starting. The process listens right away so the
  // container is healthy, but the webhook answers 503 until this succeeds.
  void harness.bootstrapUntilReady();

  for (const run of store.runs.listUnfinishedRuns()) {
    runner.rehydrate(run).catch((error) => console.error(`rehydrate ${run.id} failed`, error));
  }

  const app = createApp({
    uiHost: config.uiHost,
    internalHost: config.internalHost,
    webhookHost: config.webhookHost,
    api: {
      runs: store.runs,
      notifications: store.notifications,
      runner,
      verify,
      github,
      ...(discord ? { discord } : {}),
    },
    webhook: {
      secret: config.githubWebhookSecret,
      github,
      store: store.runs,
      runner,
      createSession: () => harness.createSession(spec),
      isReady: () => harness.ready,
    },
    ...(interactions ? { interactions } : {}),
  });

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    console.log(
      `cujo listening on :${config.port} (ui ${config.uiHost}, webhook ${config.webhookHost})`,
    );
  });
  // A send still in flight holds the message id that stops the next boot from
  // posting a duplicate card, so the queue is drained before the database is
  // closed. The deadline sits under Docker's default 10s stop grace.
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    runner.stopAll();
    server.close();
    void (notifier?.flush(5_000) ?? Promise.resolve()).finally(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
