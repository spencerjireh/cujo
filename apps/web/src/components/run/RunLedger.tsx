import type { UsageTotals } from "@/lib/api/types";
import { compactCount, usd } from "@/lib/format";

/**
 * What the run cost.
 *
 * `apps/cujo` has summed this from every turn since commit 513d35f and nothing
 * rendered it. It belongs on the run page rather than the board for the reason
 * the serializer already decided: a list of every run is not the place for a
 * token count, and here it answers a question a reader actually has — this
 * review executed a pull request in a sandbox, so what did that take.
 *
 * The same shape as the rack under the chamber: the distribution drawn, the
 * numbers beside it, never a big figure with a caption. Cache reads dominate by
 * an order of magnitude on a long run, which is the interesting part and the
 * part a row of four equal-weight numbers would hide.
 *
 * It lives inside the operator details fold now and not as a section of its
 * own (decision 89): a token count is context for an operator, and a PR author
 * reading down the page met it before they met who produced the verdict. The
 * labels say what the numbers are — "model input", "messages to the model" —
 * because on a public page a bare "input" is a number nobody can read.
 */

interface Slice {
  key: keyof UsageTotals;
  label: string;
  className: string;
}

/**
 * Four tones and not four hues. Input and output are the work; the two cache
 * figures are the same tokens read back cheaply, so they sit at reduced
 * strength rather than competing with the ones that were paid for in full.
 */
const SLICES: Slice[] = [
  { key: "inputTokens", label: "model input, tokens", className: "bg-fg" },
  { key: "outputTokens", label: "model output, tokens", className: "bg-accent-fill" },
  { key: "cacheReadTokens", label: "read from cache", className: "bg-fg-muted opacity-60" },
  { key: "cacheWriteTokens", label: "written to cache", className: "bg-fg-muted opacity-30" },
];

export function RunLedger({ usage }: { usage?: UsageTotals | null }) {
  // Absent, not zeroed. A run recorded before the field existed did not cost
  // nothing — it has no record, and drawing four empty bars would say the
  // first thing while meaning the second (decision 54).
  if (!usage) return null;

  const counts = SLICES.map((slice) => ({ ...slice, value: Number(usage[slice.key] ?? 0) }));
  const total = counts.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return null;

  return (
    <div aria-label="What this run cost" className="border-line border-t pt-4">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-[0.16em] text-fg">Cost</h3>
      <p className="mb-3 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        What the run spent to reach the verdict. Context for it, never an argument for it.
      </p>
      <div className="flex h-2 w-full gap-px overflow-hidden" aria-hidden="true">
        {counts.map((slice) =>
          slice.value > 0 ? (
            <span
              key={slice.key}
              className={`min-w-0.5 ${slice.className}`}
              style={{ width: `${(slice.value / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-xs sm:grid-cols-4">
        {counts.map((slice) => (
          <div key={slice.key}>
            <dt className="flex items-baseline gap-2 text-fg-muted">
              <span className={`h-2 w-2 shrink-0 translate-y-px ${slice.className}`} />
              {slice.label}
            </dt>
            <dd className="mt-1 text-sm text-fg">{compactCount(slice.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 mb-4 font-mono text-xs text-fg-muted">
        {usage.messages} {usage.messages === 1 ? "message" : "messages"} to the model
        {typeof usage.reasoningTokens === "number"
          ? ` · ${compactCount(usage.reasoningTokens)} tokens spent reasoning`
          : ""}
        {/* The provider's own estimate, said to be one. Cujo does not price
            anything and must not look as though it did. */}
        {typeof usage.costUsd === "number" ? ` · ${usd(usage.costUsd)} estimated` : ""}
      </p>
    </div>
  );
}
