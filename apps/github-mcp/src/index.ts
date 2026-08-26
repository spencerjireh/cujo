import { createServer } from "node:http";
import { getInstallationToken } from "@cujo/gh-app-auth";

const PORT = Number(process.env.PORT ?? 8081);

/**
 * github-mcp skeleton: the MCP server the agent calls to post a review as the
 * Cujo GitHub App. For now it only answers health checks; the review-posting
 * tools and the App-authed token flow land in the next milestone (see
 * docs/spec.md Contract 4).
 */
export function createApp() {
  return createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "github-mcp" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
}

// Wired to the shared GitHub App auth contract (implementation pending).
export const authProvider = getInstallationToken;

if (import.meta.url === `file://${process.argv[1]}`) {
  createApp().listen(PORT, () => {
    console.log(`github-mcp listening on :${PORT}`);
  });
}
