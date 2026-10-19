"use client";

import type { ToastMessage } from "@/components/ui/Toast";
import { type OwnedRepository, setRepositoryEnabled } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * A repository's reviews switch (decisions 151, 175). It flips at once, before
 * the server answers, and flips back if the save fails. Turning reviews off
 * stops everything Cujo does on a repository, so it says so in a toast with an
 * undo, rather than asking first: the common case is a deliberate click, and
 * an undo costs that click nothing.
 */
export function useRepositorySwitch(show: (toast: ToastMessage) => void) {
  const client = useQueryClient();
  const key = ownerKeys.repositories();
  const mutation = useMutation({
    mutationFn: ({ repo, enabled }: { repo: string; name: string; enabled: boolean }) =>
      setRepositoryEnabled(repo, enabled),
    onMutate: async ({ repo, enabled }) => {
      await client.cancelQueries({ queryKey: key });
      const prior = client.getQueryData<OwnedRepository[]>(key);
      client.setQueryData<OwnedRepository[]>(key, (rows) =>
        rows?.map((row) => (row.repo === repo ? { ...row, enabled } : row)),
      );
      return { prior };
    },
    onError: (_error, _variables, context) => {
      if (context?.prior) client.setQueryData(key, context.prior);
    },
    onSuccess: (_data, { repo, name, enabled }) => {
      if (enabled) return;
      show({
        message: `Reviews off for ${name}.`,
        action: {
          label: "Undo",
          run: () => mutation.mutate({ repo, name, enabled: true }),
        },
      });
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  return mutation;
}
