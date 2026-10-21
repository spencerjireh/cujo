import { Landing } from "@/components/landing/Landing";
import { whoIsReading } from "@/lib/api/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The front door (decision 160). Indexed, like the manual and unlike anything
 * else here: it quotes nobody's code, and it is the page somebody deciding
 * whether to install Cujo has to be able to find.
 */
export const metadata: Metadata = {
  title: "cujo",
  description: "A pull request reviewer that runs the code.",
  robots: { index: true, follow: true },
  openGraph: { title: "cujo", description: "A pull request reviewer that runs the code." },
};

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ signin?: string | string[] }>;
} = {}) {
  // An owner's home is their activity (decision 175, reversing 160's "not
  // straight to their pages"). Sign-in lands here, so this is also where an
  // owner arrives after signing in. A visitor, and a signed-in non-owner, get
  // the front door.
  const reader = await whoIsReading();
  if ("me" in reader && reader.me.is_owner) redirect("/activity");
  // A sign-in that did not finish comes back here with why (the callback).
  const { signin } = (await searchParams) ?? {};
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <div className="pt-6">
        <Landing signin={signin === "expired" || signin === "failed" ? signin : undefined} />
      </div>
    </div>
  );
}
