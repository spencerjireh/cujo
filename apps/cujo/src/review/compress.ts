import type { PullRequestFile } from "../clients/github";
import { isDocsPath, isLockfilePath } from "./agent-spec";

/** A file the model reads: its hunks, whole. */
interface KeptFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
}

/** A file the model is told about and does not read, with why. */
interface OmittedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  reason: "no_patch" | "over_cap";
}

export interface CompressedDiff {
  kept: KeptFile[];
  omitted: OmittedFile[];
  /** Bytes of patch text in `kept`; what the cap was spent on. */
  bytes: number;
  cap: number;
}

/**
 * Where a file sits in the reading order (Contract 11). Lower reads first.
 * Source before prose, prose before anything generated, and lockfiles last:
 * a lockfile diff is thousands of lines that say "the manifest changed",
 * which the manifest already said in three.
 */
export function rankOf(path: string): number {
  if (isLockfilePath(path)) return 3;
  if (/(^|\/)(dist|build|vendor|node_modules|__generated__|__snapshots__)\//.test(path)) return 2;
  if (/\.(min\.(js|css)|snap|map|lock)$/.test(path)) return 2;
  if (isDocsPath(path)) return 1;
  return 0;
}

/**
 * Fit a pull request's diff under a byte cap without cutting a hunk in half.
 *
 * Files are kept whole, in rank order and then in GitHub's order, until the
 * next one would not fit; every file after that is listed by name with its
 * line counts and the reason it is not there. The cap is spent on hunks, so a
 * file that has none (a binary, a rename, something GitHub thought too big)
 * costs nothing and is listed as `no_patch`. The list of what was left out is
 * part of the package on purpose: the model is told what it did not read, the
 * same way a sensor report says what it could not observe (decision 54).
 *
 * Whole files rather than the first N bytes of each: a hunk cut mid-line is a
 * line the model will anchor a finding to and `github-mcp` will refuse.
 */
export function compressDiff(files: readonly PullRequestFile[], cap: number): CompressedDiff {
  const kept: KeptFile[] = [];
  const omitted: OmittedFile[] = [];
  let bytes = 0;
  const ordered = files
    .map((file, index) => ({ file, index, rank: rankOf(file.path) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.file);
  for (const file of ordered) {
    const { path, status, additions, deletions, patch } = file;
    if (patch === null) {
      omitted.push({ path, status, additions, deletions, reason: "no_patch" });
      continue;
    }
    const size = Buffer.byteLength(patch, "utf8");
    if (bytes + size > cap) {
      omitted.push({ path, status, additions, deletions, reason: "over_cap" });
      continue;
    }
    bytes += size;
    kept.push({ path, status, additions, deletions, patch });
  }
  return { kept, omitted, bytes, cap };
}
