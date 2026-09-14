/**
 * What `apps/cujo` may ask this service to review, and the one check that is
 * not a shape: whether the clone URL names the repository the run is for.
 *
 * `checkCloneUrl` is a port of `check_clone_url` in
 * `sandbox/cujo_sniff/prepare.py`, and it holds the same line for the same
 * reason. This service is trusted — it holds a model key — and it clones
 * whatever it is told to. A URL carrying `user:token@`, a query, a fragment,
 * a scheme other than http(s), a host other than GitHub, or a path naming a
 * different repository is refused rather than inspected. A refusal never
 * echoes the URL: the thing being refused may be a credential.
 */

import { z } from "zod";

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const CLONE_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

/** Characters of title and body handed to `ocr --background`, together. */
export const BACKGROUND_CAP = 8_000;

export const ReviewRequest = z.object({
  repo: z.string().regex(REPO, "repo must be owner/name"),
  prNumber: z.number().int().positive(),
  cloneUrl: z.string().min(1).max(512),
  baseSha: z.string().regex(SHA, "baseSha must be a full lowercase sha"),
  headSha: z.string().regex(SHA, "headSha must be a full lowercase sha"),
  title: z.string().max(BACKGROUND_CAP).default(""),
  body: z
    .string()
    .max(64 * 1024)
    .default(""),
});

export type ReviewRequest = z.infer<typeof ReviewRequest>;

/** Why this URL may not be cloned, or null when it may. */
export function checkCloneUrl(url: string, repo: string): string | null {
  // WHATWG parsing, not a regex: the scp-like `git@host:path` has no scheme
  // and fails to parse, as does anything beginning with `-` that git could
  // read as an option. Both are refusals like every other branch here.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "clone url could not be parsed";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "clone url must be http or https";
  }
  if (parsed.username || parsed.password || url.includes("@")) {
    return "clone url carries credentials, which this service does not use";
  }
  if (parsed.search || parsed.hash || url.includes("?") || url.includes("#")) {
    return "clone url carries a query or fragment, which may hold a credential";
  }
  if (!parsed.hostname) return "clone url has no host";
  if (!CLONE_HOSTS.has(parsed.hostname.toLowerCase())) {
    return "clone url host is not one Cujo reviews";
  }
  // The host alone is not enough: every public repository shares it, so the
  // path has to name the repository the run is for. Case-insensitively, since
  // GitHub folds owners and names.
  const wanted = trimRepo(repo);
  const got = trimRepo(parsed.pathname);
  if (got !== wanted) return "clone url is not the repository under review";
  return null;
}

function trimRepo(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}
