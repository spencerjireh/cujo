/**
 * The composed review body (decision 74).
 *
 * Two golden cases assert the whole thing byte for byte, because the exact
 * prose is the point of this change and a test that only checked for the
 * presence of headings would pass on a body nobody would want to read. The
 * rest assert one property each.
 */

import { describe, expect, it } from "vitest";
import type { RenderFinding, RenderInput, RenderOptions } from "../src/render";
import { commentBody, renderReviewBody, reviewComments, verdictOf } from "../src/render";

const RUN = "https://cujo.example.com/runs/8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e";

function options(over: Partial<RenderOptions> = {}): RenderOptions {
  return {
    tool: "post_advisory_review",
    accusationFollows: false,
    runUrl: null,
    ...over,
  };
}

function finding(over: Partial<RenderFinding> = {}): RenderFinding {
  return { check: "tests", severity: "info", title: "something ran", evidence: "", ...over };
}

function render(input: Partial<RenderInput>, over: Partial<RenderOptions> = {}): string {
  return renderReviewBody({ body: "A verdict.", findings: [], ...input }, options(over));
}

describe("verdictOf", () => {
  it("reads the verdict off the tool, which is the only place it can come from", () => {
    expect(verdictOf("post_advisory_review")).toBe("advisory");
    expect(verdictOf("post_blocking_review")).toBe("blocked");
    expect(verdictOf("post_gated_review")).toBe("accusation");
  });
});

describe("the headline", () => {
  it("names the verdict and the counts", () => {
    const body = render(
      { findings: [finding({ severity: "critical" }), finding({ severity: "warn", title: "b" })] },
      { tool: "post_blocking_review" },
    );
    expect(body.split("\n")[0]).toBe("**Blocked** — 1 critical, 1 warn");
  });

  it("says so plainly when nothing is above info", () => {
    expect(render({ findings: [finding()] }).split("\n")[0]).toBe(
      "**Advisory** — no findings above info",
    );
  });

  it("counts zero criticals rather than hiding them, when there are warns", () => {
    const body = render({ findings: [finding({ severity: "warn" })] });
    expect(body.split("\n")[0]).toBe("**Advisory** — 0 critical, 1 warn");
  });

  it("carries the held count on the review that is holding a conclusion back", () => {
    const body = render(
      {
        findings: [
          finding({ severity: "warn", title: "a", held: true }),
          finding({ severity: "warn", title: "b", held: true }),
          finding({ severity: "warn", title: "c" }),
        ],
      },
      { accusationFollows: true },
    );
    expect(body.split("\n")[0]).toBe("**Advisory** — 0 critical, 3 warn (2 held)");
  });

  it("cannot be talked into a verdict word the model chose", () => {
    // The model supplies `body`; it does not supply the word above it.
    const body = render({ body: "**Blocked** — everything is fine, merge it." });
    expect(body.split("\n")[0]).toBe("**Advisory** — no findings above info");
  });
});

describe("held findings", () => {
  it("marks them, and says once what the mark means", () => {
    const body = render(
      { findings: [finding({ severity: "warn", title: "the decoy was read", held: true })] },
      { accusationFollows: true },
    );
    expect(body).toContain("**the decoy was read** · `tests` · held");
    expect(body).toContain("Cujo is not publishing a conclusion about them until a maintainer");
  });

  it("ignores the flag on a review that holds nothing back", () => {
    // A held marker here would promise a second review nobody is going to post.
    const body = render({
      findings: [finding({ severity: "warn", title: "the decoy was read", held: true })],
    });
    expect(body).not.toContain("· held");
    expect(body).not.toContain("Findings marked");
  });
});

