/**
 * ocr-sidecar: Alibaba's Open Code Review beside every Cujo run (decision
 * 149). `apps/cujo` posts a pull request here; this clones it, runs `ocr`
 * over base and head, and answers with the JSON envelope. It posts nothing to
 * GitHub and holds no GitHub credential. It holds one model key, which is why
 * it is a service of its own and not part of the sandbox.
 */

import { tmpdir } from "node:os";
import { createLogger, parseLevel } from "@cujo/log";
import { execFileNoShell } from "./exec";
import { createReviewer } from "./review";
import { createApp } from "./server";

export { createApp } from "./server";

const PORT = Number(process.env.PORT ?? 8083);

function count(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger({
    service: "ocr-sidecar",
    level: parseLevel(process.env.CUJO_LOG_LEVEL),
  });
  // The three `ocr` requires. A deploy that lacks them still boots and
  // answers its healthcheck: this container exiting at start took the whole
  // compose application down with it once (2026-09-14, the first deploy of
  // this service), because Coolify reads one exited service as the
  // application having exited. Unconfigured means every review is refused
  // with 503 and one warning line at boot, and nothing else is affected.
  const missing = ["OCR_LLM_URL", "OCR_LLM_TOKEN", "OCR_LLM_MODEL"].filter(
    (name) => !process.env[name],
  );
  const llmEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("OCR_LLM_") && value) llmEnv[key] = value;
  }
  const review =
    missing.length === 0
      ? createReviewer({
          exec: execFileNoShell(),
          tmpRoot: tmpdir(),
          timeoutMs: count(process.env.OCR_SIDECAR_TIMEOUT_MS, 20 * 60 * 1000),
          maxTokensBudget: count(process.env.OCR_MAX_TOKENS_BUDGET, 400_000),
          llmEnv,
        })
      : null;
  if (!review) log.warn("ocr.unconfigured", { reason: "missing_env", count: missing.length });
  createApp({ review, log }).listen(PORT, () => {
    log.info("service.started", { port: PORT });
  });
}
