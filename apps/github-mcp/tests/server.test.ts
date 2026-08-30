import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateReviewInput, GitHubClient } from "../src/github";
import { createApp } from "../src/server";

const PATCH = "@@ -1,2 +1,3 @@\n a\n+b\n c";

/** Records what would have been posted instead of calling GitHub. */
function fakeGitHub() {
  const posted: Array<{ repo: string; pr: number; input: CreateReviewInput }> = [];
  const client: GitHubClient = {
    async listReviews() {
      return [];
    },
    async listPullFiles() {
      return [{ filename: "app.py", patch: PATCH }];
    },
    async createReview(repo, pr, input) {
      posted.push({ repo, pr, input });
      return { id: 501, html_url: `https://github.com/${repo}/pull/${pr}#pullrequestreview-501` };
    },
  };
  return { client, posted };
}

const PUBLIC_BASE = "https://cujo.example.com";
const RUN_ID = "8f3a2c1e-4b2d-4f6a-9c3e-1d2b3a4c5d6e";

describe("github-mcp", () => {
  const github = fakeGitHub();
  const server = createApp({ github: github.client, publicBaseUrl: PUBLIC_BASE });
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("responds 200 ok on /healthz", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "github-mcp" });
  });

  it("lists the three review tools, with only the advisory one not destructive", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    await client.close();

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual([
      "post_advisory_review",
      "post_blocking_review",
      "post_gated_review",
    ]);
    expect(byName.get("post_advisory_review")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("post_blocking_review")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("post_gated_review")?.annotations?.destructiveHint).toBe(true);
    // The same required input on all three: which one is gated is a choice
    // `apps/cujo` makes about the name, not something the schema encodes.
    for (const name of byName.keys()) {
      expect(byName.get(name)?.inputSchema.required).toEqual(
        expect.arrayContaining(["repo", "pr_number", "head_sha", "body"]),
      );
      // Anchors ride on the findings now (decision 74). `comments` survives as
      // a deprecated field, because a session pinned to the old rubric goes on
      // sending one and dropping it from the schema would have Zod strip it —
      // posting whatever the findings anchored and losing the rest in silence.
      const properties = Object.keys((byName.get(name)?.inputSchema.properties ?? {}) as object);
      expect(properties).toEqual(
        expect.arrayContaining(["findings", "coverage", "egress", "comments"]),
      );
      expect(byName.get(name)?.inputSchema.required).not.toContain("comments");
    }
  });

  it("offers `accusation_follows` on the observation tools and not on the gated one", async () => {
    // The one asymmetry, and the whole guarantee behind it: the maintainer
    // prompt asks for an approval that `post_gated_review` already has by the
    // time it runs, so that tool has no way to ask for the sentence. Absence
    // of the parameter is what makes it unreachable — nothing checks for it.
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    await client.close();

    const props = (name: string) =>
      Object.keys((tools.find((t) => t.name === name)?.inputSchema.properties ?? {}) as object);
    expect(props("post_advisory_review")).toContain("accusation_follows");
    expect(props("post_blocking_review")).toContain("accusation_follows");
    expect(props("post_gated_review")).not.toContain("accusation_follows");
  });

  it("drops `accusation_follows` from a gated call that sends it anyway", async () => {
    // The end-to-end half of the guarantee. `postReview` honours the flag
    // whenever it is present and does not know which tool it is serving, so
    // what keeps the prompt off an accusation is that the gated tool's schema
    // has no such key and Zod strips what it does not declare.
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    await client.callTool({
      name: "post_gated_review",
      arguments: {
        repo: "spencerjireh/orders-api",
        pr_number: 7,
        head_sha: "abcdef1",
        body: "The dependency read the decoy at install time.",
        accusation_follows: true,
      },
    });
    await client.close();

    const last = github.posted.at(-1);
    expect(last?.input.body).toContain("read the decoy at install time");
    expect(last?.input.body).not.toContain("supply-chain pattern");
    expect(last?.input.body).not.toContain("/cujo confirm");
  });

  it("posts a blocking review, keeping valid anchors inline and moving the rest", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const result = await client.callTool({
      name: "post_blocking_review",
      arguments: {
        repo: "spencerjireh/orders-api",
        pr_number: 7,
        head_sha: "abcdef1",
        body: "Tests: 1 regression.",
        findings: [
          { check: "probes", severity: "critical", title: "added line", path: "app.py", line: 2 },
          {
            check: "probes",
            severity: "critical",
            title: "no such line",
            path: "app.py",
            line: 50,
          },
        ],
      },
    });
    await client.close();

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      review_id: 501,
      html_url: "https://github.com/spencerjireh/orders-api/pull/7#pullrequestreview-501",
      posted_inline: 1,
      moved_to_body: 1,
    });
    const last = github.posted.at(-1);
    expect(last?.input.event).toBe("REQUEST_CHANGES");
    expect(last?.input.commitId).toBe("abcdef1");
    // The comment is composed from the finding, severity first: an inline
    // comment arrives with no headline above it.
    expect(last?.input.comments).toEqual([
      { path: "app.py", line: 2, side: "RIGHT", body: "**critical \u2014 added line**" },
    ]);
    // The refused anchor is marked on the finding in place rather than exiled
    // to a section of its own, because the body already carries every finding.
    expect(last?.input.body).toContain("`app.py:50` (not in this diff)");
    expect(last?.input.body).not.toContain("Findings without a diff anchor");
  });

  it("appends the run footer below the composed body", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    await client.callTool({
      name: "post_advisory_review",
      arguments: {
        repo: "spencerjireh/orders-api",
        pr_number: 7,
        head_sha: "abcdef1",
        body: "Tests: 212 passed.",
        findings: [
          { check: "probes", severity: "warn", title: "no such line", path: "app.py", line: 50 },
        ],
        run_id: RUN_ID,
      },
    });
    await client.close();

    const body = github.posted.at(-1)?.input.body ?? "";
    expect(body).toContain(`**[View the full evidence →](${PUBLIC_BASE}/runs/${RUN_ID})**\n`);
    expect(body.indexOf("View the full evidence")).toBeGreaterThan(
      body.indexOf("Machine-readable summary"),
    );
    // The footer is the last thing a reader sees. The duplicate marker sits
    // below it and is an HTML comment, so it renders as nothing.
    expect(body.trimEnd().endsWith("-->")).toBe(true);
    expect(body.indexOf("<!-- cujo:")).toBeGreaterThan(body.indexOf("View the full evidence"));
  });

  it("posts no footer when the run has no public page", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    await client.callTool({
      name: "post_advisory_review",
      arguments: {
        repo: "spencerjireh/orders-api",
        pr_number: 7,
        head_sha: "abcdef1",
        body: "Tests: 212 passed.",
      },
    });
    await client.close();

    // The body is the server's now, so this is no longer a byte-identity
    // claim about the whole thing. What the private-repo guarantee still says
    // is that neither the footer nor the marker appears — both need a run id.
    const body = github.posted.at(-1)?.input.body ?? "";
    expect(
      body.startsWith("**Advisory** \u2014 no findings above info\n\nTests: 212 passed."),
    ).toBe(true);
    expect(body).not.toContain("View the full evidence");
    expect(body).not.toContain("<!-- cujo:");
  });

  it("rejects a run_id that is not a UUID, so no URL can be smuggled in", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    for (const bad of [
      "https://evil.example.com/runs/x",
      `${RUN_ID}\n\n## Merged and approved`,
      "../../evil",
    ]) {
      const result = await client.callTool({
        name: "post_blocking_review",
        arguments: {
          repo: "spencerjireh/orders-api",
          pr_number: 7,
          head_sha: "abcdef1",
          body: "x",
          run_id: bad,
        },
      });
      expect(result.isError).toBe(true);
    }
    await client.close();
  });

  it("rejects input that fails the schema", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const result = await client.callTool({
      name: "post_advisory_review",
      arguments: { repo: "not-a-repo", pr_number: 1, head_sha: "zzz", body: "x" },
    });
    await client.close();
    expect(result.isError).toBe(true);
  });
});