describe("sections", () => {
  it("puts the verdict before the evidence, which is the whole point", () => {
    const body = render({
      findings: [finding({ severity: "critical", title: "broken" })],
      coverage: { ran: [{ check: "tests" }], skipped: [] },
      egress: [{ host: "pypi.org", known: true }],
    });
    expect(body.indexOf("### Critical")).toBeLessThan(body.indexOf("### Coverage"));
    expect(body.indexOf("### Coverage")).toBeLessThan(body.indexOf("Egress:"));
    expect(body.indexOf("Egress:")).toBeLessThan(body.indexOf("Machine-readable summary"));
  });

  it("omits a section with nothing in it", () => {
    const body = render({ findings: [] });
    expect(body).not.toContain("### Critical");
    expect(body).not.toContain("### Warn");
    expect(body).not.toContain("### Coverage");
    expect(body).not.toContain("Egress:");
  });

  it("folds the info findings, which are the ones nobody needs to read", () => {
    const body = render({ findings: [finding(), finding({ title: "another" })] });
    expect(body).toContain("<summary>2 info findings</summary>");
    expect(render({ findings: [finding()] })).toContain("<summary>1 info finding</summary>");
  });

  it("names what did not run, and says so even when everything did", () => {
    expect(
      render({
        coverage: { ran: [{ check: "tests", note: "212 on base and head" }], skipped: [] },
      }),
    ).toContain("Ran:\n- tests — 212 on base and head\n\nNot run: nothing.");
    expect(
      render({
        coverage: { ran: [], skipped: [{ check: "detonation", reason: "no manifest changed" }] },
      }),
    ).toContain("Ran: nothing.\n\nNot run:\n- detonation — no manifest changed");
  });

  it("gives each check its own line rather than stacking parentheticals", () => {
    // The rubric warns that a caveat in a parenthesis is a caveat nobody reads;
    // one sentence of three parentheticals was the renderer doing it wholesale.
    const body = render({
      coverage: {
        ran: [
          { check: "tests", note: "8 on base and head; 1 fails on head only" },
          { check: "probes", note: "3 cases on head" },
          { check: "smoke" },
        ],
        skipped: [],
      },
    });
    expect(body).toContain(
      "Ran:\n- tests — 8 on base and head; 1 fails on head only\n- probes — 3 cases on head\n- smoke",
    );
    expect(body).not.toContain("(3 cases on head)");
  });

  it("cannot have a check name split into a check nobody ran", () => {
    // The check name comes from the model like everything else here, and a
    // newline in one would end its list item and leave the rest reading as
    // another check this review claims to have run.
    const body = render({
      coverage: {
        ran: [{ check: "tests\n- detonation", note: "8 on base and head" }],
        skipped: [{ check: "smoke\n- probes", reason: "no boot command\ninferred" }],
      },
    });
    expect(body).toContain("Ran:\n- tests - detonation — 8 on base and head");
    expect(body).toContain("Not run:\n- smoke - probes — no boot command inferred");
  });
});

