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

/**
 * An existing review on the pull request, as much of it as the duplicate check
 * needs. `user` is nullable because GitHub returns null for a deleted account.
 */
export interface ExistingReview {
  id: number;
  html_url: string;
  body: string | null;
  user: { login: string; type?: string } | null;
}

/**
 * A GitHub call that did not return 2xx.
 *
 * Status and path are fields, not text inside the message, so `errorFields`
 * can classify the failure and a caller can tell an expected 404 from a real
 * outage without a regular expression.
 *
 * The raw response body is deliberately **not** interpolated. It used to be,
 * and that is how an upstream body — which can echo a header or a token back —
 * reached a log line. GitHub's own `message` field is extracted instead: a
 * known short string rather than whatever the server chose to send, and capped
 * on top of that (decision 37).
 */
export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly method: string,
    detail: string,
  ) {
    super(`GitHub ${method} ${path} returned ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "GitHubError";
  }
}

/** GitHub's documented error envelope, and nothing else from the body. */
function detailFrom(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const message =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "message") : null;
    return typeof message === "string" ? message.slice(0, 200) : "";
  } catch {
    // Not JSON, so nothing here is a field this code recognises. Saying
    // nothing beats forwarding an unknown payload into the log.
    return "";
  }
}

export interface GitHubClient {
  listPullFiles(repo: string, prNumber: number): Promise<PullFile[]>;
  /** Every review already on the pull request, for the duplicate check. */
  listReviews(repo: string, prNumber: number): Promise<ExistingReview[]>;
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
      throw new GitHubError(response.status, path, init.method ?? "GET", detailFrom(text));
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

    async listReviews(repo, prNumber) {
      const reviews: ExistingReview[] = [];
      // Paginated exactly like `listPullFiles`: 100 is the API maximum, and a
      // pull request with more than 3000 reviews is not one this server's
      // duplicate check is the problem on.
      for (let page = 1; page <= 30; page += 1) {
        const batch = await call<ExistingReview[]>(
          repo,
          `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100&page=${page}`,
        );
        reviews.push(...batch);
        if (batch.length < 100) break;
      }
      return reviews;
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
