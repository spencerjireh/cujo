"use client";

import type { Run } from "@/lib/api/types";
import { absoluteTime } from "@/lib/format";
import * as Collapsible from "@radix-ui/react-collapsible";
import { type ReactNode, useState } from "react";

/**
 * What this run was, in handles.
 *
 * Decision 52 put the TrueForge session, its turns and the webhook delivery on
 * the public projection, and decision 57 kept them there on the argument that
 * they authorize nothing: the console they name has its own Access application,
 * which is the thing standing between a reader and a session. Both decisions
 * were about publishing them. Neither was followed by anything rendering them,
 * so for five releases the board published four handles to nobody.
 *
 * This is what they were published for. A verdict from an execution-backed
 * reviewer is checkable or it is an assertion, and checking it means being able
 * to name the session that produced it, the turns it took, the delivery that
 * started it, and the rubric digest it was read against. The header already
 * names the model and the short rubric; the full digest is here, because seven
 * characters identify a rubric and do not verify one.
 *
 * Collapsed by default. It is provenance, not evidence — a reader comes to this
 * page for the findings, and reaches for this only when they want to check the
 * findings against something.
 */

/** One labelled value, monospaced, wrapping rather than truncating. */
function Entry({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-baseline gap-3 border-t border-line py-2">
      <dt className="font-mono text-xs text-fg-muted">{label}</dt>
      <dd className="wrap-anywhere font-mono text-xs text-fg">{children}</dd>
    </div>
  );
}

/** A stamp, or nothing at all. Absent is not "unknown", which claims a lookup. */
function Stamp({ label, iso }: { label: string; iso: string | null }) {
  if (!iso) return null;
  return <Entry label={label}>{absoluteTime(iso)}</Entry>;
}

export function RunProvenance({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const setup = run.setup;
  // Nothing to show at all on a run recorded before any of this was stored,
  // and then the section is absent rather than an empty disclosure.
  const has =
    run.session_id ||
    run.delivery_id ||
    run.rubric_sha256 ||
    (run.turn_ids && run.turn_ids.length > 0) ||
    setup;
  if (!has) return null;

  return (
    <section aria-label="Provenance">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="flex w-full items-center justify-between gap-3 py-3 text-left">
          <span className="text-lg">Provenance</span>
          <span className="font-mono text-xs text-fg-muted" aria-hidden="true">
            {open ? "collapse" : "expand"}
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content className="pb-4">
          <p className="mb-3 max-w-[68ch] font-mono text-xs text-fg-muted">
            What produced this verdict. None of it authorizes anything: the harness console these
            name keeps its own gate, and a held finding is answered on the pull request.
          </p>
          <dl>
            {run.model ? <Entry label="model">{run.model}</Entry> : null}
            {run.rubric_sha256 ? <Entry label="rubric">{run.rubric_sha256}</Entry> : null}
            {run.session_id ? <Entry label="session">{run.session_id}</Entry> : null}
            {run.turn_ids && run.turn_ids.length > 0 ? (
              <Entry label={run.turn_ids.length === 1 ? "turn" : "turns"}>
                {run.turn_ids.join(", ")}
              </Entry>
            ) : null}
            {run.delivery_id ? <Entry label="delivery">{run.delivery_id}</Entry> : null}
            {setup ? (
              <>
                <Stamp label="turn created" iso={setup.turnCreatedAt} />
                {/* Absent on a re-run, and that absence is the fact: the event
                    is session-scoped, so a second run on the same pull request
                    never sees one because the sandbox was already there. */}
                <Stamp label="sandbox created" iso={setup.sandboxCreatedAt} />
                <Stamp label="agent started" iso={setup.agentStartedAt} />
                <Stamp label="first check" iso={setup.firstCheckAt} />
              </>
            ) : null}
          </dl>
        </Collapsible.Content>
      </Collapsible.Root>
    </section>
  );
}
