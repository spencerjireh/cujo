import { ThemeToggle } from "@/components/ThemeToggle";
import { Mark } from "@/components/brand/Mark";
import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
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
 * Every repository this board is built out of, named by what it is rather than
 * by its path. The product's whole claim is that it executes what it reviews,
 * so the three things a reader would want to check are the reviewer, the
 * harness it runs on, and the sandbox the pull request is executed in.
 */
const SOURCE = [
  { label: "Cujo", href: "https://github.com/spencerjireh/cujo" },
  { label: "TrueForge", href: "https://github.com/truefoundry/trueforge" },
  { label: "Daytona", href: "https://github.com/daytonaio/daytona" },
];

/**
 * The page's last word, and the only place the product explains itself in
 * prose. Four columns and not one line, because the one line it replaced had to
 * carry the scope, the mechanism and the credit at once and so said none of
 * them.
 *
 * The theme control lives here and nowhere else now. It had a second home in
 * the header, and the two agreed because the choice lives in
 * `lib/theme-store.ts` rather than inside either of them. That store is still
 * the right shape and is now load-bearing for a different reason: this control
 * is at the end of a long page, so it reads the document's state rather than
 * remembering its own, and arriving here after a theme was set elsewhere — a
 * system change, another tab — must not show a control claiming otherwise.
 */
function SiteFooter() {
  return (
    <footer className="border-t border-line px-4 py-10 md:px-6">
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 text-fg">
            <Mark className="h-5 w-5" />
            <span className="font-display text-base font-bold lowercase tracking-tight">cujo</span>
          </div>
          <p className="mt-3 max-w-[36ch] font-mono text-xs leading-relaxed text-fg-muted">
            An execution-backed pull request reviewer. It clones the head into a disposable sandbox,
            runs it, and reviews what happened.
          </p>
        </div>
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg">What this is</h2>
          <p className="mt-3 max-w-[36ch] font-mono text-xs leading-relaxed text-fg-muted">
            A read-only view of Cujo&rsquo;s reviews of public pull requests. It writes nothing and
            decides nothing — a held finding is confirmed on the pull request itself.
          </p>
        </div>
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg">Built on</h2>
          <p className="mt-3 max-w-[36ch] font-mono text-xs leading-relaxed text-fg-muted">
            TrueForge, unforked, for the agent harness. Daytona for the sandbox each pull request is
            executed in, and thrown away with.
          </p>
        </div>
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg">Source</h2>
          <ul className="mt-3 flex flex-col gap-2 font-mono text-xs">
            {SOURCE.map((entry) => (
              <li key={entry.href}>
                <a
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fg-muted underline decoration-line underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {/* The scope line and the theme control, on one rule under the columns.
          Both are about the page rather than about Cujo, which is why neither
          belongs in a column above. */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <p className="font-mono text-xs text-fg-muted">
          A run appears here only while its repository is public.
        </p>
        <ThemeToggle />
      </div>
    </footer>
  );
}

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
          {/* No bar. It held a wordmark and a second theme control, and cost
              the chamber the top of the window to do it — the board's whole
              argument is an instrument, and the instrument was starting below
              a rule. What replaced it is `HomeMark`, placed by each page
              because the mark takes its colour from the ground it sits on and
              only the page knows which ground that is. `main` keeps no measure
              of its own, because the chamber runs the full width; a page that
              wants the old column applies it itself, as `/runs/[id]` does. */}
          <div className="flex min-h-screen flex-col">
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
