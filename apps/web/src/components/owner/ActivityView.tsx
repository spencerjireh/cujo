"use client";

import { RelativeTime } from "@/components/RelativeTime";
import { StatusBadge } from "@/components/StatusBadge";
import { WithCommands } from "@/components/common/WithCommands";
import {
  ownerBotOptions,
  ownerHealthOptions,
  ownerInstanceOptions,
  ownerRepositoriesOptions,
  ownerRunsOptions,
} from "@/lib/api/queries";
import type { RunSummary } from "@/lib/api/types";
import { needsYou, setupSteps } from "@/lib/owner/activity";
import { deliveryTone } from "@/lib/owner/instance";
import { nextStep } from "@/lib/run/next-step";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { OwnerPage, OwnerSection } from "./OwnerPage";
import { RunTable } from "./RunTable";
import { SetupChecklist } from "./SetupChecklist";

/**
 * An owner's home (decision 175): what is left to set up, which pull requests
 * need a person, and what ran. Sign-in lands here, so it answers the question
 * an owner arrives with — does anything need me — before anything else.
 */

const RECENT = 30;

function NeedsYouRow({ run }: { run: RunSummary }) {
  const step = nextStep(run.status);
  return (
    <li className="grid grid-cols-1 gap-2 border-t border-line py-3 sm:grid-cols-[6.5rem_1fr_8rem] sm:gap-4">
      <div>
        <StatusBadge status={run.status} />
      </div>
      <div className="min-w-0">
        <Link
          href={`/runs/${run.id}`}
          className="font-medium text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          {run.pr_title ?? `Pull request #${run.pr_number}`}
        </Link>
        <p className="mt-0.5 font-mono text-xs text-fg-muted">
          {run.repo} #{run.pr_number}
        </p>
        {step ? (
          <p className="mt-1.5 text-sm text-fg-muted">
            <WithCommands text={step} />
          </p>
        ) : null}
      </div>
      <p className="text-sm text-fg-muted sm:text-right">
        <RelativeTime iso={run.updated_at} />
      </p>
    </li>
  );
}

export function ActivityView() {
  const runs = useQuery(ownerRunsOptions());
  const repositories = useQuery(ownerRepositoriesOptions());
  const settings = useQuery(ownerInstanceOptions());
  const bot = useQuery(ownerBotOptions());
  const health = useQuery(ownerHealthOptions());
  const [repo, setRepo] = useState("");
  const filterId = useId();

  // The checklist waits for every input to settle, so a step is not shown
  // as left undone for the half second before its answer arrives.
  const settled = [repositories, settings, bot, health].every((q) => !q.isPending);
  const steps = settled
    ? setupSteps({
        bot: bot.data,
        settings: settings.data?.settings,
        health: health.data,
        repositories: repositories.data,
      })
    : null;

  const all = runs.data?.runs ?? [];
  const attention = needsYou(all);
  // A recent webhook GitHub could not deliver is a pull request that may
  // never have been reviewed, which no run on this page can show.
  const undelivered = bot.data?.deliveries
    .slice(0, 5)
    .find((delivery) => deliveryTone(delivery) === "critical");
  const names = [...new Set(all.map((r) => r.repo))].sort();
  const shown = (repo ? all.filter((r) => r.repo === repo) : all).slice(0, RECENT);

  return (
    <OwnerPage title="Activity" lead="What Cujo did on your pull requests, and what needs you.">
      <div className="flex flex-col gap-10">
        {steps ? <SetupChecklist steps={steps} /> : null}

        <OwnerSection id="needs-you" title="Needs you">
          {runs.error ? (
            <p className="text-sm text-sev-critical">
              The runs could not be loaded. Reload to try again.
            </p>
          ) : runs.isPending ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : attention.length === 0 && !undelivered ? (
            <p className="text-sm text-fg-muted">
              Nothing needs you. No pull request is blocked, and no run failed.
            </p>
          ) : (
            <ul className="flex flex-col border-b border-line">
              {undelivered ? (
                <li className="border-t border-line py-3 text-sm">
                  <p className="font-medium text-sev-critical">
                    A GitHub delivery did not reach Cujo
                  </p>
                  <p className="mt-0.5 text-fg-muted">
                    The {undelivered.event} event <RelativeTime iso={undelivered.deliveredAt} /> got{" "}
                    {undelivered.statusCode ? `a ${undelivered.statusCode}` : "no answer"}. A pull
                    request it carried may not have been reviewed.{" "}
                    <Link
                      href="/settings#deliveries"
                      className="text-accent underline-offset-4 hover:underline"
                    >
                      See deliveries
                    </Link>
                  </p>
                </li>
              ) : null}
              {attention.map((run) => (
                <NeedsYouRow key={run.id} run={run} />
              ))}
            </ul>
          )}
        </OwnerSection>

        <OwnerSection id="recent" title="Recent runs">
          {runs.isPending || runs.error ? null : all.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No runs yet. Open a pull request on a repository with reviews on, and its run appears
              here.{" "}
              <Link href="/repos" className="text-accent underline-offset-4 hover:underline">
                Choose repositories
              </Link>
            </p>
          ) : (
            <>
              {names.length > 1 ? (
                <div className="mb-3 flex items-center gap-2 text-sm">
                  <label htmlFor={filterId} className="text-fg-muted">
                    Repository
                  </label>
                  <select
                    id={filterId}
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    className="rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs text-fg"
                  >
                    <option value="">All</option>
                    {names.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <RunTable runs={shown} />
            </>
          )}
        </OwnerSection>
      </div>
    </OwnerPage>
  );
}
