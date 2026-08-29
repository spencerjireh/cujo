/**
 * Shallow on purpose: invalidating `runKeys.all` reaches the list and every
 * detail.
 *
 * The mode used to be part of every key, because `reduceRun` returns the
 * *previous* object when a snapshot repeats and an entry filled on the
 * operator plane could otherwise be handed to a public render. There is one
 * plane since decision 57, so there is one cache and nothing to keep apart.
 */
export const runKeys = {
  all: ["runs"] as const,
  list: () => [...runKeys.all, "list"] as const,
  detail: (id: string) => [...runKeys.all, "detail", id] as const,
};
