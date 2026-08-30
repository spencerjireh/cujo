"use client";

import { DOC_GROUPS } from "@/lib/docs/nav";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The manual's own navigation, and the only chrome on this site.
 *
 * The board deliberately has no header bar — one was removed because it cost
 * the chamber the top of the window — and nothing here reintroduces it. This
 * list belongs to `/docs` alone, sits in the page's own column rather than over
 * it, and is the reason a reader can tell where in the manual they are.
 *
 * A client component for one reason: the current route decides which link is
 * lit, and `usePathname` is the only thing here that needs the browser. The
 * layout around it stays a server component.
 */
export function DocsNav({ id }: { id?: string }) {
  const pathname = usePathname();
  return (
    <nav id={id} aria-label="Documentation">
      <ul className="flex flex-col gap-7">
        {DOC_GROUPS.map((group) => (
          <li key={group.label}>
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-muted">
              {group.label}
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {group.pages.map((page) => {
                const active = pathname === page.href;
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      // `page` and not `true`: this is the current document,
                      // not the current step of something.
                      aria-current={active ? "page" : undefined}
                      className={`block font-mono text-xs leading-relaxed no-underline transition-colors ${
                        active ? "text-accent" : "text-fg-muted hover:text-fg"
                      }`}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
