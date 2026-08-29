/**
 * What Cujo remembers about notifying a Discord server: which repo goes to
 * which channel, which server is allowed to ask, and which message it already
 * posted for a run (spec Contracts 7 and 8).
 *
 * Separate from the run projection in `review/types.ts` because these are
 * operator data, not run state — they outlive any single run, they are written
 * by an operator or a slash command rather than derived from TrueForge events,
 * and nothing here is part of what a review concludes. The only thing crossing
 * over is `RunStatus`, which the card's dedupe key is expressed in.
 */

import type { RunStatus } from "../review/types";

/**
 * One repo bound to one Discord channel (Contract 7). Operator data rather
 * than run state, which is why it lives in the store and not the environment
 * (decision 24).
 */
export interface DiscordChannelRecord {
  /** `owner/name`, lower-cased: GitHub repo names are case-insensitive. */
  repo: string;
  channelId: string;
  guildId: string | null;
  channelName: string | null;
  /** Mentioned by the ping a blocked run posts. Null means ping with no mention. */
  notifyRoleId: string | null;
  /**
   * Who bound it: an operator's Access email, or `discord:<user id>` when it
   * came from a slash command (Contract 8). Null for a binding written before
   * the column existed.
   */
  boundBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The card Cujo posted for one run, plus the one-shot ping beside it. */
export interface RunDiscordMessage {
  runId: string;
  /**
   * Captured when the card is created. Every later edit uses this rather than
   * the current mapping, so re-pointing a repo mid-run cannot edit a message
   * into a channel that does not hold it.
   */
  channelId: string;
  messageId: string | null;
  pingMessageId: string | null;
  /**
   * True once the ping has been rewritten to say the run can no longer be
   * decided. Held separately from the status, because the card is written
   * first: without it, a failed ping edit would leave an actionable "needs a
   * human" alert in the channel that nothing ever retries.
   */
  pingResolved: boolean;
  /** The status the card was last written for; the dedupe key (Contract 7). */
  lastNotifiedStatus: RunStatus | null;
}
