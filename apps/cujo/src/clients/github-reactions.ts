/**
 * Reactions: on the pull request `apps/cujo` is reviewing (decision 38), and on
 * a comment that addressed Cujo directly (decision 43).
 *
 * A reaction carries no content, names no finding, and approves nothing, so it
 * is outside what the `@destructive` approval selector guards — reviews still
 * go through `github-mcp` and nothing else does. What this buys is a signal on
 * the pull request itself: an eye within a second of the webhook landing says
 * the ingress, the signature, the session and the claim all worked, before the
 * agent has done anything at all.
 *
 * Three facts about the GitHub API shape everything here, and all three were
 * checked against the live App rather than read off the docs:
 *
 * - `pull_requests: write` is enough. The endpoint lives under `/issues/`, and
 *   the docs name `issues: write`, but a pull request target is accepted with
 *   the permission Cujo already holds. No installation has to re-approve.
 * - The POST is idempotent: the same content twice answers 200 instead of 201
 *   and leaves one reaction. So "set" needs no read first and no stored id,
 *   which is why this feature adds no table and no migration.
 * - Ours are identifiable from the list alone, by `user.login`, so nothing has
 *   to be remembered across a restart either.
 */

import {
  getInstallationIdForRepo,
  getInstallationToken,
  normalisePrivateKey,
} from "@cujo/gh-app-auth";
import { type Logger, createLogger } from "@cujo/log";
import { BOT_LOGIN as DEFAULT_BOT_LOGIN } from "./github";

/**
 * GitHub's reaction set, which is closed: these eight and nothing else. There
 * is no check mark and no cross, which is why the mapping in
 * `notify/reactions.service.ts` reads the way it does.
 */
export type Reaction = "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";

const API = "https://api.github.com";
/** The same bound the PR reads use: enough for any real pull request, and finite. */
const MAX_PAGES = 30;

interface ReactionRow {
  id: number;
  content: string;
  user: { login: string } | null;
}

/** The write side of the App for reactions only. Posting reviews stays in `github-mcp`. */
export class GitHubReactions {
  private readonly privateKey: string;

  constructor(
    private readonly appId: string,
    privateKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: Logger = createLogger({ service: "cujo" }),
    private readonly botLogin: string = DEFAULT_BOT_LOGIN,
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
    // `@cujo/gh-app-auth` caches the token itself, five minutes clear of the
    // expiry, so a run's several transitions do not mint several tokens.
    return getInstallationToken({ appId: this.appId, privateKey: this.privateKey, installationId });
  }

  private headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "cujo",
    };
  }

  /**
   * After this resolves, the bot's reactions on the pull request are exactly
   * `wanted`. Anyone else's are left alone.
   *
   * The order is deliberate: every wanted reaction is posted **before** the
   * stale ones are cleared. A failure half way then leaves the pull request
   * showing too much rather than nothing, and the next status change fixes it;
   * the reverse order would blank the pull request and leave it blank.
   */
  async set(repo: string, prNumber: number, wanted: readonly Reaction[]): Promise<void> {
    const token = await this.token(repo);
    const path = `/repos/${repo}/issues/${prNumber}/reactions`;
    for (const content of wanted) {
      const res = await this.fetchImpl(`${API}${path}`, {
        method: "POST",
        headers: { ...this.headers(token), "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      // 201 created, 200 the same reaction already stood. Both are the goal.
      if (!res.ok) throw new Error(`GitHub POST ${path} (${content}) returned ${res.status}`);
    }
    const keep = new Set<string>(wanted);
    for (const row of await this.mine(repo, prNumber, token)) {
      if (keep.has(row.content)) continue;
      const res = await this.fetchImpl(`${API}${path}/${row.id}`, {
        method: "DELETE",
        headers: this.headers(token),
      });
      // Already gone is the state this asked for, not a failure.
      if (!res.ok && res.status !== 404) {
        throw new Error(`GitHub DELETE ${path}/${row.id} returned ${res.status}`);
      }
    }
  }

  /**
   * Acknowledge one comment. Add-only, and a separate method rather than a
   * parameter on `set`, for two reasons that are easy to miss:
   *
   * - `set` clears every bot reaction on its target that it did not want.
   *   Pointing it at a comment would be harmless; pointing the comment path at
   *   the pull request, or sharing one method that could be handed either id,
   *   would clear the run's status reaction — and `PrReactor` caches by run id,
   *   so it would never be put back.
   * - There is nothing to clear here anyway. A reaction on a command comment
   *   says "seen", once, about a comment that never changes state.
   */
  async addToComment(repo: string, commentId: number, content: Reaction): Promise<void> {
    const token = await this.token(repo);
    const path = `/repos/${repo}/issues/comments/${commentId}/reactions`;
    const res = await this.fetchImpl(`${API}${path}`, {
      method: "POST",
      headers: { ...this.headers(token), "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    // 201 created, 200 it already stood. Both are the goal.
    if (!res.ok) throw new Error(`GitHub POST ${path} (${content}) returned ${res.status}`);
  }

  /** Every reaction on the pull request posted by the bot, across pages. */
  private async mine(repo: string, prNumber: number, token: string): Promise<ReactionRow[]> {
    const path = `/repos/${repo}/issues/${prNumber}/reactions`;
    const rows: ReactionRow[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.fetchImpl(`${API}${path}?per_page=100&page=${page}`, {
        headers: this.headers(token),
      });
      if (!res.ok) throw new Error(`GitHub GET ${path} returned ${res.status}`);
      const body = (await res.json()) as ReactionRow[];
      // The identity `alreadyReviewed` already trusts, so "ours" means the
      // same thing on both sides of the client.
      for (const row of body) if (row.user?.login === this.botLogin) rows.push(row);
      if (body.length < 100) break;
      if (page === MAX_PAGES) this.log.warn("github.page_cap", { path });
    }
    return rows;
  }
}
