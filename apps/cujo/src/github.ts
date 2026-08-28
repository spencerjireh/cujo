import {
  getAppJwt,
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
/** Long enough to survive a burst of autocomplete, short enough to notice a new install. */
const REPO_CACHE_MS = 60_000;
/** The same bound the PR reads use: enough for any real account, and finite. */
const MAX_PAGES = 30;

/**
 * The read side of the GitHub App: PR metadata, changed files, and the
 * idempotency check on existing reviews. Posting stays in github-mcp.
 */
export class GitHubReader {
  private readonly privateKey: string;
  private repoCache: { repos: string[]; expiresAt: number } | null = null;
  private repoScan: Promise<string[]> | null = null;

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

  /** The App JWT's own reads, which belong to no single installation. */
  private async getAsApp<T>(path: string): Promise<T> {
    const jwt = await getAppJwt({ appId: this.appId, privateKey: this.privateKey });
    const res = await this.fetchImpl(`${API}${path}`, {
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "user-agent": "cujo",
      },
    });
    if (!res.ok) throw new Error(`GitHub ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * Every repo the Cujo App is installed on, as `owner/name`. This is the set
   * of repos Cujo can actually review, so it is what a Discord `repo:` box
   * offers (Contract 8) — a repo outside it could be bound but never notified.
   *
   * Cached, because Discord asks for autocomplete on every keystroke and gives
   * three seconds to answer; a stale entry costs at most one wrong suggestion,
   * which the bind still rejects.
   */
  async installedRepos(): Promise<string[]> {
    const cached = this.repoCache;
    if (cached && cached.expiresAt > Date.now()) return cached.repos;
    // Single flight. Autocomplete arrives in bursts, and without this a cold
    // cache would start one full scan per keystroke.
    if (!this.repoScan) {
      this.repoScan = this.scanInstalledRepos()
        .then((repos) => {
          this.repoCache = { repos, expiresAt: Date.now() + REPO_CACHE_MS };
          return repos;
        })
        .finally(() => {
          this.repoScan = null;
        });
    }
    return this.repoScan;
  }

  private async scanInstalledRepos(): Promise<string[]> {
    const names = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const installations = await this.getAsApp<{ id: number }[]>(
        `/app/installations?per_page=100&page=${page}`,
      );
      for (const installation of installations) await this.addRepos(installation.id, names);
      if (installations.length < 100) break;
      if (page === MAX_PAGES) console.warn("github: stopped listing installations at the page cap");
    }
    return [...names].sort();
  }

  private async addRepos(installationId: number, into: Set<string>): Promise<void> {
    const token = await getInstallationToken({
      appId: this.appId,
      privateKey: this.privateKey,
      installationId,
    });
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.fetchImpl(
        `${API}/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "user-agent": "cujo",
          },
        },
      );
      if (!res.ok) throw new Error(`GitHub /installation/repositories returned ${res.status}`);
      const body = (await res.json()) as { repositories: { full_name: string }[] };
      for (const repo of body.repositories) into.add(repo.full_name);
      if (body.repositories.length < 100) return;
      // A cap that stops silently reads as "that is all of them"; say so.
      if (page === MAX_PAGES) {
        console.warn(`github: stopped listing installation ${installationId} at the page cap`);
      }
    }
  }

  /** Contract 5: skip the turn when the bot already reviewed this head SHA. */
  async alreadyReviewed(repo: string, prNumber: number, headSha: string): Promise<boolean> {
    for (let page = 1; page <= 30; page++) {
      const reviews = await this.get<{ user: { login: string } | null; commit_id: string }[]>(
        repo,
        `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100&page=${page}`,
      );
      if (reviews.some((r) => r.user?.login === BOT_LOGIN && r.commit_id === headSha)) return true;
      if (reviews.length < 100) break;
    }
    return false;
  }
}
