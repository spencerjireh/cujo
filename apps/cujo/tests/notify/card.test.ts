import { describe, expect, it } from "vitest";
import type { DiscordEmbedField, DiscordMessagePayload } from "../../src/clients/discord";
import {
  LIMITS,
  buildPing,
  buildRunCard,
  embedLength,
  escapeMarkdown,
  layoutSections,
  truncate,
} from "../../src/notify/card";
import { emptyProjection } from "../../src/review/fold";
import {
  CHECK_NAMES,
  type Finding,
  type Projection,
  type RunRecord,
  type RunStatus,
} from "../../src/review/types";

const PUBLIC_UI = "https://cujo.example.com";
const LINKS = { publicBaseUrl: PUBLIC_UI };

function run(patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "o/r",
    prNumber: 7,
    headSha: "abc1234def5678",
    sessionId: "s1",
    turnIds: ["t1"],
    status: "running",
    approver: null,
    decidedAt: null,
    isPublic: true,
    deliveryId: null,
    model: null,
    rubricSha256: null,
    prTitle: "a pull request",
    prAuthorLogin: "octocat",
    prAuthorId: 583231,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
    ...patch,
  };
}

function finding(patch: Partial<Finding> = {}): Finding {
  return {
    source: "agent",
    check: "tests",
    severity: "info",
    title: "a title",
    evidence: "some evidence",
    ...patch,
  };
}

function projection(patch: Partial<Projection> = {}): Projection {
  return { ...emptyProjection(), ...patch };
}

