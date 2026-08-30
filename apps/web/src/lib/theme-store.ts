/**
 * Which theme is chosen, shared by every toggle on the page.
 *
 * A store rather than state inside `ThemeToggle`, because there are two of them
 * now — one in the header and one in the footer — and the choice is a property
 * of the document, not of either control. With local state the second toggle's
 * thumb sat under whatever the first one had left, so a reader who switched to
 * dark in the footer scrolled up to a header still claiming "system".
 *
 * `applyTheme` remains the thing that writes `data-theme` and `localStorage`;
 * this only holds what the controls render from. `@tanstack/react-store` was
 * already a dependency, and `lib/board/store.ts` is the same pattern.
 */

import { Store, useStore } from "@tanstack/react-store";
import { type ThemeChoice, applyTheme, choiceFromAttribute } from "./theme";

interface ThemeState {
  choice: ThemeChoice;
  /** False once a choice applied but did not persist. Both toggles say so. */
  persisted: boolean;
  /**
   * Whether the stored choice has been read back off the document yet. The
   * first correction must not animate — a stored dark would otherwise slide
   * every thumb across its track on load — and only the first toggle to mount
   * does the reading.
   */
  hydrated: boolean;
}

export const themeStore = new Store<ThemeState>({
  choice: "system",
  persisted: true,
  hydrated: false,
});

/**
 * Seed from the document, once per page. The blocking script in `layout.tsx`
 * has already applied the stored choice by the time this runs, so the attribute
 * is the answer and `localStorage` need not be read a second time.
 */
export function hydrateTheme(): void {
  if (themeStore.state.hydrated) return;
  const choice = choiceFromAttribute(document.documentElement.getAttribute("data-theme"));
  themeStore.setState((state) => ({ ...state, choice, hydrated: true }));
}

/** Applies the choice to the document, then records what happened. */
export function chooseTheme(choice: ThemeChoice): void {
  const persisted = applyTheme(choice);
  themeStore.setState((state) => ({ ...state, choice, persisted }));
}

export function useThemeState(): ThemeState {
  return useStore(themeStore);
}
