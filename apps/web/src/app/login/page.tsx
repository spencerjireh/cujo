import { OPERATOR_COOKIE } from "@/lib/api/credentials";
import { serverMode } from "@/lib/api/mode";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Where an operator hands over the token, once (decision 49).
 *
 * A form post and an httpOnly cookie rather than a field in local storage: the
 * token gates every write on this plane, and a value a page can read is a value
 * a script injected into that page can read. Nothing in the browser ever sees
 * it again — the server-side proxy is the only thing that does.
 *
 * The form is deliberately plain. There is no client component, no state, and
 * no fetch: a `<form action>` posting to a server action means the token never
 * exists in JavaScript at all, not even for the moment before it is sent.
 *
 * Not served on the public host. The board there has nothing to sign in to, and
 * a login form on an anonymous page is an invitation to phish one.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ bad?: string }>;
}) {
  if ((await serverMode()) === "public") notFound();
  const { bad } = await searchParams;

  async function signIn(formData: FormData) {
    "use server";
    const token = String(formData.get("token") ?? "").trim();
    if (!token) redirect("/login?bad=1");
    const jar = await cookies();
    jar.set(OPERATOR_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // Off in dev so the local stack works over plain HTTP; the deploy is
      // HTTPS-only, so this is on wherever the token is worth protecting.
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    redirect("/");
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl">Sign in</h1>
      <p className="mb-4 max-w-[60ch] text-sm text-fg-muted">
        This is the operator view. Paste the operator token; it is stored in a cookie this page
        cannot read, and sent only from the server.
      </p>
      <form action={signIn} className="flex max-w-[40ch] flex-col gap-3">
        <input
          type="password"
          name="token"
          autoComplete="off"
          aria-label="Operator token"
          className="rounded-md border border-line bg-bg-raised px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          className="self-start rounded-md bg-accent-fill px-4 py-1.5 text-sm font-medium text-accent-fg"
        >
          Sign in
        </button>
      </form>
      {bad ? <p className="mt-3 text-sm text-sev-critical">Enter the token.</p> : null}
      <p className="mt-6 max-w-[60ch] text-xs text-fg-muted">
        Nothing here decides a review. A held finding is answered on the pull request with{" "}
        <code className="rounded-sm bg-bg-raised px-1.5 py-0.5">/cujo confirm</code> or{" "}
        <code className="rounded-sm bg-bg-raised px-1.5 py-0.5">/cujo dismiss</code>, by somebody
        with write access to the repository.
      </p>
    </div>
  );
}