/** No unpaired surrogate: a naive slice through a 4-byte emoji leaves one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function expectWithinDiscordLimits(payload: DiscordMessagePayload): void {
  expect(payload.content?.length ?? 0).toBeLessThanOrEqual(LIMITS.content);
  for (const embed of payload.embeds ?? []) {
    expect(embed.author?.name.length ?? 0).toBeLessThanOrEqual(LIMITS.author);
    expect(embed.title?.length ?? 0).toBeLessThanOrEqual(LIMITS.title);
    expect(embed.description?.length ?? 0).toBeLessThanOrEqual(LIMITS.description);
    expect(embed.footer?.text.length ?? 0).toBeLessThanOrEqual(LIMITS.footer);
    expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(LIMITS.fields);
    for (const field of embed.fields ?? []) {
      expect(field.name.length).toBeLessThanOrEqual(LIMITS.fieldName);
      expect(field.value.length).toBeLessThanOrEqual(LIMITS.fieldValue);
    }
    expect(embedLength(embed)).toBeLessThanOrEqual(LIMITS.total);
  }
}

describe("escapeMarkdown", () => {
  it("escapes formatting and link syntax so nothing renders or links", () => {
    const out = escapeMarkdown("**bad** [x](http://evil) `y` _z_ ~w~ |s|");
    expect(out).toContain("\\*\\*bad\\*\\*");
    expect(out).toContain("\\[x\\]\\(http\\[:\\]//evil\\)");
    expect(out).toContain("\\`y\\`");
    expect(out).not.toContain("**bad**");
  });

  it("defangs a bare address, which Discord would otherwise linkify", () => {
    // Discord linkifies a bare web address and an <https://…> autolink, and a
    // backslash stops neither.
    const out = escapeMarkdown(
      "see http://evil.example/x and <https://evil.example> and www.evil.example",
    );
    expect(out).not.toContain("http://");
    expect(out).not.toContain("https://");
    expect(out).not.toContain("www.evil");
    expect(out).toContain("http\\[:\\]//evil.example/x");
    expect(out).toContain("www\\[.\\]evil.example");
  });

  it("strips bidi overrides and zero-width characters rather than escaping them", () => {
    const bidi = String.fromCharCode(0x202e);
    const zeroWidth = String.fromCharCode(0x200b);
    const out = escapeMarkdown(`not${bidi} crit${zeroWidth}ical`);
    expect(out).not.toContain(bidi);
    expect(out).not.toContain(zeroWidth);
    expect(out).toBe("not critical");
  });

  it("keeps tabs and newlines but collapses a wall of blank lines", () => {
    expect(escapeMarkdown("a\n\n\n\n\nb")).toBe("a\n\nb");
    expect(escapeMarkdown("a\tb")).toBe("a\tb");
  });
});

describe("truncate", () => {
  it("counts code points, not UTF-16 units", () => {
    const out = truncate("😀".repeat(2000), 100);
    expect([...out]).toHaveLength(100);
    expect(LONE_SURROGATE.test(out)).toBe(false);
  });

  it("leaves a short string alone", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });
});

const STATUSES: RunStatus[] = [
  "running",
  "clean",
  "blocked_pending",
  "blocked_posted",
  "denied",
  "error",
  "superseded",
];

describe("buildRunCard", () => {
  it.each(STATUSES)("renders %s within every Discord limit", (status) => {
    const payload = buildRunCard({
      run: run({
        status,
        approver: status === "denied" ? "op@example.com" : null,
        prTitle: "Add a thing",
      }),
      projection: projection({
        status,
        error: "boom",
        summary: "all good",
        findings: [finding({ severity: "critical", path: "a.py", line: 3 })],
      }),
      links: LINKS,
    });
    expectWithinDiscordLimits(payload);
    const embed = payload.embeds?.[0];
    expect(embed?.description).toBeTruthy();
    expect(embed?.url).toBe(`${PUBLIC_UI}/runs/${run().id}`);
  });

  it("gives each status its own colour", () => {
    const colors = STATUSES.map(
      (status) =>
        buildRunCard({
          run: run({ status, prTitle: null }),
          projection: projection({ status }),
          links: LINKS,
        }).embeds?.[0]?.color,
    );
    expect(new Set(colors).size).toBe(STATUSES.length);
  });

  it("spends brand amber on the one status that needs a human", () => {
    // brand.md: amber is the brand, and it marks the thing a person must act
    // on. If a second status takes it, the signal is gone (decision 36).
    const amber = STATUSES.filter(
      (status) =>
        buildRunCard({
          run: run({ status, prTitle: null }),
          projection: projection({ status }),
          links: LINKS,
        }).embeds?.[0]?.color === 0xf2a900,
    );
    expect(amber).toEqual(["blocked_pending"]);
  });

  it("colours an errored run blue, not red", () => {
    // Red means the pull request is dangerous. A run that errors is Cujo
    // falling over, which is a status and not a verdict on someone's code.
    const colorOf = (status: RunStatus) =>
      buildRunCard({
        run: run({ status, prTitle: null }),
        projection: projection({ status }),
        links: LINKS,
      }).embeds?.[0]?.color;
    expect(colorOf("error")).toBe(0x66b0f0);
    expect(colorOf("blocked_posted")).toBe(0xff5c45);
  });

  it("suppresses every mention, so a PR titled @everyone pings nobody", () => {
    const payload = buildRunCard({
      run: run({ prTitle: "@everyone @here <@&999>" }),
      projection: projection(),
      links: LINKS,
    });
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toBeUndefined();
  });

  it("never puts a derived string in a URL field, or leaves one clickable", () => {
    const payload = buildRunCard({
      run: run({ status: "error", prTitle: "http://evil.example" }),
      projection: projection({
        status: "error",
        error: "see <https://evil.example> and www.evil.example",
        findings: [
          finding({
            severity: "critical",
            title: "http://evil.example",
            evidence: "https://evil.example/steal",
          }),
        ],
      }),
      links: LINKS,
    });
    const embed = payload.embeds?.[0];
    expect(embed?.url).toBe(`${PUBLIC_UI}/runs/${run().id}`);
    expect(embed?.title).not.toContain("](");
    // Only the run's own link survives as a real address.
    const rendered = JSON.stringify({ ...embed, url: undefined });
    expect(rendered).not.toContain("http://evil");
    expect(rendered).not.toContain("https://evil");
    expect(rendered).not.toContain("www.evil");
  });

  it("escapes the summary and the error", () => {
    const payload = buildRunCard({
      run: run({ status: "clean", prTitle: null }),
      projection: projection({ status: "clean", summary: "**bold** [x](http://evil)" }),
      links: LINKS,
    });
    const summary = payload.embeds?.[0]?.fields?.find((f) => f.name === "Summary");
    expect(summary?.value).toContain("\\*\\*bold\\*\\*");
    expect(summary?.value).not.toContain("](http://evil)");
  });

  it("drops fields rather than overflow the 6000-character budget", () => {
    const findings = Array.from({ length: 200 }, (_, i) =>
      finding({ severity: "critical", title: `f${i} ${"x".repeat(1000)}` }),
    );
    const payload = buildRunCard({
      run: run({ status: "blocked_pending", prTitle: "z".repeat(5_000) }),
      projection: projection({ status: "blocked_pending", findings, summary: "y".repeat(20_000) }),
      links: LINKS,
    });
    expectWithinDiscordLimits(payload);
  });

  it("shows no findings for a superseded run", () => {
    const payload = buildRunCard({
      run: run({ status: "superseded", prTitle: null }),
      projection: projection({
        status: "superseded",
        findings: [finding({ severity: "critical", title: "stale" })],
      }),
      links: LINKS,
    });
    const names = payload.embeds?.[0]?.fields?.map((f) => f.name) ?? [];
    // The identity row survives: the pull request cannot go stale the way a
    // finding about a commit nobody is looking at can.
    expect(names).toEqual(["Head", "Pull request"]);
  });

  describe("who the card names, and where", () => {
    const embedOf = (patch: Partial<RunRecord> = {}) =>
      buildRunCard({ run: run(patch), projection: projection(), links: LINKS }).embeds?.[0];

    it.each(STATUSES)("names Cujo first, in the author line, on %s", (status) => {
      // Decision 88, reversing 86's allocation: the first line of every card
      // is the fixed party, the one a channel reads before anything else.
      const embed = embedOf({ status });
      expect(embed?.author?.name).toBe("Cujo");
      expect(embed?.author?.icon_url).toContain("avatar-64.png");
      // The title right beneath already points at the run; a second link to
      // the same place is noise.
      expect(embed?.author?.url).toBeUndefined();
    });

    it.each(STATUSES)("puts the opener bottom-left, in the footer, on %s", (status) => {
      const embed = embedOf({ status });
      // The footer renders its icon to the left of its text on the embed's
      // last line: avatar in front, name after, handles last. No link —
      // footer text renders no markdown, and `[@login](url)` would draw as
      // literal syntax rather than click.
      expect(embed?.footer?.icon_url).toBe("https://avatars.githubusercontent.com/u/583231?s=64");
      expect(embed?.footer?.text).toBe("@octocat · run 11111111 · abc1234");
      expect(embed?.footer?.text).not.toContain("](");
    });

    it("cleans the login with stripping alone, not escaping", () => {
      // A no-markdown slot draws a backslash rather than defusing one, so an
      // underscored login must keep its underscore; the invisible characters
      // still go.
      const embed = embedOf({ prAuthorLogin: "some_login" });
      expect(embed?.footer?.text).toContain("@some_login");
      expect(embed?.footer?.text).not.toContain("\\");
      const dirty = embedOf({
        prAuthorLogin: `octo${String.fromCharCode(0x200b)}cat`,
      });
      expect(dirty?.footer?.text).not.toContain(String.fromCharCode(0x200b));
    });

    it("sanitizes the handles, which are strings the store handed over", () => {
      const embed = embedOf({
        prAuthorLogin: null,
        prAuthorId: null,
        headSha: `a${String.fromCharCode(0x202e)}bc1234`,
      });
      // A bidi override reorders plain text as happily as markdown, so the
      // footer's handles pass the same strip as the name.
      expect(embed?.footer?.text).not.toContain(String.fromCharCode(0x202e));
      expect(embed?.footer?.text).toContain("run 11111111");
    });

    it("builds the avatar from the account id, never from the login", () => {
      const embed = embedOf({ prAuthorLogin: "../../evil", prAuthorId: 42 });
      expect(embed?.footer?.icon_url).toBe("https://avatars.githubusercontent.com/u/42?s=64");
      expect(embed?.footer?.text).toContain("@../../evil");
    });

    it("names a bot with its brackets drawn, and still with its avatar", () => {
      const embed = embedOf({ prAuthorLogin: "dependabot[bot]", prAuthorId: 49699333 });
      // No markdown in the footer, so nothing is escaped and nothing could
      // link even if it wanted to; only the avatar carries identity beyond
      // the name.
      expect(embed?.footer?.text).toContain("@dependabot[bot]");
      expect(embed?.footer?.text).not.toContain("\\");
      expect(embed?.footer?.icon_url).toContain("49699333");
    });

    it("carries no URL in the footer at all, whatever the login", () => {
      // The login-derived profile link retired with the footer placement
      // (decision 100): footer text renders no markdown, so the card's live
      // links stay the run's own and the pull request's.
      for (const login of ["octocat", "a b", "-lead", "x".repeat(40), "o/r", "https://evil"]) {
        const footer = embedOf({ prAuthorLogin: login })?.footer;
        expect(footer?.text, login).not.toContain("github.com");
        expect(footer?.text, login).not.toContain("](");
        expect(footer?.text, login).not.toContain("://");
      }
    });

    it("leaves only the handles when the author was never stored", () => {
      const embed = embedOf({ prAuthorLogin: null, prAuthorId: null });
      expect(embed?.author?.name).toBe("Cujo");
      expect(embed?.footer?.text).toBe("run 11111111 · abc1234");
      expect(embed?.footer?.icon_url).toBeUndefined();
    });

    it("counts the author line against the 6000 total", () => {
      // Discord counts it, so a clamp that did not would fit a payload the API
      // then rejects — and a 400 loses the card for the whole run.
      const embed = embedOf();
      const withoutAuthor = { ...embed, author: undefined };
      expect(embedLength(embed ?? {})).toBe(embedLength(withoutAuthor) + "Cujo".length);
    });
  });

  describe("the spacer rows", () => {
    const isSpacer = (field: { name: string } | undefined) => field?.name === "\u200b";

    it("separate every surviving section on a full card", () => {
      const payload = buildRunCard({
        run: run({ status: "clean", prTitle: null }),
        projection: projection({
          status: "clean",
          summary: "all good",
          checks: [
            {
              threadId: "t",
              title: "tests",
              isCheck: true,
              status: "done",
              report: {},
              error: null,
              startedAt: null,
              endedAt: null,
            },
          ],
          findings: [finding({ severity: "critical", path: "a.py", line: 3 })],
        }),
        links: LINKS,
      });
      const fields = payload.embeds?.[0]?.fields ?? [];
      // Identity row, Critical, Checks, Summary — three blank rows between
      // four groups, and none before the first or after the last.
      const names = fields.map((f) => (isSpacer(f) ? "<spacer>" : f.name));
      expect(names).toEqual([
        "Head",
        "Pull request",
        "Findings",
        "<spacer>",
        "Critical (1)",
        "<spacer>",
        "Checks",
        "<spacer>",
        "Summary",
      ]);
      expectWithinDiscordLimits(payload);
    });

    it("never dangle: a section the clamp drops takes its spacers with it", () => {
      const findings = Array.from({ length: 200 }, (_, i) =>
        finding({ severity: "critical", title: `f${i} ${"x".repeat(1000)}` }),
      );
      const payload = buildRunCard({
        run: run({ status: "blocked_pending", prTitle: "z".repeat(5_000) }),
        projection: projection({ status: "blocked_pending", findings }),
        links: LINKS,
      });
      const fields = payload.embeds?.[0]?.fields ?? [];
      expectWithinDiscordLimits(payload);
      // No trailing spacer, and never two beside each other: whatever the
      // clamp kept reads as sections, not as gaps where sections were.
      expect(isSpacer(fields[fields.length - 1])).toBe(false);
      for (let i = 1; i < fields.length; i += 1) {
        expect(isSpacer(fields[i - 1]) && isSpacer(fields[i])).toBe(false);
      }
    });

    it("are absent when there is nothing to separate", () => {
      const payload = buildRunCard({
        run: run({ status: "running", prTitle: null }),
        projection: projection({ status: "running" }),
        links: LINKS,
      });
      expect(payload.embeds?.[0]?.fields?.filter(isSpacer)).toHaveLength(0);
    });

    it("claim no budget a dropped section left unused", () => {
      // Pack synthetic groups to the exact character where a fixed reserve
      // and a corrected one differ. Three groups; the last group is a
      // 100-character field the clamp must drop, and what survives of the
      // second is a two-character field a fixed maximum reserve would have
      // popped with it — needlessly, because the layout that keeps it, its
      // one blank row included, still fits the total.
      const field = (name: string, size: number): DiscordEmbedField => ({
        name,
        value: "v".repeat(Math.max(0, size - name.length)),
      });
      const groups: DiscordEmbedField[][] = [
        [field("a1", 3000)],
        [field("b1", 2), field("b2", 2995)],
        [field("c1", 100)],
      ];
      // 3000 + 2 + 2995 + 100 = 6097, so the clamp must drop something.
      const laid = layoutSections({ fields: groups.flat() }, groups);
      const fields = laid.fields ?? [];
      const names = fields.map((f) => f.name);
      // The 100-character field is gone, the two-character one is not, and
      // one blank row separates the two groups that remain: 5997 + 2 = 5999.
      expect(names).toEqual(["a1", "\u200b", "b1", "b2"]);
      expect(embedLength(laid)).toBeLessThanOrEqual(LIMITS.total);
    });

    it("still drop whatever no reserve can save", () => {
      // Well past every reserve: the layout settles within the limit, with
      // no blank row after the last surviving field.
      const big = (name: string): DiscordEmbedField => ({
        name,
        value: "v".repeat(2000),
      });
      const groups: DiscordEmbedField[][] = [[big("a1"), big("a2")], [big("b1")], [big("c1")]];
      const laid = layoutSections({ fields: groups.flat() }, groups);
      expect(embedLength(laid)).toBeLessThanOrEqual(LIMITS.total);
      const fields = laid.fields ?? [];
      expect(fields[fields.length - 1]?.name).not.toBe("c1");
      expect(isSpacer(fields[fields.length - 1])).toBe(false);
    });
  });

  describe("the identity row", () => {
    it("links the pull request beside Head on every status, private included", () => {
      for (const isPublic of [true, false]) {
        const payload = buildRunCard({
          run: run({ status: "running", isPublic, prTitle: null }),
          projection: projection({ status: "running" }),
          links: LINKS,
        });
        const fields = payload.embeds?.[0]?.fields ?? [];
        expect(fields[0]?.name).toBe("Head");
        expect(fields[1]?.name).toBe("Pull request");
        // Structural, not derived (rule 8's argument): the repo was validated
        // when the channel was bound and the number is a number.
        expect(fields[1]?.value).toBe("https://github.com/o/r/pull/7");
        expect(fields[1]?.inline).toBe(true);
      }
    });

    it("omits the pull request field when the stored repo is not owner/name", () => {
      // A live link is the one place a hostile string chooses where a reader
      // goes, so the shape is enforced in code rather than assumed (rule 7's
      // philosophy, applied to the structural link).
      const payload = buildRunCard({
        run: run({ status: "running", repo: "not a repo", prTitle: null }),
        projection: projection({ status: "running" }),
        links: LINKS,
      });
      expect(payload.embeds?.[0]?.fields?.map((f) => f.name)).toEqual(["Head"]);
    });

    it("pairs Findings with the row rather than standing alone further down", () => {
      const payload = buildRunCard({
        run: run({ status: "clean", prTitle: null }),
        projection: projection({ status: "clean", findings: [finding({ severity: "warn" })] }),
        links: LINKS,
      });
      const fields = payload.embeds?.[0]?.fields ?? [];
      // Discord only shares a row between neighbouring inline fields, which is
      // why the counts moved up here when `Opened by` went (decision 86).
      expect(fields.slice(0, 3).map((f) => f.name)).toEqual(["Head", "Pull request", "Findings"]);
      expect(fields[2]?.inline).toBe(true);
    });
  });

  describe("what the Checks field says", () => {
    const START = Date.parse("2026-08-27T00:00:00.000Z");
    const stamped = (title: string, status: "running" | "done" | "error", ms: number | null) => ({
      threadId: title,
      title,
      isCheck: true,
      status,
      report: {},
      error: null,
      startedAt: ms === null ? null : new Date(START).toISOString(),
      endedAt: ms === null ? null : new Date(START + ms).toISOString(),
    });

    it("says what each check measured, never a pass glyph", () => {
      const payload = buildRunCard({
        run: run({ status: "blocked_posted", prTitle: null }),
        projection: projection({
          status: "blocked_posted",
          checks: [
            stamped("tests", "done", 41_000),
            stamped("probes", "done", 1_234),
            stamped("smoke", "error", 800),
          ],
          findings: [
            finding({ check: "tests", severity: "critical" }),
            finding({ check: "smoke", severity: "critical" }),
          ],
        }),
        links: LINKS,
      });
      const checks = payload.embeds?.[0]?.fields?.find((f) => f.name === "Checks");
      expect(checks?.value).toContain("tests done, 1 critical, 41s");
      expect(checks?.value).toContain("probes done, 0 critical, 1.2s");
      expect(checks?.value).toContain("smoke error, 1 critical, 800ms");
      // A check that never appeared is named as absent, which is a different
      // fact from one that failed.
      expect(checks?.value).toContain("detonation —");
      // The tick meant "the thread finished", and read as "passed" under a
      // `Critical (3)` heading. It is gone entirely (decision 86).
      expect(JSON.stringify(payload)).not.toMatch(/[✅❌⏳]/u);
    });

    it("rounds a duration as a whole before it splits minutes", () => {
      // 119.6s floored to minutes and rounded to seconds independently is
      // `1m60s`, which is not a duration anybody ran for.
      const payload = buildRunCard({
        run: run({ status: "blocked_posted", prTitle: null }),
        projection: projection({
          status: "blocked_posted",
          checks: [stamped("tests", "done", 119_600), stamped("probes", "done", 59_700)],
        }),
        links: LINKS,
      });
      const checks = payload.embeds?.[0]?.fields?.find((f) => f.name === "Checks");
      expect(checks?.value).toContain("tests done, 0 critical, 2m00s");
      expect(checks?.value).toContain("probes done, 0 critical, 1m00s");
    });
  });

  describe("duplicate criticals", () => {
    const decoy = (check: string) =>
      finding({
        check,
        severity: "critical",
        title: "read the decoy secret",
        evidence: "cat .decoy-secret",
        path: "a.py",
        line: 3,
      });

    it("cost one line, naming the checks that saw it", () => {
      const payload = buildRunCard({
        run: run({ status: "blocked_pending", prTitle: null }),
        projection: projection({
          status: "blocked_pending",
          findings: [decoy("tests"), decoy("smoke"), decoy("detonation")],
        }),
        links: LINKS,
      });
      const critical = payload.embeds?.[0]?.fields?.find((f) => f.name.startsWith("Critical"));
      // Three findings, one fact: the heading keeps the raw count and the
      // line names every check that reported it.
      expect(critical?.name).toBe("Critical (3)");
      expect(critical?.value).toContain("read the decoy secret");
      expect(critical?.value).toContain("`a.py:3` — tests, smoke, detonation");
      expect(critical?.value?.match(/read the decoy secret/g)).toHaveLength(1);
      expect(critical?.value).not.toContain("more in Cujo");
    });

    it("count findings, not groups, against the shown budget", () => {
      const findings = [decoy("tests"), decoy("smoke"), decoy("detonation")];
      for (let i = 0; i < 3; i += 1) {
        findings.push(finding({ check: "probes", severity: "critical", title: `distinct ${i}` }));
      }
      const payload = buildRunCard({
        run: run({ status: "blocked_pending", prTitle: null }),
        projection: projection({ status: "blocked_pending", findings }),
        links: LINKS,
      });
      const critical = payload.embeds?.[0]?.fields?.find((f) => f.name.startsWith("Critical"));
      expect(critical?.name).toBe("Critical (6)");
      // Three groups shown — the decoy (3 findings) and two distinct — so
      // five of six findings are on the card and one is behind the link.
      expect(critical?.value).toContain("+1 more in Cujo");
    });
  });

  it("renders only threads the folder matched to a check name", () => {
    const payload = buildRunCard({
      run: run({ status: "clean", prTitle: null }),
      projection: projection({
        status: "clean",
        checks: [
          {
            threadId: "a",
            title: "tests",
            isCheck: true,
            status: "done",
            report: {},
            error: null,
            startedAt: null,
            endedAt: null,
          },
          {
            threadId: "b",
            startedAt: null,
            endedAt: null,
            title: "**pwned**",
            isCheck: false,
            status: "done",
            report: {},
            error: null,
          },
        ],
      }),
      links: LINKS,
    });
    const checks = payload.embeds?.[0]?.fields?.find((f) => f.name === "Checks");
    expect(checks?.value).toContain("tests");
    expect(checks?.value).not.toContain("pwned");
    for (const name of CHECK_NAMES) expect(checks?.value).toContain(name);
  });

  it("names the approver on a decided run", () => {
    const payload = buildRunCard({
      run: run({ status: "blocked_posted", approver: "op@example.com", prTitle: null }),
      projection: projection({ status: "blocked_posted" }),
      links: LINKS,
    });
    expect(payload.embeds?.[0]?.description).toContain("op@example.com");
  });
});

describe("buildPing", () => {
  const pingOf = (patch: Partial<RunRecord> = {}, roleId: string | null = null) =>
    buildPing({
      run: run({ status: "blocked_pending", ...patch }),
      projection: projection({
        status: patch.status ?? "blocked_pending",
        findings: [finding({ severity: "critical" })],
      }),
      links: LINKS,
      roleId,
    });

  it("mentions the configured role and nothing else", () => {
    const payload = pingOf({ status: "blocked_pending" }, "123456789012345678");
    expect(payload.content).toContain("<@&123456789012345678>");
    expect(payload.allowed_mentions).toEqual({ parse: [], roles: ["123456789012345678"] });
    expectWithinDiscordLimits(payload);
  });

  it("wraps its own link so Discord unfurls nothing beside its embed", () => {
    const payload = pingOf();
    expect(payload.content).toContain(`<${PUBLIC_UI}/runs/${run().id}>`);
    // Not the bare form: that is the grey site-preview box this message
    // exists to replace (decision 86).
    expect(payload.content).not.toContain(` ${PUBLIC_UI}/runs/${run().id}`);
  });

  it("carries its own card, not a copy of the run card", () => {
    const payload = pingOf();
    const embed = payload.embeds?.[0];
    expect(embed?.color).toBe(0xf2a900);
    expect(embed?.title).toBe("o/r #7 — a pull request");
    expect(embed?.url).toBe(`${PUBLIC_UI}/runs/${run().id}`);
    expect(embed?.description).toContain("waiting for a human");
    expect(embed?.description).toContain("1 critical finding");
    // Slim: anything it repeated from the card above it would be noise.
    expect(embed?.fields).toBeUndefined();
    expectWithinDiscordLimits(payload);
  });

  it("escapes the pull request title it carries for the first time", () => {
    // Rule 8's amendment: the ping's embed is the first stranger-authored
    // text on a ping payload, so it goes through the card's own pipeline.
    const payload = pingOf({ prTitle: "**urgent** [x](http://evil.example)" });
    expect(payload.embeds?.[0]?.title).toContain("\\*\\*urgent\\*\\*");
    expect(payload.embeds?.[0]?.title).not.toContain("](http://evil");
  });

  it("clamps its embed like the card's, because a 400 would lose the alert", () => {
    const payload = buildPing({
      run: run({ status: "blocked_pending", prTitle: "t".repeat(5_000) }),
      projection: projection({
        status: "blocked_pending",
        findings: Array.from({ length: 50 }, () =>
          finding({ severity: "critical", title: "x".repeat(500) }),
        ),
      }),
      links: LINKS,
      roleId: null,
    });
    expectWithinDiscordLimits(payload);
  });

  it("still posts without a role, because an edit would notify nobody", () => {
    const payload = pingOf();
    expect(payload.content).not.toContain("<@&");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds).toHaveLength(1);
  });

  it("reads as resolved once the run has left blocked_pending", () => {
    const payload = pingOf({ status: "blocked_posted" }, "123456789012345678");
    expect(payload.content).toContain("Resolved (blocked_posted)");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    // The embed stays, recoloured to the outcome, so the message that raised
    // the channel's unread mark is the one that clears it.
    expect(payload.embeds?.[0]?.color).toBe(0xff5c45);
    expect(payload.embeds?.[0]?.description).toContain("Resolved — ");
  });
});

/**
 * A card for a public run points at the board anyone can open (decision 34). A
 * private run has no page at all since decision 57, so its card carries no
 * link — the key is absent rather than null, because Discord refuses a null
 * `url` and the title has to keep rendering either way.
 */
