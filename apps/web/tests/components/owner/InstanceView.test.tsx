// @vitest-environment jsdom

import { InstanceView } from "@/components/owner/InstanceView";
import type { Health, InstanceSettingsView } from "@/lib/api/owner-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The instance page's model half (decision 174): the banner a deploy with no
 * model shows, the provider list, the test button, and the picker.
 */
const api = vi.hoisted(() => ({
  fetchInstanceSettings: vi.fn(),
  fetchBot: vi.fn(),
  fetchHealth: vi.fn(),
  saveInstanceSettings: vi.fn(),
  listProviderModels: vi.fn(),
  testProvider: vi.fn(),
}));
vi.mock("@/lib/api/owner-client", () => api);

const groups = {} as InstanceSettingsView["groups"];
const sources = {} as InstanceSettingsView["sources"];

function view(settings: Partial<InstanceSettingsView["settings"]> = {}): InstanceSettingsView {
  return {
    settings: {
      model: "openrouter/glm",
      modelReasoningEffort: "",
      modelTemperature: null,
      modelMaxTokens: null,
      diffModel: null,
      diffBudgetTokens: 400_000,
      sandboxBudgetTokens: 3_000_000,
      reviewMode: "sandbox",
      modelProviders: [
        {
          kind: "openai",
          name: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "****1234",
          models: [{ name: "glm", modelId: "z-ai/glm-5.3-flash" }],
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
      ...settings,
    },
    sources,
    groups,
  };
}

const health = (configured: boolean): Health => ({
  harness: "ready",
  store: "ok",
  configured,
  uptimeMs: 60_000,
  ready: true,
});

afterEach(() => {
  cleanup();
  for (const fn of Object.values(api)) fn.mockReset();
});

function mount(settings: InstanceSettingsView, configured = true) {
  api.fetchInstanceSettings.mockResolvedValue(settings);
  api.fetchHealth.mockResolvedValue(health(configured));
  api.fetchBot.mockRejectedValue(new Error("no App"));
  api.listProviderModels.mockResolvedValue([{ id: "claude-sonnet-5", costKnown: true }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InstanceView />
    </QueryClientProvider>,
  );
}

describe("InstanceView models (decision 174)", () => {
  it("says no model is configured while the instance has none", async () => {
    mount(view({ model: null, modelProviders: [] }), false);
    await waitFor(() => expect(screen.getByText(/No model is configured/)).toBeTruthy());
    expect(screen.getByText("No provider yet.")).toBeTruthy();
  });

  it("adds an Anthropic provider beside the saved one, masked key kept as served", async () => {
    mount(view());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Anthropic" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add Anthropic" }));
    expect(
      (screen.getByRole("button", { name: "Add Anthropic" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const keys = screen.getAllByLabelText("api key") as HTMLInputElement[];
    expect(keys.map((k) => k.value)).toEqual(["****1234", ""]);
    fireEvent.change(keys[1] as HTMLInputElement, { target: { value: "sk-ant-new" } });
    api.saveInstanceSettings.mockResolvedValue(view());
    fireEvent.click(screen.getByRole("button", { name: "Save providers" }));
    await waitFor(() => expect(api.saveInstanceSettings).toHaveBeenCalled());
    expect(api.saveInstanceSettings.mock.calls[0]?.[0]).toEqual({
      modelProviders: [
        expect.objectContaining({ kind: "openai", name: "openrouter", apiKey: "****1234" }),
        { kind: "anthropic", name: "anthropic", apiKey: "sk-ant-new" },
      ],
    });
  });

  it("tests what is typed and shows the answer", async () => {
    mount(view({ modelProviders: [{ kind: "anthropic", name: "anthropic", apiKey: "****9f2a" }] }));
    api.testProvider.mockResolvedValue({ ok: true, latencyMs: 9 });
    const button = await screen.findByRole("button", { name: "Test claude-haiku-4-5" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("ok · 9 ms")).toBeTruthy());
    expect(api.testProvider).toHaveBeenCalledWith(
      { kind: "anthropic", name: "anthropic", apiKey: "****9f2a" },
      "claude-haiku-4-5",
    );
  });

  it("offers the catalog and the declared models in the picker, and sends an empty diff model as null", async () => {
    const { container } = mount(
      view({
        modelProviders: [
          { kind: "anthropic", name: "anthropic", apiKey: "****9f2a" },
          ...view().settings.modelProviders,
        ],
      }),
    );
    await waitFor(() =>
      expect(container.querySelector('option[value="anthropic/claude-sonnet-5"]')).toBeTruthy(),
    );
    expect(container.querySelector('option[value="openrouter/glm"]')).toBeTruthy();
    api.saveInstanceSettings.mockResolvedValue(view());
    fireEvent.click(screen.getByRole("button", { name: "Save models" }));
    await waitFor(() => expect(api.saveInstanceSettings).toHaveBeenCalled());
    expect(api.saveInstanceSettings.mock.calls[0]?.[0]).toMatchObject({
      model: "openrouter/glm",
      diffModel: null,
    });
  });
});
