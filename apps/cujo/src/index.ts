import { serve } from "@hono/node-server";
import { createAccessVerifier, devVerifier } from "./access";
import { buildAgentSpec } from "./agent";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { GitHubReader } from "./github";
import { Runner } from "./runner";
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

  if (config.devNoAccess) {
    console.warn("CUJO_DEV_NO_ACCESS=1: the Access check is off; every operator route is open");
  }
  const verify = config.devNoAccess
    ? devVerifier
    : createAccessVerifier({ teamDomain: config.cfAccessTeamDomain, audience: config.cfAccessAud });

  try {
    const applied = await harness.bootstrap();
    console.log(`trueforge bootstrap: ${applied.join(", ")}`);
  } catch (error) {
    // The server may still be starting; a later webhook fails loudly if this
    // never succeeds, and a restart retries.
    console.error("trueforge bootstrap failed", error);
  }

  for (const run of store.listUnfinishedRuns()) {
    runner.rehydrate(run).catch((error) => console.error(`rehydrate ${run.id} failed`, error));
  }

  const app = createApp({
    uiHost: config.uiHost,
    webhookHost: config.webhookHost,
    api: { store, runner, verify },
    webhook: {
      secret: config.githubWebhookSecret,
      github,
      store,
      runner,
      createSession: () => harness.createSession(spec),
    },
  });

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    console.log(
      `cujo listening on :${config.port} (ui ${config.uiHost}, webhook ${config.webhookHost})`,
    );
  });
  const shutdown = () => {
    runner.stopAll();
    server.close();
    store.close();
    process.exit(0);
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
