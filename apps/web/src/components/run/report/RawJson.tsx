"use client";

import { useMemo } from "react";
import { VirtualRows } from "./VirtualRows";

/**
 * The fallback for a report that matches no known shape. It must never be the
 * reason a page fails to render, so serialization is guarded and the output is
 * windowed by line — a multi-megabyte report should not freeze the tab.
 */
export function RawJson({ value }: { value: unknown }) {
  const lines = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2).split("\n");
    } catch {
      return [String(value)];
    }
  }, [value]);

  return (
    <div className="mt-2 rounded-md bg-bg-raised p-3">
      <VirtualRows items={lines} estimateSize={20} threshold={80}>
        {(line, index) => (
          <pre
            key={`${index}-${line.slice(0, 12)}`}
            className="whitespace-pre font-mono text-xs leading-5 text-fg-muted"
          >
            {line}
          </pre>
        )}
      </VirtualRows>
    </div>
  );
}
