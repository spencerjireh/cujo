"use client";

import { SeverityBadge } from "@/components/SeverityBadge";
import { Chevron } from "@/components/icons/Chevron";
import type { Finding, Run } from "@/lib/api/types";
import { SMOKE_STOP_SIGNAL, compactCount, describeExit } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { prefersReducedMotion } from "@/lib/motion";
import {
  type CheckEntry,
  type LogEntry,
  type ReviewEntry,
  buildLog,
  offsetLabel,
} from "@/lib/run/log";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useEffect, useMemo, useRef, useState } from "react";
import { RawReport } from "./report/RawReport";
import { SensorReport } from "./report/SensorReport";
import { SensorStatus } from "./report/SensorStatus";

/**
 * The evidence log (decision 154): the run as a record of what happened, in
 * the order it happened, each entry beside the evidence for it. It replaces
 * the three sections that used to hold the same facts apart — the findings
 * grouped by check, the review as posted, the reports — with one column that
 * a reader goes down once.
 *
 * What is on the page without a click: when each check started, what it ran,
 * what the sensors saw, and every finding above `info` with its evidence.
 * What folds: the evidence tables, the raw report, the `info` findings, and
 * the review's composed body, which repeats the log. Decision 93's rule that
 * nothing opens itself still holds for those; it no longer holds for a
 * finding a person would block a merge on, which is the thing the page is
 * for.
 */

const ALARM_TONE: Record<string, string> = {
  critical: "border-sev-critical bg-sev-critical-bg text-sev-critical",
  warn: "border-sev-high bg-sev-high-bg text-sev-high",
  info: "border-line bg-bg-raised text-fg-muted",
};

const TRIGGER =
  "-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left font-mono text-xs text-fg-muted hover:bg-bg-raised hover:text-fg";

