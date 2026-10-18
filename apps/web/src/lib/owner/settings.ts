import type { RepositorySettingsView, ReviewMode } from "@/lib/api/owner-client";

/**
 * What the repository page says about where a value comes from (decision 155),
 * decided without a component: `default < set here < repository file`. The
 * words are the owner's, not the system's (decision 175): "set here" and not
 * "the board", "Full review" and not "run it".
 */

export const MODE_LABELS: Record<ReviewMode, string> = {
  sandbox: "Full review",
  diff: "Diff only",
};

/** What each mode does, in one line, shown beside the choice. */
export const MODE_DETAILS: Record<ReviewMode, string> = {
  sandbox: "Runs the code in a sandbox: install, tests, probes, a boot, and new dependencies.",
  diff: "Reads the diff against your standards. Nothing runs.",
};

/** The mode in effect and where it comes from, as one short line for a header. */
export function effectiveMode(view: RepositorySettingsView): string {
  const { value, source } = view.effective.mode;
  const from =
    source === "file" ? "set by .cujo.yml" : source === "board" ? "set here" : "the default";
  return `${MODE_LABELS[value]}, ${from}`;
}

/** The sentence under the mode control. */
export function describeMode(view: RepositorySettingsView): string {
  const { effective, file, board } = view;
  const word = MODE_LABELS[effective.mode.value];
  if (effective.mode.source === "file") {
    const shadowed =
      board.mode && board.mode !== file.mode
        ? ` The choice here, ${MODE_LABELS[board.mode]}, is ignored while the file sets it.`
        : "";
    return `Set by .cujo.yml in the repository: ${word}.${shadowed}`;
  }
  if (effective.mode.source === "board") {
    return `Set here: ${word}. The repository's .cujo.yml does not set a mode, so this applies.`;
  }
  return `Not set for this repository, so it uses the default: ${word}.`;
}

/** The sentence under the instructions. */
export function describeInstructions(view: RepositorySettingsView): string {
  const { effective, file, board } = view;
  if (!effective.instructions) {
    return "No instructions. Reviews read the repository's standards files only.";
  }
  const cut = effective.instructions.truncated
    ? " Cut on a line at 16 KB; reviews read what is shown."
    : "";
  if (effective.instructions.source === "file") {
    const shadowed = board.instructions?.trim()
      ? " The text here is ignored while the file exists."
      : "";
    return `Set by ${file.path} in the repository, read at each pull request's base.${shadowed}${cut}`;
  }
  return `Set here. Reviews read this beside the standards files. Adding ${file.path} to the repository replaces it.${cut}`;
}
