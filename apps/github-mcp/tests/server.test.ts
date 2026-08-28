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

describe("github-mcp", () => {
  const github = fakeGitHub();
  const server = createApp({ github: github.client });
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

  it("lists both review tools with the blocking one marked destructive", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    await client.close();

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual(["post_advisory_review", "post_blocking_review"]);
    expect(byName.get("post_advisory_review")?.annotations?.destructiveHint).toBe(false);
    expect(byName.get("post_blocking_review")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("post_blocking_review")?.inputSchema.required).toEqual(
      expect.arrayContaining(["repo", "pr_number", "head_sha", "body"]),
    );
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
        comments: [
          { path: "app.py", line: 2, body: "added line" },
          { path: "app.py", line: 50, body: "no such line" },
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
    expect(last?.input.comments).toEqual([
      { path: "app.py", line: 2, side: "RIGHT", body: "added line" },
    ]);
    expect(last?.input.body).toContain("### Findings without a diff anchor");
    expect(last?.input.body).toContain("`app.py:50` (RIGHT): no such line");
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
