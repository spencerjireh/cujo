import { RelativeTime } from "@/components/RelativeTime";
import { StatusBadge } from "@/components/StatusBadge";
import type { Run } from "@/lib/api/types";
import { avatarUrl, prUrl, profileUrl, shortSha } from "@/lib/format";
import Image from "next/image";

const AVATAR = 20;

/**
 * Who opened the pull request (decision 55). Absent for a run recorded before
 * the author was stored and for a deleted account, in which case the line below
 * is exactly what it was before.
 *
 * The avatar loads through `next/image`, so the file is fetched and resized by
 * the server: a visitor to the anonymous board never makes a request to
 * github.com just by opening a run.
 */
function Author({ run }: { run: Run }) {
  const login = run.pr_author_login;
  if (!login) return null;
  const avatar = avatarUrl(run.pr_author_id, AVATAR);
  const profile = profileUrl(login);
  const name = (
    <span className="font-sans text-fg">
      {avatar ? (
        <Image
          src={avatar}
          alt=""
          width={AVATAR}
          height={AVATAR}
          className="mr-1.5 inline-block rounded-full align-text-bottom"
        />
      ) : null}
      {login}
    </span>
  );
  return (
    <>
      {profile ? (
        <a
          href={profile}
          target="_blank"
          rel="noreferrer"
          className="hover:underline hover:decoration-accent"
        >
          {name}
        </a>
      ) : (
        name
      )}
      {" · "}
    </>
  );
}

export function RunHeader({ run }: { run: Run }) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* The pull request's own title when there is one, and `repo #N` when
            there is not — the shape every run had before titles were stored. */}
        <h1 className="wrap-anywhere text-2xl">
          <a
            href={prUrl(run.repo, run.pr_number)}
            target="_blank"
            rel="noreferrer"
            className="text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
          >
            {run.pr_title ?? `${run.repo} #${run.pr_number}`}
          </a>
        </h1>
        <StatusBadge status={run.status} />
      </div>
      {run.pr_title ? (
        <p className="mt-1 font-mono text-xs text-fg-muted">
          {run.repo} #{run.pr_number}
        </p>
      ) : null}
      <p className="mt-2 font-mono text-xs text-fg-muted">
        <Author run={run} />
        {shortSha(run.head_sha)} · started <RelativeTime iso={run.created_at} />
      </p>
      {run.summary ? <p className="mt-4 max-w-[68ch] text-sm">{run.summary}</p> : null}
      {run.error ? (
        <p className="mt-3 rounded-md bg-sev-critical-bg px-3 py-2 font-mono text-xs text-sev-critical">
          {run.error}
        </p>
      ) : null}
    </header>
  );
}
