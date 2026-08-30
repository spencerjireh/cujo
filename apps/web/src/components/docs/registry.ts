import { Board } from "@/components/docs/pages/Board";
import { Checks } from "@/components/docs/pages/Checks";
import { Configure } from "@/components/docs/pages/Configure";
import { Conversation } from "@/components/docs/pages/Conversation";
import { Discord } from "@/components/docs/pages/Discord";
import { Findings } from "@/components/docs/pages/Findings";
import { HowItWorks } from "@/components/docs/pages/HowItWorks";
import { Install } from "@/components/docs/pages/Install";
import { Sandbox } from "@/components/docs/pages/Sandbox";
import { SelfHost } from "@/components/docs/pages/SelfHost";
import { TheGate } from "@/components/docs/pages/TheGate";
import type { ReactNode } from "react";

/**
 * Slug to component, statically.
 *
 * A `Record` and not a dynamic import: there are a dozen of these, they are
 * server components with no client cost, and a static map is the thing a test
 * can compare against `nav.ts` — which is the guard that a page listed in the
 * sidebar cannot 404.
 *
 * The overview is not here. It is served at `/docs` by that route's own page,
 * so a slug of `overview` is not a page at all.
 */
export const DOC_COMPONENTS: Record<string, () => ReactNode> = {
  install: Install,
  configure: Configure,
  "how-it-works": HowItWorks,
  checks: Checks,
  findings: Findings,
  "the-gate": TheGate,
  sandbox: Sandbox,
  discord: Discord,
  conversation: Conversation,
  board: Board,
  "self-host": SelfHost,
};
