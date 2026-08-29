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
export function loadRubric(name = "SKILL.md"): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // src/review -> apps/cujo/src -> apps/cujo -> apps -> repo root.
    resolve(here, `../../../../agent/${name}`),
    // dist -> /app, which is where the Dockerfile puts agent/.
    resolve(here, `../agent/${name}`),
    resolve(here, `agent/${name}`),
    resolve(process.cwd(), `agent/${name}`),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // Try the next location.
    }
  }
  throw new Error(`agent/${name} not found`);
}

/**
 * The spec defines the session the sandbox runs under, so it is the one place
 * a server-side secret could cross the trust boundary. It takes only the two
 * fields it needs rather than the whole `Config`, which turns a future
 * `...config` spread into a compile error instead of a leak.
 */
export function buildAgentSpec(
  config: Pick<Config, "model" | "sniffTarballUrl">,
  rubric = loadRubric(),
): TrueForgeApi.AgentSpec {
  return {
    model: { name: config.model },
    instructions: rubric.replaceAll("{{CUJO_SNIFF_TARBALL_URL}}", config.sniffTarballUrl),
    // The one gated tool, and the one line that decides what a human is asked
    // about. `post_blocking_review` is deliberately not here: blocking a merge
    // on a broken test is mechanical and reversible, and asking about it is
    // ceremony. Only the accusation waits (decision 42).
    mcpServers: [{ name: "github-mcp", requireApprovalForTools: ["post_gated_review"] }],
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
 * The agent that answers `@cujo-guard` (Design 3).
 *
 * Two differences from the reviewer, and both are the design:
 *
 * `mcpServers: []` — **no review tools at all**, structurally rather than by
 * prose. The message this agent reads was written by whoever could reach the
 * pull request, so it is an untrusted-instruction channel published to the
 * internet. With no tool that can write to GitHub, the worst a prompt injection
 * achieves is a wasted sandbox. `apps/cujo` posts the reply itself, after the
 * turn ends, from the final assistant message.
 *
 * `sandbox.enabled` stays true. Re-execution is the whole point — every other
 * review bot can re-read a diff, and only this one still has the recipe — so
 * removing the sandbox would leave a conversation agent that can only
 * paraphrase the report it was handed.
 */
export function buildConverseSpec(
  config: Pick<Config, "model" | "sniffTarballUrl">,
  rubric = loadRubric("CONVERSE.md"),
): TrueForgeApi.AgentSpec {
  return {
    model: { name: config.model },
    instructions: rubric.replaceAll("{{CUJO_SNIFF_TARBALL_URL}}", config.sniffTarballUrl),
    mcpServers: [],
    config: {
      sandbox: { enabled: true },
      askUserQuestions: { enabled: false },
      generativeUi: { enabled: false },
      // Lower than the review's 150: this answers one question against a brief
      // that is already collected, and a conversation that needs a hundred
      // steps has misunderstood what it was asked.
      iterationLimit: 60,
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
