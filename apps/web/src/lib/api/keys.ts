import type { Mode } from "./mode";

/**
 * Shallow on purpose: invalidating `runKeys.all` reaches the list and every
 * detail.
 *
 * The mode is part of the key, and that is load-bearing rather than tidiness.
 * `reduceRun` returns the *previous* object when a snapshot repeats, so a cache
 * entry filled on the operator plane — approver and all — could otherwise be
 * handed to a public render. Different keys make that unreachable.
 */
export const runKeys = {
  all: ["runs"] as const,
  list: (mode: Mode) => [...runKeys.all, mode, "list"] as const,
  detail: (mode: Mode, id: string) => [...runKeys.all, mode, "detail", id] as const,
};
