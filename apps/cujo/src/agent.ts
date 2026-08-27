import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type { Config } from "./config";
import type { PullRequestInfo } from "./github";

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
];

export function manifestChanged(files: readonly string[]): boolean {
  return files.some((f) => MANIFESTS.some((re) => re.test(f)));
}

/**
 * The rubric lives in agent/SKILL.md at the repo root so a reader (and Qodo)
 * can review it as prose. The Dockerfile copies it next to dist/.
 */
export function loadRubric(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../agent/SKILL.md"),
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

export function buildAgentSpec(config: Config, rubric = loadRubric()): TrueForgeApi.AgentSpec {
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

/** Contract 1 step 3: the single user message that starts a turn. */
export function buildTurnMessage(pr: PullRequestInfo): string {
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
  };
  return `Review this pull request. Input:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}
