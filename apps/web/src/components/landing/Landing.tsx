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
 * `reader` is decided by the page from the request's session. An owner's
 * first two links are their own pages; a visitor's are the App and the
 * manual. The manual stays on both, because it answers the question either
 * of them has next.
 */
export function Landing({ reader }: { reader: "visitor" | "owner" }) {
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
            It clones the head into a disposable sandbox, runs the tests on base and on head, writes
            its own probes against the change, boots the app and hits it, and reads what a new
            dependency does when installed. The review it posts cites what happened.
          </Lead>
        </div>
        <nav aria-label="Where to go" className="mt-8 flex flex-wrap items-center gap-3">
          {reader === "owner" ? (
            <>
              <Primary href="/repos">Your repositories</Primary>
              <Secondary href="/instance">Instance</Secondary>
              <Link
                href="/docs"
                className="px-2 font-mono text-xs text-fg-muted underline decoration-line underline-offset-4 hover:text-accent"
              >
                Read the manual
              </Link>
            </>
          ) : (
            <>
              <Primary href={INSTALL_URL} external>
                Install the App
              </Primary>
              <Secondary href="/docs">Read the manual</Secondary>
            </>
          )}
        </nav>
      </header>

      <Section id="what-lands" title="What lands on a pull request">
        <UL>
          <LI>
            One review from <span className="text-fg">cujo-guard[bot]</span>: what ran, what it
            found, and inline comments on the lines they are about.
          </LI>
          <LI>
            A check run that holds the merge while a critical finding stands, until a person lifts
            it with one comment.
          </LI>
          <LI>
            Nothing else. It never posts APPROVE, and it never comments on style, architecture or
            preference; every finding follows from something a sensor observed.
          </LI>
        </UL>
      </Section>

      <Section id="limits" title="What it will not do">
        <UL>
          <LI>
            Hold a credential where the code runs. The sandbox gets a tree and no token; a private
            repository&rsquo;s trees are fetched outside it and copied in.
          </LI>
          <LI>
            Read what the code sends. Egress is recorded as a host, a port and a byte count, never
            intercepted.
          </LI>
          <LI>
            Pretend to have seen everything. A process that opens a socket past the proxy is a gap,
            and the report says which sensors were watching so the gap is legible.
          </LI>
        </UL>
      </Section>

      <Section id="evidence" title="Where the evidence is">
        <P>
          Every run has a page: the commands, the reports, the findings and the review as posted. A
          public repository&rsquo;s newest runs are on{" "}
          <Link href="/galaxy" className="text-accent underline underline-offset-4">
            the board
          </Link>
          , drawn as a galaxy where each star is one run. A private repository&rsquo;s runs are its
          owner&rsquo;s, signed in.
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
