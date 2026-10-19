"use client";

import { WithCommands } from "@/components/common/WithCommands";
import { Chevron } from "@/components/icons/Chevron";
import type { Finding, Run } from "@/lib/api/types";
import { SEVERITY_ORDER, SEVERITY_TONE, TONE_TEXT } from "@/lib/board/tone";
import { headline, nextStep, whatHappened } from "@/lib/run/next-step";
import * as Collapsible from "@radix-ui/react-collapsible";
import Link from "next/link";
import { useState } from "react";

/**
 * The verdict, what it rests on, and what to do (decision 175). It replaced a
 * card of severity counts, which told a reader from GitHub how bad the run
 * was but not why, nor what would lift it: those were a screen further down,
 * at the end of the evidence log.
 *
 * The critical findings are listed by name, with where each one is. A
 * hard-rule finding carries no file and line (the rule is about what ran, not
 * about a line), so its place is the first line of its evidence, which is
 * where the failing test names or the host are.
 *
 * While the run is live there is no verdict yet, so nothing is listed: a
 * check that never reported only becomes a finding at the end of the turn.
 */

const HEADLINE_TONE: Partial<Record<Run["status"], string>> = {
  blocked: "text-sev-critical",
  clean: "text-sev-live",
  error: "text-sev-high",
  unproven: "text-sev-high",
};

function place(finding: Finding): string | null {
  if (finding.path) return finding.line ? `${finding.path}:${finding.line}` : finding.path;
  const first = finding.evidence.split("\n").find((line) => line.trim() !== "");
  return first ? first.trim() : null;
}

function FindingItem({ finding }: { finding: Finding }) {
  const where = place(finding);
  return (
    <li className="border-t border-line py-2.5">
      <p className="text-fg">
        {finding.title}
        {finding.source === "hard_rule" ? (
          <span className="ml-2 text-xs text-fg-muted">hard rule</span>
        ) : null}
      </p>
      {where ? (
        <p className="mt-0.5 wrap-anywhere font-mono text-xs text-fg-muted">{where}</p>
      ) : null}
    </li>
  );
}

export function RunVerdict({ run }: { run: Run }) {
  const [othersOpen, setOthersOpen] = useState(false);
  const live = run.status === "running";
  const critical = run.findings.filter((f) => f.severity === "critical");
  const others = run.findings
    .filter((f) => f.severity !== "critical")
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const step = nextStep(run.status);
  const otherCounts = SEVERITY_ORDER.filter((s) => s !== "critical")
    .map((severity) => ({ severity, count: others.filter((f) => f.severity === severity).length }))
    .filter(({ count }) => count > 0);

  return (
    <section
      aria-label="Verdict"
      className="mt-5 rounded-lg border border-line bg-bg-raised p-5 font-ui"
    >
      <p className={`font-display text-xl font-bold ${HEADLINE_TONE[run.status] ?? "text-fg"}`}>
        {headline(run.status, critical.length, run.mode)}
      </p>
      <p className="mt-1 text-sm text-fg-muted">{whatHappened(run.status)}</p>

      {!live && critical.length > 0 ? (
        <ul aria-label="Critical findings" className="mt-4 flex flex-col">
          {critical.map((finding) => (
            <FindingItem key={`${finding.check}-${finding.title}`} finding={finding} />
          ))}
        </ul>
      ) : null}

      {step ? (
        <p className="mt-4 border-t border-line pt-4 text-sm text-fg">
          <WithCommands text={step} />
          {run.status === "blocked" || run.status === "dismissed" ? (
            <>
              {" "}
              <Link
                href="/docs/blocking"
                className="text-accent underline-offset-4 hover:underline"
              >
                How blocking works
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {!live && others.length > 0 ? (
        <Collapsible.Root open={othersOpen} onOpenChange={setOthersOpen} className="mt-3">
          <Collapsible.Trigger className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg">
            <Chevron open={othersOpen} />
            {others.length} other {others.length === 1 ? "finding" : "findings"}
            <span className="flex gap-2 font-mono text-xs">
              {otherCounts.map(({ severity, count }) => (
                <span key={severity} className={TONE_TEXT[SEVERITY_TONE[severity]]}>
                  {count} {severity}
                </span>
              ))}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <ul className="mt-2 flex flex-col">
              {others.map((finding) => (
                <FindingItem key={`${finding.check}-${finding.title}`} finding={finding} />
              ))}
            </ul>
          </Collapsible.Content>
        </Collapsible.Root>
      ) : null}
    </section>
  );
}
