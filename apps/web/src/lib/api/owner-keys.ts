/** Query keys for the owner plane (decision 156). Shallow, like `runKeys`. */
export const ownerKeys = {
  all: ["owner"] as const,
  me: () => [...ownerKeys.all, "me"] as const,
  repositories: () => [...ownerKeys.all, "repositories"] as const,
  settings: (repo: string) => [...ownerKeys.all, "settings", repo.toLowerCase()] as const,
  instance: () => [...ownerKeys.all, "instance"] as const,
  bot: () => [...ownerKeys.all, "bot"] as const,
  health: () => [...ownerKeys.all, "health"] as const,
  runs: () => [...ownerKeys.all, "runs"] as const,
};
