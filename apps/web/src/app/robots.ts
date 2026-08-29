import type { MetadataRoute } from "next";

/**
 * The public board is reachable by anyone with the link, and deliberately not
 * by anyone searching a repository's name.
 *
 * Cujo reviews public pull requests belonging to people who did not ask to be
 * indexed here, and a finding quotes their code and the sandbox's observations
 * of it. A link someone chooses to share is a different thing from a result
 * that surfaces beside the repository itself.
 *
 * There is one hostname since decision 57, so this needs no per-host branch.
 * One line to reverse if the board should ever be indexed.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
