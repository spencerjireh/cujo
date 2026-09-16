/**
 * The App this board runs, at its public page on GitHub.
 *
 * The public page rather than `/installations/new`: the page carries the
 * Install button and renders for a reader who is not signed in, while the
 * direct target bounces an anonymous reader through a login first, which is
 * the wrong first thing to show someone who has not decided yet. A
 * self-hoster makes their own App; see /docs/self-host.
 */
export const INSTALL_URL = "https://github.com/apps/cujo-guard";
