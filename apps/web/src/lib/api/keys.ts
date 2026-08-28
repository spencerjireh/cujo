/** Shallow on purpose: invalidating `runKeys.all` reaches the list and every detail. */
export const runKeys = {
  all: ["runs"] as const,
  list: () => [...runKeys.all, "list"] as const,
  detail: (id: string) => [...runKeys.all, "detail", id] as const,
};
