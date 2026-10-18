"use client";

import { Mark } from "@/components/brand/Mark";
import { Chevron } from "@/components/icons/Chevron";
import { ApiError } from "@/lib/api/client";
import { type Me, fetchMe } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The site's one bar (decision 175, reversing the "no bar" of 80, 98 and 160).
 *
 * Who is reading decides the links, and it is asked in the browser rather
 * than in the layout: a layout that reads the cookie renders every page per
 * request, and the manual is meant to stay static (decision 156). Until the
 * answer arrives the bar draws the links everyone gets, so nothing moves for a
 * visitor and an owner's three links appear beside them.
 *
 * On `/galaxy` it floats over the chamber, transparent and in the chamber's
 * own tokens, so the instrument still takes the whole window.
 */

type Session =
  | { kind: "unknown" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; me: Me }
  /** No sign-in configured, or the plane did not answer: offer nothing. */
  | { kind: "none" };

function useSession(): Session {
  const me = useQuery({
    queryKey: ownerKeys.me(),
    queryFn: ({ signal }) => fetchMe(undefined, signal),
    retry: false,
    staleTime: 60_000,
  });
  if (me.isPending) return { kind: "unknown" };
  if (me.error) {
    // Only a 401 is "signed out". A sign-in link on a plane that cannot
    // answer would lead to an error page.
    return me.error instanceof ApiError && me.error.status === 401
      ? { kind: "signed-out" }
      : { kind: "none" };
  }
  return { kind: "signed-in", me: me.data };
}

type NavLink = { href: string; label: string };

const OWNER_LINKS: NavLink[] = [
  { href: "/activity", label: "Activity" },
  { href: "/repos", label: "Repositories" },
  { href: "/settings", label: "Settings" },
];

const PUBLIC_LINKS: NavLink[] = [
  { href: "/galaxy", label: "Board" },
  { href: "/docs", label: "Manual" },
];

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const session = useSession();
  const [open, setOpen] = useState(false);
  const overlay = pathname === "/galaxy";
  const owner = session.kind === "signed-in" && session.me.is_owner;

  // A followed link closes the phone menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on navigation only
  useEffect(() => setOpen(false), [pathname]);

  const links = owner ? [...OWNER_LINKS, ...PUBLIC_LINKS] : PUBLIC_LINKS;
  const tone = overlay
    ? {
        bar: "absolute inset-x-0 top-0 z-30",
        text: "text-[var(--chamber-fg)]",
        muted: "text-[var(--chamber-fg-muted)] hover:text-[var(--chamber-fg)]",
        current: "text-[var(--chamber-fg)]",
        panel: "border-[var(--chamber-line)] bg-[var(--chamber)]",
      }
    : {
        bar: "sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur",
        text: "text-fg",
        muted: "text-fg-muted hover:text-fg",
        current: "text-fg",
        panel: "border-line bg-bg",
      };

  const navItem = (link: NavLink, block = false) => {
    const current = isCurrent(pathname, link.href);
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={current ? "page" : undefined}
        className={`${block ? "block py-2" : "px-2.5 py-1.5"} rounded-md font-ui text-sm no-underline transition-colors ${
          current ? `${tone.current} font-medium` : tone.muted
        }`}
      >
        {link.label}
        {current && !block ? (
          <span aria-hidden="true" className="mt-0.5 block h-px bg-accent-fill" />
        ) : null}
      </Link>
    );
  };

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} asChild>
      <header className={tone.bar}>
        <div className="flex h-14 items-center gap-4 px-4 md:px-6">
          <Link
            href={owner ? "/activity" : "/"}
            aria-label="cujo, home"
            className={`-m-2 flex items-center gap-2 p-2 no-underline ${tone.text}`}
          >
            <Mark className="h-6 w-6" />
            <span className="font-display text-lg font-bold lowercase tracking-tight">cujo</span>
          </Link>

          <nav aria-label="Site" className="hidden flex-1 items-center gap-1 md:flex">
            {links.map((link) => navItem(link))}
          </nav>

          <div className="ml-auto hidden md:block">
            <Account session={session} tone={tone} />
          </div>

          <Collapsible.Trigger
            className={`ml-auto flex items-center gap-2 rounded-md px-2.5 py-1.5 font-ui text-sm md:hidden ${tone.muted}`}
          >
            Menu
            <Chevron open={open} />
          </Collapsible.Trigger>
        </div>

        <Collapsible.Content className={`border-t px-4 pb-4 md:hidden ${tone.panel}`}>
          <nav aria-label="Site" className="flex flex-col pt-2">
            {links.map((link) => navItem(link, true))}
          </nav>
          <div className={`mt-3 border-t pt-3 ${tone.panel}`}>
            <Account session={session} tone={tone} />
          </div>
        </Collapsible.Content>
      </header>
    </Collapsible.Root>
  );
}

function Account({
  session,
  tone,
}: {
  session: Session;
  tone: { text: string; muted: string };
}) {
  // A fixed minimum width while the session is unknown, so the links do not
  // shift when the answer arrives.
  if (session.kind === "unknown") return <div className="min-w-24" />;
  if (session.kind === "none") return null;
  if (session.kind === "signed-out") {
    return (
      <a
        href="/api/auth/login"
        className={`rounded-md border border-current/25 px-3 py-1.5 font-ui text-sm no-underline transition-colors ${tone.muted}`}
      >
        Sign in with GitHub
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className={`font-mono text-xs ${tone.text}`}>@{session.me.login}</span>
      <form action="/api/auth/logout" method="post" className="contents">
        <button
          type="submit"
          className={`rounded-md px-2 py-1.5 font-ui text-sm transition-colors ${tone.muted}`}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
