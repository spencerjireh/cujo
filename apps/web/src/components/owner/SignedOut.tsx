import { OwnerPage } from "./OwnerPage";

/**
 * What a visitor who is not an owner sees on an owner's page (decision 156):
 * an invitation, not a 404. These pages are for the person who installed the
 * App, and saying so, with the one thing to do next, is more useful than
 * pretending the page is not there.
 */
export function SignedOut({
  title,
  reason,
}: {
  title: string;
  reason: "anonymous" | "not_owner" | "unconfigured";
}) {
  return (
    <OwnerPage title={title}>
      <div className="max-w-[60ch] text-sm leading-relaxed text-fg-muted">
        {reason === "unconfigured" ? (
          <p>
            Sign-in is not set up. Add the App&rsquo;s OAuth client id and secret to the
            environment.
          </p>
        ) : reason === "not_owner" ? (
          <p>You are not an owner. Sign in as an admin of the account that installed the App.</p>
        ) : (
          <>
            <p>Sign in with the account that installed the App.</p>
            <a
              href="/api/auth/login"
              className="mt-5 inline-block rounded-md bg-accent-fill px-3 py-1.5 font-medium text-accent-fg no-underline transition-colors hover:bg-accent"
            >
              Sign in with GitHub
            </a>
          </>
        )}
      </div>
    </OwnerPage>
  );
}