function duration(msValue: number | null): string | null {
  if (msValue === null) return null;
  const total = Math.round(msValue / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** The gutter: when, and what. The rule beside it runs the length of the log. */
function Gutter({ at, name }: { at: number | null; name: string }) {
  const when = offsetLabel(at);
  return (
    <div className="flex flex-row items-baseline gap-3 md:flex-col md:items-end md:gap-0.5 md:pr-4 md:text-right">
      <h3 className="text-base leading-tight">{name}</h3>
      <span className="font-mono text-xs text-fg-muted">{when ?? " "}</span>
    </div>
  );
}

function Entry({
  at,
  name,
  id,
  children,
}: { at: number | null; name: string; id?: string; children: React.ReactNode }) {
  return (
    // Focusable so the timeline's pick can put the keyboard here as well as
    // scroll here; `-1` keeps it out of the Tab order.
    <li
      id={id}
      tabIndex={-1}
      className="grid scroll-mt-4 gap-2 outline-none md:grid-cols-[8rem_1fr] md:gap-0"
    >
      <Gutter at={at} name={name} />
      <div className="min-w-0 border-l border-line pb-8 pl-4 md:pl-6">{children}</div>
    </li>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="grid grid-cols-[5.5rem_1fr] items-start gap-3 border-t border-line py-3">
      <SeverityBadge severity={finding.severity} />
      <div className="min-w-0">
        <p className="text-sm">{finding.title}</p>
        {finding.evidence ? (
          <p className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">
            {finding.evidence}
          </p>
        ) : null}
        {finding.path || finding.source === "hard_rule" ? (
          <p className="mt-1 font-mono text-xs text-fg-muted">
            {finding.path ? `${finding.path}${finding.line ? `:${finding.line}` : ""}` : ""}
            {finding.path && finding.source === "hard_rule" ? " · " : ""}
            {finding.source === "hard_rule" ? "hard rule" : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** Findings above `info` are on the page; `info` folds behind its count. */
function Findings({ findings }: { findings: Finding[] }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const loud = findings.filter((f) => f.severity !== "info");
  const quiet = findings.filter((f) => f.severity === "info");
  if (findings.length === 0) return null;
  return (
    <div className="mt-3">
      {loud.length > 0 ? (
        <ul className="flex flex-col">
          {loud.map((finding, index) => (
            // Position is part of the key: two probes can report the same
            // title at the same severity, and they are two rows.
            <FindingRow key={`${index}-${finding.severity}-${finding.title}`} finding={finding} />
          ))}
        </ul>
      ) : null}
      {quiet.length > 0 ? (
        <Collapsible.Root
          open={infoOpen}
          onOpenChange={setInfoOpen}
          className={loud.length ? "border-t border-line" : ""}
        >
          <Collapsible.Trigger className={TRIGGER}>
            <span>
              {quiet.length} {quiet.length === 1 ? "note" : "notes"}
            </span>
            <Chevron open={infoOpen} />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <ul className="flex flex-col">
              {quiet.map((finding, index) => (
                <FindingRow key={`${index}-info-${finding.title}`} finding={finding} />
              ))}
            </ul>
          </Collapsible.Content>
        </Collapsible.Root>
      ) : null}
    </div>
  );
}

function Commands({ entry }: { entry: CheckEntry }) {
  if (entry.commands.length === 0) return null;
  const expectedSignal = entry.name === "smoke" ? SMOKE_STOP_SIGNAL : undefined;
  return (
    <ul className="mt-2 flex max-w-3xl flex-col gap-0.5 font-mono text-xs">
      {entry.commands.map((command, index) => {
        const ended = command.exit === null ? null : describeExit(command.exit, { expectedSignal });
        const expected =
          command.exit !== null && expectedSignal !== undefined && -command.exit === expectedSignal;
        const alarming = command.exit !== null && command.exit !== 0 && !expected;
        return (
          <li
            key={`${index}-${command.argv.join(" ")}`}
            className="flex flex-wrap items-baseline gap-x-3"
          >
            <code className="min-w-0 break-all text-fg">{command.argv.join(" ")}</code>
            <span className="flex shrink-0 gap-3 text-fg-muted">
              {command.label ? <span>{command.label}</span> : null}
              {ended !== null ? (
                <span className={alarming ? "text-sev-high" : ""}>{ended}</span>
              ) : null}
              {command.durationS !== null ? <span>{command.durationS}s</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** What the sensors saw, as facts: the alarms first, then the count of hosts reached. */
function Observed({ entry }: { entry: CheckEntry }) {
  const rows = [
    ...entry.alarms.map((alarm) => ({ text: alarm.text, tone: alarm.severity as string })),
    ...(entry.egressHosts !== null
      ? [
          {
            text:
              entry.egressHosts === 0
                ? "no host contacted"
                : `${entry.egressHosts} known ${entry.egressHosts === 1 ? "host" : "hosts"} contacted`,
            tone: "info",
          },
        ]
      : []),
  ];
  if (rows.length === 0) return null;
  return (
    <ul className="mt-2 flex max-w-3xl flex-col gap-px">
      {rows.map((row) => (
        <li
          key={row.text}
          className={`flex items-baseline justify-between gap-3 border-l-2 px-2 py-1 font-mono text-xs ${ALARM_TONE[row.tone] ?? ALARM_TONE.info}`}
        >
          <span>{row.text}</span>
          {row.tone !== "info" ? <span className="shrink-0 opacity-70">{row.tone}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function StatusLine({ entry }: { entry: CheckEntry }) {
  const parts: React.ReactNode[] = [];
  if (entry.status === "running")
    parts.push(
      <span key="s" className="text-sev-live">
        running
      </span>,
    );
  else if (entry.status === "error")
    parts.push(
      <span key="s" className="text-sev-critical">
        error
      </span>,
    );
  else if (entry.empty)
    parts.push(
      <span key="s" className="text-sev-high">
        no report
      </span>,
    );
  else parts.push(<span key="s">reported</span>);
  const wall = duration(entry.wallMs);
  if (wall) parts.push(<span key="w">{wall}</span>);
  const box = duration(entry.sandboxMs);
  if (box) parts.push(<span key="b">{box} in the sandbox</span>);
  if (entry.tokens) {
    parts.push(
      <span key="t">
        {compactCount(entry.tokens.input)} in, {compactCount(entry.tokens.output)} out
      </span>,
    );
  }
  if (entry.attempts > 1) parts.push(<span key="a">attempt {entry.attempts}</span>);
  return <p className="flex flex-wrap gap-x-3 font-mono text-xs text-fg-muted">{parts}</p>;
}

/** The evidence tables and the raw report, folded; opened by the timeline's pick. */
function Evidence({ entry, summoned }: { entry: CheckEntry; summoned: number }) {
  const [open, setOpen] = useState(false);
  const delivered = useRef(summoned);
  useEffect(() => {
    if (summoned === delivered.current) return;
    delivered.current = summoned;
    if (summoned !== 0) setOpen(true);
  }, [summoned]);
  if (entry.blocks.length === 0 && entry.raw === null) return null;
  return (
    <div className="mt-3">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className={TRIGGER}>
          <span>{entry.blocks.length ? "what the sandbox recorded" : "the report"}</span>
          <Chevron open={open} />
        </Collapsible.Trigger>
        <Collapsible.Content>
          {entry.blocks.length ? (
            <>
              <SensorStatus block={entry.blocks[0]} />
              {entry.blocks.map((block, index) => (
                <SensorReport
                  key={block.label ?? `block-${index}`}
                  block={block}
                  check={entry.name}
                  index={index}
                  total={entry.blocks.length}
                />
              ))}
            </>
          ) : null}
          <RawReport raw={entry.raw} />
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

function CheckBody({ entry, summoned }: { entry: CheckEntry; summoned: number }) {
  return (
    <>
      <StatusLine entry={entry} />
      {entry.error ? (
        <p className="mt-2 font-mono text-xs text-sev-critical">{entry.error}</p>
      ) : null}
      <Commands entry={entry} />
      <Observed entry={entry} />
      <Findings findings={entry.findings} />
      <Evidence entry={entry} summoned={summoned} />
    </>
  );
}

/**
 * The review as posted, folded: the body `github-mcp` composed repeats the
 * findings above it. Markdown an agent wrote, so sanitized after mount
 * (lib/markdown.ts) and inert text until then.
 */
function ReviewBody({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const markdown = run.review?.composed_body || run.review?.body || "";
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (open && html === null) setHtml(renderMarkdown(markdown));
  }, [open, html, markdown]);
  if (!run.review) return null;
  return (
    <div className="mt-3">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className={TRIGGER}>
          <span>the review as posted</span>
          <Chevron open={open} />
        </Collapsible.Trigger>
        <Collapsible.Content>
          {html === null ? (
            <p className="max-w-[68ch] whitespace-pre-wrap py-2 text-sm">{markdown}</p>
          ) : (
            <div
              className="cujo-prose max-w-[68ch] py-2 text-sm"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized in lib/markdown.ts
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {run.review.comments.length > 0 ? (
            <ul className="mt-2">
              {run.review.comments.map((comment) => (
                <li
                  key={`${comment.path}:${comment.line}`}
                  className="border-t border-line py-2 font-mono text-xs"
                >
                  <span className="text-accent">
                    {comment.path}:{comment.line}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap text-fg-muted">{comment.body}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

function ReviewEntryBody({ entry, run }: { entry: ReviewEntry; run: Run }) {
  const what = !entry.posted
    ? run.review
      ? "drafted, not posted"
      : "the run ended without a review"
    : entry.blocking
      ? "posted as a request for changes; the cujo/guard check fails on this commit until a maintainer lifts it with /cujo dismiss"
      : "posted as a comment";
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs">
        <span
          className={`rounded-md px-2 py-0.5 font-medium ${
            entry.blocking ? "bg-sev-critical-bg text-sev-critical" : "bg-sev-info-bg text-sev-info"
          }`}
        >
          {entry.blocking ? "request changes" : "comment"}
        </span>
        <span className="text-fg-muted">{what}</span>
        {entry.anchored > 0 ? (
          <span className="text-fg-muted">
            {entry.anchored} anchored {entry.anchored === 1 ? "comment" : "comments"}
          </span>
        ) : null}
      </p>
      {entry.lede ? <p className="mt-2 max-w-[68ch] text-sm">{entry.lede}</p> : null}
      <Findings findings={entry.findings} />
      <ReviewBody run={run} />
    </>
  );
}

const END_WORD: Record<string, string> = {
  clean: "clean: every check ran and nothing tripped",
  blocked: "blocked until a maintainer lifts it on the pull request",
  dismissed: "dismissed by a maintainer on the pull request",
  error: "ended in error",
  unproven: "unproven: a check that was expected did not report",
  superseded: "superseded by a run on a newer commit",
  approved: "approved",
};

export function EvidenceLog({
  run,
  picked,
}: {
  run: Run;
  /** The lane a reader picked on the timeline, which opens that entry's evidence and scrolls to it. */
  picked?: { check: string; nonce: number } | null;
}) {
  const entries = useMemo(() => buildLog(run), [run]);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    if (!picked) return;
    const target = listRef.current?.querySelector<HTMLElement>(`#log-${CSS.escape(picked.check)}`);
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    // The scroll on its own is a change nobody using a keyboard or a screen
    // reader is told about; the focus is the part that matters.
    target.focus({ preventScroll: true });
  }, [picked]);

  return (
    <section aria-label="Evidence log">
      <h2 className="mb-1 text-lg">What happened</h2>
      <p className="mb-4 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        In the order it happened, from the turn&rsquo;s start. Each check is what it ran, what the
        sensors saw, and what it concluded; the tables behind each fold.
      </p>
      <ol ref={listRef} className="flex flex-col">
        {entries.map((entry: LogEntry) => {
          if (entry.kind === "setup") {
            return (
              <Entry key="setup" at={entry.at} name="setup">
                <p className="flex flex-wrap gap-x-3 font-mono text-xs text-fg-muted">
                  {entry.sandboxProvisionedMs !== null ? (
                    <span>sandbox in {duration(entry.sandboxProvisionedMs)}</span>
                  ) : null}
                  {entry.ms !== null ? (
                    <span>{duration(entry.ms)} before the first check</span>
                  ) : null}
                  <span>
                    {entry.messages} {entry.messages === 1 ? "message" : "messages"}
                  </span>
                </p>
              </Entry>
            );
          }
          if (entry.kind === "check") {
            return (
              <Entry key={entry.name} at={entry.at} name={entry.name} id={`log-${entry.name}`}>
                <CheckBody
                  entry={entry}
                  summoned={picked && picked.check === entry.name ? picked.nonce : 0}
                />
              </Entry>
            );
          }
          if (entry.kind === "review") {
            return (
              <Entry key="review" at={null} name="review">
                <ReviewEntryBody entry={entry} run={run} />
              </Entry>
            );
          }
          return (
            <Entry key="end" at={null} name="end">
              <p className="font-mono text-xs text-fg-muted">
                {END_WORD[entry.status] ?? entry.status}
              </p>
              {entry.error ? (
                <p className="mt-1 font-mono text-xs text-sev-critical">{entry.error}</p>
              ) : null}
            </Entry>
          );
        })}
      </ol>
    </section>
  );
}
