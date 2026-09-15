import type { RepositorySettingsView, ReviewMode } from "@/lib/api/owner-client";

/**
 * What the settings page says about where a value comes from (decision 155),
 * decided without a component: `deploy default < board < repository file`.
 */

export const MODE_LABELS: Record<ReviewMode, string> = {
  sandbox: "run it",
  diff: "read it",
};

/** The sentence under the mode control. */
export function describeMode(view: RepositorySettingsView): string {
  const { effective, file, board, instance } = view;
  const word = MODE_LABELS[effective.mode.value];
  if (effective.mode.source === "file") {
    const shadowed =
      board.mode && board.mode !== file.mode
        ? ` The board's choice, ${MODE_LABELS[board.mode]}, has no effect while the file speaks.`
        : "";
    return `The repository's own .cujo.yml sets this: the next run will ${word}.${shadowed}`;
  }
  if (effective.mode.source === "board") {
    return `Set here: the next run will ${word}. The repository's .cujo.yml does not say, so this stands.`;
  }
  return `Nothing is set for this repository, so it follows the instance: the next run will ${word} (${MODE_LABELS[instance.mode]} is the instance's default).`;
}

/** The sentence under the instructions. */
export function describeInstructions(view: RepositorySettingsView): string {
  const { effective, file, board } = view;
  if (!effective.instructions) {
    return "No instructions. The reviews read the repository's standards files and nothing else of yours.";
  }
  const cut = effective.instructions.truncated
    ? " Cut on a line at 16 KB; the reviews read what is shown."
    : "";
  if (effective.instructions.source === "file") {
    const shadowed = board.instructions?.trim()
      ? " What is written here on the board has no effect while the file exists."
      : "";
    return `The repository's ${file.path} sets these, read at each pull request's base.${shadowed}${cut}`;
  }
  return `Set here, and read by both reviews beside the standards files. Adding ${file.path} to the repository would take over.${cut}`;
}
