import { ThemeToggle } from "@/components/ThemeToggle";
import { Mark } from "@/components/brand/Mark";
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
 * One hostname, one plane. This used to read the request's own `Host` to decide
 * which of two planes it was rendering (decision 34); decision 57 deleted the
 * other one, so the layout is static again.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script below sets data-theme before React hydrates, so the
    // server markup and the hydrated DOM differ on this element by design.
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal, no interpolation */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg text-fg">
        <Providers>
          {/* The chrome keeps its measure; `main` does not, because the board's
              chamber runs the full width of the window. A page that wants the
              old column applies it itself — `/runs/[id]` does. */}
          <div className="flex min-h-screen flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-4 md:px-6">
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
            <main className="flex-1">{children}</main>
            <footer className="border-t border-line px-4 py-4 text-xs text-fg-muted md:px-6">
              A read-only view of Cujo&rsquo;s reviews of public pull requests. Built on TrueForge.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
