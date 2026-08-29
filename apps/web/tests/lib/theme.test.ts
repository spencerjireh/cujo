import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  attributeFor,
  choiceFromAttribute,
} from "@/lib/theme";
import { describe, expect, it } from "vitest";

describe("attributeFor", () => {
  it("removes the attribute for system rather than naming it", () => {
    // brand/tokens.css reads the dark block under
    // `:root:not([data-theme="light"])`, so `data-theme="system"` would be an
    // unknown value that pins the page to light on a dark machine.
    expect(attributeFor("system")).toBeNull();
  });

  it("names the attribute for a forced theme", () => {
    expect(attributeFor("light")).toBe("light");
    expect(attributeFor("dark")).toBe("dark");
  });
});

describe("choiceFromAttribute", () => {
  it("round-trips every choice through the attribute", () => {
    for (const choice of THEME_CHOICES) {
      expect(choiceFromAttribute(attributeFor(choice))).toBe(choice);
    }
  });

  it("follows the system for an absent or unrecognized attribute", () => {
    expect(choiceFromAttribute(null)).toBe("system");
    expect(choiceFromAttribute("")).toBe("system");
    expect(choiceFromAttribute("system")).toBe("system");
    expect(choiceFromAttribute("Dark")).toBe("system");
  });
});

describe("THEME_CHOICES", () => {
  it("runs light to dark, because the toggle's thumb moves by index", () => {
    expect([...THEME_CHOICES]).toEqual<ThemeChoice[]>(["light", "system", "dark"]);
  });
});

describe("the pre-paint script in layout.tsx", () => {
  // The script has to be a static string in the document head — it runs before
  // any bundle does — so it cannot import these constants and restates them
  // instead. This is what stops the two copies drifting.
  const layout = readFileSync(
    fileURLToPath(new URL("../../src/app/layout.tsx", import.meta.url)),
    "utf8",
  );
  const script = layout.match(/const THEME_SCRIPT = `([^`]*)`/)?.[1];

  it("is still a single template literal named THEME_SCRIPT", () => {
    expect(script).toBeDefined();
  });

  it("reads the storage key this module writes", () => {
    expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("applies every value the storage key can hold, and no other", () => {
    for (const choice of THEME_CHOICES) {
      const attribute = attributeFor(choice);
      if (attribute === null) continue;
      expect(script).toContain(`"${attribute}"`);
    }
    expect(script).not.toContain('"system"');
  });
});
