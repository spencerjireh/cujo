import type { SetupStep } from "@/lib/owner/activity";
import Link from "next/link";

/**
 * The steps between installing Cujo and a first review (decision 175). Shown
 * at the top of an owner's activity and settings while any step is left, and
 * gone once every one passes. Numbered, because the steps are an order: a
 * model cannot be picked before a provider serves it.
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section
      aria-labelledby="setup-title"
      className="rounded-lg border border-sev-high/40 bg-bg-raised p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup-title" className="font-display text-lg">
          Finish setting up
        </h2>
        <p className="text-sm text-fg-muted">
          {done} of {steps.length} done
        </p>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        Until every step is done, pull requests get no review.
      </p>
      <ol className="mt-4 flex flex-col">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="grid grid-cols-[1.75rem_1fr] items-start gap-3 border-t border-line py-3 sm:grid-cols-[1.75rem_1fr_auto]"
          >
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                step.done
                  ? "border-sev-live/50 bg-sev-live-bg text-sev-live"
                  : "border-line text-fg-muted"
              }`}
            >
              {step.done ? "✓" : index + 1}
            </span>
            <div className="min-w-0">
              <p className={step.done ? "text-fg-muted" : "font-medium text-fg"}>
                {step.title}
                <span className="sr-only">{step.done ? ", done" : ", not done"}</span>
              </p>
              {step.done ? null : <p className="mt-0.5 text-sm text-fg-muted">{step.detail}</p>}
            </div>
            {step.done ? null : step.external ? (
              <a
                href={step.href}
                target="_blank"
                rel="noreferrer"
                className="col-start-2 text-sm text-accent underline-offset-4 hover:underline sm:col-start-3"
              >
                {step.action}
              </a>
            ) : (
              <Link
                href={step.href}
                className="col-start-2 text-sm text-accent underline-offset-4 hover:underline sm:col-start-3"
              >
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
