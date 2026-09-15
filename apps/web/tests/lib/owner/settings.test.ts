import type { RepositorySettingsView } from "@/lib/api/owner-client";
import { describeInstructions, describeMode } from "@/lib/owner/settings";
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
    expect(describeMode(view())).toContain("follows the instance");
    expect(
      describeMode(
        view({
          board: { mode: "diff", instructions: null, updated_at: "t" },
          effective: { mode: { value: "diff", source: "board" }, instructions: null },
        }),
      ),
    ).toContain("Set here: the next run will read it");
    const shadowed = describeMode(
      view({
        file: { mode: "sandbox", instructions: null, path: ".cujo/REVIEW.md" },
        board: { mode: "diff", instructions: null, updated_at: "t" },
        effective: { mode: { value: "sandbox", source: "file" }, instructions: null },
      }),
    );
    expect(shadowed).toContain(".cujo.yml sets this: the next run will run it");
    expect(shadowed).toContain("has no effect while the file speaks");
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
    expect(file).toContain(".cujo/REVIEW.md sets these");
    expect(file).toContain("no effect while the file exists");
    expect(file).toContain("Cut on a line");
  });
});
