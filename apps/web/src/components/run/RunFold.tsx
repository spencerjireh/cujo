"use client";

import { Chevron } from "@/components/icons/Chevron";
import * as Collapsible from "@radix-ui/react-collapsible";
import type { ReactNode } from "react";

/**
 * A section of the run page below the verdict, folded until asked for
 * (decision 175). A reader from GitHub came for the verdict and what to do;
 * the timeline and the evidence behind it are one click away, with a line on
 * the closed fold saying what is inside. The heading holds the button, so the
 * outline of the page still reads as its sections.
 */
export function RunFold({
  title,
  summary,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} asChild>
      <section className="border-t border-line">
        <h2 className="text-lg">
          <Collapsible.Trigger className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 py-3 text-left hover:bg-bg-raised">
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span>{title}</span>
              {summary ? (
                <span className="font-ui text-sm font-normal text-fg-muted">{summary}</span>
              ) : null}
            </span>
            <Chevron open={open} className="text-fg-muted" />
          </Collapsible.Trigger>
        </h2>
        <Collapsible.Content className="pt-1 pb-6">{children}</Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}
