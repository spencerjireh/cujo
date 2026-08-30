import { THEME_STORAGE_KEY } from "@/lib/theme";
import { chooseTheme, hydrateTheme, themeStore } from "@/lib/theme-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The theme store, which is what makes two toggles one control.
 *
 * This suite runs in node with no DOM by design (see vitest.config.ts), and
 * `applyTheme` writes to `document.documentElement` and `localStorage`. Both
 * are stubbed here rather than pulling in jsdom for two methods: what is under
 * test is the store's own behaviour — hydrating once, recording whether the
 * write stuck, and holding one value for every subscriber — and the document is
 * only the thing it writes through. The rendered toggles are covered in
 * Storybook and in the browser, as every other component in this app is.
 */

const INITIAL = { choice: "system", persisted: true, hydrated: false } as const;

/** The two `documentElement` methods `applyTheme` reaches for, and nothing else. */
function fakeDocument() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
  };
}

function fakeStorage(failing = false) {
  const items = new Map<string, string>();
  return {
    items,
    setItem: (key: string, value: string) => {
      if (failing) throw new Error("site data is blocked");
      items.set(key, value);
    },
    removeItem: (key: string) => {
      if (failing) throw new Error("site data is blocked");
      items.delete(key);
    },
  };
}

let doc = fakeDocument();
let store = fakeStorage();

beforeEach(() => {
  themeStore.setState(() => ({ ...INITIAL }));
  doc = fakeDocument();
  store = fakeStorage();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("localStorage", store);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hydrateTheme", () => {
  it("reads the choice the blocking script already applied", () => {
    // `layout.tsx` sets `data-theme` before first paint, so the attribute is
    // the answer and storage need not be read a second time.
    doc.attributes.set("data-theme", "dark");
    hydrateTheme();
    expect(themeStore.state.choice).toBe("dark");
    expect(themeStore.state.hydrated).toBe(true);
  });

  it("follows the system when no attribute was applied", () => {
    hydrateTheme();
    expect(themeStore.state.choice).toBe("system");
  });

  it("runs once, so the second toggle to mount does not undo a choice", () => {
    // Both toggles call this on mount. If the later one re-read the document
    // it would be harmless, but if a choice were made between the two mounts
    // it would overwrite it — so hydration is once per page, not per control.
    hydrateTheme();
    chooseTheme("light");
    doc.attributes.set("data-theme", "dark");
    hydrateTheme();
    expect(themeStore.state.choice).toBe("light");
  });
});

describe("chooseTheme", () => {
  it("writes the attribute and the stored value together", () => {
    chooseTheme("dark");
    expect(doc.attributes.get("data-theme")).toBe("dark");
    expect(store.items.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(themeStore.state.choice).toBe("dark");
    expect(themeStore.state.persisted).toBe(true);
  });

  it("removes the attribute and the stored value for system", () => {
    // "system" is the absence of both, never `data-theme="system"`: the tokens
    // key their dark block off `:root:not([data-theme="light"])`, so a value
    // the CSS does not know would pin a dark machine to light.
    chooseTheme("dark");
    chooseTheme("system");
    expect(doc.attributes.has("data-theme")).toBe(false);
    expect(store.items.has(THEME_STORAGE_KEY)).toBe(false);
    expect(themeStore.state.choice).toBe("system");
  });

  it("records a choice that applied but did not persist", () => {
    // A private window and a browser told to block site data both throw on the
    // write. Neither is a reason to refuse the theme change — the page still
    // switches, it just cannot remember, and both toggles have to say so.
    store = fakeStorage(true);
    vi.stubGlobal("localStorage", store);
    chooseTheme("light");
    expect(doc.attributes.get("data-theme")).toBe("light");
    expect(themeStore.state.choice).toBe("light");
    expect(themeStore.state.persisted).toBe(false);
  });
});

describe("two toggles, one control", () => {
  it("gives every subscriber the same choice from either control", () => {
    // The bug this store exists to prevent: `ThemeToggle` held the choice in
    // its own state, so the footer control switching to dark left the header
    // control still rendering "system".
    const header: string[] = [];
    const footer: string[] = [];
    const unsubHeader = themeStore.subscribe(() => header.push(themeStore.state.choice));
    const unsubFooter = themeStore.subscribe(() => footer.push(themeStore.state.choice));

    chooseTheme("dark");
    chooseTheme("light");

    expect(header).toEqual(["dark", "light"]);
    expect(footer).toEqual(["dark", "light"]);
    unsubHeader.unsubscribe();
    unsubFooter.unsubscribe();
  });

  it("stops notifying once a control unmounts", () => {
    const seen: string[] = [];
    const subscription = themeStore.subscribe(() => seen.push(themeStore.state.choice));
    chooseTheme("dark");
    subscription.unsubscribe();
    chooseTheme("light");
    expect(seen).toEqual(["dark"]);
  });
});
