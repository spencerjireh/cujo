import type { ReviewMode } from "./types";

/**
 * Why a run is the review it is, for the log and the run page (decision 135).
 * `declared`, `board` and `deploy_default` are the three layers of the
 * setting (decision 155); the two floors override any of them.
 */
export type ModeReason = "declared" | "board" | "deploy_default" | "manifest_floor" | "bot_floor";

export interface ModeInputs {
  /** `CUJO_REVIEW_MODE`, the instance's answer when the repo gives none. */
  deployDefault: ReviewMode;
  /** `mode:` from `.cujo.yml` at the pull request's base, or null for none. */
  declared: ReviewMode | null;
  /** What the owner set for this repository on the board, or null for nothing (decision 155). */
  board?: ReviewMode | null;
  /** A dependency manifest is in the diff: an install the sandbox has to watch. */
  manifestChanged: boolean;
  /** GitHub says a Bot account opened it: nobody wrote it, so nobody read it. */
  authorIsBot: boolean;
}

/**
 * Deploy default, then the board's setting for the repository, then the
 * repository's own declaration, then the floors — in that order, and the
 * floors last on purpose. The declaration is text a
 * repository owner controls and a pull request cannot (it is read from base),
 * which is enough to let it pick the cheaper review; it is not enough to let
 * it skip the one review that watches an install, because the pull request
 * that adds a hostile dependency is exactly the one whose owner may have been
 * talked into `mode: diff`. The floors are code, and code does not read the
 * pull request.
 */
export function resolveMode(inputs: ModeInputs): { mode: ReviewMode; reason: ModeReason } {
  if (inputs.manifestChanged) return { mode: "sandbox", reason: "manifest_floor" };
  if (inputs.authorIsBot) return { mode: "sandbox", reason: "bot_floor" };
  if (inputs.declared !== null) return { mode: inputs.declared, reason: "declared" };
  if (inputs.board) return { mode: inputs.board, reason: "board" };
  return { mode: inputs.deployDefault, reason: "deploy_default" };
}
