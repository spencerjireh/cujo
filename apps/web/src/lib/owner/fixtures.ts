import type {
  BotState,
  Health,
  InstanceSettingsView,
  OwnedRepository,
  ProviderModel,
} from "@/lib/api/owner-client";

/**
 * What the owner plane serves, for stories and tests (decision 175): one
 * configured instance and its variants, the App as GitHub sees it (short one
 * permission), and the repositories it holds. The runs are `ownerRuns` in
 * `lib/fixtures.ts`.
 */

export const instanceView: InstanceSettingsView = {
  settings: {
    model: "openrouter/glm-flash",
    modelReasoningEffort: "",
    modelTemperature: null,
    modelMaxTokens: null,
    diffModel: "openrouter/glm-flash",
    diffBudgetTokens: 400_000,
    sandboxBudgetTokens: 3_000_000,
    reviewMode: "sandbox",
    modelProviders: [
      {
        kind: "openai",
        name: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "****1234",
        models: [{ name: "glm-flash", modelId: "z-ai/glm-5.3-flash" }],
        contextWindow: 128_000,
        maxTokens: 16_384,
        reasoning: true,
      },
    ],
    turnTimeoutMs: 1_800_000,
    diffTimeoutMs: 600_000,
    diffBytes: 60_000,
    pushDebounceMs: 60_000,
    converseLimit: 3,
    converseWindowMs: 3_600_000,
    converseTimeoutMs: 600_000,
    ocrEnabled: false,
    executeDeclared: true,
    executeStepTimeoutMs: 900_000,
    executedReportBytes: 24_000,
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
    modelProviders: "seed",
    turnTimeoutMs: "owner",
    diffTimeoutMs: "seed",
    diffBytes: "seed",
    pushDebounceMs: "seed",
    converseLimit: "seed",
    converseWindowMs: "seed",
    converseTimeoutMs: "seed",
    ocrEnabled: "seed",
    executeDeclared: "seed",
    executeStepTimeoutMs: "seed",
    executedReportBytes: "seed",
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
    modelProviders: "provider",
    turnTimeoutMs: "limits",
    diffTimeoutMs: "limits",
    diffBytes: "limits",
    pushDebounceMs: "limits",
    converseLimit: "limits",
    converseWindowMs: "limits",
    converseTimeoutMs: "limits",
    ocrEnabled: "limits",
    executeDeclared: "limits",
    executeStepTimeoutMs: "limits",
    executedReportBytes: "limits",
  },
};

export const bot: BotState = {
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

export const health: Health = {
  harness: "ready",
  store: "ok",
  configured: true,
  uptimeMs: 5_400_000,
  ready: true,
};

/** A deploy that booted with no model: no providers, nothing chosen (decision 174). */
export const unconfigured: InstanceSettingsView = {
  ...instanceView,
  settings: { ...instanceView.settings, model: null, diffModel: null, modelProviders: [] },
};

/** Claude for the sandbox review, OpenRouter for the diff review. */
export const twoProviders: InstanceSettingsView = {
  ...instanceView,
  settings: {
    ...instanceView.settings,
    model: "anthropic/claude-sonnet-5",
    modelProviders: [
      { kind: "anthropic", name: "anthropic", apiKey: "****9f2a" },
      ...instanceView.settings.modelProviders,
    ],
  },
};

export const catalog: ProviderModel[] = [
  { id: "claude-haiku-4-5", contextWindow: 200_000, maxTokens: 64_000, costKnown: true },
  { id: "claude-sonnet-5", contextWindow: 1_000_000, maxTokens: 128_000, costKnown: true },
  { id: "claude-opus-5", contextWindow: 1_000_000, maxTokens: 128_000, costKnown: true },
];

export const repositories: OwnedRepository[] = [
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
