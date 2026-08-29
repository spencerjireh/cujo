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

  it("refuses a comment that says both things", () => {
    expect(verbOf("/cujo confirm\n/cujo dismiss")).toBe("ambiguous");
  });

  it("reads one verb repeated as that verb", () => {
    expect(verbOf("/cujo confirm\n/cujo confirm")).toBe("confirm");
  });
});
