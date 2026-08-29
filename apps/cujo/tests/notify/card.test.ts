import { describe, expect, it } from "vitest";
import type { DiscordMessagePayload } from "../../src/clients/discord";
import {
  LIMITS,
  buildPing,
  buildRunCard,
  embedLength,
  escapeMarkdown,
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
          run: run({ status }),
          projection: projection({ status }),
          prTitle: null,
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
          run: run({ status }),
          projection: projection({ status }),
          prTitle: null,
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
        run: run({ status }),
        projection: projection({ status }),
        prTitle: null,
        links: LINKS,
      }).embeds?.[0]?.color;
    expect(colorOf("error")).toBe(0x66b0f0);
    expect(colorOf("blocked_posted")).toBe(0xff5c45);
  });

  it("suppresses every mention, so a PR titled @everyone pings nobody", () => {
    const payload = buildRunCard({
      run: run(),
      projection: projection(),
      prTitle: "@everyone @here <@&999>",
      links: LINKS,
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
      run: run({ status: "clean" }),
      projection: projection({ status: "clean", summary: "**bold** [x](http://evil)" }),
      prTitle: null,
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
      run: run({ status: "blocked_pending" }),
      projection: projection({ status: "blocked_pending", findings, summary: "y".repeat(20_000) }),
      prTitle: "z".repeat(5_000),
      links: LINKS,
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
      links: LINKS,
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
      links: LINKS,
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
      links: LINKS,
    });
    expect(payload.embeds?.[0]?.description).toContain("op@example.com");
  });
});

describe("buildPing", () => {
  it("mentions the configured role and nothing else", () => {
    const payload = buildPing({
      run: run({ status: "blocked_pending" }),
      links: LINKS,
      roleId: "123456789012345678",
    });
    expect(payload.content).toContain("<@&123456789012345678>");
    expect(payload.content).toContain(`${PUBLIC_UI}/runs/${run().id}`);
    expect(payload.allowed_mentions).toEqual({ parse: [], roles: ["123456789012345678"] });
    expectWithinDiscordLimits(payload);
  });

  it("still posts without a role, because an edit would notify nobody", () => {
    const payload = buildPing({
      run: run({ status: "blocked_pending" }),
      links: LINKS,
      roleId: null,
    });
    expect(payload.content).not.toContain("<@&");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("reads as resolved once the run has left blocked_pending", () => {
    const payload = buildPing({
      run: run({ status: "blocked_posted" }),
      links: LINKS,
      roleId: "123456789012345678",
    });
    expect(payload.content).toContain("Resolved");
    expect(payload.allowed_mentions).toEqual({ parse: [] });
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
      run: run({ isPublic: true }),
      projection: projection(),
      prTitle: null,
      links: LINKS,
    });
    expect(payload.embeds?.[0]?.url).toBe(`${PUBLIC_UI}/runs/${run().id}`);
  });

  it("gives a private run no link, and still a title", () => {
    const payload = buildRunCard({
      run: run({ isPublic: false }),
      projection: projection(),
      prTitle: null,
      links: LINKS,
    });
    const [embed] = payload.embeds ?? [];
    expect(embed && "url" in embed).toBe(false);
    expect(embed?.title).toBeTruthy();
  });

  it("links nowhere at all when no board is configured", () => {
    const payload = buildRunCard({
      run: run({ isPublic: true }),
      projection: projection(),
      prTitle: null,
      links: { publicBaseUrl: "" },
    });
    expect(payload.embeds?.[0] && "url" in payload.embeds[0]).toBe(false);
  });

  it("applies the same rule to the ping, without a dangling space", () => {
    const blocked = { status: "blocked_pending" as const };
    expect(
      buildPing({ run: run({ ...blocked, isPublic: true }), links: LINKS, roleId: null }).content,
    ).toContain(PUBLIC_UI);
    const private_ = buildPing({
      run: run({ ...blocked, isPublic: false }),
      links: LINKS,
      roleId: null,
    }).content;
    expect(private_).not.toContain("://");
    expect(private_).toBe(private_?.trimEnd());
  });

  it("escapes a repo name Discord would read as emphasis", () => {
    // A repo name may hold `_`, and the ping is the one payload that was
    // interpolating it with only a length bound.
    const content = buildPing({
      run: run({ status: "blocked_pending", repo: "o/my_repo_name", isPublic: true }),
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
      links: LINKS,
      roleId: null,
    }).content;
    expect(resolved).toContain("o/r #7");
    expect(resolved).not.toContain("://");
    expect(resolved).toBe(resolved?.trimEnd());
  });
});