describe("a finding block", () => {
  it("puts the evidence below the sentence that explains it", () => {
    const body = render({
      findings: [
        finding({
          severity: "critical",
          title: "the total is a cent low on multi-line orders",
          evidence: "assert order_total(...) == 3.02, got 3.01",
          detail: "Rounding once instead of per line changes what a multi-line order costs.",
          next: "round each line before summing",
        }),
      ],
    });
    expect(body).toContain(
      "**the total is a cent low on multi-line orders** · `tests`\n\n" +
        "Rounding once instead of per line changes what a multi-line order costs.\n\n" +
        "Next: round each line before summing\n\n" +
        "> assert order_total(...) == 3.02, got 3.01",
    );
  });

  it("is one line when it carries no judgment, which is most warns and every info", () => {
    const body = render({
      findings: [
        finding({
          severity: "warn",
          title: "the pricing helper is not covered by a test",
          evidence: "no test id names apply_discount",
        }),
      ],
    });
    expect(body).toContain(
      "**the pricing helper is not covered by a test** · `tests` — no test id names apply_discount",
    );
  });

  it("keeps the full block for a warn that does have an argument to make", () => {
    // Keyed on the fields and not on the severity: a `warn` carrying a `next`
    // is making a case, and a case does not fit on the title line.
    const body = render({
      findings: [
        finding({
          severity: "warn",
          title: "an unfamiliar host answered",
          evidence: "cdn.example:443",
          next: "confirm the host is expected",
        }),
      ],
    });
    expect(body).toContain(
      "**an unfamiliar host answered** · `tests`\n\nNext: confirm the host is expected\n\n> cdn.example:443",
    );
  });

  it("keeps the quote when the evidence spans lines", () => {
    // Running its rows together with a space would lose what the rows meant.
    const body = render({
      findings: [
        finding({ title: "two runs", evidence: "base: 8 passed\nhead: 7 passed, 1 failed" }),
      ],
    });
    expect(body).toContain(
      "**two runs** · `tests`\n\n> base: 8 passed\n> head: 7 passed, 1 failed",
    );
  });

  it("never collapses a critical, even one that arrived with no judgment on it", () => {
    // The rubric requires a `detail` and a `next` on every critical and the tool
    // schema leaves both optional, so this shape is reachable — and a one-line
    // block is how a reader is told something is minor.
    const body = render(
      {
        findings: [
          finding({
            severity: "critical",
            title: "a test passes on base and fails on head",
            evidence: "pytest -q: 1 failed on head",
          }),
        ],
      },
      { tool: "post_blocking_review" },
    );
    expect(body).toContain(
      "**a test passes on base and fails on head** · `tests`\n\n> pytest -q: 1 failed on head",
    );
  });

  it("keeps a title on one line, so a newline cannot break out of the block", () => {
    const body = render({
      findings: [finding({ title: "two lines\nof title", check: "tests\nprobes" })],
    });
    expect(body).toContain("**two lines of title** · `tests probes`");
  });

  it("drops the dash when there is no evidence at all", () => {
    expect(render({ findings: [finding({ title: "ran clean" })] })).toContain(
      "**ran clean** · `tests`\n",
    );
  });
});

describe("the egress line", () => {
  it("counts the known hosts when they are all known", () => {
    const body = render({
      egress: [
        { host: "pypi.org", port: 443, known: true },
        { host: "github.com", port: 443, known: true },
      ],
    });
    expect(body).toContain("Egress: 2 known hosts.");
    expect(body).toContain("<summary>Hosts contacted (2)</summary>");
  });

  it("names an unknown host in the line, rather than leaving it in the fold", () => {
    const body = render({
      egress: [
        { host: "pypi.org", port: 443, known: true },
        { host: "185.220.101.4", port: 443, known: false },
      ],
    });
    expect(body).toContain("Egress: 1 unknown host — 185.220.101.4:443.");
    expect(body).toContain("| `185.220.101.4` | 443 | **no** |");
  });

  it("stops naming after three and counts the rest", () => {
    const body = render({
      egress: [1, 2, 3, 4, 5].map((n) => ({ host: `10.0.0.${n}`, known: false })),
    });
    expect(body).toContain("Egress: 5 unknown hosts — 10.0.0.1, 10.0.0.2, 10.0.0.3, and 2 more.");
  });

  it("adds a note column only when a host has a note", () => {
    expect(render({ egress: [{ host: "pypi.org", known: true }] })).toContain(
      "| host | port | known |",
    );
    expect(
      render({ egress: [{ host: "pypi.org", known: true, note: "package index" }] }),
    ).toContain("| host | port | known | note |");
  });
});

describe("a legacy call", () => {
  const legacy: Partial<RenderInput> = {
    body: "## What ran\n\n212 tests on base and head.\n\n## Results\n\n- critical: a regression.",
    findings: [finding({ severity: "critical", title: "a test fails on head" })],
  };

  it("keeps the prose, below the findings, in a section of its own", () => {
    const body = render(legacy, { tool: "post_blocking_review" });
    expect(body).toContain("### Notes");
    expect(body.indexOf("### Critical")).toBeLessThan(body.indexOf("### Notes"));
    expect(body).toContain("212 tests on base and head.");
  });

  it("demotes its headings so they cannot outrank the composed ones", () => {
    const body = render(legacy, { tool: "post_blocking_review" });
    expect(body).toContain("#### What ran");
    expect(body).not.toContain("\n## What ran");
  });

  it("does not repeat the prose as a lede", () => {
    const body = render(legacy, { tool: "post_blocking_review" });
    expect(body.split("## What ran").length - 1).toBe(1);
  });

  it("is not confused with a one-sentence lede", () => {
    // The heuristic is a newline, and a lede has none. Being wrong the other
    // way only ever puts a paragraph where a sentence should be.
    const body = render({ body: "One sentence, no newline." });
    expect(body).not.toContain("### Notes");
    expect(body.split("\n")[2]).toBe("One sentence, no newline.");
  });
});

