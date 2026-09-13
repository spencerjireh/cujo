/**
 * Writes the `cujo/guard` check run on the pull request's head commit and
 * moves it as the run's status moves (decision 138). The check is the merge
 * lock: branch protection that requires it holds the merge until this App
 * completes it, and only a person's `/cujo dismiss` turns a failure into
 * anything else.
 *
 * The same three properties `PrReactor` holds, for the same reasons: a run
 * never fails because GitHub did, calls are totally ordered, and nothing has
 * to be remembered — the check is looked up by name on the commit and
 * re-written, so a restart re-applies the current status and converges. The
 * id is cached per run only to save the lookup.
 *
 * One difference from the reaction, and it is the shape of the thing. A
 * reaction is per pull request; a check run is per commit. A run superseded
 * by a *newer head* leaves its own commit's check behind, and an `in_progress`
 * check on a commit nobody is reviewing any more would dangle forever, so
 * that run writes `skipped` — but only while it is still the latest run for
 * its head. On `/cujo review` the replacement run owns the same commit and is
 * about to write its own `in_progress`, so the superseded one writes nothing.
 */

import { type Logger, errorFields } from "@cujo/log";
import type { CheckPayload, GitHubChecks } from "../clients/github-checks";
import { type UiLinks, runUrl } from "../review/links";
import type { RunView } from "../review/runner.service";
import type { Projection, RunRecord, RunStatus } from "../review/types";
import type { RunStore } from "../store/runs";
import { describe } from "./card";

export interface PrChecksDeps {
  /** The process logger; every line names the plane it came from (decision 37). */
  log: Logger;
  checks: GitHubChecks;
  links: UiLinks;
  /** For the superseded rule: is this run still the latest for its head? */
  runs: Pick<RunStore, "runForPrHead">;
  /** Backoff before each retry of a failed call, as on the reactor. */
  retryDelaysMs?: number[];
  /** Injected so a retry test does not really wait. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Test hook: called once each queued call has settled, failure included. */
  onSettled?: (runId: string) => void;
}

/** Runs whose last written payload is remembered, bounded as on the reactor. */
const MAX_TRACKED_RUNS = 512;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type Shape = Pick<CheckPayload, "status" | "conclusion" | "output">;

function counts(projection: Projection): string {
  const n = { critical: 0, warn: 0, info: 0 };
  for (const finding of projection.findings) n[finding.severity] += 1;
  return `${n.critical} critical, ${n.warn} warn, ${n.info} info.`;
}

/**
 * What the check says per status. A `Record` and not a lookup with a
 * fallback, so a new `RunStatus` fails typecheck here until someone decides
 * what the commit should show. `null` is a real answer: write nothing.
 *
 * The title is the same sentence the Discord card carries, so the checks tab
 * and the channel never describe one status two ways. `in_progress` keeps a
 * constant summary on purpose: `refold` fires on every folded event, and a
 * summary that counted findings while the run was live would be a new
 * payload — and a new PATCH — per event.
 */
function running(run: RunRecord): Shape {
  return {
    status: "in_progress",
    output: { title: describe(run), summary: "Cujo is reviewing this commit." },
  };
}

const BY_STATUS: Record<RunStatus, (view: RunView) => Shape | null> = {
  running: ({ run }) => running(run),
  clean: ({ run, projection }) => ({
    status: "completed",
    conclusion: "success",
    output: { title: describe(run), summary: counts(projection) },
  }),
  unproven: ({ run, projection }) => ({
    status: "completed",
    conclusion: "neutral",
    output: { title: describe(run), summary: counts(projection) },
  }),
  blocked: ({ run, projection }) => ({
    status: "completed",
    conclusion: "failure",
    output: { title: describe(run), summary: counts(projection) },
  }),
  dismissed: ({ run, projection }) => ({
    status: "completed",
    conclusion: "neutral",
    output: {
      title: `Dismissed by @${(run.approver ?? "").replace(/^github:/, "")}`,
      summary: `${describe(run)} ${counts(projection)}`,
    },
  }),
  error: ({ run }) => ({
    status: "completed",
    conclusion: "neutral",
    output: { title: describe(run), summary: "Cujo reached no verdict on this commit." },
  }),
  // Decided in `onRunChanged`, which knows whether a newer run owns the head.
  superseded: () => null,
};

