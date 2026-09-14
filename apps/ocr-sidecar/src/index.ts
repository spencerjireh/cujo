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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

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
  // The three `ocr` requires, checked here so a misconfigured deploy fails at
  // boot rather than on the first pull request. Everything else `OCR_LLM_*`
  // rides along as `ocr` documents it.
  for (const name of ["OCR_LLM_URL", "OCR_LLM_TOKEN", "OCR_LLM_MODEL"]) requireEnv(name);
  const llmEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("OCR_LLM_") && value) llmEnv[key] = value;
  }
  const review = createReviewer({
    exec: execFileNoShell(),
    tmpRoot: tmpdir(),
    timeoutMs: count(process.env.OCR_SIDECAR_TIMEOUT_MS, 20 * 60 * 1000),
    maxTokensBudget: count(process.env.OCR_MAX_TOKENS_BUDGET, 400_000),
    llmEnv,
  });
  createApp({ review, log }).listen(PORT, () => {
    log.info("service.started", { port: PORT });
  });
}
