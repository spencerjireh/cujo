/**
 * Puts Cujo's own reaction on the pull request and moves it as the run's
 * status moves (decision 38).
 *
 * The same three properties the Discord notifier holds, for the same reasons:
 *
 * - **A run never fails because GitHub did.** `onRunChanged` is synchronous,
 *   never throws, and never awaits; every queued call ends in a `catch`.
 * - **Calls are totally ordered.** One queue, so a later status can never
 *   overtake an earlier one and leave the pull request showing a state the run
 *   has already left.
 * - **Nothing is remembered.** Setting a reaction is idempotent, so a restart
 *   simply re-applies the current status and converges. That is what lets this
 *   whole feature add no table and no migration.
 *
 * One reaction serves a pull request that may have had several runs, so the
 * only safe writes are the ones a *current* run makes. `superseded` therefore
 * writes nothing at all: the run that replaced it is about to say what the
 * pull request should show, and a superseded run reaching for the eye is how
 * a finished verdict gets overwritten by a stale delivery.
 */

import { type Logger, createLogger, errorFields } from "@cujo/log";
import type { GitHubReactions, Reaction } from "../clients/github-reactions";
import type { RunView } from "../review/runner.service";
import type { RunRecord, RunStatus } from "../review/types";

export interface PrReactorDeps {
  /** The process logger; every line names the plane it came from (decision 37). */
  log: Logger;
  reactions: GitHubReactions;
  /**
   * Backoff before each retry of a failed call. A terminal status is the last
   * event a run produces, so without a retry one transient GitHub failure
   * leaves the pull request wearing the previous status forever.
   */
  retryDelaysMs?: number[];
  /** Injected so a retry test does not really wait. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Test hook: called once each queued call has settled, failure included. */
  onSettled?: (runId: string) => void;
}

/** What Cujo has seen but not yet judged. */
const LOOKING: readonly Reaction[] = ["eyes"];

/**
 * Runs whose reaction set is remembered for de-duplication. A bound, because
 * this reactor lives as long as the process and sees every run it ever
 * handles; an evicted run that somehow emits again simply re-applies, which is
 * idempotent. Far above any plausible burst of concurrent pull requests.
 */
const MAX_TRACKED_RUNS = 512;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The status the pull request wears. A `Record` and not a lookup with a
 * fallback, so a new `RunStatus` fails typecheck here until someone decides
 * what the pull request should say about it. `null` is a real answer: leave
 * the pull request exactly as it is.
 *
 * The reactions describe what happened to the pull request, not what Cujo
 * concluded: `denied` is a thumbs up because a human cleared the pull request
 * to proceed, even though Cujo's finding stands. GitHub offers eight reactions
 * and no check mark, so this is the whole vocabulary there is.
 */
const BY_STATUS: Record<RunStatus, readonly Reaction[] | null> = {
  /** Under review. */
  running: LOOKING,
  /** Still under review, and now waiting on a human: the eye plus a flare. */
  blocked_pending: ["eyes", "rocket"],
  /** No critical finding. */
  clean: ["hooray"],
  /** The blocking review posted. */
  blocked_posted: ["-1"],
  /** A human rejected the block, so the pull request is clear to proceed. */
  denied: ["+1"],
  /** Cujo broke. Shared with no other status, so it always means just this. */
  error: ["confused"],
  /** Not this run's pull request to describe any more. See the header. */
  superseded: null,
};

export class PrReactor {
  /**
   * What each run's pull request was last asked to wear, keyed by the reaction
   * set rather than the status. A pre-filter only: `refold` fires on every
   * folded event and this collapses that storm without a network call.
   *
   * Keying on the reactions and not the status is what makes the claim and the
   * first fold one call instead of two — both want the eye — and it is the
   * honest key, since two statuses that look identical on the pull request
   * have nothing to say to each other. Cleared when a call finally fails, so a
   * later status change retries.
   */
  private readonly applied = new Map<string, string>();
  private tail: Promise<void> = Promise.resolve();
  private readonly retryDelaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;

  private get log(): Logger {
    return this.deps.log;
  }

  constructor(private readonly deps: PrReactorDeps) {
    this.retryDelaysMs = deps.retryDelaysMs ?? [1_000, 3_000];
    this.sleep = deps.sleepImpl ?? defaultSleep;
  }

  /**
   * The eye, before any turn exists. This is the reaction worth the most: it
   * appears within a second of the delivery, so its absence says the failure
   * is in front of the agent rather than inside it.
   */
  markClaimed(run: RunRecord): void {
    this.apply(run.id, run.repo, run.prNumber, LOOKING);
  }

  /** Never throws, never awaits: it is called from inside the fold path. */
  onRunChanged(view: RunView | null): void {
    if (!view) return;
    const { run } = view;
    const wanted = BY_STATUS[run.status];
    if (!wanted) return;
    this.apply(run.id, run.repo, run.prNumber, wanted);
  }

  /**
   * Await every queued call. Used by tests and by shutdown. A real timer, not
   * an injected one, so a test that stubs time still waits for the queue.
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

  /** Record the run's current key, oldest evicted first. */
  private remember(runId: string, key: string): void {
    // Re-inserting moves the run to the newest end, so eviction takes the
    // least recently *seen* run rather than the earliest one claimed.
    this.applied.delete(runId);
    this.applied.set(runId, key);
    if (this.applied.size > MAX_TRACKED_RUNS) {
      const oldest = this.applied.keys().next().value;
      if (oldest !== undefined) this.applied.delete(oldest);
    }
  }

  private apply(runId: string, repo: string, prNumber: number, wanted: readonly Reaction[]): void {
    const key = wanted.join("+");
    if (this.applied.get(runId) === key) return;
    this.remember(runId, key);
    this.tail = this.tail.then(async () => {
      try {
        await this.attempt(runId, repo, prNumber, wanted, key);
      } catch (error) {
        // Unreachable: `attempt` swallows. Belt and braces, because a throw
        // here would break the queue for every later run.
        this.log.child({ run_id: runId }).error("discord.notify.failed", {
          reason: "reaction_queue",
          ...errorFields(error),
        });
      }
      try {
        this.deps.onSettled?.(runId);
      } catch (error) {
        this.log.child({ run_id: runId }).error("discord.notify.failed", {
          reason: "reaction_on_settled",
          ...errorFields(error),
        });
      }
    });
  }

  /**
   * One call, retried with backoff. A terminal status produces no further
   * event, so the queue is the only place a transient failure can be recovered
   * from; everything is still swallowed at the end, because a run must never
   * fail because GitHub did.
   */
  private async attempt(
    runId: string,
    repo: string,
    prNumber: number,
    wanted: readonly Reaction[],
    key: string,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.deps.reactions.set(repo, prNumber, wanted);
        return;
      } catch (error) {
        if (attempt >= this.retryDelaysMs.length) {
          // Give up, and forget the key so a later status change tries again.
          this.applied.delete(runId);
          this.log.child({ run_id: runId }).error("discord.notify.failed", {
            repo,
            pr_number: prNumber,
            reason: "reaction_gave_up",
            attempts: attempt,
            ...errorFields(error),
          });
          return;
        }
        await this.sleep(this.retryDelaysMs[attempt] ?? 0);
        // A newer status was queued behind this one while it was failing.
        // Retrying a state the run has already left would only delay it.
        if (this.applied.get(runId) !== key) return;
      }
    }
  }
}
