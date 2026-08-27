/**
 * Shared GitHub App authentication for Cujo's services.
 *
 * Both `ingress` (reads the PR metadata and changed-file list) and
 * `github-mcp` (posts reviews) act as the Cujo GitHub App and need a
 * short-lived installation access token. The real flow — sign an App JWT and
 * exchange it for an installation token via @octokit/auth-app — lands in the
 * next milestone. This is a typed placeholder so both services depend on one
 * contract.
 */

export interface InstallationTokenOptions {
  /** GitHub App ID. */
  appId: string;
  /** PEM-encoded App private key. */
  privateKey: string;
  /** Installation ID to mint a token for. */
  installationId: number;
}

/**
 * Mint a short-lived installation access token for the Cujo GitHub App.
 *
 * @throws Error until the real @octokit/auth-app flow is implemented.
 */
export async function getInstallationToken(_options: InstallationTokenOptions): Promise<string> {
  throw new Error("getInstallationToken: not implemented");
}
