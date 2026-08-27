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

import { DiscordError, UNKNOWN_MESSAGE } from "./discord";
import type { DiscordClient } from "./discord";
import { buildPing, buildRunCard } from "./discord-card";
import type { DiscordMessagePayload } from "./discord-card";
import type { RunView } from "./runner";
import type { Store } from "./store";
import type { RunDiscordMessage, RunRecord, RunStatus } from "./types";

export interface NotifierDeps {
  store: Store;
  client: DiscordClient;
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
 * What this run still owes Discord. A repeated status owes nothing except a
 * ping that has not been sent yet, which is why the ping is deduped on its own
 * id and not on the status: a crash between the card edit and the ping would
 * otherwise leave a blocked run waiting on a human nobody told.
 */
function owesWork(run: RunRecord, row: RunDiscordMessage | null): boolean {
  // A run that errored before it ever had a turn is re-claimed by the next
  // webhook delivery under a fresh id, so a card for it would be a corpse
  // beside the real one.
  if (run.status === "error" && run.turnIds.length === 0) return false;
  if (row?.lastNotifiedStatus !== run.status) return true;
  return run.status === "blocked_pending" && !row.pingMessageId;
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

    let messageId = row?.messageId ?? null;
    let pingMessageId = row?.pingMessageId ?? null;
    const write = (next: Partial<RunDiscordMessage>): void => {
      store.putRunDiscordMessage({
        runId,
        channelId,
        messageId,
        pingMessageId,
        lastNotifiedStatus: run.status,
        ...next,
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
      write({});
    }

    if (run.status === "blocked_pending") {
      if (pingMessageId) return;
      const ping = buildPing({ run, uiBaseUrl, roleId: mapping?.notifyRoleId ?? null });
      pingMessageId = (await this.retrying(() => this.deps.client.createMessage(channelId, ping)))
        .id;
      write({});
      return;
    }

    // The run left blocked_pending, so the ping points at a decision nobody
    // can still make. Edit it rather than leave a dead link in the channel.
    const ping = pingMessageId;
    if (ping) {
      const resolved = buildPing({ run, uiBaseUrl, roleId: null });
      await this.retrying(() => this.deps.client.editMessage(channelId, ping, resolved));
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