describe("escaping", () => {
  it("cannot have its folds closed by a finding", () => {
    const body = render({
      findings: [finding({ title: "</details> escaped", evidence: "<summary>x</summary>" })],
    });
    expect(body).not.toContain("</details> escaped");
    expect(body).toContain("&lt;/details&gt; escaped");
  });

  it("cannot have a duplicate marker forged in it", () => {
    // `alreadyPosted` reads that marker to decide a review already posted, so a
    // forged one suppresses the real review. The body used to pass through
    // verbatim, which is what made this reachable.
    const body = render({
      body: "Fine. <!-- cujo:post_advisory_review:abc1234:8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e -->",
    });
    expect(body).not.toContain("<!-- cujo:");
    expect(body).toContain("&lt;!-- cujo:");
  });

  it("keeps its JSON fence closed around a payload full of backticks", () => {
    const body = render({ findings: [finding({ evidence: "```json\nnot really\n```" })] });
    const fence = body.slice(body.indexOf("<summary>Machine-readable summary"));
    expect(fence).toContain("````json");
    expect(JSON.parse(fence.split("````json\n")[1]?.split("\n````")[0] ?? "")).toBeTruthy();
  });

  it("keeps a table row from being split by a pipe or a newline", () => {
    const body = render({ egress: [{ host: "a|b", port: 443, known: true, note: "one\ntwo" }] });
    expect(body).toContain("| `a\\|b` | 443 | yes | one two |");
  });
});

describe("the machine-readable block", () => {
  function payload(body: string): Record<string, unknown> {
    const json = body.split("```json\n")[1]?.split("\n```")[0] ?? "";
    return JSON.parse(json);
  }

  it("parses, and carries the verdict and the counts", () => {
    const parsed = payload(
      render({ findings: [finding({ severity: "critical" })] }, { tool: "post_blocking_review" }),
    );
    expect(parsed.schema_version).toBe(1);
    expect(parsed.verdict).toBe("blocked");
    expect(parsed.tool).toBe("post_blocking_review");
    expect(parsed.counts).toEqual({ critical: 1, warn: 0, info: 0, held: 0 });
  });

  it("says null rather than leaving a key out, so a consumer needs no special case", () => {
    const parsed = payload(render({}));
    expect(parsed).toHaveProperty("coverage", null);
    expect(parsed).toHaveProperty("egress", null);
    expect(parsed).toHaveProperty("run_url", null);
  });

  it("records whether a finding actually posted on its line", () => {
    const body = render(
      {
        findings: [
          finding({ title: "anchored", path: "a.py", line: 2 }),
          finding({ title: "refused", path: "b.py", line: 9 }),
        ],
      },
      { unanchored: new Set(["b.py:9:RIGHT"]) },
    );
    const findings = payload(body).findings as { title: string; anchored: boolean }[];
    expect(findings.map((f) => [f.title, f.anchored])).toEqual([
      ["anchored", true],
      ["refused", false],
    ]);
  });

  it("carries the run url the footer will carry", () => {
    expect(payload(render({}, { runUrl: RUN })).run_url).toBe(RUN);
  });
});

