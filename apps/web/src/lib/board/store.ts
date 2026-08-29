/**
 * Which run the pointer is on, shared by the chamber and the record.
 *
 * A store rather than lifted state: the chamber writes this from a raycast
 * inside a `requestAnimationFrame` loop, and routing that through a React
 * setState on the page would re-render the whole record on every pointer move
 * across the canvas. Here only the two subscribers that read it re-render.
 *
 * `@tanstack/react-store` was already a dependency.
 */

import { Store, useStore } from "@tanstack/react-store";

export const focusStore = new Store<{ runId: string | null }>({ runId: null });

export function setFocusedRun(runId: string | null): void {
  if (focusStore.state.runId === runId) return;
  focusStore.setState(() => ({ runId }));
}

export function useFocusedRun(): string | null {
  return useStore(focusStore, (state) => state.runId);
}
