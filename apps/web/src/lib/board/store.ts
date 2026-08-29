/**
 * Which run the pointer is on, and which one was picked, shared by the chamber
 * and the record.
 *
 * A store rather than lifted state: the chamber writes this from a raycast
 * inside a `requestAnimationFrame` loop, and routing that through a React
 * setState on the page would re-render the whole record on every pointer move
 * across the canvas. Here only the two subscribers that read it re-render.
 *
 * Two fields and not one, because they are two different claims. `runId` is
 * transient — where the pointer is right now, on either drawing — and it
 * survives nothing. `selectedId` is a decision: a specimen was clicked, the
 * record scrolled to its row, and that row stays marked until something else is
 * picked or Escape clears it. Collapsing them would make a hover erase a
 * selection the moment the pointer left the canvas, which is exactly when the
 * reader is looking at the row it scrolled to.
 *
 * `@tanstack/react-store` was already a dependency.
 */

import { Store, useStore } from "@tanstack/react-store";

interface FocusState {
  /** Hover, from either the chamber or a record row. */
  runId: string | null;
  /** The run a click in the chamber sent the record to. */
  selectedId: string | null;
}

export const focusStore = new Store<FocusState>({ runId: null, selectedId: null });

export function setFocusedRun(runId: string | null): void {
  if (focusStore.state.runId === runId) return;
  focusStore.setState((state) => ({ ...state, runId }));
}

export function useFocusedRun(): string | null {
  return useStore(focusStore, (state) => state.runId);
}

/**
 * Picking the run that is already picked clears it, so a second click on the
 * same specimen is an undo rather than a no-op. Nothing else in the chamber can
 * unpick one — the canvas is `aria-hidden` and has no other control.
 */
export function setSelectedRun(selectedId: string | null): void {
  focusStore.setState((state) => ({
    ...state,
    selectedId: state.selectedId === selectedId ? null : selectedId,
  }));
}

export function clearSelectedRun(): void {
  if (focusStore.state.selectedId === null) return;
  focusStore.setState((state) => ({ ...state, selectedId: null }));
}

export function useSelectedRun(): string | null {
  return useStore(focusStore, (state) => state.selectedId);
}
