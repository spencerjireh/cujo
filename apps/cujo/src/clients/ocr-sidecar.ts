/**
 * The `ocr-sidecar` service (decision 149): Open Code Review beside a run.
 *
 * One call, `review`, which never throws: a sidecar that is down, busy, slow
 * or wrong answers as `{ ok: false }` and the run goes on exactly as it would
 * have. Nothing this returns reaches a pull request; `review/ocr-shadow.ts`
 * stores it and that is the end of it.
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

export class OcrSidecar {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async review(input: OcrReviewInput): Promise<OcrReviewOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
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
    if (!body || typeof body !== "object" || typeof (body as { ok?: unknown }).ok !== "boolean") {
      return { ok: false, error: "sidecar answered with an unexpected shape" };
    }
    return body as OcrReviewOutcome;
  }
}
