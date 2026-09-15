import type { OwnedRepository } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RepositoriesView } from "./RepositoriesView";

const rows: OwnedRepository[] = [
  {
    repo: "spencerjireh/orders-api",
    displayName: "spencerjireh/orders-api",
    installationId: 1,
    isPrivate: false,
    enabled: true,
    addedAt: "2026-09-01T10:00:00Z",
    removedAt: null,
    updatedAt: "2026-09-01T10:00:00Z",
  },
  {
    repo: "spencerjireh/cujo",
    displayName: "spencerjireh/cujo",
    installationId: 1,
    isPrivate: false,
    enabled: true,
    addedAt: "2026-09-01T10:00:00Z",
    removedAt: null,
    updatedAt: "2026-09-01T10:00:00Z",
  },
  {
    repo: "spencerjireh/notes",
    displayName: "spencerjireh/notes",
    installationId: 1,
    isPrivate: true,
    enabled: false,
    addedAt: "2026-08-20T10:00:00Z",
    removedAt: null,
    updatedAt: "2026-09-10T10:00:00Z",
  },
  {
    repo: "spencerjireh/old",
    displayName: "spencerjireh/old",
    installationId: 1,
    isPrivate: false,
    enabled: true,
    addedAt: "2026-07-01T10:00:00Z",
    removedAt: "2026-09-12T10:00:00Z",
    updatedAt: "2026-09-12T10:00:00Z",
  },
];

function withRepositories(seed: OwnedRepository[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(ownerKeys.repositories(), seed);
  return function Decorated(Story: () => React.ReactElement) {
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof RepositoriesView> = {
  title: "Owner/RepositoriesView",
  component: RepositoriesView,
};
export default meta;
type Story = StoryObj<typeof RepositoriesView>;

/** Three held, one lost: the lost one dimmed and dated, its switch still shown. */
export const Installed: Story = { decorators: [withRepositories(rows)] };
/** A fresh instance before the App is on anything. */
export const Empty: Story = { decorators: [withRepositories([])] };