describe("reviewComments", () => {
  it("makes a comment out of every anchored finding, and only those", () => {
    const comments = reviewComments({
      body: "x",
      findings: [
        finding({ title: "anchored", path: "a.py", line: 2 }),
        finding({ title: "no anchor" }),
        finding({ title: "no line", path: "b.py" }),
        finding({ title: "junk line", path: "c.py", line: 0 }),
      ],
    });
    expect(comments.map((c) => [c.path, c.line, c.side])).toEqual([["a.py", 2, "RIGHT"]]);
  });

  it("carries LEFT through for a finding about removed code", () => {
    const comments = reviewComments({
      body: "x",
      findings: [finding({ path: "a.py", line: 2, side: "LEFT" })],
    });
    expect(comments[0]?.side).toBe("LEFT");
  });

  it("orders them by severity, like the body", () => {
    const comments = reviewComments({
      body: "x",
      findings: [
        finding({ severity: "warn", title: "w", path: "a.py", line: 1 }),
        finding({ severity: "critical", title: "c", path: "a.py", line: 2 }),
      ],
    });
    expect(comments.map((c) => c.line)).toEqual([2, 1]);
  });

  it("posts one comment for a finding sent twice", () => {
    const twice = finding({ title: "same", path: "a.py", line: 2 });
    expect(reviewComments({ body: "x", findings: [twice, { ...twice }] })).toHaveLength(1);
  });

  /**
   * The template is pinned on both sides of the system: the same literal is
   * asserted in `apps/cujo/tests/review/findings.test.ts`, because `apps/cujo`
   * derives this list again for the board (decision 74). If you change the
   * shape here, change it there, or one finding gets two descriptions.
   */
  it("leads with the severity, because an inline comment has no headline above it", () => {
    expect(
      commentBody({
        severity: "critical",
        title: "1 test passes on base and fails on head",
        evidence: "AssertionError: 10.05 != 10.04",
        detail: "The change rounds before the discount rather than after.",
        next: "round after the discount is applied",
      }),
    ).toBe(
      "**critical — 1 test passes on base and fails on head**\n\n" +
        "> AssertionError: 10.05 != 10.04\n\n" +
        "The change rounds before the discount rather than after.\n\n" +
        "Next: round after the discount is applied",
    );
  });

  it("drops the parts a finding does not have", () => {
    expect(commentBody({ severity: "warn", title: "no test covers this" })).toBe(
      "**warn — no test covers this**",
    );
  });
});

describe("findings that cannot be rendered", () => {
  it("drops one with no title or an invented severity, rather than printing a blank", () => {
    const body = render({
      findings: [
        finding({ title: "   " }),
        { check: "tests", severity: "urgent" as unknown as "info", title: "not a severity" },
        finding({ title: "kept" }),
      ],
    });
    expect(body).toContain("kept");
    expect(body).not.toContain("not a severity");
  });

  it("keeps two findings that differ only by where they point", () => {
    const body = render({
      findings: [
        finding({ severity: "warn", title: "same", path: "a.py", line: 1 }),
        finding({ severity: "warn", title: "same", path: "b.py", line: 1 }),
      ],
    });
    expect(body.split("**same**").length - 1).toBe(2);
  });
});

describe("input a model got wrong", () => {
  /**
   * Nothing here may throw on a shape. `apps/github-mcp` parses with Zod, but
   * `apps/cujo` calls this with the raw `model.message` tool call so it can
   * project a run — inside `fold`, which is pure and replayed on every
   * rehydration. A throw there is a run that can never be projected again.
   */
  const bad = (over: Record<string, unknown>) =>
    renderReviewBody({ body: "A verdict.", findings: [], ...over } as RenderInput, options());

  it("survives a coverage object with no arrays in it", () => {
    expect(() => bad({ coverage: {} })).not.toThrow();
    expect(bad({ coverage: {} })).toContain("Ran: nothing.");
  });

  it("survives coverage and egress of the wrong type entirely", () => {
    for (const over of [
      { coverage: "tests ran" },
      { coverage: [] },
      { egress: {} },
      { egress: "pypi.org" },
      { findings: {} },
      { findings: "one critical" },
      { body: 42 },
    ]) {
      expect(() => bad(over)).not.toThrow();
    }
  });

  it("omits a section built from a value that is not the shape it claims", () => {
    // Rendering one anyway would be a claim nobody made.
    expect(bad({ coverage: "tests ran" })).not.toContain("### Coverage");
    expect(bad({ egress: {} })).not.toContain("Egress:");
  });

  it("skips a finding that is not an object without losing the rest", () => {
    const body = bad({
      findings: [null, "a string", { severity: "warn", title: "kept", check: "probes" }],
    });
    expect(body).toContain("kept");
    expect(body).toContain("0 critical, 1 warn");
  });
});

