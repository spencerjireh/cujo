/**
 * Fitting a command's answer into what Discord will accept.
 *
 * Not a subcommand — there is no `/cujo text`. The four subcommands are
 * watch, unwatch, status and test; this is what they share.
 */

/** Discord's cap on the content of a message, which a deferred reply is. */
export const MAX_CONTENT = 2000;

/**
 * Discord refuses a message over 2000 characters, and a deferred reply that
 * fails leaves the invoker staring at "thinking" forever. So a long list is
 * cut with a count rather than sent whole.
 */
export function fitLines(lines: string[]): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const tail = `\n…and ${lines.length - kept.length} more`;
    if (length + line.length + 1 + tail.length > MAX_CONTENT) {
      return `${kept.join("\n")}${tail}`;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join("\n");
}
