import { Blocking } from "@/components/docs/pages/Blocking";
import { Configure } from "@/components/docs/pages/Configure";
import { Install } from "@/components/docs/pages/Install";
import { Reviews } from "@/components/docs/pages/Reviews";
import { SelfHost } from "@/components/docs/pages/SelfHost";
import type { ReactNode } from "react";

/**
 * Slug to component, statically.
 *
 * A `Record` and not a dynamic import: these are server components with no
 * client cost, and a static map is the thing a test can compare against
 * `nav.ts` — which is the guard that a page listed in the sidebar cannot 404.
 *
 * The overview is not here. It is served at `/docs` by that route's own page,
 * so a slug of `overview` is not a page at all.
 */
export const DOC_COMPONENTS: Record<string, () => ReactNode> = {
  install: Install,
  configure: Configure,
  reviews: Reviews,
  blocking: Blocking,
  "self-host": SelfHost,
};
