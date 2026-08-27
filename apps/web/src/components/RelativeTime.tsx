"use client";

import { absoluteTime, relativeTime } from "@/lib/format";
import { useEffect, useState } from "react";

/**
 * "3 minutes ago", but only once the page is interactive.
 *
 * A relative time reads the clock, and the server's clock is not the browser's,
 * so rendering it during the first pass is a guaranteed hydration mismatch.
 * Until the effect runs, both sides render the same absolute string derived
 * from the ISO value alone. The `<time>` element keeps the exact instant
 * available to assistive technology either way.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => setLabel(relativeTime(iso)), [iso]);
  return <time dateTime={iso}>{label ?? absoluteTime(iso)}</time>;
}
