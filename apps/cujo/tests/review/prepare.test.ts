import { describe, expect, it } from "vitest";
import type { PullRequestInfo } from "../../src/clients/github";
import { emptyProjection } from "../../src/review/fold";
import {
  STANDARDS_PATHS,
  prepareReviewPackage,
  previousFindings,
  readStandards,
} from "../../src/review/prepare";
import type { Finding } from "../../src/review/types";
import { Store } from "../../src/store";

const caps = { diffBytes: 1000, standardsFileBytes: 40, standardsTotalBytes: 60 };

/** A reader over a map of `ref:path` to text; a missing key is a 404. */
function reader(files: Record<string, string>, fail?: string) {
  const reads: string[] = [];
  return {
    reads,
    readFile: async (_repo: string, path: string, ref: string) => {
      reads.push(`${ref}:${path}`);
      if (path === fail) throw new Error("GitHub /contents returned 500");
      return files[`${ref}:${path}`] ?? null;
    },
  };
}

const pr: PullRequestInfo = {
  repo: "o/r",
  prNumber: 7,
  title: "t",
  body: "b",
  baseSha: "base",
  headSha: "head",
  cloneUrl: "https://github.com/o/r.git",
  changedFiles: ["src/a.ts"],
  files: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ +1 @@" }],
  authorLogin: "octocat",
  authorId: 1,
  authorIsBot: false,
};

describe("readStandards", () => {
  it("reads the four files at base, in order, and skips the ones that are not there", async () => {
    const gh = reader({ "base:AGENTS.md": "agents", "base:CONTRIBUTING.md": "contrib" });
    const out = await readStandards(gh, "o/r", "base", caps);
    expect(out).toEqual([
      { path: "AGENTS.md", text: "agents", truncated: false },
      { path: "CONTRIBUTING.md", text: "contrib", truncated: false },
    ]);
    expect(gh.reads).toEqual(STANDARDS_PATHS.map((p) => `base:${p}`));
  });

  it("cuts a long file on a line and says so, and drops a file past the total", async () => {
    const long = `${"x".repeat(30)}\n${"y".repeat(30)}\n`;
    const gh = reader({
      "base:AGENTS.md": long,
      "base:CLAUDE.md": "c".repeat(30),
      "base:CONTRIBUTING.md": "small",
    });
    const out = await readStandards(gh, "o/r", "base", caps);
    // 40 bytes of `long` is the first line plus part of the second; the cut
    // lands at the newline. 30 kept + 30 more = 60 fits; "small" would not.
    expect(out).toEqual([
      { path: "AGENTS.md", text: "x".repeat(30), truncated: true },
      { path: "CLAUDE.md", text: "c".repeat(30), truncated: false },
    ]);
  });

  it("throws when a read fails rather than reviewing against nothing", async () => {
    const gh = reader({}, "CLAUDE.md");
    await expect(readStandards(gh, "o/r", "base", caps)).rejects.toThrow("returned 500");
  });
});

describe("previousFindings", () => {
  const finding = (over: Partial<Finding>): Finding => ({
    source: "agent",
    check: "diff",
    severity: "warn",
    title: "t",
    evidence: "e",
    ...over,
  });

  it("returns the agent findings of the newest earlier run that posted, without hard rules", () => {
    const store = new Store(":memory:");
    const head = { repo: "o/r", prNumber: 7, sessionId: "s", isPublic: true };
    const first = store.runs.createRun({ ...head, headSha: "h1" }).run;
    store.runs.updateRun(first.id, { status: "clean" });
    store.runs.putProjection(first.id, {
      ...emptyProjection(),
      review: {
        tool: "post_advisory_review",
        toolCallId: "c",
        body: "b",
        composedBody: "b",
        comments: [],
        findings: [],
      },
      findings: [
        finding({ title: "old", path: "src/a.ts", line: 3 }),
        finding({ source: "hard_rule", title: "rule", severity: "critical" }),
        finding({ title: "unanchored", severity: "info" }),
      ],
    });
    // A newer run that never posted is skipped, not returned empty.
    const second = store.runs.createRun({ ...head, headSha: "h2" }).run;
    store.runs.updateRun(second.id, { status: "error" });
    store.runs.putProjection(second.id, emptyProjection());
    const current = store.runs.createRun({ ...head, headSha: "h3" }).run;
    expect(previousFindings(store.runs, current)).toEqual([
      { severity: "warn", title: "old", path: "src/a.ts", line: 3 },
      { severity: "info", title: "unanchored" },
    ]);
  });

  it("is empty on a pull request's first run", () => {
    const store = new Store(":memory:");
    const run = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "h1",
      sessionId: "s",
      isPublic: true,
    }).run;
    expect(previousFindings(store.runs, run)).toEqual([]);
  });
});

describe("prepareReviewPackage", () => {
  it("assembles the metadata, the compressed diff, the standards and the memory", async () => {
    const store = new Store(":memory:");
    const run = store.runs.createRun({
      repo: "o/r",
      prNumber: 7,
      headSha: "head",
      sessionId: "s",
      isPublic: true,
    }).run;
    const gh = reader({ "base:CONTRIBUTING.md": "## Standards\n" });
    const pkg = await prepareReviewPackage({ github: gh, store: store.runs, caps }, pr, run);
    expect(pkg.pr).toEqual({
      repo: "o/r",
      prNumber: 7,
      title: "t",
      body: "b",
      baseSha: "base",
      headSha: "head",
      changedFiles: ["src/a.ts"],
    });
    expect(pkg.diff.kept.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(pkg.diff.cap).toBe(1000);
    expect(pkg.standards.map((s) => s.path)).toEqual(["CONTRIBUTING.md"]);
    expect(pkg.previousFindings).toEqual([]);
    // No clone URL and no author: the package names nothing the model can
    // fetch and nobody it can address.
    expect(JSON.stringify(pkg)).not.toContain("github.com");
    expect(JSON.stringify(pkg)).not.toContain("octocat");
  });
});
