import { type Logger, createLogger, errorFields } from "@cujo/log";
import { serve } from "@hono/node-server";
import { DiscordClient } from "./clients/discord";
import { GitHubReader } from "./clients/github";
import { GitHubChecks } from "./clients/github-checks";
import { GitHubOAuth } from "./clients/github-oauth";
import { GitHubReactions } from "./clients/github-reactions";
import { Harness } from "./clients/harness";
import { OcrSidecar } from "./clients/ocr-sidecar";
import { loadConfig } from "./config";
import { ConverseService } from "./converse/converse.service";
import { ConverseRateLimit } from "./converse/rate-limit";
import { createApp } from "./http/router";
import { PrChecks } from "./notify/checks.service";
import { COMMANDS } from "./notify/commands/definitions";
import { DiscordNotifier } from "./notify/notifier.service";
import { PrReactor } from "./notify/reactions.service";
import {
  buildAgentSpec,
  buildConverseSpec,
  buildDiffSpec,
  loadRubric,
  specFingerprint,
} from "./review/agent-spec";
import { PrCommandService } from "./review/commands/pr-command.service";
import { publicRunId } from "./review/links";
import { PushDebounce } from "./review/push-debounce";
import { RegistryService } from "./review/registry.service";
import { ANY_RUN, type RunView, Runner } from "./review/runner.service";
import type { DiffReviewDeps } from "./review/start-run";
import { startRun } from "./review/start-run";
import type { RunRecord } from "./review/types";
import { VisibilityService } from "./review/visibility.service";
import { Settings, seedFromConfig } from "./settings";
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
  // Where a link to a run points. A public run links to the board anyone can
  // open; a private one has no page at all, so its card and its comments carry
  // no link (decision 57). Built before the runner because the runner needs it
  // too, for the one comment a run may post (decisions 109, 110).
  const links = { publicBaseUrl: config.publicBaseUrl };
  const runner = new Runner(
    store.runs,
    harness,
    { turnTimeoutMs: config.turnTimeoutMs, diffTurnTimeoutMs: config.diffTimeoutMs, links },
    log,
    github,
    store.detonations,
  );
  // The settings an owner changes at runtime (decision 152): seeded from the
  // environment once, read at use from here on. The specs are built per
  // session on the values of that moment; the rubrics are read once.
  const settings = Settings.open(store.settings, seedFromConfig(config), log);
  harness.modelProvider = () => settings.current().modelProvider;
  settings.onChange((key, current) => {
    if (key !== "modelProvider" || !current.modelProvider) return;
    void harness
      .registerModelProvider(current.modelProvider)
      .catch((error) => log.error("settings.provider.failed", errorFields(error)));
  });
  const rubric = loadRubric();
  const diffRubric = loadRubric("DIFF.md");
  const converseRubric = loadRubric("CONVERSE.md");
  const spec = () => buildAgentSpec(settings.current(), rubric);
  const diffSpec = () => buildDiffSpec(settings.current(), diffRubric);

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

  // Decision 138. The commit wears the run's status as a check run, which is
  // the merge lock. Subscribed like the reactor, before the rehydrate loop.
  const checks = config.prChecks
    ? new PrChecks({
        log,
        checks: new GitHubChecks(config.githubAppId, config.githubAppPrivateKey, fetch),
        links,
        runs: store.runs,
      })
    : null;
  if (checks) {
    runner.changes.on(ANY_RUN, (view: RunView | null) => checks.onRunChanged(view));
  } else {
    log.warn("service.started", { reason: "pr_checks_off" });
  }
  // What a claimed run tells the pull request before any turn exists: the eye
  // and the in-progress check, both from the moment the head is known to be
  // the one worth starting.
  const onClaimed = (run: RunRecord): void => {
    reactor?.markClaimed(run);
    checks?.markClaimed(run);
  };
  // A push burst is one run (decision 144): a `synchronize` waits out the
  // window before its run starts, and a newer push inside it takes the slot.
  const debounce = new PushDebounce(config.pushDebounceMs);

  // `/cujo dismiss` on the pull request is the unlock (decisions 45, 138), so
  // it is composed here with the same GitHub client the reviews read through
  // and the same runner that writes every status. It reuses the reactor's
  // write client for the acknowledgement, and goes without one when reactions
  // are off — the reply is the answer, and the reaction is decoration.
  // What every path that claims a run stamps on it. Read from the spec rather
  // than from `config`, so the digest is of the string a session would actually
  // be handed, tarball URL substituted and all.
  const provenance = {
    get model() {
      return settings.current().model;
    },
    rubricSha256: specFingerprint(spec()),
  };
  // The shadow review (decision 149). Optional: with no sidecar URL no run
  // asks, and the table stays empty.
  const ocr = config.ocrSidecarUrl
    ? { client: new OcrSidecar(config.ocrSidecarUrl, config.ocrTimeoutMs), store: store.ocr }
    : undefined;

  // The diff review's half of the same (Contract 11): its own spec, so its own
  // digest and model, plus the budget the spec carries; a fresh session per
  // run (decision 137); and the three caps `prepare` cuts the package to.
  const diffRubricSha256 = specFingerprint(diffSpec());
  const diff: DiffReviewDeps = {
    get deployDefault() {
      return settings.current().reviewMode;
    },
    createSession: () => harness.createSession(diffSpec()),
    get provenance() {
      const current = settings.current();
      return {
        model: current.diffModel,
        rubricSha256: diffRubricSha256,
        budgetTokens: current.diffBudgetTokens,
      };
    },
    caps: { diffBytes: config.diffBytes, standardsFileBytes: 16_000, standardsTotalBytes: 48_000 },
  };

  /**
   * The one status that means a run still owns a live turn on its session.
   * `Runner.isTerminal` says the same thing and is private to it.
   */
  const inFlight = (status: RunRecord["status"]) => status === "running";

  /**
   * `/cujo review` (decision 63): claim the current head and start a turn on it.
   *
   * The same pieces the webhook route uses, composed once here so
   * `review/commands/pr-command.service.ts` stays a policy module. Two
   * differences from a webhook claim, and both are the point of the verb: the
   * head's existing run is reclaimed, because `runs_head` is unique and a
   * finished run is exactly what a re-review displaces; and `startRun` is
   * forced past the already-reviewed guard, which exists to stop a redelivery
   * reviewing the same commit twice and would otherwise refuse this every time.
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
    // A run for this head that is still in flight owns a live turn on the
    // session. Deleting its row would leave that turn running: it would keep
    // folding into a row that no longer exists, and it could still post a
    // review for the head this command is about to review again. `supersede`
    // cancels the turn first, which is what the webhook path does for an older
    // head and what this path was missing.
    const existing = store.runs.runForPrHead(input.repo, input.prNumber, input.headSha);
    if (existing) {
      // The answer matters, and a resolved promise is not it. `supersede`
      // swallows a failed `cancelTurn` — the harness being unreachable is not
      // worth failing a supersession over — so it reports whether the turn is
      // *confirmed* stopped. Deleting the row while a turn may still be alive
      // is the one thing this must not do. A finished run takes the same
      // path: `supersede` moves its row and emits, so its ping and its check
      // run hear that a newer run owns this commit (decision 138).
      const stopped = await runner.supersede(existing.id);
      if (!stopped && inFlight(existing.status)) {
        return {
          ok: false,
          detail:
            "I could not confirm the current run for this commit has stopped, so I have left it alone. Try again shortly.",
        };
      }
      // Supersede rather than delete (decision 104): the old run's posted
      // review stays on the PR with an evidence footer that still resolves.
      // The partial unique index on runs_head excludes terminal statuses,
      // so the superseded row does not block the replacement's insert.
    }
    // A fresh session, always (decision 150). On the pull request's existing
    // session the model reads its own earlier review of this head in the
    // history and declines to post a second one: orders-api #45 on
    // 2026-09-14 ended in one message, "already reviewed in the prior
    // turn", and no review. After the supersede above, so no live turn is
    // stranded on the session this replaces; the next push follows it.
    const sessionId = store.runs.replaceSession(
      input.repo,
      input.prNumber,
      await harness.createSession(spec()),
    );
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
        diff,
        detonations: store.detonations,
        ocr,
        reviewRunId: (r: RunRecord) => publicRunId(r),
        log,
        onClaimed,
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
          spec: () => buildConverseSpec(settings.current(), converseRubric),
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
          resetSession: (repo: string, prNumber: number) => {
            const busy = store.runs.listUnfinishedRuns({ repo, prNumber })[0];
            if (busy) return { kind: "busy" as const, runId: busy.id };
            return { kind: "reset" as const, sessions: store.runs.deleteSessions(repo, prNumber) };
          },
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

  // Which repositories the App holds (decision 151): the installation
  // webhooks are the fast path, this fills the table at boot and reconciles
  // behind them.
  const registry = new RegistryService({
    log,
    repositories: store.repositories,
    github,
    intervalMs: config.registrySyncMs,
  });
  registry.start();

  // Expired board sessions and abandoned sign-ins (decision 153) go once an
  // hour. No line: an empty sweep is the normal outcome, and a session that
  // expired said so to its owner at the 401.
  const sessionSweep = setInterval(() => store.webSessions.sweep(new Date()), 60 * 60 * 1000);
  sessionSweep.unref?.();

  // The owner plane (decision 153). Both halves of the OAuth client or none:
  // without them the internal host has no `/auth` and no `/owner`.
  const owner =
    config.githubOauthClientId && config.githubOauthClientSecret && config.publicBaseUrl
      ? {
          oauth: new GitHubOAuth(config.githubOauthClientId, config.githubOauthClientSecret),
          appId: Number(config.githubAppId),
          redirectUri: `${config.publicBaseUrl}/api/auth/callback`,
          sessions: store.webSessions,
          settings,
          repositories: store.repositories,
          log,
        }
      : undefined;
  if (!owner) log.warn("owner.disabled");

  const app = createApp({
    log,
    internalHost: config.internalHost,
    webhookHost: config.webhookHost,
    public: {
      runs: store.runs,
      runner,
      streamLimit: config.publicStreamLimit,
    },
    ...(owner ? { owner } : {}),
    webhook: {
      log,
      secret: config.githubWebhookSecret,
      github,
      store: store.runs,
      runner,
      diff,
      detonations: store.detonations,
      ocr,
      repositories: store.repositories,
      // What the review's footer names. A public run gets its id; anything
      // else gets nothing, since a private run has no page for a stranger
      // reading the pull request to open. `github-mcp` turns the id into a
      // link, so no hostname passes through the agent (decision 36).
      reviewRunId: (run: RunRecord) => publicRunId(run),
      onClaimed,
      createSession: () => harness.createSession(spec()),
      provenance,
      isReady: () => harness.ready,
      prCommands,
      debounce,
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
    registry.stop();
    clearInterval(sessionSweep);
    server.close();
    // A push still waiting out its window starts now: a row that never got a
    // turn is an error on the next boot, and one that did is followed there.
    debounce.flush();
    void Promise.all([notifier?.flush(5_000), reactor?.flush(5_000), checks?.flush(5_000)])
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
