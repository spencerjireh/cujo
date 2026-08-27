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

export interface AnchorResult {
  inline: AnchoredComment[];
  moved: ReviewComment[];
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
  let inHunk = false;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"

    const marker = raw[0];
    if (marker === "+") {
      lines.right.add(newLine);
      newLine += 1;
    } else if (marker === "-") {
      lines.left.add(oldLine);
      oldLine += 1;
    } else {
      lines.left.add(oldLine);
      lines.right.add(newLine);
      oldLine += 1;
      newLine += 1;
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
  const moved: ReviewComment[] = [];

  for (const comment of comments) {
    const side: Side = comment.side ?? "RIGHT";
    const lines = byPath.get(comment.path);
    const present = lines ? (side === "LEFT" ? lines.left : lines.right).has(comment.line) : false;
    if (present && Number.isInteger(comment.line) && comment.line > 0) {
      inline.push({ ...comment, side });
    } else {
      moved.push(comment);
    }
  }
  return { inline, moved };
}

/** Append the comments that lost their anchor to the review body. */
export function appendMovedComments(body: string, moved: ReviewComment[]): string {
  if (moved.length === 0) return body;
  const lines = moved.map(
    (c) => `- \`${c.path}:${c.line}\` (${c.side ?? "RIGHT"}): ${c.body.trim()}`,
  );
  return `${body.trimEnd()}\n\n### Findings without a diff anchor\n\n${lines.join("\n")}\n`;
}
