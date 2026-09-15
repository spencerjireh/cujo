import type { GitHubReader, PullRequestInfo } from "../clients/github";
import type { RunStore } from "../store/runs";
import { type CompressedDiff, compressDiff } from "./compress";
import type { Instructions } from "./instructions";
import type { Finding, RunRecord } from "./types";

/**
 * The files a repository writes for the people and agents that work in it,
 * in the order they are read. The Standards section of a CONTRIBUTING file is
 * what a review holds a pull request to, and the agent instruction files are
 * where a repository says what it expects of generated code; a review that
 * judged against neither would be judging against the model's taste.
 */
export const STANDARDS_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  ".github/copilot-instructions.md",
] as const;

export interface StandardsFile {
  path: string;
  text: string;
  /** The file was longer than the per-file cap and `text` is its head. */
  truncated: boolean;
}

/** What the diff review already said about this pull request, on an earlier head. */
export interface PreviousFinding {
  severity: Finding["severity"];
  title: string;
  path?: string;
  line?: number;
}

/**
 * Everything the diff review reads, gathered by code on the trusted side and
 * handed to the model as one message (Contract 11, decision 134). The model
 * never lists files, never fetches a patch and never opens a standards file
 * itself: the mechanical half of the review is not a decision, and doing it in
 * code is what makes the cost of a review a number rather than a guess.
 */
export interface ReviewPackage {
  pr: Pick<
    PullRequestInfo,
    "repo" | "prNumber" | "title" | "body" | "baseSha" | "headSha" | "changedFiles"
  >;
  diff: CompressedDiff;
  standards: StandardsFile[];
  /** The owner's guidance for this repository, when there is any (decision 155). */
  instructions: Instructions | null;
  previousFindings: PreviousFinding[];
}

export interface PrepareCaps {
  /** Bytes of patch text the diff may hold. */
  diffBytes: number;
  /** Bytes of one standards file; the rest is cut. */
  standardsFileBytes: number;
  /** Bytes of all standards files together; a file past the line is dropped. */
  standardsTotalBytes: number;
}

export interface PrepareDeps {
  github: Pick<GitHubReader, "readFile">;
  store: Pick<RunStore, "runsForPr" | "getProjection">;
  caps: PrepareCaps;
}

/** How many earlier runs to look back through for a review that posted. */
const PREVIOUS_RUNS = 10;

function cut(text: string, bytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= bytes) return { text, truncated: false };
  // Cut on a line so the tail of the file is a whole line or nothing.
  const head = Buffer.from(text, "utf8").subarray(0, bytes).toString("utf8");
  const lastLine = head.lastIndexOf("\n");
  return { text: lastLine > 0 ? head.slice(0, lastLine) : head, truncated: true };
}

/**
 * The standards files at the pull request's base, capped twice. Read from
 * base and not from head for the reason `.cujo.yml` is (decision 13): what a
 * pull request may be held to is decided by the branch it targets, and a pull
 * request that rewrites CONTRIBUTING.md to permit itself has changed nothing
 * until it is merged. A missing file is skipped; a read that failed throws,
 * because "the repo has no standards" and "GitHub did not answer" are
 * different facts and only one of them should reach a review.
 */
export async function readStandards(
  github: Pick<GitHubReader, "readFile">,
  repo: string,
  ref: string,
  caps: Pick<PrepareCaps, "standardsFileBytes" | "standardsTotalBytes">,
): Promise<StandardsFile[]> {
  const files: StandardsFile[] = [];
  let total = 0;
  for (const path of STANDARDS_PATHS) {
    const raw = await github.readFile(repo, path, ref);
    if (raw === null) continue;
    const { text, truncated } = cut(raw, caps.standardsFileBytes);
    const size = Buffer.byteLength(text, "utf8");
    if (total + size > caps.standardsTotalBytes) continue;
    total += size;
    files.push({ path, text, truncated });
  }
  return files;
}

/**
 * The newest earlier run on this pull request whose review posted, reduced to
 * what a reader needs in order not to say it twice. A diff run has a fresh
 * session (decision 137), so this is its whole memory of the pull request.
 * Hard-rule findings are left out: a diff run cannot reproduce them and must
 * not restate them as its own reading.
 */
export function previousFindings(
  store: Pick<RunStore, "runsForPr" | "getProjection">,
  run: Pick<RunRecord, "id" | "repo" | "prNumber">,
): PreviousFinding[] {
  for (const earlier of store.runsForPr(run.repo, run.prNumber, PREVIOUS_RUNS)) {
    if (earlier.id === run.id) continue;
    const projection = store.getProjection(earlier.id);
    if (!projection?.review) continue;
    return projection.findings
      .filter((f) => f.source === "agent")
      .map((f) => ({
        severity: f.severity,
        title: f.title,
        ...(f.path !== undefined ? { path: f.path } : {}),
        ...(f.line !== undefined ? { line: f.line } : {}),
      }));
  }
  return [];
}

export async function prepareReviewPackage(
  deps: PrepareDeps,
  pr: PullRequestInfo,
  run: Pick<RunRecord, "id" | "repo" | "prNumber">,
  instructions: Instructions | null = null,
): Promise<ReviewPackage> {
  const standards = await readStandards(deps.github, pr.repo, pr.baseSha, deps.caps);
  return {
    pr: {
      repo: pr.repo,
      prNumber: pr.prNumber,
      title: pr.title,
      body: pr.body,
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      changedFiles: pr.changedFiles,
    },
    diff: compressDiff(pr.files, deps.caps.diffBytes),
    standards,
    instructions,
    previousFindings: previousFindings(deps.store, run),
  };
}
