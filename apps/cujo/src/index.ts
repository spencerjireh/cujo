import { serve } from "@hono/node-server";
import { createAccessVerifier, devVerifier } from "./access";
import { buildAgentSpec } from "./agent";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { DiscordClient } from "./discord";
import { GitHubReader } from "./github";
import { DiscordNotifier } from "./notifier";
import { ANY_RUN, type RunView, Runner } from "./runner";
import { Store } from "./store";
import { Harness } from "./trueforge";

export { createApp } from "./app";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const harness = new Harness(config);
  const runner = new Runner(store, harness, { turnTimeoutMs: config.turnTimeoutMs });
  const github = new GitHubReader(config.githubAppId, config.githubAppPrivateKey);
  const spec = buildAgentSpec(config);

  // Contract 7. Optional: with no token the service runs and simply does not
  // notify. Subscribed before the rehydrate loop so a run that changed status
  // while the process was down is still reported.
  const discord = config.discordBotToken ? new DiscordClient(config.discordBotToken) : null;
  const notifier = discord
    ? new DiscordNotifier({ store, client: discord, uiBaseUrl: config.uiBaseUrl })
    : null;
  if (notifier) {
    runner.changes.on(ANY_RUN, (view: RunView | null) => notifier.onRunChanged(view));
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

  for (const run of store.listUnfinishedRuns()) {
    runner.rehydrate(run).catch((error) => console.error(`rehydrate ${run.id} failed`, error));
  }

  const app = createApp({
    uiHost: config.uiHost,
    internalHost: config.internalHost,
    webhookHost: config.webhookHost,
    api: { store, runner, verify, ...(discord ? { discord } : {}) },
    webhook: {
      secret: config.githubWebhookSecret,
      github,
      store,
      runner,
      createSession: () => harness.createSession(spec),
      isReady: () => harness.ready,
    },
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
