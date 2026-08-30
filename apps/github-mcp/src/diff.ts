/**
 * Unified-diff anchor validation. GitHub rejects a review comment whose line
 * is not part of the PR diff, and one bad anchor fails the whole review. So
 * every comment is checked against the hunks GitHub returned for the file
 * before anything is posted; the ones that fail move into the review body.
 */

export type Side = "LEFT" | "RIGHT";

export interface DiffLines {
  /** Line numbers that exist in the diff on the base (LEFT) side. */
  left: Set<number>;
  /** Line numbers that exist in the diff on the head (RIGHT) side. */
  right: Set<number>;
}

export interface PullFile {
  filename: string;
  /** Absent for binary files and for very large diffs GitHub does not inline. */
  patch?: string;
}

export interface ReviewComment {
  path: string;
  line: number;
  side?: Side;
  body: string;
}

export interface AnchoredComment extends ReviewComment {
  side: Side;
}

/**
 * Why a comment could not be anchored to the diff.
 *
 * The three branches were always distinguished internally and then thrown
 * away, which left `moved_to_body` as a count with no explanation: an agent
 * citing a file the PR does not touch and an agent citing a real file at a
 * line outside the hunk are different mistakes, and only the first suggests
 * the rubric is pointing it at the wrong thing.
 */
export type MovedReason = "file_not_in_diff" | "line_not_in_hunk" | "bad_line";

export interface MovedComment {
  comment: ReviewComment;
  reason: MovedReason;
}

export interface AnchorResult {
  inline: AnchoredComment[];
  moved: MovedComment[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Walk the hunks of one file's patch and collect the line numbers present on
 * each side. Context lines count on both sides, `-` lines on LEFT only, `+`
 * lines on RIGHT only.
 */
export function parseDiffLines(patch: string | undefined): DiffLines {
  const lines: DiffLines = { left: new Set(), right: new Set() };
  if (!patch) return lines;

  let oldLine = 0;
  let newLine = 0;
  // Lines still owed to the current hunk per its header; once both hit zero
  // nothing until the next header is a diff line.
  let oldLeft = 0;
  let newLeft = 0;

  const rows = patch.split("\n");
  if (rows.at(-1) === "") rows.pop(); // a newline-terminated patch, not an empty context line

  for (const raw of rows) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = header[4] === undefined ? 1 : Number(header[4]);
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"

    const marker = raw[0];
    if (marker === "+") {
      if (newLeft <= 0) continue;
      lines.right.add(newLine);
      newLine += 1;
      newLeft -= 1;
    } else if (marker === "-") {
      if (oldLeft <= 0) continue;
      lines.left.add(oldLine);
      oldLine += 1;
      oldLeft -= 1;
    } else {
      if (oldLeft <= 0 || newLeft <= 0) continue;
      lines.left.add(oldLine);
      lines.right.add(newLine);
      oldLine += 1;
      newLine += 1;
      oldLeft -= 1;
      newLeft -= 1;
    }
  }
  return lines;
}

/**
 * Split comments into those GitHub will accept inline and those that must be
 * folded into the body. A comment is kept inline only when its path is in the
 * PR and its line is present on the requested side of that file's diff.
 */
export function validateAnchors(files: PullFile[], comments: ReviewComment[]): AnchorResult {
  const byPath = new Map<string, DiffLines>();
  for (const file of files) byPath.set(file.filename, parseDiffLines(file.patch));

  const inline: AnchoredComment[] = [];
  const moved: MovedComment[] = [];

  for (const comment of comments) {
    const side: Side = comment.side ?? "RIGHT";
    const lines = byPath.get(comment.path);
    if (!Number.isInteger(comment.line) || comment.line <= 0) {
      moved.push({ comment, reason: "bad_line" });
      continue;
    }
    if (!lines) {
      moved.push({ comment, reason: "file_not_in_diff" });
      continue;
    }
    if (!(side === "LEFT" ? lines.left : lines.right).has(comment.line)) {
      moved.push({ comment, reason: "line_not_in_hunk" });
      continue;
    }
    inline.push({ ...comment, side });
  }
  return { inline, moved };
}

/**
 * Append the legacy comments that lost their anchor to the review body.
 *
 * Retired for findings-derived comments (decision 74) — a finding whose anchor
 * GitHub refused is already printed in the composed body and marked there, so
 * exiling it to a section of its own would print it twice. It survives for the
 * deprecated `comments[]` path, where the same is not true: a legacy comment's
 * text lives nowhere but the comment, so a rejected anchor drops it from the
 * review entirely. That is a regression this function exists to prevent, and
 * it goes when `comments[]` does.
 */
export function appendMovedComments(body: string, moved: MovedComment[]): string {
  if (moved.length === 0) return body;
  const lines = moved.map(
    ({ comment: c }) => `- \`${c.path}:${c.line}\` (${c.side ?? "RIGHT"}): ${c.body.trim()}`,
  );
  return `${body.trimEnd()}\n\n### Findings without a diff anchor\n\n${lines.join("\n")}\n`;
}
