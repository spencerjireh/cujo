/**
 * Posts one Discord card per run and edits it in place as the run's status
 * moves (spec Contract 7).
 *
 * Three properties hold no matter what Discord does:
 *
 * - **A run never fails because Discord did.** `onRunChanged` is synchronous,
 *   never throws, and never awaits; every queued send ends in a `catch`.
 * - **Sends are totally ordered.** One queue, so an edit can never overtake
 *   the create it depends on, and a fan-out across many PRs cannot exceed
 *   Discord's global request rate.
 * - **Delivery is at-least-once.** The store row is written after a successful
 *   send, so a crash in between costs a duplicate card, never a missed one.
 *   Discord offers no idempotency key, so this is the safe direction.
 */

import { DiscordError, UNKNOWN_MESSAGE } from "../clients/discord";
import type { DiscordClient } from "../clients/discord";
import type { GitHubReader } from "../clients/github";
import type { RunView } from "../review/runner.service";
import type { RunDiscordMessage, RunRecord, RunStatus } from "../review/types";
import type { Store } from "../store";
import { authorizationFor } from "./authorization";
import { buildPing, buildRunCard } from "./card";
import type { DiscordMessagePayload } from "./card";

export interface NotifierDeps {
  store: Store;
  client: DiscordClient;
  /** Reads the repo's `.cujo.yml`, so a revoked declaration stops delivery. */
  github: GitHubReader;
  uiBaseUrl: string;
  /** Injected so a 429 test does not really wait. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Test hook: called once each queued send has settled, failure included. */
  onSettled?: (runId: string) => void;
}

/** However long Discord asks for, one retry is never worth more than this. */
const MAX_RETRY_DELAY_MS = 5_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What this run still owes Discord. The status alone cannot answer this: the
 * card is written before the ping, so a status that matches may still owe a
 * ping. Both ping steps therefore have their own durable marker, and each is
 * retried until it lands.
 *
 * - blocked and no `pingMessageId`: the ping was never sent, and a blocked run
 *   nobody was told about is the failure this whole feature exists to prevent.
 * - no longer blocked, a ping exists, and it has not been resolved: the
 *   channel is still showing an actionable alert for a run that can no longer
 *   be decided.
 */
function owesWork(run: RunRecord, row: RunDiscordMessage | null): boolean {
  // A run that errored before it ever had a turn is re-claimed by the next
  // webhook delivery under a fresh id, so a card for it would be a corpse
  // beside the real one.
  if (run.status === "error" && run.turnIds.length === 0) return false;
  if (row?.lastNotifiedStatus !== run.status) return true;
  if (run.status === "blocked_pending") return !row.pingMessageId;
  return Boolean(row.pingMessageId) && !row.pingResolved;
}

