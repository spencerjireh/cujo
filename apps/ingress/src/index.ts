import { createServer } from "node:http";
import { getInstallationToken } from "@cujo/gh-app-auth";

const PORT = Number(process.env.PORT ?? 8080);

/**
 * Ingress skeleton: turns a GitHub pull-request webhook into a TrueForge agent
 * session. For now it only answers health checks; webhook verification and the
 * diff-to-session logic land in the next milestone (see docs/spec.md Contract 1).
 */
export function createApp() {
  return createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "ingress" }));
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
    console.log(`ingress listening on :${PORT}`);
  });
}
