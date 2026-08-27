import {
  getInstallationIdForRepo,
  getInstallationToken,
  normalisePrivateKey,
} from "@cujo/gh-app-auth";

export interface PullRequestInfo {
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  baseSha: string;
  headSha: string;
  cloneUrl: string;
  changedFiles: string[];
}

const BOT_LOGIN = "cujo-guard[bot]";
const API = "https://api.github.com";

/**
 * The read side of the GitHub App: PR metadata, changed files, and the
 * idempotency check on existing reviews. Posting stays in github-mcp.
 */
export class GitHubReader {
  private readonly privateKey: string;

  constructor(
    private readonly appId: string,
    privateKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.privateKey = normalisePrivateKey(privateKey);
  }

  private async token(repo: string): Promise<string> {
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error(`bad repo name: ${repo}`);
    const installationId = await getInstallationIdForRepo({
      appId: this.appId,
      privateKey: this.privateKey,
      owner,
      repo: name,
    });
    return getInstallationToken({ appId: this.appId, privateKey: this.privateKey, installationId });
  }

  private async get<T>(repo: string, path: string): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      headers: {
        authorization: `Bearer ${await this.token(repo)}`,
        accept: "application/vnd.github+json",
        "user-agent": "cujo",
      },
    });
    if (!res.ok) throw new Error(`GitHub ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  async pullRequest(repo: string, prNumber: number): Promise<PullRequestInfo> {
    const pr = await this.get<{
      title: string;
      body: string | null;
      base: { sha: string; repo: { clone_url: string } };
      head: { sha: string };
    }>(repo, `/repos/${repo}/pulls/${prNumber}`);
    const changedFiles: string[] = [];
    for (let page = 1; page <= 30; page++) {
      const files = await this.get<{ filename: string }[]>(
        repo,
        `/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      );
      changedFiles.push(...files.map((f) => f.filename));
      if (files.length < 100) break;
    }
    return {
      repo,
      prNumber,
      title: pr.title,
      body: pr.body ?? "",
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      // The base repo's public clone URL; the sandbox gets no token.
      cloneUrl: pr.base.repo.clone_url,
      changedFiles,
    };
  }

  /** Contract 5: skip the turn when the bot already reviewed this head SHA. */
  async alreadyReviewed(repo: string, prNumber: number, headSha: string): Promise<boolean> {
    const reviews = await this.get<{ user: { login: string } | null; commit_id: string }[]>(
      repo,
      `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`,
    );
    return reviews.some((r) => r.user?.login === BOT_LOGIN && r.commit_id === headSha);
  }
}
