import { Mark } from "@/components/brand/Mark";
import { LI, Lead, P, Section, UL } from "@/components/docs/Prose";
import { INSTALL_URL } from "@/lib/install-url";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The front door (decision 160): what Cujo is, and where to go.
 *
 * Written in the manual's register and set in its column, because the person
 * reading it is the person the manual is for — someone deciding whether to
 * point Cujo at a repository — and a front page that looked like a different
 * product from its own manual would be two things to learn. One bold element,
 * the name; everything under it is the manual's prose kit. Nothing here is
 * live: no run, no count, no poll. The board is one link away at `/galaxy`.
 *
 * The name is the page's own heading, with the mark beside it, and there is
 * no corner mark above: the one page where the name is already the first
 * thing would otherwise say it twice.
 *
 * Only a visitor reads it: an owner is sent to their activity (decision 175).
 */
export function Landing() {
  return (
    <article>
      <header className="mb-14">
        <h1 className="flex items-center gap-4 font-display text-[3.5rem] font-bold lowercase leading-none tracking-[-0.04em] sm:text-[5rem]">
          <Mark className="h-[0.8em] w-[0.8em]" />
          <span>cujo</span>
        </h1>
        <p className="mt-4 max-w-[24ch] font-display text-xl leading-snug tracking-[-0.02em] sm:text-2xl">
          A pull request reviewer that runs the code.
        </p>
        <div className="mt-6 max-w-[68ch]">
          <Lead>
            It runs your tests, tries the change, boots the app, and installs new dependencies in a
            sandbox. Then it posts what happened.
          </Lead>
        </div>
        <nav aria-label="Where to go" className="mt-8 flex flex-wrap items-center gap-3">
          <Primary href={INSTALL_URL} external>
            Install the App
          </Primary>
          <Secondary href="/docs">Read the manual</Secondary>
        </nav>
      </header>

      <Section id="on-your-pr" title="On your PR">
        <UL>
          <LI>
            One review from <span className="text-fg">cujo-guard[bot]</span>, with comments on the
            lines.
          </LI>
          <LI>A check that blocks the merge on a critical finding.</LI>
          <LI>No approvals and no style comments.</LI>
        </UL>
      </Section>

      <Section id="limits" title="Limits">
        <UL>
          <LI>The sandbox gets no tokens or keys.</LI>
          <LI>It records which hosts the code contacts, not what it sends.</LI>
          <LI>It can miss traffic that goes around its proxy.</LI>
        </UL>
      </Section>

      <Section id="evidence" title="Every run has a page">
        <P>
          Public runs are on{" "}
          <Link href="/galaxy" className="text-accent underline underline-offset-4">
            the board
          </Link>
          . Private runs are visible to the owner after sign-in.
        </P>
      </Section>
    </article>
  );
}

const PRIMARY =
  "rounded-md bg-accent-fill px-4 py-2 font-mono text-sm text-accent-fg no-underline transition-colors hover:bg-accent";
const SECONDARY =
  "rounded-md border border-line px-4 py-2 font-mono text-sm text-fg no-underline transition-colors hover:border-fg-muted";

function Primary({
  href,
  external = false,
  children,
}: {
  href: string;
  external?: boolean;
  children: ReactNode;
}) {
  // An external link stays a plain anchor: the App's page is GitHub's, and
  // there is nothing for the router to prefetch there.
  return external ? (
    <a href={href} className={PRIMARY}>
      {children}
    </a>
  ) : (
    <Link href={href} className={PRIMARY}>
      {children}
    </Link>
  );
}

function Secondary({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={SECONDARY}>
      {children}
    </Link>
  );
}
