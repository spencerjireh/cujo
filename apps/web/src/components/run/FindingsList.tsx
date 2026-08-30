"use client";

import { SeverityBadge } from "@/components/SeverityBadge";
import { Chevron } from "@/components/icons/Chevron";
import { CHECK_NAMES, type Finding, type RunStatus, type Severity, isLive } from "@/lib/api/types";
import { SEVERITY_ORDER } from "@/lib/board/tone";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useState } from "react";

/**
 * The findings, grouped by the check that produced them.
 *
 * `findings` arrives presorted critical-first and already merged with the
 * hard-rule hits. It used to be rendered as one flat list in that order, which
 * is right for a reader asking "what is the worst thing here" and wrong for
 * the one the page is for: a pull request author who came from the review,
 * asking "what did the tests find" — and had to read the meta line under every
 * row to sort that out. So the list is folded by check, in the order the checks
 * are always named, and within a group the rows keep the order they arrived
 * in, which is worst first.
 *
 * Every group starts closed. A group used to open itself when it held anything
 * above info, and the page then arrived with its worst section already unfolded
 * under a verdict card and a timeline that had both just said what was bad.
 * The trigger row carries the counts, so a closed group already says what is
 * inside it; what it holds is for a reader who has chosen to look.
 *
 * The chips above filter what is shown and never what is counted: a trigger
 * row that said "1 critical" while the reader is looking at info would be the
 * page revising the run to match the filter.
 *
 * The empty state depends on the run status. A check that never reported only
 * becomes a finding at `turn.done`, so an empty list on a live run means "not
 * yet", not "nothing wrong" — and claiming a clean result while someone is
 * deciding whether to block a merge would be the worst place to overstate it.
 */

type Filter = "all" | Severity;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "warn", label: "Warn" },
  { id: "info", label: "Info" },
];

interface Group {
  check: string;
  findings: Finding[];
}

/**
 * Grouped in `CHECK_NAMES` order, then any check the list names that the four
 * do not, in the order they were first seen. Only groups that hold something
 * are returned: a check with no findings has its lane on the timeline to say
 * so, and an empty disclosure here would say it again with nothing under it.
 */
function groupByCheck(findings: Finding[]): Group[] {
  const byCheck = new Map<string, Finding[]>();
  for (const name of CHECK_NAMES) byCheck.set(name, []);
  for (const finding of findings) {
    const bucket = byCheck.get(finding.check);
    if (bucket) bucket.push(finding);
    else byCheck.set(finding.check, [finding]);
  }
  return [...byCheck.entries()]
    .filter(([, mine]) => mine.length > 0)
    .map(([check, mine]) => ({ check, findings: mine }));
}

/** "2 critical, 1 info" — the zero terms left out, and "no findings" for none. */
function countsLine(findings: Finding[]): string {
  const terms = SEVERITY_ORDER.map((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length;
    return count > 0 ? `${count} ${severity}` : null;
  }).filter(Boolean);
  return terms.length > 0 ? terms.join(", ") : "no findings";
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
        <p className="mt-1 font-mono text-xs text-fg-muted">
          {finding.check}
          {finding.path ? ` · ${finding.path}${finding.line ? `:${finding.line}` : ""}` : ""}
          {finding.source === "hard_rule" ? " · hard rule" : ""}
        </p>
      </div>
    </li>
  );
}

function CheckGroup({ group, filter }: { group: Group; filter: Filter }) {
  const [open, setOpen] = useState(false);
  const shown =
    filter === "all"
      ? group.findings
      : group.findings.filter((finding) => finding.severity === filter);

  return (
    <li>
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm border-t border-line px-2 py-3 text-left hover:bg-bg-raised">
          <span className="wrap-anywhere font-mono text-xs">
            <span className="text-fg">{group.check}</span>
            <span className="text-fg-muted">
              : {countsLine(group.findings)}
              {/* The count stays whole; only what is under it narrows. */}
              {filter === "all" ? "" : ` (${shown.length} shown)`}
            </span>
          </span>
          <Chevron open={open} className="text-fg-muted" />
        </Collapsible.Trigger>
        <Collapsible.Content>
          {shown.length > 0 ? (
            <ul className="flex flex-col pb-2">
              {shown.map((finding) => (
                <FindingRow key={`${finding.check}-${finding.title}`} finding={finding} />
              ))}
            </ul>
          ) : (
            <p className="border-t border-line py-3 font-mono text-xs text-fg-muted">
              Nothing at this severity from {group.check}.
            </p>
          )}
        </Collapsible.Content>
      </Collapsible.Root>
    </li>
  );
}

export function FindingsList({
  findings,
  status,
}: {
  findings: Finding[];
  status: RunStatus;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  if (findings.length === 0) {
    return (
      <section aria-label="Findings">
        <h2 className="mb-1 text-lg">Findings</h2>
        <p className="mb-3 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
          What the checks concluded, by check and worst first. A hard-rule hit is Cujo&rsquo;s own
          reading of a report, not the model&rsquo;s.
        </p>
        <p className="text-sm text-fg-muted">
          {isLive(status)
            ? "Nothing found so far. Checks that have not reported yet are still counted at the end of the run."
            : "Nothing to report. Every check ran and none of the hard rules tripped."}
        </p>
      </section>
    );
  }

  const groups = groupByCheck(findings);

  return (
    <section aria-label="Findings">
      <h2 className="mb-1 text-lg">
        Findings <span className="text-fg-muted">({findings.length})</span>
      </h2>
      <p className="mb-3 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        What the checks concluded, by check and worst first. A hard-rule hit is Cujo&rsquo;s own
        reading of a report, not the model&rsquo;s.
      </p>
      {/* The same chips the record uses to narrow its rows, so a reader who
          has used one has used both. Copied rather than shared: the board's
          filters are about run status and these are about severity, and a
          component that took both would be two components in one prop. */}
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const count =
            option.id === "all"
              ? findings.length
              : findings.filter((finding) => finding.severity === option.id).length;
          const active = filter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={active}
              className={`rounded-md border px-3 py-1 font-mono text-xs transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-line text-fg-muted hover:border-fg-muted hover:text-fg"
              }`}
            >
              {option.label} ({count})
            </button>
          );
        })}
      </div>
      <ul className="flex flex-col">
        {groups.map((group) => (
          <CheckGroup key={group.check} group={group} filter={filter} />
        ))}
      </ul>
    </section>
  );
}