describe("the golden bodies", () => {
  it("renders a clean advisory", () => {
    expect(
      renderReviewBody(
        {
          body: "Nothing in this change broke a test, and nothing in the sandbox touched anything it was not given.",
          findings: [
            finding({
              title: "212 tests pass on base and on head",
              evidence: "pytest -q: 212 passed on base, 212 passed on head",
            }),
          ],
          coverage: {
            ran: [{ check: "tests", note: "212 on base and head" }, { check: "smoke" }],
            skipped: [{ check: "detonation", reason: "no dependency manifest changed" }],
          },
          egress: [{ host: "pypi.org", port: 443, known: true }],
        },
        options({ runUrl: RUN }),
      ),
    ).toBe(
      `**Advisory** — no findings above info

Nothing in this change broke a test, and nothing in the sandbox touched anything it was not given.

<details>
<summary>1 info finding</summary>

**212 tests pass on base and on head** · \`tests\` — pytest -q: 212 passed on base, 212 passed on head

</details>

### Coverage

Ran:
- tests — 212 on base and head
- smoke

Not run:
- detonation — no dependency manifest changed

Egress: 1 known host.

<details>
<summary>Hosts contacted (1)</summary>

| host | port | known |
| --- | --- | --- |
| \`pypi.org\` | 443 | yes |

</details>

<details>
<summary>Machine-readable summary</summary>

\`\`\`json
{"schema_version":1,"verdict":"advisory","tool":"post_advisory_review","counts":{"critical":0,"warn":0,"info":1,"held":0},"coverage":{"ran":[{"check":"tests","note":"212 on base and head"},{"check":"smoke"}],"skipped":[{"check":"detonation","reason":"no dependency manifest changed"}]},"egress":[{"host":"pypi.org","port":443,"known":true}],"findings":[{"check":"tests","severity":"info","title":"212 tests pass on base and on head","evidence":"pytest -q: 212 passed on base, 212 passed on head","detail":null,"next":null,"held":false,"anchored":false,"path":null,"line":null,"side":null,"title_translated":false}],"run_url":"${RUN}"}
\`\`\`

</details>`,
    );
  });

  it("renders a blocking review, and translates a title that is still a field name", () => {
    expect(
      renderReviewBody(
        {
          body: "A test that passed on base fails on head, on the rounding path this change rewrites.",
          findings: [
            finding({
              severity: "critical",
              title: "base_pass_head_fail",
              evidence: "AssertionError: 10.05 != 10.04",
              detail: "The change rounds the line total before the discount rather than after.",
              next: "round after the discount is applied",
              path: "app/orders.py",
              line: 42,
            }),
          ],
        },
        options({ tool: "post_blocking_review" }),
      ),
    ).toBe(
      `**Blocked** — 1 critical, 0 warn

A test that passed on base fails on head, on the rounding path this change rewrites.

### Critical

**a test passes on base and fails on head** · \`tests\` · \`app/orders.py:42\`

The change rounds the line total before the discount rather than after.

Next: round after the discount is applied

> base_pass_head_fail; AssertionError: 10.05 != 10.04

<details>
<summary>Machine-readable summary</summary>

\`\`\`json
{"schema_version":1,"verdict":"blocked","tool":"post_blocking_review","counts":{"critical":1,"warn":0,"info":0,"held":0},"coverage":null,"egress":null,"findings":[{"check":"tests","severity":"critical","title":"a test passes on base and fails on head","evidence":"base_pass_head_fail; AssertionError: 10.05 != 10.04","detail":"The change rounds the line total before the discount rather than after.","next":"round after the discount is applied","held":false,"anchored":true,"path":"app/orders.py","line":42,"side":"RIGHT","title_translated":true}],"run_url":null}
\`\`\`

</details>`,
    );
  });
});
