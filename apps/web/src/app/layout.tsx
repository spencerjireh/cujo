import { ThemeToggle } from "@/components/ThemeToggle";
import { Mark } from "@/components/brand/Mark";
import { adminBaseUrl, serverMode } from "@/lib/api/mode";
import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

// Published as --font-*-src, not --font-display: next/font emits its variables
// on a class whose specificity ties with :root in brand/tokens.css, so a direct
// name collision would resolve by stylesheet order. globals.css maps these.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-display-src",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: "cujo",
  description: "Execution-backed pull request review.",
  // Belt to robots.ts's braces: a crawler that ignores robots.txt still reads
  // this, and the board is meant to be shared by link, not found by search.
  robots: { index: false, follow: false },
};

// Applies a stored theme before first paint. Without it a stored override
// flashes the system theme on every navigation-free load.
const THEME_SCRIPT = `try{var t=localStorage.getItem("cujo-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

/**
 * Both hostnames are served by this one app, and which plane a request is on is
 * decided per request from its `Host` (decision 34). Reading it here makes the
 * layout dynamic, which both pages already are.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const mode = await serverMode();
  const admin = adminBaseUrl();
  return (
    // The theme script below sets data-theme before React hydrates, so the
    // server markup and the hydrated DOM differ on this element by design.
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal, no interpolation */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg text-fg">
        <Providers mode={mode} adminBaseUrl={admin}>
          <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4">
            <header className="flex items-center justify-between gap-4 border-b border-line py-4">
              <Link
                href="/"
                className="flex items-center gap-2.5 text-fg no-underline"
                aria-label="cujo, all runs"
              >
                <Mark className="h-7 w-7" />
                <span className="font-display text-xl font-bold lowercase tracking-tight">
                  cujo
                </span>
              </Link>
              <ThemeToggle />
            </header>
            {mode === "public" ? (
              <p className="border-b border-line py-2 text-xs text-fg-muted">
                A read-only view of Cujo&rsquo;s reviews of public pull requests.{" "}
                {admin ? (
                  <a href={admin} className="underline">
                    Operators sign in here
                  </a>
                ) : null}
              </p>
            ) : null}
            <main className="flex-1 py-8">{children}</main>
            <footer className="border-t border-line py-4 text-xs text-fg-muted">
              Reviews pull requests by running them. Built on TrueForge.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
