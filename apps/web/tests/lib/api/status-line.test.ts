import { STATUS_LINE } from "@/lib/api/status-line";
import { RUN_STATUSES } from "@/lib/api/types";
import { describe, expect, it } from "vitest";

/**
 * Two surfaces read these sentences now — a run link's preview and the docs
 * page that explains what a verdict means. A status added in `apps/cujo` that
 * reached only one of them would render a blank cell in the manual, so the
 * cover is asserted rather than left to the `Record` type alone.
 */
describe("status lines", () => {
  it("covers every run status, with a written sentence", () => {
    expect(Object.keys(STATUS_LINE).sort()).toEqual([...RUN_STATUSES].sort());
    for (const status of RUN_STATUSES) {
      expect(STATUS_LINE[status].length).toBeGreaterThan(10);
    }
  });
});
