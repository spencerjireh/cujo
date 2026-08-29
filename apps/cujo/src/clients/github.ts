import {
  getAppJwt,
  getInstallationIdForRepo,
  getInstallationToken,
  normalisePrivateKey,
} from "@cujo/gh-app-auth";
import { type Logger, createLogger } from "@cujo/log";

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

/** The bot the App posts as. Shared with `github-reactions.ts`, so "ours" means one thing. */
export const BOT_LOGIN = "cujo-guard[bot]";

/**
 * How much of a reply reaches the pull request. GitHub accepts 65536, so this
 * is not the API's limit but Cujo's: a comment long enough to bury the thread
 * is a worse answer than a short one plus a link, and the text can come from a
 * model.
 */
export const COMMENT_BODY_CAP = 8000;

const TRUNCATION_NOTE = "\n\n_(truncated)_";

function capComment(body: string): string {
  if (body.length <= COMMENT_BODY_CAP) return body;
  return body.slice(0, COMMENT_BODY_CAP - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}
const API = "https://api.github.com";
/** Long enough to survive a burst of autocomplete, short enough to notice a new install. */
const REPO_CACHE_MS = 60_000;
/** The same bound the PR reads use: enough for any real account, and finite. */
const MAX_PAGES = 30;
/** Short: a repo that just declared a server should not wait to be believed. */
const GUILD_CACHE_MS = 30_000;

/**
 * Pull `discord_guild` out of a `.cujo.yml` without parsing YAML. One key, one
 * shape — a Discord snowflake at the top level — so a strict line match reads
 * it and anything else simply does not match, which is the "ignored, and said
 * so in `/cujo status`" behaviour Contract 8 asks for. A YAML dependency for
 * one scalar is not worth the bundle or the parser's own surface.
 */
export function parseDeclaredGuild(yaml: string): string | null {
  // A file written on Windows ends its lines with CRLF, and `\r` is not
  // whitespace to this pattern; without normalising, such a repo would be
  // silently undeclared forever.
  const match = /^discord_guild:[ \t]*["']?(\d{17,20})["']?[ \t]*(?:#.*)?$/m.exec(
    yaml.replace(/\r\n?/g, "\n"),
  );
  return match?.[1] ?? null;
}

/**
 * The read side of the GitHub App: PR metadata, changed files, and the
 * idempotency check on existing reviews. Posting a review stays in github-mcp;
 * the one write `apps/cujo` makes is the reaction in `github-reactions.ts`,
 * which carries no content (decision 38).
 */
/**
 * A GitHub call that did not return 2xx.
 *
 * The status is a field, not text inside the message. It used to be
 * interpolated — `GitHub ${path} returned ${status}` — which left every caller
 * regexing English to find out whether a failure was an expected 404 or a real
 * outage, and left `errorFields` unable to classify it at all. Modelled on
 * `DiscordError`, which already carried its status this way.
 */
export class GitHubError extends Error {
  constructor(
    readonly status: number,
    /** The API path, without the token or any query the caller added. */
    readonly path: string,
  ) {
    super(`GitHub ${path} returned ${status}`);
    this.name = "GitHubError";
  }
}

export class GitHubReader {
  private readonly privateKey: string;
  private repoCache: { repos: string[]; expiresAt: number } | null = null;
  private repoScan: Promise<string[]> | null = null;
  private readonly guildCache = new Map<string, { guildId: string | null; expiresAt: number }>();

  constructor(
    private readonly appId: string,
    privateKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: Logger = createLogger({ service: "cujo" }),
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
    if (!res.ok) throw new GitHubError(res.status, path);
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
    if (!res.ok) throw new GitHubError(res.status, path);
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
      if (page === MAX_PAGES) this.log.warn("github.page_cap", { path: "/app/installations" });
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
      if (!res.ok) throw new GitHubError(res.status, "/installation/repositories");
      const body = (await res.json()) as { repositories: { full_name: string }[] };
      for (const repo of body.repositories) into.add(repo.full_name);
      if (body.repositories.length < 100) return;
      // A cap that stops silently reads as "that is all of them"; say so.
      if (page === MAX_PAGES) {
        this.log.warn("github.page_cap", { path: "/installation/repositories" });
      }
    }
  }

  /**
   * The Discord server a repo declares in `.cujo.yml` on its default branch
   * (Contract 8). Null means the repo genuinely declares none — no file, or no
   * usable key. A read that could not be made **throws**, because "the repo
   * says no server" and "GitHub did not answer" are different facts and a
   * caller deciding whether to keep notifying has to tell them apart.
   *
   * Read here, through the App, and never from the sandbox's copy: the sandbox
   * holds the pull request's code, and code that declares its own authorization
   * is not an authorization at all.
   *
   * The default branch, not the pull request's: declaring a server is an act
   * that has to be merged, which is exactly what makes it proof of control.
   *
   * `fresh` skips the cache. The last check before a binding is written uses
   * it, since a cached answer from before the command started would let a
   * declaration revoked mid-command still be honoured.
   */
  async declaredGuild(repo: string, options: { fresh?: boolean } = {}): Promise<string | null> {
    const cached = this.guildCache.get(repo);
    if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.guildId;
    const { default_branch } = await this.get<{ default_branch: string }>(repo, `/repos/${repo}`);
    const yaml = await this.rawFile(repo, ".cujo.yml", default_branch);
    const guildId = yaml === null ? null : parseDeclaredGuild(yaml);
    this.guildCache.set(repo, { guildId, expiresAt: Date.now() + GUILD_CACHE_MS });
    return guildId;
  }

  /**
   * Is the repo public right now (decision 34)?
   *
   * Deliberately uncached, unlike its neighbours: `guildCache` exists because
   * Discord asks on every keystroke, while this has one caller on a timer and
   * freshness is the entire job. A cache here would only add a staleness window
   * to the read whose whole purpose is not being stale.
   *
   * Three answers, not two. `unknown` is what a network blip or a 5xx gets, and
   * the caller leaves the stamp alone: taking the board dark because GitHub was
   * briefly unreachable protects nothing, since the repo did not become
   * private. A 404 or 410 does mean private — a repo Cujo can no longer read is
   * one it cannot vouch for.
   */
  async repoIsPublic(repo: string): Promise<"public" | "private" | "unknown"> {
    try {
      const res = await this.fetchImpl(`${API}/repos/${repo}`, {
        headers: {
          authorization: `Bearer ${await this.token(repo)}`,
          accept: "application/vnd.github+json",
          "user-agent": "cujo",
        },
      });
      if (res.status === 404 || res.status === 410) return "private";
      if (!res.ok) return "unknown";
      const body = (await res.json()) as { private?: boolean };
      // The same explicit comparison the webhook makes: a response without the
      // field is not evidence of being public.
      return body.private === false ? "public" : "private";
    } catch {
      return "unknown";
    }
  }

  /** A file's bytes at a ref, or null when it is not there. */
  private async rawFile(repo: string, path: string, ref: string): Promise<string | null> {
    // A branch name may hold `/`, `#` or `&`. Unencoded, `#` truncates the ref
    // to a URL fragment and the repo reads as undeclared.
    const url = `${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const res = await this.fetchImpl(url, {
      headers: {
        authorization: `Bearer ${await this.token(repo)}`,
        accept: "application/vnd.github.raw",
        "user-agent": "cujo",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, `/repos/${repo}/contents/${path}`);
    return res.text();
  }

  /**
   * Reply on the pull request, as a plain issue comment (decision 43).
   *
   * The only text `apps/cujo` writes to GitHub, and it is written from the
   * trusted plane rather than through `github-mcp` on purpose: every caller is
   * answering a person who addressed Cujo directly, so the reply is
   * human-initiated by construction. It states no finding nobody asked for,
   * which is the property decision 38 protects.
   *
   * `body` is capped rather than trusted. GitHub's own limit is far higher, and
   * a reply that reaches this method may quote a model's prose, so a bound here
   * is cheaper than discovering the limit through a 422 on the one call that
   * was supposed to explain a refusal.
   */
  async createComment(repo: string, prNumber: number, body: string): Promise<number> {
    const path = `/repos/${repo}/issues/${prNumber}/comments`;
    const res = await this.fetchImpl(`${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.token(repo)}`,
        accept: "application/vnd.github+json",
        "user-agent": "cujo",
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: capComment(body) }),
    });
    if (!res.ok) throw new GitHubError(res.status, path);
    const created = (await res.json()) as { id: number };
    return created.id;
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
