"use client";

import { DarkIcon, LightIcon, SystemIcon } from "@/components/icons/ThemeIcons";
import { THEME_CHOICES, type ThemeChoice } from "@/lib/theme";
import { chooseTheme, hydrateTheme, useThemeState } from "@/lib/theme-store";
import { useEffect, useId, useState } from "react";

const CELLS: Record<ThemeChoice, { label: string; Icon: typeof LightIcon }> = {
  light: { label: "Light", Icon: LightIcon },
  system: { label: "Match system", Icon: SystemIcon },
  dark: { label: "Dark", Icon: DarkIcon },
};

const THUMB = "absolute top-0.5 left-0.5 h-7 w-7 rounded-sm bg-bg-raised";

/**
 * Shown as the group's `title` when the choice applied but did not persist.
 * `aria-label` already names the group, so a `title` lands as its description
 * rather than competing for the name.
 */
const NOT_SAVED = "This browser is blocking site data, so the theme resets on reload.";

/**
 * Three mutually exclusive states on one light-to-dark axis, which is a radio
 * group and not a menu. Native radios carry the grouping, the arrow keys and
 * the focus, so there is no key handling here and no primitive behind it; the
 * vocabulary itself lives in `lib/theme.ts`.
 *
 * The selected glyph takes the accent, which puts exactly one amber eye in the
 * header at a time — the rule brand/brand.md gives the mark two elements to its
 * left, applied to the chrome.
 *
 * The choice lives in `lib/theme-store.ts` rather than here, because the page
 * carries two of these: one in the header and one in the footer. They are two
 * controls for one document property and have to agree.
 */
export function ThemeToggle() {
  const { choice, persisted } = useThemeState();
  // The thumb sits where the server put it until the stored choice is read
  // back, so the first correction must not animate: a stored dark would
  // otherwise slide the thumb across the track on every load. Per instance,
  // not shared — a toggle mounted later still starts from the server position.
  const [mounted, setMounted] = useState(false);
  const name = useId();

  useEffect(() => {
    hydrateTheme();
    setMounted(true);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      title={persisted ? undefined : NOT_SAVED}
      className="relative flex items-center rounded-md border border-line p-0.5"
    >
      <span
        aria-hidden="true"
        className={mounted ? `${THUMB} transition-transform duration-150` : THUMB}
        style={{ transform: `translateX(${THEME_CHOICES.indexOf(choice) * 100}%)` }}
      />
      {THEME_CHOICES.map((option) => {
        const { label, Icon } = CELLS[option];
        const selected = choice === option;
        return (
          <label
            key={option}
            title={label}
            className="group relative flex cursor-pointer items-center justify-center"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={selected}
              aria-label={label}
              onChange={() => chooseTheme(option)}
              className="peer sr-only"
            />
            <span className="flex h-7 w-7 items-center justify-center rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
              <Icon
                className={`h-4.5 w-4.5 transition-colors ${
                  selected ? "text-accent-fill" : "text-fg-muted group-hover:text-fg"
                }`}
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}