const SUPERSEDED: Shape = {
  status: "completed",
  conclusion: "skipped",
  output: {
    title: "Superseded by a newer commit",
    summary: "A newer commit on this pull request got its own review.",
  },
};

export class PrChecks {
  /** The last payload written per run, keyed on its JSON, as the reactor keys on its set. */
  private readonly applied = new Map<string, string>();
  /** The check run id per run, so a run's several transitions read once. */
  private readonly ids = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private readonly retryDelaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;

  private get log(): Logger {
    return this.deps.log;
  }

  constructor(private readonly deps: PrChecksDeps) {
    this.retryDelaysMs = deps.retryDelaysMs ?? [1_000, 3_000];
    this.sleep = deps.sleepImpl ?? defaultSleep;
  }

  /** `in_progress`, before any turn exists: the lock is on from the claim. */
  markClaimed(run: RunRecord): void {
    this.apply(run, running(run));
  }

  /** Never throws, never awaits: it is called from inside the fold path. */
  onRunChanged(view: RunView | null): void {
    if (!view) return;
    const { run } = view;
    if (run.status === "superseded") {
      const latest = this.deps.runs.runForPrHead(run.repo, run.prNumber, run.headSha);
      if (latest && latest.id === run.id) this.apply(run, SUPERSEDED);
      return;
    }
    const shape = BY_STATUS[run.status](view);
    if (shape) this.apply(run, shape);
  }

  /** Await every queued call. Used by tests and by shutdown. */
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

  private remember(runId: string, key: string): void {
    this.applied.delete(runId);
    this.applied.set(runId, key);
    if (this.applied.size > MAX_TRACKED_RUNS) {
      const oldest = this.applied.keys().next().value;
      if (oldest !== undefined) {
        this.applied.delete(oldest);
        this.ids.delete(oldest);
      }
    }
  }

  private apply(run: RunRecord, shape: Shape): void {
    const payload: CheckPayload = {
      runId: run.id,
      detailsUrl: runUrl(this.deps.links, run),
      ...shape,
    };
    const key = JSON.stringify(payload);
    if (this.applied.get(run.id) === key) return;
    this.remember(run.id, key);
    this.tail = this.tail.then(async () => {
      try {
        await this.attempt(run, payload, key);
      } catch (error) {
        this.log.child({ run_id: run.id }).error("check_run.failed", {
          reason: "queue_step",
          ...errorFields(error),
        });
      }
      try {
        this.deps.onSettled?.(run.id);
      } catch (error) {
        this.log.child({ run_id: run.id }).error("check_run.failed", {
          reason: "on_settled",
          ...errorFields(error),
        });
      }
    });
  }

  private async attempt(run: RunRecord, payload: CheckPayload, key: string): Promise<void> {
    const log = this.log.child({ run_id: run.id });
    for (let attempt = 0; ; attempt++) {
      try {
        const id = await this.deps.checks.write(
          run.repo,
          run.headSha,
          payload,
          this.ids.get(run.id) ?? null,
        );
        this.ids.set(run.id, id);
        log.info("check_run.written", {
          repo: run.repo,
          pr_number: run.prNumber,
          head_sha: run.headSha,
          status: payload.conclusion ?? payload.status,
        });
        return;
      } catch (error) {
        if (attempt >= this.retryDelaysMs.length) {
          this.applied.delete(run.id);
          log.error("check_run.failed", {
            repo: run.repo,
            pr_number: run.prNumber,
            reason: "gave_up",
            attempts: attempt + 1,
            ...errorFields(error),
          });
          return;
        }
        await this.sleep(this.retryDelaysMs[attempt] ?? 0);
        if (this.applied.get(run.id) !== key) return;
      }
    }
  }
}
