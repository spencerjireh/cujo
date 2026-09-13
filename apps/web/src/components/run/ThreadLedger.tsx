import type { LedgerThread, RunLedger } from "@/lib/api/types";
import { bytes, compactCount } from "@/lib/format";

/**
 * Where the tokens went (decision 141).
 *
 * The Cost section above says what the run spent; this says who spent it. A
 * model bills its whole context on every message, so a thread's cost is its
 * context times its messages, and the parent — which holds the rubric, the
 * brief and every report — is usually the largest row by a distance. The
 * split at the top says that in two figures; the table says it per thread;
 * the last table names the tool results that made the context large, by size
 * and never by content.
 *
 * A check the rubric respawned is two rows with the same title, numbered, so
 * a retry that cost as much as the first attempt reads as what it was.
 */

/** Rows that are the parent, and rows that are not. */
function split(threads: LedgerThread[]): { parent: LedgerThread | null; checks: LedgerThread[] } {
  const parent = threads.find((t) => t.title === "main") ?? null;
  return { parent, checks: threads.filter((t) => t !== parent) };
}

function billed(row: Pick<LedgerThread, "inputTokens" | "cacheReadTokens">): number {
  return row.inputTokens + row.cacheReadTokens;
}

export function ThreadLedger({ ledger }: { ledger?: RunLedger | null }) {
  // Absent, not zeroed, for the reason the Cost section has (decision 54).
  if (!ledger || ledger.threads.length === 0) return null;
  const { parent, checks } = split(ledger.threads);
  const parentBilled = parent ? billed(parent) : 0;
  const checksBilled = checks.reduce((sum, row) => sum + billed(row), 0);
  const total = parentBilled + checksBilled;

  return (
    <div aria-label="Where the tokens went" className="mb-4">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-[0.16em] text-fg">Ledger</h3>
      <p className="mb-3 max-w-[68ch] font-mono text-xs leading-relaxed text-fg-muted">
        Input tokens by thread, cache reads included. The parent re-reads everything it holds on
        every message; the checks read only their own.
      </p>
      {total > 0 ? (
        <dl className="mb-4 grid grid-cols-2 gap-x-6 font-mono text-xs">
          <div>
            <dt className="text-fg-muted">parent</dt>
            <dd className="mt-1 text-sm text-fg">
              {compactCount(parentBilled)}{" "}
              <span className="text-fg-muted">({Math.round((parentBilled / total) * 100)}%)</span>
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">checks</dt>
            <dd className="mt-1 text-sm text-fg">
              {compactCount(checksBilled)}{" "}
              <span className="text-fg-muted">({Math.round((checksBilled / total) * 100)}%)</span>
            </dd>
          </div>
        </dl>
      ) : null}
      <div className="overflow-x-auto">
        <table className="mb-4 w-full border-collapse font-mono text-xs">
          <caption className="mb-1 text-left text-fg-muted">By thread</caption>
          <thead>
            <tr className="text-left text-fg-muted">
              <th scope="col" className="py-1 pr-3 font-normal">
                thread
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                messages
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                input
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                cache read
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                output
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-normal">
                reasoning
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                tool results
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.threads.map((row, index) => (
              // The fold fixes the order, so the index is a stable key.
              <tr key={`${row.title}-${row.attempt}-${index}`} className="border-t border-line">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg">
                  {row.title}
                  {row.attempt > 1 ? <span className="text-fg-muted"> #{row.attempt}</span> : null}
                </th>
                <td className="py-1.5 pr-3 text-right text-fg-muted">{row.messages}</td>
                <td className="py-1.5 pr-3 text-right text-fg">{compactCount(row.inputTokens)}</td>
                <td className="py-1.5 pr-3 text-right text-fg-muted">
                  {compactCount(row.cacheReadTokens)}
                </td>
                <td className="py-1.5 pr-3 text-right text-fg">{compactCount(row.outputTokens)}</td>
                <td className="py-1.5 pr-3 text-right text-fg-muted">
                  {row.reasoningTokens === null ? "—" : compactCount(row.reasoningTokens)}
                </td>
                <td className="py-1.5 text-right text-fg-muted">{bytes(row.toolResultBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ledger.largestToolResults.length > 0 ? (
        <table className="w-full max-w-[68ch] border-collapse font-mono text-xs">
          <caption className="mb-1 text-left text-fg-muted">Largest tool results</caption>
          <tbody>
            {ledger.largestToolResults.map((result, index) => (
              <tr key={`${result.thread}-${result.tool}-${index}`} className="border-t border-line">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg-muted">
                  {result.thread}
                </th>
                <td className="py-1.5 pr-3 text-fg">{result.tool}</td>
                <td className="py-1.5 pr-3 text-right text-fg">{bytes(result.bytes)}</td>
                <td className="py-1.5 text-right text-fg-muted">{result.isError ? "error" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
