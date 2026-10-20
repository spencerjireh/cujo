import type { RepositorySettingsView } from "@/lib/api/owner-client";
import { describeInstructions, describeMode, effectiveMode } from "@/lib/owner/settings";
import { describe, expect, it } from "vitest";

function view(over: Partial<RepositorySettingsView> = {}): RepositorySettingsView {
  return {
    board: { mode: null, instructions: null, updated_at: null },
    file: { mode: null, instructions: null, path: ".cujo/REVIEW.md" },
    instance: { mode: "sandbox" },
    effective: { mode: { value: "sandbox", source: "instance" }, instructions: null },
    ...over,
  };
}

describe("describeMode (decision 155)", () => {
  it("names the layer that wins and the one it shadows", () => {
    expect(describeMode(view())).toBe("Default: Full review.");
    expect(
      describeMode(
        view({
          board: { mode: "diff", instructions: null, updated_at: "t" },
          effective: { mode: { value: "diff", source: "board" }, instructions: null },
        }),
      ),
    ).toContain("Set here: Diff only");
    const shadowed = describeMode(
      view({
        file: { mode: "sandbox", instructions: null, path: ".cujo/REVIEW.md" },
        board: { mode: "diff", instructions: null, updated_at: "t" },
        effective: { mode: { value: "sandbox", source: "file" }, instructions: null },
      }),
    );
    expect(shadowed).toContain("Set by .cujo.yml: Full review");
    expect(shadowed).toContain("Diff only here is ignored");
  });
});

describe("effectiveMode (decision 175)", () => {
  it("names the mode in effect and its source in one line", () => {
    expect(effectiveMode(view())).toBe("Full review, default");
    expect(
      effectiveMode(
        view({ effective: { mode: { value: "diff", source: "file" }, instructions: null } }),
      ),
    ).toBe("Diff only, set by .cujo.yml");
    expect(
      effectiveMode(
        view({ effective: { mode: { value: "diff", source: "board" }, instructions: null } }),
      ),
    ).toBe("Diff only, set here");
  });
});

describe("describeInstructions (decision 155)", () => {
  it("says where the text comes from, whether it was cut, and what the board's text is worth", () => {
    expect(describeInstructions(view())).toContain("No instructions");
    expect(
      describeInstructions(
        view({
          effective: {
            mode: { value: "sandbox", source: "instance" },
            instructions: { text: "x", truncated: false, source: "board" },
          },
        }),
      ),
    ).toContain("Set here");
    const file = describeInstructions(
      view({
        board: { mode: null, instructions: "board text", updated_at: "t" },
        effective: {
          mode: { value: "sandbox", source: "instance" },
          instructions: { text: "x", truncated: true, source: "file" },
        },
      }),
    );
    expect(file).toContain("Set by .cujo/REVIEW.md");
    expect(file).toContain("The text here is ignored");
    expect(file).toContain("Cut at 16 KB");
  });
});
