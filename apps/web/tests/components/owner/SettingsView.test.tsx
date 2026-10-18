// @vitest-environment jsdom

import { SettingsView } from "@/components/owner/settings/SettingsView";
import type { InstanceSettingsView } from "@/lib/api/owner-client";
import { bot, health, instanceView, repositories } from "@/lib/owner/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Settings as one form (decision 175): no save bar until something differs,
 * one PATCH with only what changed across every section, Discard to go back,
 * and the setup steps while one is left.
 */
const api = vi.hoisted(() => ({
  fetchInstanceSettings: vi.fn(),
  fetchBot: vi.fn(),
  fetchHealth: vi.fn(),
  fetchRepositories: vi.fn(),
  saveInstanceSettings: vi.fn(),
  listProviderModels: vi.fn(),
  testProvider: vi.fn(),
}));
vi.mock("@/lib/api/owner-client", () => api);
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  for (const fn of Object.values(api)) fn.mockReset();
});

function mount(view: InstanceSettingsView = instanceView, configured = true) {
  api.fetchInstanceSettings.mockResolvedValue(view);
  api.fetchHealth.mockResolvedValue({ ...health, configured });
  api.fetchBot.mockResolvedValue(bot);
  api.fetchRepositories.mockResolvedValue(repositories);
  api.listProviderModels.mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsView />
    </QueryClientProvider>,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("SettingsView (decision 175)", () => {
  it("draws no save bar until a value differs from what was saved", async () => {
    mount();
    await waitFor(() => expect(field("Model for full reviews").value).toBe("openrouter/glm-flash"));
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.change(field("Model for full reviews"), { target: { value: "openrouter/other" } });
    expect(screen.getByText("You have unsaved changes.")).toBeTruthy();
    fireEvent.change(field("Model for full reviews"), {
      target: { value: "openrouter/glm-flash" },
    });
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("saves edits from two sections in one call, with only the keys that changed", async () => {
    mount();
    await waitFor(() => expect(field("Model for full reviews")).toBeTruthy());
    fireEvent.change(field("Model for diff reviews"), { target: { value: "" } });
    fireEvent.change(field("Time limit, full review"), { target: { value: "900" } });
    api.saveInstanceSettings.mockResolvedValue(instanceView);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.saveInstanceSettings).toHaveBeenCalledTimes(1));
    expect(api.saveInstanceSettings.mock.calls[0]?.[0]).toEqual({
      diffModel: null,
      turnTimeoutMs: 900_000,
    });
    await waitFor(() => expect(screen.getByText("Settings saved.")).toBeTruthy());
  });

  it("discards back to what was saved", async () => {
    mount();
    await waitFor(() => expect(field("Model for full reviews")).toBeTruthy());
    fireEvent.change(field("Model for full reviews"), { target: { value: "x/y" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(field("Model for full reviews").value).toBe("openrouter/glm-flash");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("adds an Anthropic provider and keeps the served key masked", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Anthropic" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add Anthropic" }));
    const keys = screen.getAllByLabelText("API key") as HTMLInputElement[];
    expect(keys.map((k) => k.value)).toEqual(["****1234", ""]);
    fireEvent.change(keys[1] as HTMLInputElement, { target: { value: "sk-ant-new" } });
    api.saveInstanceSettings.mockResolvedValue(instanceView);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.saveInstanceSettings).toHaveBeenCalled());
    expect(api.saveInstanceSettings.mock.calls[0]?.[0]).toEqual({
      modelProviders: [
        expect.objectContaining({ kind: "openai", name: "openrouter", apiKey: "****1234" }),
        { kind: "anthropic", name: "anthropic", apiKey: "sk-ant-new" },
      ],
    });
  });

  it("tests what is typed and says whether it works", async () => {
    mount({
      ...instanceView,
      settings: {
        ...instanceView.settings,
        modelProviders: [{ kind: "anthropic", name: "anthropic", apiKey: "****9f2a" }],
      },
    });
    api.testProvider.mockResolvedValue({ ok: true, latencyMs: 9 });
    fireEvent.click(await screen.findByRole("button", { name: "Test claude-haiku-4-5" }));
    await waitFor(() => expect(screen.getByText("Works, answered in 9 ms")).toBeTruthy());
  });

  it("shows the setup steps while one is left", async () => {
    mount();
    // The fixture App holds checks:read where checks:write is needed.
    await waitFor(() => expect(screen.getByText("Finish setting up")).toBeTruthy());
    expect(screen.getAllByText(/checks \(write, holds read\)/).length).toBeGreaterThan(0);
  });
});
