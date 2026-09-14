/**
 * Open Code Review beside a run (decision 149): ask the sidecar, keep what it
 * said, post nothing. Fire-and-forget from `startRun`, after the run is known
 * to be the one worth starting and before its mode is resolved, so the sandbox
 * review and the diff review get the same shadow and neither waits for it.
 */

import { type Logger, errorFields } from "@cujo/log";
import type { PullRequestInfo } from "../clients/github";
import type { OcrSidecar } from "../clients/ocr-sidecar";
import type { OcrReviewStore } from "../store/ocr";
import type { RunRecord } from "./types";

const OCR_PROVIDER = "ocr";

export interface OcrShadowDeps {
  client: Pick<OcrSidecar, "review">;
  store: Pick<OcrReviewStore, "markStarted" | "finish">;
  log: Logger;
  now?: () => Date;
}

export async function shadowReview(
  deps: OcrShadowDeps,
  pr: PullRequestInfo,
  run: RunRecord,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  deps.store.markStarted(run.id, OCR_PROVIDER, now().toISOString());
  const started = Date.now();
  try {
    const outcome = await deps.client.review({
      repo: run.repo,
      prNumber: run.prNumber,
      cloneUrl: pr.cloneUrl,
      baseSha: pr.baseSha,
      headSha: run.headSha,
      title: pr.title,
      body: pr.body,
    });
    const durationMs = outcome.durationMs ?? Date.now() - started;
    if (outcome.ok) {
      deps.store.finish(
        run.id,
        {
          status: "ok",
          resultJson: JSON.stringify(outcome.result),
          error: null,
          exitCode: outcome.exitCode,
          durationMs,
        },
        now().toISOString(),
      );
      deps.log.info("ocr.review.finished", { duration_ms: durationMs });
    } else {
      deps.store.finish(
        run.id,
        {
          status: "error",
          resultJson: null,
          error: outcome.stderrTail ? `${outcome.error}\n${outcome.stderrTail}` : outcome.error,
          exitCode: outcome.exitCode ?? null,
          durationMs,
        },
        now().toISOString(),
      );
      deps.log.warn("ocr.review.failed", { duration_ms: durationMs, error_message: outcome.error });
    }
  } catch (error) {
    deps.store.finish(
      run.id,
      {
        status: "error",
        resultJson: null,
        error: error instanceof Error ? error.message : String(error),
        exitCode: null,
        durationMs: Date.now() - started,
      },
      now().toISOString(),
    );
    deps.log.warn("ocr.review.failed", errorFields(error));
  }
}
