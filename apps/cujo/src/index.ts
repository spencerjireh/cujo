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
import { buildAgentSpec, buildConverseSpec, specFingerprint } from "./review/agent-spec";
import { publicRunId } from "./review/links";
import { PrCommandService } from "./review/pr-command.service";
import { ANY_RUN, type RunView, Runner } from "./review/runner.service";
import { startRun } from "./review/start-run";
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
  const github = new GitHubReader(
    config.githubAppId,
    config.githubAppPrivateKey,
    fetch,
    log,
    config.botLogin,
  );
  const runner = new Runner(
    store.runs,
    harness,
    { turnTimeoutMs: config.turnTimeoutMs },
    log,
    github,
  );
  const spec = buildAgentSpec(config);
  // Where a Discord card points. A public run links to the board anyone can
  // open; a private one has no page at all, so its card carries no link
  // (decision 57).
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
        reactions: new GitHubReactions(
          config.githubAppId,
          config.githubAppPrivateKey,
          fetch,
          log,
          config.botLogin,
        ),
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
  // What every path that claims a run stamps on it. Read from the spec rather
  // than from `config`, so the digest is of the string a session would actually
  // be handed, tarball URL substituted and all.
  const provenance = { model: config.model, rubricSha256: specFingerprint(spec) };

  /**
   * The two statuses that mean a run still owns a live turn on its session.
   * `Runner.isTerminal` says the same thing and is private to it.
   */
  const inFlight = (status: RunRecord["status"]) =>
    status === "running" || status === "blocked_pending";

  /**
   * `/cujo review` (decision 63): claim the current head and start a turn on it.
   *
   * The same pieces the webhook route uses, composed once here so
   * `pr-command.service.ts` stays a policy module. Two differences from a
   * webhook claim, and both are the point of the verb: the head's existing run
   * is reclaimed, because `runs_head` is unique and a finished run is exactly
   * what a re-review displaces; and `startRun` is forced past the
   * already-reviewed guard, which exists to stop a redelivery reviewing the
   * same commit twice and would otherwise refuse this every time.
   */
  const startReview = async (input: {
    repo: string;
    prNumber: number;
    headSha: string;
    actor: string;
  }): Promise<{ ok: true } | { ok: false; detail: string }> => {
    // A repo GitHub will not answer about is one this run cannot decide the
    // visibility of, and `isPublic` decides whether the run gets a public page
    // at all (decision 34). Refuse rather than guess private and quietly
    // publish nothing.
    const visibility = await github.repoIsPublic(input.repo);
    if (visibility === "unknown") {
      return {
        ok: false,
        detail: "I could not tell whether this repository is public. Try again.",
      };
    }
    let sessionId = store.runs.getSession(input.repo, input.prNumber);
    if (!sessionId) {
      sessionId = store.runs.putSession(
        input.repo,
        input.prNumber,
        await harness.createSession(spec),
      );
    }
    // A run for this head that is still in flight owns a live turn on the
    // session. Deleting its row would leave that turn running: it would keep
    // folding into a row that no longer exists, and it could still post a
    // review for the head this command is about to review again. `supersede`
    // cancels the turn first, which is what the webhook path does for an older
    // head and what this path was missing.
    const existing = store.runs.runForPrHead(input.repo, input.prNumber, input.headSha);
    if (existing) {
      if (inFlight(existing.status)) {
        // The answer matters, and a resolved promise is not it. `supersede`
        // swallows a failed `cancelTurn` — the harness being unreachable is not
        // worth failing a supersession over — so it reports whether the turn is
        // *confirmed* stopped. It also declines to cancel when a human's
        // decision is landing on that run, because cancelling would kill the
        // turn that decision started. Either way, deleting the row while a turn
        // may still be alive is the one thing this must not do.
        const stopped = await runner.supersede(existing.id);
        if (!stopped) {
          return {
            ok: false,
            detail:
              "I could not confirm the current run for this commit has stopped, so I have left it alone. Try again shortly.",
          };
        }
      }
      // By id, and never "whatever owns this head now". Two concurrent
      // `/cujo review` commands both snapshot this same run and both wait on
      // its supersession; a delete that re-queried by head would have the
      // slower one delete the *replacement* the faster one just created, and
      // that replacement's `startRun` would carry on against a deleted row.
      store.runs.deleteRun(existing.id);
    }
    const { run, created } = store.runs.createRun({
      repo: input.repo,
      prNumber: input.prNumber,
      headSha: input.headSha,
      sessionId,
      isPublic: visibility === "public",
      deliveryId: null,
      ...provenance,
    });
    // The race's other half, and the database settles it: `runs_head` is UNIQUE
    // on (repo, pr_number, head_sha), so of two concurrent commands exactly one
    // insert wins and the loser says so rather than starting a second turn.
    if (!created) return { ok: false, detail: "A run for this commit is already starting." };
    log.info("run.claimed", {
      run_id: run.id,
      repo: run.repo,
      pr_number: run.prNumber,
      head_sha: run.headSha,
      reason: "pr_command",
    });
    reactor?.markClaimed(run);
    // Fire and forget, with a terminal catch: `startRun` handles its own
    // failures and marks the run, but an unhandled rejection here would take
    // the process down rather than the run.
    void startRun(
      {
        github,
        store: store.runs,
        runner,
        reviewRunId: (r: RunRecord) => publicRunId(r),
        log,
        ...(reactor ? { onClaimed: (r: RunRecord) => reactor.markClaimed(r) } : {}),
      },
      run,
      { force: true },
    ).catch((error) => log.error("run.prepare.failed", { run_id: run.id, ...errorFields(error) }));
    return { ok: true };
  };

  const prCommands = new PrCommandService({
    runs: store.runs,
    runner,
    github,
    startReview,
    reactions: config.prReactions
      ? new GitHubReactions(
          config.githubAppId,
          config.githubAppPrivateKey,
          fetch,
          log,
          config.botLogin,
        )
      : null,
    botLogin: config.botLogin,
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
          botLogin: config.botLogin,
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
      provenance,
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
