import { type Logger, createLogger, errorFields } from "@cujo/log";
import { serve } from "@hono/node-server";
import { DiscordClient } from "./clients/discord";
import { GitHubReader } from "./clients/github";
import { GitHubReactions } from "./clients/github-reactions";
import { Harness } from "./clients/trueforge";
import { loadConfig } from "./config";
import { ConverseService } from "./converse/converse.service";
import { ConverseRateLimit } from "./converse/rate-limit";
import { createApp } from "./http/router";
import { COMMANDS } from "./notify/commands/definitions";
import { DiscordNotifier } from "./notify/notifier.service";
import { PrReactor } from "./notify/reactions.service";
import { buildAgentSpec, buildConverseSpec } from "./review/agent-spec";
import { publicRunId } from "./review/links";
import { PrCommandService } from "./review/pr-command.service";
import { ANY_RUN, type RunView, Runner } from "./review/runner.service";
import type { RunRecord } from "./review/types";
import { VisibilityService } from "./review/visibility.service";
import { Store } from "./store";

export { createApp } from "./http/router";

/**
 * Put `/cujo` in every server the bot is in. Per-guild rather than global,
 * because a guild command appears at once where a global one takes up to an
 * hour (decision 29); a full PUT, so the definition cannot drift from the code
 * across deploys. A server the bot joins later gets its commands at the next
 * start. Never fatal: the service notifies fine without commands.
 */
