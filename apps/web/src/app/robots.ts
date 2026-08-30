import type { MetadataRoute } from "next";

/**
 * The board is reachable by anyone with the link, and deliberately not by
 * anyone searching a repository's name.
 *
 * Cujo reviews public pull requests belonging to people who did not ask to be
 * indexed here, and a finding quotes their code and the sandbox's observations
 * of it. A link someone chooses to share is a different thing from a result
 * that surfaces beside the repository itself.
 *
 * `/docs` is the exception, and it is the exception because that argument does
 * not reach it: the manual is ours, it quotes nobody, and it names no
 * repository. It is also the one thing on this site that fails at its job if it
 * cannot be found — somebody deciding whether to point Cujo at their repository
 * is not holding a link to it yet. `Allow` is more specific than `Disallow`, so
 * a crawler that follows the standard takes the manual and leaves the runs; the
 * pages themselves restate the permission in their metadata, which is what a
 * crawler that ignores this file reads instead.
 *
 * There is one hostname since decision 57, so this needs no per-host branch.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/docs", disallow: "/" } };
}
