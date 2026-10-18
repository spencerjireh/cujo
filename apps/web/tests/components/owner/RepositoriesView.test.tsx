// @vitest-environment jsdom

import { RepositoriesView } from "@/components/owner/RepositoriesView";
import { ownerRuns } from "@/lib/fixtures";
import { repositories } from "@/lib/owner/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The repositories list (decision 175): a real switch that flips before the
 * server answers and back if it refuses, an undo after turning reviews off,
 * and each repository's newest run and open blocks beside it.
 */
const api = vi.hoisted(() => ({
  fetchRepositories: vi.fn(),
  fetchOwnerRuns: vi.fn(),
  setRepositoryEnabled: vi.fn(),
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

function mount() {
  api.fetchRepositories.mockResolvedValue(repositories);
  api.fetchOwnerRuns.mockResolvedValue({ runs: ownerRuns });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RepositoriesView />
    </QueryClientProvider>,
  );
}

const reviewsOn = (name: string) =>
  screen.getByRole("switch", { name: `Reviews on ${name}` }) as HTMLButtonElement;

describe("RepositoriesView (decision 175)", () => {
  it("shows the switch as a switch, and none on a repository the App lost", async () => {
    mount();
    await waitFor(() => expect(reviewsOn("spencerjireh/orders-api")).toBeTruthy());
    expect(reviewsOn("spencerjireh/orders-api").getAttribute("aria-checked")).toBe("true");
    expect(reviewsOn("spencerjireh/notes").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("switch", { name: "Reviews on spencerjireh/old" })).toBeNull();
    expect(screen.getByText("Not installed")).toBeTruthy();
  });

  it("counts open blocks from each pull request's newest run", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("2 blocked")).toBeTruthy());
  });

  it("turns reviews off at once, and undoes it from the toast", async () => {
    mount();
    await waitFor(() => expect(reviewsOn("spencerjireh/orders-api")).toBeTruthy());
    api.setRepositoryEnabled.mockResolvedValue({});
    // Flipped before the server has answered: the save below never resolves.
    let answer: (value: unknown) => void = () => {};
    api.setRepositoryEnabled.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    fireEvent.click(reviewsOn("spencerjireh/orders-api"));
    await waitFor(() =>
      expect(reviewsOn("spencerjireh/orders-api").getAttribute("aria-checked")).toBe("false"),
    );
    await act(async () => answer({}));
    await waitFor(() =>
      expect(screen.getByText("Reviews off for spencerjireh/orders-api.")).toBeTruthy(),
    );
    expect(api.setRepositoryEnabled).toHaveBeenCalledWith("spencerjireh/orders-api", false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(api.setRepositoryEnabled).toHaveBeenLastCalledWith("spencerjireh/orders-api", true);
  });

  it("flips back and says so when the save is refused", async () => {
    mount();
    await waitFor(() => expect(reviewsOn("spencerjireh/notes")).toBeTruthy());
    api.setRepositoryEnabled.mockRejectedValue(new Error("forbidden"));
    fireEvent.click(reviewsOn("spencerjireh/notes"));
    await waitFor(() =>
      expect(screen.getByText(/The switch did not save: forbidden/)).toBeTruthy(),
    );
    expect(reviewsOn("spencerjireh/notes").getAttribute("aria-checked")).toBe("false");
  });
});
