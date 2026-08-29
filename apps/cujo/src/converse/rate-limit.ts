/**
 * How often one pull request may ask Cujo a question.
 *
 * Conversation is the one path where a comment provisions a sandbox, so it is
 * the one path where a person who is merely enthusiastic costs real money and
 * a person who is hostile costs more. Repo write is already required — a
 * sandbox is not free speech — but a maintainer can still paste six questions
 * in a row, and each one is a clone and an install.
 *
 * In memory and per pull request, deliberately. The limit protects a resource
 * this process provisions, so the process is the right place to count; a row
 * in SQLite would survive a restart, which is not a property worth having when
 * a restart already means no turn is in flight. `notify/reactions.service.ts`
 * bounds its dedupe map the same way and for the same reason.
 */

/** Far above any plausible number of pull requests being talked to at once. */
const MAX_TRACKED = 512;

export interface RateLimitOptions {
  /** How many questions one pull request may ask inside the window. */
  limit: number;
  windowMs: number;
  /** Injectable so a test does not wait a window out. */
  now?: () => number;
}

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; reason: "in_flight" }
  | { allowed: false; reason: "too_many"; retryAfterMs: number };

interface Entry {
  /** Timestamps of the questions that have been *started*, newest last. */
  started: number[];
  inFlight: boolean;
}

export class ConverseRateLimit {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  private key(repo: string, prNumber: number): string {
    // Lowercased for the same reason the store compares `COLLATE NOCASE`:
    // `repo` is whatever casing GitHub sent, and two spellings of one pull
    // request must not each get their own budget.
    return `${repo.toLowerCase()}#${prNumber}`;
  }

  /**
   * Take a slot, or say why not.
   *
   * A caller that is allowed **must** call `release`, which is why the service
   * wraps the whole turn in a `finally`. An in-flight question is refused
   * rather than queued: two sandboxes for one pull request at once is the
   * thing the limit exists to prevent, and a queue would only delay it.
   */
  take(repo: string, prNumber: number): RateVerdict {
    const key = this.key(repo, prNumber);
    const now = this.now();
    const entry = this.entries.get(key) ?? { started: [], inFlight: false };
    if (entry.inFlight) return { allowed: false, reason: "in_flight" };
    const cutoff = now - this.options.windowMs;
    entry.started = entry.started.filter((at) => at > cutoff);
    if (entry.started.length >= this.options.limit) {
      // The oldest one in the window is the one whose expiry frees a slot.
      const oldest = entry.started[0] ?? now;
      this.remember(key, entry);
      return {
        allowed: false,
        reason: "too_many",
        retryAfterMs: oldest + this.options.windowMs - now,
      };
    }
    entry.started.push(now);
    entry.inFlight = true;
    this.remember(key, entry);
    return { allowed: true };
  }

  /** The turn is over, however it ended. */
  release(repo: string, prNumber: number): void {
    const entry = this.entries.get(this.key(repo, prNumber));
    if (entry) entry.inFlight = false;
  }

  /** Newest at the end, oldest evicted first — the pattern `PrReactor` uses. */
  private remember(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > MAX_TRACKED) {
      const oldest = this.entries.keys().next().value;
      // Never evict something in flight: its `release` would then create a
      // fresh entry that is not in flight, and the guard would be gone.
      if (oldest !== undefined && !this.entries.get(oldest)?.inFlight) {
        this.entries.delete(oldest);
      }
    }
  }
}
