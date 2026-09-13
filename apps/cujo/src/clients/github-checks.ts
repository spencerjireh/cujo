/**
 * The `cujo/guard` check run on the pull request's head commit (decision 138).
 *
 * This is the merge lock. A REQUEST_CHANGES review can be dismissed by anyone
 * with write access, a coding agent with write access included; a check run
 * cannot be dismissed at all, only re-run or completed by the App that owns
 * it. Branch protection that requires `cujo/guard` therefore holds the merge
 * until this App says otherwise, and this App says otherwise only through
 * `/cujo dismiss` from a person.
 *
 * Needs `checks: write`, the one App permission this feature added, which
 * every installation had to re-approve. Until it has, every write here fails
 * with 403 and the reaction and the review are unaffected.
 *
 * Idempotent by lookup rather than by memory: a check run has an id GitHub
 * assigns, so the write reads the head's check runs for the App's own name
 * first and PATCHes the one it finds, or POSTs when there is none. The caller
 * caches the id so a run's several transitions read once.
 */

import {
  getInstallationIdForRepo,
  getInstallationToken,
  normalisePrivateKey,
} from "@cujo/gh-app-auth";

/** The check's name, as branch protection will list it. */
export const CHECK_NAME = "cujo/guard";

const API = "https://api.github.com";

type CheckConclusion = "success" | "failure" | "neutral" | "skipped";

export interface CheckPayload {
  /** The run this check speaks for; GitHub stores it as `external_id`. */
  runId: string;
  status: "in_progress" | "completed";
  /** Required by GitHub when `status` is `completed`, refused otherwise. */
  conclusion?: CheckConclusion;
  /** The run page, for the "Details" link on the pull request's checks tab. */
  detailsUrl: string | null;
  output: { title: string; summary: string };
}

/** The write side of the App for check runs only. Posting reviews stays in `github-mcp`. */
export class GitHubChecks {
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

  private headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "cujo",
    };
  }

  /** The id of this App's `cujo/guard` check on the commit, or null when it has none. */
  async find(repo: string, sha: string): Promise<number | null> {
    const token = await this.token(repo);
    const path = `/repos/${repo}/commits/${sha}/check-runs`;
    const query = `check_name=${encodeURIComponent(CHECK_NAME)}&app_id=${this.appId}&per_page=100`;
    const res = await this.fetchImpl(`${API}${path}?${query}`, { headers: this.headers(token) });
    if (!res.ok) throw new Error(`GitHub GET ${path} returned ${res.status}`);
    const body = (await res.json()) as { check_runs?: { id: number }[] };
    return body.check_runs?.[0]?.id ?? null;
  }

  /**
   * Write the check on the commit: PATCH the existing one when its id is
   * known or found, POST otherwise. Returns the id, so the caller can skip the
   * lookup next time.
   */
  async write(
    repo: string,
    sha: string,
    payload: CheckPayload,
    knownId: number | null = null,
  ): Promise<number> {
    const id = knownId ?? (await this.find(repo, sha));
    const token = await this.token(repo);
    const body = {
      name: CHECK_NAME,
      head_sha: sha,
      external_id: payload.runId,
      status: payload.status,
      ...(payload.conclusion ? { conclusion: payload.conclusion } : {}),
      ...(payload.detailsUrl ? { details_url: payload.detailsUrl } : {}),
      output: payload.output,
    };
    const path = id === null ? `/repos/${repo}/check-runs` : `/repos/${repo}/check-runs/${id}`;
    const res = await this.fetchImpl(`${API}${path}`, {
      method: id === null ? "POST" : "PATCH",
      headers: { ...this.headers(token), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${id === null ? "POST" : "PATCH"} ${path} returned ${res.status}`);
    }
    const created = (await res.json()) as { id: number };
    return created.id;
  }
}