export class DiscordNotifier {
  /**
   * The status each run was last enqueued for. A pre-filter only: `refold`
   * fires on every folded event, and this collapses that storm without
   * touching SQLite. It is cleared when a send fails, so the next event
   * retries; the store row is the truth.
   */
  private readonly enqueued = new Map<string, RunStatus>();
  private tail: Promise<void> = Promise.resolve();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: NotifierDeps) {
    this.sleep = deps.sleepImpl ?? defaultSleep;
  }

  /** Never throws, never awaits: it is called from inside the fold path. */
  onRunChanged(view: RunView | null): void {
    if (!view) return;
    const { run } = view;
    if (this.enqueued.get(run.id) === run.status) return;
    this.enqueued.set(run.id, run.status);
    this.enqueue(run.id);
  }

  /**
   * Await every queued send. Used by tests and by shutdown. The deadline uses
   * a real timer, not the injected sleep, so a test that stubs the sleep still
   * waits for the queue.
   */
  async flush(timeoutMs = 5_000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([this.tail, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private enqueue(runId: string): void {
    this.tail = this.tail.then(async () => {
      try {
        await this.step(runId);
      } catch (error) {
        // Log and drop. The run is unaffected, and the next status change
        // retries because the pre-filter is cleared here.
        this.enqueued.delete(runId);
        console.error(`discord: could not notify for run ${runId}`, error);
      }
      try {
        this.deps.onSettled?.(runId);
      } catch (error) {
        console.error(`discord: onSettled threw for run ${runId}`, error);
      }
    });
  }

  private async step(runId: string): Promise<void> {
    const { store, uiBaseUrl } = this.deps;
    // Re-read rather than trust the captured view: a burst then collapses to
    // one send at the newest status for free.
    const run = store.getRun(runId);
    if (!run) return;
    const row = store.getRunDiscordMessage(runId);
    if (!owesWork(run, row)) return;
    const mapping = store.getDiscordChannel(run.repo);
    // The channel is pinned to the run at first post, so re-pointing a repo
    // mid-run cannot edit a message into a channel that does not hold it.
    const channelId = row?.channelId ?? mapping?.channelId ?? null;
    if (!channelId) return;

    // Contract 8 says a repo revokes a server by editing `.cujo.yml`, and a
    // binding written before that edit would otherwise keep delivering
    // forever, because nothing else on this path consults the declaration.
    // Checked here rather than at bind time alone, which is what makes
    // "revoked by a commit" true instead of aspirational.
    if (mapping?.guildId) {
      const allowed = await authorizationFor(
        { store, github: this.deps.github },
        mapping.guildId,
        run.repo,
      );
      if (!allowed.allowed && allowed.reason !== "unknown") {
        // A definite no, so stop and clear the binding. `unknown` is GitHub
        // being unreachable, which says nothing about what the repo declares:
        // a hiccup must not silence a team's reviews.
        console.warn(`discord: ${run.repo} no longer allows this server; dropping the binding`);
        store.deleteDiscordChannel(run.repo);
        return;
      }
    }

    let messageId = row?.messageId ?? null;
    let pingMessageId = row?.pingMessageId ?? null;
    let pingResolved = row?.pingResolved ?? false;
    const write = (): void => {
      store.putRunDiscordMessage({
        runId,
        channelId,
        messageId,
        pingMessageId,
        pingResolved,
        lastNotifiedStatus: run.status,
      });
    };

    if (row?.lastNotifiedStatus !== run.status || !messageId) {
      const projection = store.getProjection(runId);
      if (!projection) return;
      const card = buildRunCard({
        run,
        projection,
        prTitle: store.getRunPrTitle(runId),
        uiBaseUrl,
      });
      messageId = await this.upsert(channelId, messageId, card);
      write();
    }

    if (run.status === "blocked_pending") {
      if (pingMessageId) return;
      // The role belongs to the channel it was configured for. The card's
      // channel is pinned to the run, so a repo re-bound to another server
      // mid-run would otherwise send that server's role id into the old
      // channel, where it mentions nobody.
      const roleId = mapping?.channelId === channelId ? (mapping.notifyRoleId ?? null) : null;
      const ping = buildPing({ run, uiBaseUrl, roleId });
      pingMessageId = (await this.retrying(() => this.deps.client.createMessage(channelId, ping)))
        .id;
      pingResolved = false;
      write();
      return;
    }

    // The run left blocked_pending, so the ping points at a decision nobody
    // can still make. Edit it rather than leave a dead link in the channel.
    const ping = pingMessageId;
    if (ping && !pingResolved) {
      const resolved = buildPing({ run, uiBaseUrl, roleId: null });
      await this.retrying(() => this.deps.client.editMessage(channelId, ping, resolved));
      pingResolved = true;
      write();
    }
  }

  /**
   * Edit the run's card, or create one when there is none. A card someone
   * deleted (or one left in a channel the mapping no longer points at) answers
   * 404 with `10008`; that is a create, not a failure.
   */
  private async upsert(
    channelId: string,
    messageId: string | null,
    payload: DiscordMessagePayload,
  ): Promise<string> {
    if (messageId) {
      try {
        await this.retrying(() => this.deps.client.editMessage(channelId, messageId, payload));
        return messageId;
      } catch (error) {
        const gone =
          error instanceof DiscordError && (error.code === UNKNOWN_MESSAGE || error.status === 404);
        if (!gone) throw error;
      }
    }
    const created = await this.retrying(() => this.deps.client.createMessage(channelId, payload));
    return created.id;
  }

  /** One retry on a 429, honouring `retry_after`. Anything else throws. */
  private async retrying<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof DiscordError && error.status === 429 && error.retryAfterMs !== null) {
        await this.sleep(Math.min(error.retryAfterMs, MAX_RETRY_DELAY_MS));
        return op();
      }
      throw error;
    }
  }
}
