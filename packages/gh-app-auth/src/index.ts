/**
 * Shared GitHub App authentication for Cujo's services.
 *
 * Both `apps/cujo` (reads PR metadata, the changed-file list, and existing
 * reviews) and `github-mcp` (posts reviews) act as the Cujo GitHub App and
 * need a short-lived installation access token. The flow is: sign an App JWT
 * with the App private key, then exchange it for an installation token.
 * `@octokit/auth-app` does both; this module adds the repo-to-installation
 * lookup, PEM normalisation for keys that arrive through an environment
 * variable, and a small cache so the two services do not mint a token per call.
 */

import { createAppAuth } from "@octokit/auth-app";
import type { StrategyOptions } from "@octokit/auth-app";

/** Octokit's request function shape. Injectable so tests never touch the network. */
export type RequestFn = NonNullable<StrategyOptions["request"]>;

export interface AppCredentials {
  /** GitHub App ID. */
  appId: string;
  /** PEM-encoded App private key. Literal `\n` sequences are accepted. */
  privateKey: string;
  /** Optional request function; defaults to Octokit's. */
  request?: RequestFn;
}

export interface InstallationTokenOptions extends AppCredentials {
  /** Installation ID to mint a token for. */
  installationId: number;
}

export interface InstallationLookupOptions extends AppCredentials {
  owner: string;
  repo: string;
}

/**
 * Environment variables cannot hold real newlines in every deploy tool, so the
 * key often arrives with literal `\n`. Turn it back into a PEM block.
 */
export function normalisePrivateKey(pem: string): string {
  return pem.replace(/\\n/g, "\n").trim().concat("\n");
}

interface CachedToken {
  token: string;
  /** Epoch milliseconds after which the token is treated as expired. */
  expiresAt: number;
}

/** Refresh five minutes before GitHub's one-hour expiry so a token never dies mid-call. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const tokenCache = new Map<number, CachedToken>();

/** Test hook: forget every cached token. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

function appAuth(options: AppCredentials) {
  const strategy: StrategyOptions = {
    appId: options.appId,
    privateKey: normalisePrivateKey(options.privateKey),
  };
  if (options.request) strategy.request = options.request;
  return createAppAuth(strategy);
}

/**
 * Mint (or reuse) a short-lived installation access token for the Cujo GitHub
 * App.
 */
export async function getInstallationToken(options: InstallationTokenOptions): Promise<string> {
  const cached = tokenCache.get(options.installationId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const auth = appAuth(options);
  const result = await auth({ type: "installation", installationId: options.installationId });
  const expiresAt = Date.parse(result.expiresAt) - EXPIRY_MARGIN_MS;
  tokenCache.set(options.installationId, { token: result.token, expiresAt });
  return result.token;
}

/**
 * Find the installation of the App on a repository. Uses the App JWT, so it
 * works before any installation token exists.
 */
export async function getInstallationIdForRepo(
  options: InstallationLookupOptions,
): Promise<number> {
  const auth = appAuth(options);
  const { token: jwt } = await auth({ type: "app" });
  let data: unknown;
  if (options.request) {
    const response = await options.request("GET /repos/{owner}/{repo}/installation", {
      owner: options.owner,
      repo: options.repo,
      headers: { authorization: `bearer ${jwt}` },
    });
    data = response.data;
  } else {
    // Plain fetch keeps this package's dependency list to @octokit/auth-app alone.
    const url = `https://api.github.com/repos/${options.owner}/${options.repo}/installation`;
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `bearer ${jwt}`,
        "user-agent": "cujo-gh-app-auth",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Installation lookup for ${options.owner}/${options.repo} failed: ${response.status}`,
      );
    }
    data = await response.json();
  }
  const id = (data as { id?: unknown }).id;
  if (typeof id !== "number") {
    throw new Error(`No installation id in response for ${options.owner}/${options.repo}`);
  }
  return id;
}
