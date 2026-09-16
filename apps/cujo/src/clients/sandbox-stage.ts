/**
 * The staging door on `sandbox-mcp` (decision 158).
 *
 * A private repository's trees are fetched here, on the trusted side, and
 * handed to the sandbox service under a ticket; the agent's `sandbox_create`
 * with that ticket copies them into the box. This client is the only thing in
 * `apps/cujo` that talks to `sandbox-mcp` at all -- the review session reaches
 * it over MCP from the harness -- and it sends bytes, never a token or a URL.
 */

export type StageTree = "base" | "head";

export class StageError extends Error {
  constructor(
    readonly status: number,
    readonly tree: StageTree,
    detail: string,
  ) {
    super(`staging the ${tree} tree failed: ${detail}`);
    this.name = "StageError";
  }
}

export class SandboxStager {
  private readonly base: string;

  constructor(
    /** The MCP endpoint (`SANDBOX_MCP_URL`); the staging route is its sibling. */
    mcpUrl: string,
    /** Bound on one tree, connect to last byte accepted. */
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = new URL("/stage/", mcpUrl).toString();
  }

  /** Stream one tree's archive up. Resolves to the bytes the service kept. */
  async put(ticket: string, tree: StageTree, body: ReadableStream<Uint8Array>): Promise<number> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${ticket}/${tree}`, {
        method: "PUT",
        headers: { "content-type": "application/gzip" },
        body,
        // A streamed request body; Node's fetch requires saying so.
        duplex: "half",
        signal: AbortSignal.timeout(this.timeoutMs),
      } as RequestInit);
    } catch (error) {
      throw new StageError(0, tree, error instanceof Error ? error.message : String(error));
    }
    const answer = (await res.json().catch(() => ({}))) as { bytes?: unknown; error?: unknown };
    if (res.status !== 201) {
      const detail = typeof answer.error === "string" ? answer.error : `status ${res.status}`;
      throw new StageError(res.status, tree, detail);
    }
    return typeof answer.bytes === "number" ? answer.bytes : 0;
  }
}
