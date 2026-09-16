import { Landing } from "@/components/landing/Landing";
import { whoIsReading } from "@/lib/api/session";
import type { Metadata } from "next";

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

export default async function Page() {
  // Who is reading decides the first two links and nothing else. The session
  // is not seeded into the query cache (see /repos for why).
  const reader = await whoIsReading();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <div className="pt-10">
        <Landing reader={"me" in reader ? "owner" : "visitor"} />
      </div>
    </div>
  );
}
