import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type { PullRequestInfo } from "../clients/github";
import type { Config } from "../config";

const MANIFESTS = [
  /(^|\/)requirements[^/]*\.txt$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)setup\.(py|cfg)$/,
  /(^|\/)Pipfile(\.lock)?$/,
  /(^|\/)uv\.lock$/,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.(toml|lock)$/,
  /(^|\/)go\.(mod|sum)$/,
  /(^|\/)Gemfile(\.lock)?$/,
  /(^|\/)composer\.(json|lock)$/,
  /(^|\/)conanfile\.(txt|py)$/,
  /(^|\/)vcpkg\.json$/,
];

export function manifestChanged(files: readonly string[]): boolean {
  return files.some((f) => MANIFESTS.some((re) => re.test(f)));
}

/**
 * The rubric lives in agent/SKILL.md at the repo root so a reader (and Qodo)
 * can review it as prose. The Dockerfile copies it next to dist/.
 *
 * The candidates are a chain, not alternatives, and two of them are load
 * bearing for different environments: the four-level one is this source file
 * reaching the repo root in dev and test, and the one-level one is the bundle
 * at /app/dist reaching /app/agent in the container. Neither covers the other,
 * so neither may be dropped when this file moves.
 */
export function loadRubric(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // src/review -> apps/cujo/src -> apps/cujo -> apps -> repo root.
    resolve(here, "../../../../agent/SKILL.md"),
    // dist -> /app, which is where the Dockerfile puts agent/.
    resolve(here, "../agent/SKILL.md"),
    resolve(here, "agent/SKILL.md"),
    resolve(process.cwd(), "agent/SKILL.md"),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // Try the next location.
    }
  }
  throw new Error("agent/SKILL.md not found");
}

/**
 * The spec defines the session the sandbox runs under, so it is the one place
 * a server-side secret could cross the trust boundary. It takes only the two
 * fields it needs rather than the whole `Config`, which turns a future
 * `...config` spread into a compile error instead of a leak.
 */
export function buildAgentSpec(
  config: Pick<Config, "model" | "sniffUrl">,
  rubric = loadRubric(),
): TrueForgeApi.AgentSpec {
  return {
    model: { name: config.model },
    instructions: rubric.replaceAll("{{CUJO_SNIFF_URL}}", config.sniffUrl),
    mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["post_blocking_review"] }],
    config: {
      sandbox: { enabled: true },
      // The review runs headless; nothing can answer a question or view a card.
      askUserQuestions: { enabled: false },
      generativeUi: { enabled: false },
      iterationLimit: 150,
    },
  };
}

/**
 * Contract 1 step 3: the single user message that starts a turn.
 *
 * `runId` is this run's id when it has a public page and `""` when it does not,
 * and the key is left out of the payload entirely in the second case
 * (decision 36). Omitting rather than sending `""` keeps one rule at both ends:
 * the key is absent and `run_id` is optional on the review tool, so a private
 * repo's review needs no special case anywhere downstream.
 *
 * It is an id rather than a URL so that nothing the agent reads in the pull
 * request can choose the host the review's footer points at; `github-mcp` owns
 * that.
 */
export function buildTurnMessage(pr: PullRequestInfo, runId = ""): string {
  const payload = {
    repo: pr.repo,
    pr_number: pr.prNumber,
    pr_title: pr.title,
    pr_body: pr.body,
    base_sha: pr.baseSha,
    head_sha: pr.headSha,
    clone_url: pr.cloneUrl,
    changed_files: pr.changedFiles,
    manifest_changed: manifestChanged(pr.changedFiles),
    ...(runId ? { run_id: runId } : {}),
  };
  return `Review this pull request. Input:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}
