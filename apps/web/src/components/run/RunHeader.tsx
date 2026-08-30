import { RelativeTime } from "@/components/RelativeTime";
import { StatusBadge } from "@/components/StatusBadge";
import type { Run } from "@/lib/api/types";
import { setupWindow } from "@/lib/board/setup";
import { avatarUrl, duration, prUrl, profileUrl, shortSha } from "@/lib/format";
import Image from "next/image";
import Link from "next/link";

const AVATAR = 20;

/** A span in milliseconds, worded the way every other duration on the page is. */
function span(ms: number): string {
  return duration(new Date(0).toISOString(), new Date(ms).toISOString()) ?? "";
}

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
  const window = setupWindow(run.setup);
  return (
    <header className="mb-8">
      {/* The mark in the corner scrolls away with the page, and most readers
          arrive here from a link in a GitHub review rather than from the board
          — so without this a reader who has scrolled has no route to the rest
          of the runs at all. A breadcrumb rather than chrome: it sits where the
          eye already is, and costs the board nothing. */}
      <Link href="/" className="font-mono text-xs text-fg-muted no-underline hover:text-accent">
        ← all runs
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
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
      {/* What reviewed this pull request, and against what. A verdict from an
          execution-backed reviewer is only checkable if the reader can see
          which model reached it and which rubric it was reading — both are
          published (commit 513d35f) and neither was on the page. Null on a run
          recorded before the columns existed, and then this line is absent
          rather than saying "unknown", which claims a lookup happened. */}
      {run.model || run.rubric_sha256 ? (
        <p className="mt-1 font-mono text-xs text-fg-muted">
          {run.model ? <>reviewed by {run.model}</> : null}
          {run.model && run.rubric_sha256 ? " · " : null}
          {run.rubric_sha256 ? <>rubric {shortSha(run.rubric_sha256)}</> : null}
        </p>
      ) : null}
      {/* What the run spent before it could start measuring anything
          (decision 67). One line, because the shape of it is on the timeline
          and the number is what a reader wants beside the verdict: a review
          that took six minutes spent most of them here, and the page said
          nothing about that until this landed. Absent, never zeroed, on a run
          whose stamps cannot support it. */}
      {window ? (
        <p className="mt-1 font-mono text-xs text-fg-muted">
          setup {span(window.lengthMs)} · {window.messages}{" "}
          {window.messages === 1 ? "message" : "messages"}
          {window.thinkingMs === null ? null : <> · {span(window.thinkingMs)} planning</>}
        </p>
      ) : null}
      {run.summary ? <p className="mt-4 max-w-[68ch] text-sm">{run.summary}</p> : null}
      {run.error ? (
        <p className="mt-3 rounded-md bg-sev-critical-bg px-3 py-2 font-mono text-xs text-sev-critical">
          {run.error}
        </p>
      ) : null}
    </header>
  );
}
