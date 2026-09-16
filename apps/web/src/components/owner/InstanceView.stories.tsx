import type { BotState, Health, InstanceSettingsView } from "@/lib/api/owner-client";
import { ownerKeys } from "@/lib/api/owner-keys";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InstanceView } from "./InstanceView";

const settings: InstanceSettingsView = {
  settings: {
    model: "openrouter/glm-flash",
    modelReasoningEffort: "",
    modelTemperature: null,
    modelMaxTokens: null,
    diffModel: "openrouter/glm-flash",
    diffBudgetTokens: 400_000,
    sandboxBudgetTokens: 3_000_000,
    reviewMode: "sandbox",
    modelProvider: {
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "****1234",
      models: [{ name: "glm-flash", modelId: "z-ai/glm-5.3-flash" }],
      contextWindow: 128_000,
      maxTokens: 16_384,
      reasoning: true,
    },
    turnTimeoutMs: 1_800_000,
    diffTimeoutMs: 600_000,
    diffBytes: 60_000,
    pushDebounceMs: 60_000,
    converseLimit: 3,
    converseWindowMs: 3_600_000,
    converseTimeoutMs: 600_000,
    ocrEnabled: false,
  },
  sources: {
    model: "owner",
    modelReasoningEffort: "seed",
    modelTemperature: "seed",
    modelMaxTokens: "seed",
    diffModel: "seed",
    diffBudgetTokens: "seed",
    sandboxBudgetTokens: "seed",
    reviewMode: "seed",
    modelProvider: "seed",
    turnTimeoutMs: "owner",
    diffTimeoutMs: "seed",
    diffBytes: "seed",
    pushDebounceMs: "seed",
    converseLimit: "seed",
    converseWindowMs: "seed",
    converseTimeoutMs: "seed",
    ocrEnabled: "seed",
  },
  groups: {
    model: "models",
    modelReasoningEffort: "models",
    modelTemperature: "models",
    modelMaxTokens: "models",
    diffModel: "models",
    diffBudgetTokens: "models",
    sandboxBudgetTokens: "models",
    reviewMode: "models",
    modelProvider: "provider",
    turnTimeoutMs: "limits",
    diffTimeoutMs: "limits",
    diffBytes: "limits",
    pushDebounceMs: "limits",
    converseLimit: "limits",
    converseWindowMs: "limits",
    converseTimeoutMs: "limits",
    ocrEnabled: "limits",
  },
};

const bot: BotState = {
  app: {
    slug: "cujo-guard",
    name: "Cujo",
    htmlUrl: "https://github.com/apps/cujo-guard",
    permissions: {},
    events: ["pull_request"],
  },
  permissions: [
    { name: "contents", needed: "read", held: "read", ok: true },
    { name: "metadata", needed: "read", held: "read", ok: true },
    { name: "pull_requests", needed: "write", held: "write", ok: true },
    { name: "checks", needed: "write", held: "read", ok: false },
    { name: "issues", needed: "read", held: "read", ok: true },
  ],
  installations: [
    {
      id: 1,
      account: { login: "spencerjireh", type: "User" },
      suspended: false,
      repositorySelection: "selected",
      repositories: 3,
    },
    {
      id: 2,
      account: { login: "acme", type: "Organization" },
      suspended: true,
      repositorySelection: "all",
      repositories: 0,
    },
  ],
  deliveries: [
    {
      id: 3,
      event: "pull_request",
      action: "synchronize",
      deliveredAt: "2026-09-16T09:58:00Z",
      status: "OK",
      statusCode: 202,
      durationS: 0.3,
      redelivery: false,
    },
    {
      id: 2,
      event: "issue_comment",
      action: "created",
      deliveredAt: "2026-09-16T09:40:00Z",
      status: "OK",
      statusCode: 200,
      durationS: 0.1,
      redelivery: false,
    },
    {
      id: 1,
      event: "pull_request",
      action: "opened",
      deliveredAt: "2026-09-16T09:00:00Z",
      status: "Invalid HTTP Response: 503",
      statusCode: 503,
      durationS: 0.2,
      redelivery: true,
    },
  ],
};

const health: Health = { harness: "ready", store: "ok", uptimeMs: 5_400_000, ready: true };

function seeded(over: { bot?: BotState; health?: Health } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, refetchInterval: false },
    },
  });
  client.setQueryData(ownerKeys.instance(), settings);
  client.setQueryData(ownerKeys.bot(), over.bot ?? bot);
  client.setQueryData(ownerKeys.health(), over.health ?? health);
  return function Decorated(Story: () => React.ReactElement) {
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof InstanceView> = { title: "Owner/InstanceView", component: InstanceView };
export default meta;
type Story = StoryObj<typeof InstanceView>;

/** Everything answered; the App is short one permission. */
export const Ready: Story = { decorators: [seeded()] };
/** The harness is still registering its settings. */
export const Bootstrapping: Story = {
  decorators: [
    seeded({ health: { harness: "bootstrapping", store: "ok", uptimeMs: 12_000, ready: false } }),
  ],
};