describe("where a card links", () => {
  it("sends a public run to the public board", () => {
    const payload = buildRunCard({
      run: run({ isPublic: true, prTitle: null }),
      projection: projection(),
      links: LINKS,
    });
    expect(payload.embeds?.[0]?.url).toBe(`${PUBLIC_UI}/runs/${run().id}`);
  });

  it("gives a private run no link, and still a title", () => {
    const payload = buildRunCard({
      run: run({ isPublic: false, prTitle: null }),
      projection: projection(),
      links: LINKS,
    });
    const [embed] = payload.embeds ?? [];
    expect(embed && "url" in embed).toBe(false);
    expect(embed?.title).toBeTruthy();
  });

  it("links nowhere at all when no board is configured", () => {
    const payload = buildRunCard({
      run: run({ isPublic: true, prTitle: null }),
      projection: projection(),
      links: { publicBaseUrl: "" },
    });
    expect(payload.embeds?.[0] && "url" in payload.embeds[0]).toBe(false);
  });

  it("applies the same rule to the ping, without a dangling space", () => {
    const blocked = { status: "blocked_pending" as const };
    expect(
      buildPing({
        run: run({ ...blocked, isPublic: true }),
        projection: projection({ status: "blocked_pending" }),
        links: LINKS,
        roleId: null,
      }).content,
    ).toContain(PUBLIC_UI);
    const private_ = buildPing({
      run: run({ ...blocked, isPublic: false }),
      projection: projection({ status: "blocked_pending" }),
      links: LINKS,
      roleId: null,
    });
    expect(private_.content).not.toContain("://");
    expect(private_.content).toBe(private_.content?.trimEnd());
    // The embed renders for a private run too; its title simply does not link.
    expect(private_.embeds?.[0] && "url" in private_.embeds[0]).toBe(false);
    expect(private_.embeds?.[0]?.title).toBeTruthy();
  });

  it("escapes a repo name Discord would read as emphasis", () => {
    // A repo name may hold `_`, and the ping is the one payload that was
    // interpolating it with only a length bound.
    const content = buildPing({
      run: run({ status: "blocked_pending", repo: "o/my_repo_name", isPublic: true }),
      projection: projection({ status: "blocked_pending" }),
      links: LINKS,
      roleId: null,
    }).content;
    expect(content).toContain("o/my\\_repo\\_name");
    // And the link is still a link: escapeMarkdown defangs URLs, so running it
    // over the finished string would have broken Cujo's own.
    expect(content).toContain(`${PUBLIC_UI}/runs/`);
  });

  it("names the pull request in a private run's resolved ping, and links nothing", () => {
    const resolved = buildPing({
      run: run({ status: "denied", isPublic: false }),
      projection: projection({ status: "denied" }),
      links: LINKS,
      roleId: null,
    });
    expect(resolved.content).toContain("o/r #7");
    expect(resolved.content).not.toContain("://");
    expect(resolved.content).toBe(resolved.content?.trimEnd());
    expect(resolved.embeds?.[0] && "url" in resolved.embeds[0]).toBe(false);
  });
});
