import { describe, expect, it } from "vitest";
import {
  type DiscordMessagePayload,
  LIMITS,
  buildPing,
  buildRunCard,
  embedLength,
  escapeMarkdown,
  truncate,
} from "./discord-card";
import { emptyProjection } from "./folder";
import {
  CHECK_NAMES,
  type Finding,
  type Projection,
  type RunRecord,
  type RunStatus,
} from "./types";

const UI = "https://cujo.example.com";

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
      run: run({ status, approver: status === "denied" ? "op@example.com" : null }),
      projection: projection({
        status,
        error: "boom",
        summary: "all good",
        findings: [finding({ severity: "critical", path: "a.py", line: 3 })],
      }),
      prTitle: "Add a thing",
      uiBaseUrl: UI,
    });
    expectWithinDiscordLimits(payload);
    const embed = payload.embeds?.[0];
    expect(embed?.description).toBeTruthy();
    expect(embed?.url).toBe(`${UI}/runs/${run().id}`);
  });

  it("gives each status its own colour", () => {
    const colors = STATUSES.map(
      (status) =>
        buildRunCard({
          run: run({ status }),
          projection: projection({ status }),
          prTitle: null,
          uiBaseUrl: UI,
        }).embeds?.[0]?.color,
    );
    expect(new Set(colors).size).toBe(STATUSES.length);
  });

  it("suppresses every mention, so a PR titled @everyone pings nobody", () => {
    const payload = buildRunCard({
      run: run(),
      projection: projection(),
      prTitle: "@everyone @here <@&999>",
      uiBaseUrl: UI,
    });
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toBeUndefined();
  });

  it("never puts a derived string in a URL field, or leaves one clickable", () => {
    const payload = buildRunCard({
      run: run({ status: "error" }),
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
      prTitle: "http://evil.example",
      uiBaseUrl: UI,
    });
    const embed = payload.embeds?.[0];
    expect(embed?.url).toBe(`${UI}/runs/${run().id}`);
    expect(embed?.title).not.toContain("](");
    // Only the run's own link survives as a real address.
    const rendered = JSON.stringify({ ...embed, url: undefined });
    expect(rendered).not.toContain("http://evil");
    expect(rendered).not.toContain("https://evil");
    expect(rendered).not.toContain("www.evil");
  });

  it("escapes the summary and the error", () => {
    const payload = buildRunCard({
      run: run({ status: "clean" }),
      projection: projection({ status: "clean", summary: "**bold** [x](http://evil)" }),
      prTitle: null,
      uiBaseUrl: UI,
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
      run: run({ status: "blocked_pending" }),
      projection: projection({ status: "blocked_pending", findings, summary: "y".repeat(20_000) }),
      prTitle: "z".repeat(5_000),
      uiBaseUrl: UI,
    });
    expectWithinDiscordLimits(payload);
  });

  it("shows no findings for a superseded run", () => {
    const payload = buildRunCard({
      run: run({ status: "superseded" }),
      projection: projection({
        status: "superseded",
        findings: [finding({ severity: "critical", title: "stale" })],
      }),
      prTitle: null,
      uiBaseUrl: UI,
    });
    const names = payload.embeds?.[0]?.fields?.map((f) => f.name) ?? [];
    expect(names).toEqual(["Head"]);
  });

  it("renders only threads the folder matched to a check name", () => {
    const payload = buildRunCard({
      run: run({ status: "clean" }),
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
      prTitle: null,
      uiBaseUrl: UI,
    });
    const checks = payload.embeds?.[0]?.fields?.find((f) => f.name === "Checks");
    expect(checks?.value).toContain("tests");
    expect(checks?.value).not.toContain("pwned");
    for (const name of CHECK_NAMES) expect(checks?.value).toContain(name);
  });

  it("names the approver on a decided run", () => {
    const payload = buildRunCard({
      run: run({ status: "blocked_posted", approver: "op@example.com" }),
      projection: projection({ status: "blocked_posted" }),
      prTitle: null,
      uiBaseUrl: UI,
    });
    expect(payload.embeds?.[0]?.description).toContain("op@example.com");
  });
});

describe("buildPing", () => {
  it("mentions the configured role and nothing else", () => {
    const payload = buildPing({
      run: run({ status: "blocked_pending" }),
      uiBaseUrl: UI,
      roleId: "123456789012345678",
    });
    expect(payload.content).toContain("<@&123456789012345678>");
    expect(payload.content).toContain(`${UI}/runs/${run().id}`);
    expect(payload.allowed_mentions).toEqual({ parse: [], roles: ["123456789012345678"] });
    expectWithinDiscordLimits(payload);
  });

  it("still posts without a role, because an edit would notify nobody", () => {
    const payload = buildPing({
      run: run({ status: "blocked_pending" }),
      uiBaseUrl: UI,
      roleId: null,
    });
    expect(payload.content).not.toContain("<@&");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("reads as resolved once the run has left blocked_pending", () => {
    const payload = buildPing({
      run: run({ status: "blocked_posted" }),
      uiBaseUrl: UI,
      roleId: "123456789012345678",
    });
    expect(payload.content).toContain("Resolved");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });
});
