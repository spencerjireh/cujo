/**
 * The two GitHub REST calls this server makes, as the Cujo GitHub App. The
 * fetch function is injected so tests run without the network and without a
 * private key.
 */

import { getInstallationIdForRepo, getInstallationToken } from "@cujo/gh-app-auth";
import type { AnchoredComment, PullFile } from "./diff";

export type FetchFn = typeof fetch;

export interface GitHubClientOptions {
  appId: string;
  privateKey: string;
  fetch?: FetchFn;
  apiBase?: string;
}

export interface CreateReviewInput {
  commitId: string;
  event: "COMMENT" | "REQUEST_CHANGES";
  body: string;
  comments: AnchoredComment[];
}

export interface CreatedReview {
  id: number;
  html_url: string;
}

export interface GitHubClient {
  listPullFiles(repo: string, prNumber: number): Promise<PullFile[]>;
  createReview(repo: string, prNumber: number, input: CreateReviewInput): Promise<CreatedReview>;
}

/** Per-repo installation ids do not change, so one lookup per process is enough. */
const installationIds = new Map<string, Promise<number>>();

export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`repo must be "owner/name", got "${repo}"`);
  }
  return { owner, name };
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const doFetch = options.fetch ?? fetch;
  const apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/$/, "");

  async function tokenFor(repo: string): Promise<string> {
    const { owner, name } = splitRepo(repo);
    let idPromise = installationIds.get(repo);
    if (!idPromise) {
      idPromise = getInstallationIdForRepo({
        appId: options.appId,
        privateKey: options.privateKey,
        owner,
        repo: name,
      });
      installationIds.set(repo, idPromise);
      // A failed lookup must not poison later calls.
      idPromise.catch(() => installationIds.delete(repo));
    }
    const installationId = await idPromise;
    return getInstallationToken({
      appId: options.appId,
      privateKey: options.privateKey,
      installationId,
    });
  }

  async function call<T>(repo: string, path: string, init: RequestInit = {}): Promise<T> {
    const token = await tokenFor(repo);
    const response = await doFetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "cujo-github-mcp",
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
    }
    return (await response.json()) as T;
  }

  return {
    async listPullFiles(repo, prNumber) {
      const files: PullFile[] = [];
      // 100 per page is the API maximum; a PR rarely needs more than a few pages.
      for (let page = 1; page <= 30; page += 1) {
        const batch = await call<PullFile[]>(
          repo,
          `/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
        );
        files.push(...batch);
        if (batch.length < 100) break;
      }
      return files;
    },

    async createReview(repo, prNumber, input) {
      return call<CreatedReview>(repo, `/repos/${repo}/pulls/${prNumber}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          commit_id: input.commitId,
          event: input.event,
          body: input.body,
          comments: input.comments.map((c) => ({
            path: c.path,
            line: c.line,
            side: c.side,
            body: c.body,
          })),
        }),
      });
    },
  };
}
