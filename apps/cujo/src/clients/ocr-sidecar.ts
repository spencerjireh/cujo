/**
 * The `ocr-sidecar` service (decision 149): Open Code Review beside a run.
 *
 * One call, `review`, which never throws: a sidecar that is down, busy, slow
 * or wrong answers as `{ ok: false }` and the run goes on exactly as it would
 * have. Nothing this returns reaches a pull request; `review/ocr-shadow.ts`
 * stores it and that is the end of it.
 *
 * Two requests underneath, a start and then polls, because a review is
 * minutes and Node's fetch stops waiting for response headers after five of
 * them regardless of the caller's own signal. The first shadow reviews that
 * ran longer came back `fetch failed` while the sidecar was still working.
 */

export interface OcrReviewInput {
  repo: string;
  prNumber: number;
  cloneUrl: string;
  baseSha: string;
  headSha: string;
  title: string;
  body: string;
}

export type OcrReviewOutcome =
  | { ok: true; result: unknown; exitCode: number | null; durationMs: number }
  | {
      ok: false;
      error: string;
      exitCode?: number | null;
      stderrTail?: string;
      durationMs?: number;
    };

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 15_000;

export class OcrSidecar {
  constructor(
    private readonly baseUrl: string,
    /** Bound on the whole review, start to collected outcome. */
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly pollMs: number = DEFAULT_POLL_MS,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async review(input: OcrReviewInput): Promise<OcrReviewOutcome> {
    const deadline = Date.now() + this.timeoutMs;
    const started = await this.call(`${this.base()}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!started.ok) return started;
    const id = (started.body as { id?: unknown }).id;
    if (typeof id !== "string") {
      return { ok: false, error: "sidecar answered a start with no id" };
    }
    while (Date.now() < deadline) {
      await this.sleep(Math.min(this.pollMs, Math.max(0, deadline - Date.now())));
      const polled = await this.call(`${this.base()}/review/${id}`, { method: "GET" });
      if (!polled.ok) return polled;
      const state = polled.body as { state?: unknown; outcome?: unknown };
      if (state.state === "done") {
        const outcome = state.outcome;
        if (
          !outcome ||
          typeof outcome !== "object" ||
          typeof (outcome as { ok?: unknown }).ok !== "boolean"
        ) {
          return { ok: false, error: "sidecar answered with an unexpected shape" };
        }
        return outcome as OcrReviewOutcome;
      }
      if (state.state !== "running") {
        return { ok: false, error: "sidecar answered with an unexpected shape" };
      }
    }
    return { ok: false, error: `sidecar did not finish within ${this.timeoutMs} ms` };
  }

  private base(): string {
    return this.baseUrl.replace(/\/+$/, "");
  }

  /** One request, answered as `{ ok: true, body }` or a failed outcome. Never throws. */
  private async call(
    url: string,
    init: RequestInit,
  ): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "request failed" };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, error: `sidecar answered ${res.status} with no JSON` };
    }
    if (!res.ok) {
      const error =
        body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `sidecar answered ${res.status}`;
      return { ok: false, error };
    }
    return { ok: true, body };
  }
}