async function registerCommands(discord: DiscordClient, log: Logger): Promise<void> {
  try {
    const application = await discord.application();
    const guilds = await discord.listGuilds();
    for (const guild of guilds) {
      try {
        await discord.putGuildCommands(application.id, guild.id, COMMANDS);
        log.info("discord.commands.registered", { guild_id: guild.id });
      } catch (error) {
        log.warn("discord.commands.failed", { guild_id: guild.id, ...errorFields(error) });
      }
    }
  } catch (error) {
    log.warn("discord.commands.failed", errorFields(error));
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  // One process logger; every request gets a child of it bound to its ray, and
  // later a run gets a child bound to its delivery (decision 37).
  const log = createLogger({ service: "cujo", level: config.logLevel });
  const store = new Store(config.dbPath);
  const harness = new Harness(config, log);
  const runner = new Runner(store.runs, harness, { turnTimeoutMs: config.turnTimeoutMs }, log);
  const github = new GitHubReader(config.githubAppId, config.githubAppPrivateKey, fetch, log);
  const spec = buildAgentSpec(config);
  // Where a Discord card points. A public run links to the board anyone can
  // open; a private one has no page at all, so its card carries no link
  // (decision 54).
  const links = { publicBaseUrl: config.publicBaseUrl };

  // Contract 7. Optional: with no token the service runs and simply does not
  // notify. Subscribed before the rehydrate loop so a run that changed status
  // while the process was down is still reported.
  const discord = config.discordBotToken ? new DiscordClient(config.discordBotToken) : null;
  const notifier = discord
    ? new DiscordNotifier({
        log,
        store,
        client: discord,
        github,
        links,
        defaultGuild: config.defaultDiscordGuild,
      })
    : null;
  if (notifier) {
    runner.changes.on(ANY_RUN, (view: RunView | null) => notifier.onRunChanged(view));
  }

  // Decision 38. The pull request wears the run's status. Subscribed beside
  // the notifier and, like it, before the rehydrate loop, so a run that moved
  // while the process was down still reaches the pull request.
  const reactor = config.prReactions
    ? new PrReactor({
        log,
        reactions: new GitHubReactions(config.githubAppId, config.githubAppPrivateKey, fetch, log),
      })
    : null;
  if (reactor) {
    runner.changes.on(ANY_RUN, (view: RunView | null) => reactor.onRunChanged(view));
  } else {
    log.warn("service.started", { reason: "pr_reactions_off" });
  }

  // Design 2. `/cujo confirm` on the pull request is the human gate, so it is
  // composed here with the same GitHub client the reviews read through and the
  // same runner the operator route resumes. It reuses the reactor's write
  // client for the acknowledgement, and goes without one when reactions are
  // off — the reply is the answer, and the reaction is decoration.
  const prCommands = new PrCommandService({
    runs: store.runs,
    runner,
    github,
    reactions: config.prReactions
      ? new GitHubReactions(config.githubAppId, config.githubAppPrivateKey, fetch, log)
      : null,
  });

  // Design 3, and the only service that shares the harness client with the
  // reviewer without sharing anything else. Not built with `runner`: a
  // conversation turn must never reach `refold`, which writes run status and
  // repaints the pull request reaction (decision 47). `converseLimit: 0` turns
  // the whole feature off and the webhook still answers 200.
  const converse =
    config.converseLimit > 0
      ? new ConverseService({
          runs: store.runs,
          harness,
          github,
          spec: buildConverseSpec(config),
          limit: new ConverseRateLimit({
            limit: config.converseLimit,
            windowMs: config.converseWindowMs,
          }),
          turnTimeoutMs: config.converseTimeoutMs,
        })
      : null;
  if (!converse) log.warn("converse.disabled");

  // Contract 8. The slash commands need the application's public key as well
  // as the bot token; with either missing, notifications still work and the
  // interactions route is not mounted at all.
  const interactions =
    discord && config.discordPublicKey
      ? {
          log,
          publicKey: config.discordPublicKey,
          store: store.notifications,
          discord,
          github,
          links,
          defaultGuild: config.defaultDiscordGuild,
        }
      : null;
  if (interactions && discord) {
    void registerCommands(discord, log);
  }

  // The server may still be starting. The process listens right away so the
  // container is healthy, but the webhook answers 503 until this succeeds.
  void harness.bootstrapUntilReady();

  for (const run of store.runs.listUnfinishedRuns()) {
    runner
      .rehydrate(run)
      .catch((error) =>
        log.child({ run_id: run.id }).error("run.rehydrate.failed", errorFields(error)),
      );
  }

  // Reconciles the public board's `is_public` stamps behind the `repository`
  // webhook, and backfills the rows that predate the column (decision 34).
  const visibility = new VisibilityService({
    log,
    runs: store.runs,
    github,
    intervalMs: config.visibilityRecheckMs,
  });
  visibility.start();

  const app = createApp({
    log,
    internalHost: config.internalHost,
    webhookHost: config.webhookHost,
    public: {
      runs: store.runs,
      runner,
      streamLimit: config.publicStreamLimit,
    },
    webhook: {
      log,
      secret: config.githubWebhookSecret,
      github,
      store: store.runs,
      runner,
      // What the review's footer names. A public run gets its id; anything
      // else gets nothing, since a private run has no page for a stranger
      // reading the pull request to open. `github-mcp` turns the id into a
      // link, so no hostname passes through the agent (decision 36).
      reviewRunId: (run: RunRecord) => publicRunId(run),
      ...(reactor ? { onClaimed: (run: RunRecord) => reactor.markClaimed(run) } : {}),
      createSession: () => harness.createSession(spec),
      isReady: () => harness.ready,
      prCommands,
      ...(converse ? { converse } : {}),
    },
    ...(interactions ? { interactions } : {}),
  });

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    log.info("service.started", { port: config.port });
  });
  // A send still in flight holds the message id that stops the next boot from
  // posting a duplicate card, so the queue is drained before the database is
  // closed. The deadline sits under Docker's default 10s stop grace.
  let stopping = false;
  const shutdown = (reason: "sigterm" | "sigint") => () => {
    if (stopping) return;
    stopping = true;
    // What distinguishes a deploy from a crash in a log that otherwise just
    // ends: merging to main is a release, so this line is the difference
    // between "Coolify swapped the container" and "the process died".
    log.info("service.stopping", { reason });
    visibility.stop();
    runner.stopAll();
    server.close();
    void Promise.all([notifier?.flush(5_000), reactor?.flush(5_000)])
      // Nothing here rejects today, but this promise is not awaited and the
      // `.finally` has to run whatever happens: the store close and the exit
      // are the shutdown.
      .catch((error) => log.error("service.fatal", { reason: "flush", ...errorFields(error) }))
      .finally(() => {
        store.close();
        process.exit(0);
      });
  };
  process.on("SIGTERM", shutdown("sigterm"));
  process.on("SIGINT", shutdown("sigint"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // The logger may not exist yet — loadConfig throws on a missing required
    // variable — so this one keeps its own, at the default level.
    createLogger({ service: "cujo" }).error("service.fatal", errorFields(error));
    process.exit(1);
  });
}
