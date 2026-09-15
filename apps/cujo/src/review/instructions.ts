/**
 * The owner's instructions for one repository (decision 155): what to care
 * about, what to ignore, in the owner's words, read beside the standards
 * files by both reviews. Two places can hold them, and the file wins where
 * it exists — `deploy default < board < repository file` — read at the pull
 * request's base for the reason `.cujo.yml` is (decision 13).
 *
 * Capped at the standards file cap, and cut on a line, so a wall of text
 * cannot crowd the diff out of the brief. Untrusted like everything else out
 * of a repository: the rubric says so, and this reader only sizes it.
 */

import type { GitHubReader } from "../clients/github";
import type { RepositorySettingsStore } from "../store/repository-settings";
import { STANDARDS_FILE_BYTES, cut } from "./prepare";

export const INSTRUCTIONS_PATH = ".cujo/REVIEW.md";
/** The same cap as one standards file, and the same cut, so the two cannot drift. */
export const INSTRUCTIONS_BYTES = STANDARDS_FILE_BYTES;

export interface Instructions {
  source: "file" | "board";
  text: string;
  truncated: boolean;
}

/**
 * The file at `ref` when it exists and says something, else the board's text,
 * else null. A read that failed throws, as the standards read does: "the
 * repository has no instructions" and "GitHub did not answer" are different
 * facts and only one of them should reach a review.
 */
export async function readInstructions(
  github: Pick<GitHubReader, "readFile">,
  settings: Pick<RepositorySettingsStore, "get"> | undefined,
  repo: string,
  ref: string,
): Promise<Instructions | null> {
  const file = await github.readFile(repo, INSTRUCTIONS_PATH, ref);
  if (file !== null && file.trim() !== "") {
    return { source: "file", ...cut(file, INSTRUCTIONS_BYTES) };
  }
  const board = settings?.get(repo).instructions ?? null;
  if (board !== null && board.trim() !== "") {
    return { source: "board", ...cut(board, INSTRUCTIONS_BYTES) };
  }
  return null;
}
