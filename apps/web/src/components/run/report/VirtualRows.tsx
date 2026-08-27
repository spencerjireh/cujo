"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";

/**
 * A detonation report can carry thousands of egress or filesystem rows, so
 * these lists are windowed. Everything shorter than `threshold` renders plainly
 * — virtualizing a six-row table costs more than it saves and breaks find-in-page.
 */
export function VirtualRows<T>({
  items,
  estimateSize = 32,
  threshold = 40,
  maxHeight = 420,
  children,
}: {
  items: T[];
  estimateSize?: number;
  threshold?: number;
  maxHeight?: number;
  children: (item: T, index: number) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 12,
    enabled: items.length > threshold,
  });

  if (items.length <= threshold) {
    return <div className="overflow-x-auto">{items.map((item, i) => children(item, i))}</div>;
  }

  return (
    <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (item === undefined) return null;
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {children(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
