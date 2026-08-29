/**
 * The theme vocabulary, kept out of the component so the two places that speak
 * it stay in step: this module, and the blocking script in `app/layout.tsx`
 * that applies a stored choice before first paint.
 *
 * Three states, matching brand/tokens.css exactly: no attribute follows the
 * system, `light` and `dark` force one. "system" is the *absence* of
 * `data-theme`, never `data-theme="system"` — the tokens key their dark block
 * off `:root:not([data-theme="light"])` inside a `prefers-color-scheme` query,
 * so an attribute the CSS does not know about would pin the page to light.
 */
export type ThemeChoice = "light" | "system" | "dark";

/** Left to right in the toggle, and the index its thumb translates by. */
export const THEME_CHOICES = ["light", "system", "dark"] as const satisfies readonly ThemeChoice[];

export const THEME_STORAGE_KEY = "cujo-theme";

/** What `data-theme` should be for a choice; `null` means remove the attribute. */
export function attributeFor(choice: ThemeChoice): "light" | "dark" | null {
  return choice === "system" ? null : choice;
}

/** The choice a `data-theme` value stands for. Anything else follows the system. */
export function choiceFromAttribute(attribute: string | null): ThemeChoice {
  return attribute === "light" || attribute === "dark" ? attribute : "system";
}

/** Writes the choice to the document and to storage, which is all a theme is. */
export function applyTheme(choice: ThemeChoice): void {
  const attribute = attributeFor(choice);
  const root = document.documentElement;
  if (attribute === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", attribute);
  try {
    if (attribute === null) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, attribute);
  } catch {
    // A blocked storage API is not a reason to refuse the theme change.
  }
}
