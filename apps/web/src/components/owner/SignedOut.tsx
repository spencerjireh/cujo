/**
 * What a visitor who is not an owner sees on an owner's page (decision 156):
 * an invitation, not a 404. The board's pages are for anyone; these are for
 * the person who installed the App, and saying so is more useful than
 * pretending the page is not there.
 */
export function SignedOut({ reason }: { reason: "anonymous" | "not_owner" | "unconfigured" }) {
  return (
    <section className="max-w-[60ch]">
      <h1 className="text-2xl">Repositories</h1>
      {reason === "unconfigured" ? (
        <p className="mt-3 font-mono text-xs leading-relaxed text-fg-muted">
          This instance has no sign-in configured. The owner plane needs the App&rsquo;s OAuth
          client id and secret in the environment; until then the board is read-only.
        </p>
      ) : reason === "not_owner" ? (
        <p className="mt-3 font-mono text-xs leading-relaxed text-fg-muted">
          You are signed in, but not as an owner: this page is for an admin of the account the App
          is installed on.
        </p>
      ) : (
        <>
          <p className="mt-3 font-mono text-xs leading-relaxed text-fg-muted">
            The repositories the App is installed on, with their review settings, for the person who
            installed it. Sign in with the GitHub account that did.
          </p>
          <a
            href="/api/auth/login"
            className="mt-5 inline-block rounded-md border border-line px-3 py-1.5 font-mono text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
          >
            Sign in with GitHub
          </a>
        </>
      )}
    </section>
  );
}
