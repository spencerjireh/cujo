"use client";

import { ApiError } from "@/lib/api/client";
import { fetchMe } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

/**
 * Sign in, or who is signed in, on the footer's rule (decision 156).
 *
 * A client component that asks the owner plane on mount rather than a
 * server read in the layout, because a layout that reads the cookie is a
 * layout that renders every page per request, and the manual is meant to be
 * static and indexed. Signed out is the quiet default: one button, no
 * prompt. A 404 is an instance with no sign-in configured, and then nothing
 * is drawn at all.
 */
export function SessionButtons({ className }: { className: string }) {
  const me = useQuery({
    queryKey: ownerKeys.me(),
    queryFn: ({ signal }) => fetchMe(undefined, signal),
    retry: false,
    staleTime: 60_000,
  });
  if (me.isPending) return null;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 404) return null;
    return (
      <a href="/api/auth/login" className={className}>
        Sign in with GitHub
      </a>
    );
  }
  return (
    <>
      {me.data.is_owner ? (
        <Link href="/repos" className={className}>
          Repositories
        </Link>
      ) : null}
      <form action="/api/auth/logout" method="post" className="contents">
        <button type="submit" className={className} title={`Signed in as ${me.data.login}`}>
          Sign out
        </button>
      </form>
    </>
  );
}
