"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useState } from "react";

/**
 * Three states, matching brand/tokens.css exactly: no attribute follows the
 * system, `light` and `dark` force one. The inline script in layout.tsx applies
 * a stored choice before paint, so this only has to keep the two in step.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "cujo-theme";

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // A blocked storage API is not a reason to refuse the theme change.
  }
}

const LABELS: Record<ThemeChoice, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    if (stored === "light" || stored === "dark") setChoice(stored);
  }, []);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-muted transition-colors hover:text-fg hover:border-fg-muted">
        Theme: {LABELS[choice].toLowerCase()}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-40 rounded-md border border-line bg-bg-raised p-1 text-sm shadow-lg"
        >
          {(Object.keys(LABELS) as ThemeChoice[]).map((option) => (
            <DropdownMenu.Item
              key={option}
              onSelect={() => {
                apply(option);
                setChoice(option);
              }}
              className="cursor-pointer rounded-sm px-3 py-1.5 outline-none data-highlighted:bg-bg data-highlighted:text-fg"
            >
              {LABELS[option]}
              {choice === option ? <span className="ml-2 text-accent">•</span> : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
