/**
 * github-mcp: the MCP server the agent calls to post a review as the Cujo
 * GitHub App (docs/spec.md Contract 4). It is the only service that holds the
 * App private key, and it is write-only: it posts reviews and reads nothing
 * but the PR's diff to validate anchors.
 */

import { createLogger, parseLevel } from "@cujo/log";
import { createGitHubClient } from "./github";
import { createApp } from "./server";

export { createApp } from "./server";

const PORT = Number(process.env.PORT ?? 8081);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const log = createLogger({
    service: "github-mcp",
    level: parseLevel(process.env.CUJO_LOG_LEVEL),
  });
  const github = createGitHubClient({
    appId: requireEnv("GITHUB_APP_ID"),
    privateKey: requireEnv("GITHUB_APP_PRIVATE_KEY"),
  });
  // Optional: with no board configured, no review carries an evidence footer.
  const publicBaseUrl = (process.env.CUJO_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  createApp({ github, publicBaseUrl, log }).listen(PORT, () => {
    log.info("service.started", { port: PORT });
  });
}
