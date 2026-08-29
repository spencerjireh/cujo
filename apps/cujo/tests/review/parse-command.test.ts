import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/review/parse-command";

const verbOf = (body: string) => {
  const parsed = parseCommand(body);
  return parsed.kind === "command" ? parsed.verb : parsed.kind;
};

describe("parseCommand", () => {
  it("reads a verb on its own line", () => {
    expect(verbOf("/cujo confirm")).toBe("confirm");
    expect(verbOf("/cujo dismiss")).toBe("dismiss");
    expect(verbOf("looks right to me\n\n/cujo confirm\n")).toBe("confirm");
    expect(verbOf("/cujo\tconfirm  ")).toBe("confirm");
    expect(verbOf("/cujo confirm\r\n")).toBe("confirm");
  });

  it("ignores a comment that is not a command", () => {
    expect(verbOf("")).toBe("none");
    expect(verbOf("looks fine")).toBe("none");
    expect(verbOf("/cujo")).toBe("none");
    expect(verbOf("/cujo status")).toBe("none");
    expect(verbOf("/cujoconfirm")).toBe("none");
  });

  it("refuses a verb buried in a sentence", () => {
    // Anything after the verb means this is prose about a command, not one.
    // Intent is never parsed here: an intent parser reads "ignore that" as a
    // dismissal, which is the whole reason the privileged syntax is exact.
    expect(verbOf("/cujo confirm this is malware")).toBe("none");
    expect(verbOf("I would /cujo confirm but I am not sure")).toBe("none");
    expect(verbOf("please /cujo dismiss")).toBe("none");
  });

  it("does not match a command inside a code fence", () => {
    expect(verbOf("here is how:\n\n```\n/cujo confirm\n```\n")).toBe("none");
    expect(verbOf("```sh\n/cujo dismiss\n```")).toBe("none");
    expect(verbOf("~~~\n/cujo confirm\n~~~")).toBe("none");
  });

  it("closes a fence only on its own character", () => {
    // A ``` inside a ~~~ block does not end it, so the command stays fenced.
    expect(verbOf("~~~\n```\n/cujo confirm\n```\n~~~")).toBe("none");
  });

  it("still reads a command after a fence has closed", () => {
    expect(verbOf("```\nnot this one\n```\n/cujo confirm")).toBe("confirm");
  });

  it("does not match a quoted command", () => {
    // Somebody repeating what Cujo said, or quoting an earlier comment, is not
    // giving the command themselves.
    expect(verbOf("> /cujo confirm\n\nI would not.")).toBe("none");
    expect(verbOf("  >  /cujo dismiss")).toBe("none");
  });

  it("does not match an indented command, which renders as a code block", () => {
    expect(verbOf("    /cujo confirm")).toBe("none");
    expect(verbOf("  /cujo confirm")).toBe("none");
  });

  it("does not let a short or decorated fence close a longer one", () => {
    // CommonMark §4.5: a closing fence is at least as long as its opener and
    // carries nothing after it. Reading either as a close would let the next
    // line out of a block GitHub still renders as code.
    expect(verbOf("````\n```\n/cujo confirm\n````")).toBe("none");
    expect(verbOf("```\n```js\n/cujo confirm\n```")).toBe("none");
    expect(verbOf("```\n``` and more\n/cujo dismiss\n```")).toBe("none");
  });

  it("does not treat an indented fence as a fence at all", () => {
    // Four spaces is an indented code block, so this never opens a fence and
    // never toggles one shut either.
    expect(verbOf("```\n    ```\n/cujo confirm\n```")).toBe("none");
  });

  it("does not match a lazy blockquote continuation", () => {
    // GitHub keeps an unmarked line inside the quote when it continues a
    // quoted paragraph (CommonMark §5.1), so this renders wholly as a
    // quotation and the second line is not a command anyone gave.
    expect(verbOf("> they said this was fine\n/cujo dismiss")).toBe("none");
    expect(verbOf("> a\n> b\n/cujo confirm")).toBe("none");
  });

  it("reads a command once a blank line has ended the quote", () => {
    expect(verbOf("> they said this was fine\n\n/cujo confirm")).toBe("confirm");
  });

  it("does not match a command hidden in an HTML comment", () => {
    // Rendered, this is invisible. A gate a reader cannot see is not a gate.
    expect(verbOf("<!-- /cujo confirm -->")).toBe("none");
    expect(verbOf("looks fine\n<!--\n/cujo dismiss\n-->\n")).toBe("none");
    // Unterminated: the rest of the comment is swallowed too, which is the
    // conservative reading and the one that refuses.
    expect(verbOf("<!--\n/cujo confirm")).toBe("none");
  });

  it("reads a command after an HTML comment closes", () => {
    expect(verbOf("<!-- a note -->\n/cujo confirm")).toBe("confirm");
  });

  it("does not read a fence out of inline code", () => {
    expect(verbOf("use `a` here\n/cujo confirm")).toBe("confirm");
  });

  it("does not match a command inside raw HTML", () => {
    // GitHub renders markdown with raw HTML in it. `<pre>` shows its contents
    // as code, and a block tag wraps them in markup — neither reads as an
    // instruction somebody gave.
    expect(verbOf("<pre>\n/cujo dismiss\n</pre>")).toBe("none");
    expect(verbOf("<details>\n/cujo confirm\n</details>")).toBe("none");
    expect(verbOf("<table>\n<tr><td>\n/cujo dismiss\n</td></tr>\n</table>")).toBe("none");
  });

  it("keeps a pre block open across a blank line, unlike a block tag", () => {
    // §4.6 condition 1 ends on the closing tag; condition 6 ends on a blank
    // line. Reading `<pre>` the second way would let the command out.
    expect(verbOf("<pre>\n\n/cujo confirm\n</pre>")).toBe("none");
    expect(verbOf("<div>\nmarkup\n\n/cujo confirm")).toBe("confirm");
  });

  it("does not treat an autolink at the start of a line as HTML", () => {
    // The tag list is CommonMark's for exactly this: `<h…>` is not `<h1>`.
    expect(verbOf("<https://example.com/x>\n\n/cujo confirm")).toBe("confirm");
  });

  it("refuses a comment that says both things", () => {
    expect(verbOf("/cujo confirm\n/cujo dismiss")).toBe("ambiguous");
  });

  it("reads one verb repeated as that verb", () => {
    expect(verbOf("/cujo confirm\n/cujo confirm")).toBe("confirm");
  });
});
