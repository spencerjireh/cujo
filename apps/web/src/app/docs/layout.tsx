import { HomeMark } from "@/components/brand/HomeMark";
import { DocsNav } from "@/components/docs/DocsNav";
import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The manual's shell, and the one segment of this site that is indexable.
 *
 * The root layout declares `robots: { index: false }` for the whole board, and
 * that rule is about *runs*: Cujo reviews public pull requests belonging to
 * people who did not ask to be listed beside their own repository, and a
 * finding quotes their code. None of that argument reaches these pages. They
 * are ours, they quote nobody, and a manual nobody can find is a manual that
 * does not work — so this segment overrides the rule, and `robots.ts` allows
 * exactly this path.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    // The mark's positioned ancestor is the full-width box and not the column,
    // so it sits in the window's corner the way it does on every other page
    // (see the note in runs/[id]/page.tsx).
    <div className="relative">
      <HomeMark />
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <a
          href="#doc"
          className="sr-only focus:not-sr-only focus:mb-4 focus:inline-block focus:font-mono focus:text-accent focus:text-xs"
        >
          Skip to content
        </a>
        <div className="pt-10 lg:grid lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-12">
          {/* A disclosure below `lg` and a plain list above it. `<details>`
              rather than a toggle with state: the sidebar has to work with no
              JavaScript, and a summary element is the one control that does
              without any. Closed by default, because a topic page opening with
              a screenful of index above its own title is a page nobody reads;
              `.docs-sidebar` in globals.css forces it open from `lg`, where
              there is a column for it to stand in. */}
          <details className="docs-sidebar mb-10 border-line border-b pb-6 lg:mb-0 lg:border-0 lg:pb-0">
            <summary className="cursor-pointer list-none font-mono text-xs uppercase tracking-[0.18em] text-fg-muted marker:content-['']">
              Contents
            </summary>
            <div className="mt-5 lg:mt-0 lg:sticky lg:top-8">
              <DocsNav />
            </div>
          </details>
          <div id="doc" className="min-w-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
