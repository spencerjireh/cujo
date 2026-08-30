"use client";

import { Chevron } from "@/components/icons/Chevron";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useState } from "react";
import { RawJson } from "./RawJson";

/**
 * The report as the sandbox wrote it.
 *
 * The tables above are a reading of the report, not the report. Anything they
 * have no column for — the output tails, the per-check fields, a field added by
 * a sandbox newer than this build — is only here. Closed by default; it is the
 * fallback, not the view.
 *
 * It was a native `<details>` with a `cursor-pointer` summary, which is a third
 * disclosure pattern on a page that now has one: the check card and the
 * provenance section are both a Collapsible with a `Chevron` and a row that is
 * the whole control. The sensor health that used to sit under this disclosure
 * is `SensorStatus`, said once above the blocks, where a reader looks for it.
 */
export function RawReport({ raw }: { raw: unknown }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-6 border-t border-line">
      <Collapsible.Trigger className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 py-2 text-left hover:bg-bg-raised">
        <span className="font-mono text-xs text-fg-muted">Raw report</span>
        <Chevron open={open} className="text-fg-muted" />
      </Collapsible.Trigger>
      <Collapsible.Content className="pb-2">
        <RawJson value={raw} />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
