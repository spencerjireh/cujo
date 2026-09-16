import { createLogger } from "@cujo/log";
import { describe, expect, it } from "vitest";
import { DaytonaRuntime } from "../../src/runtimes/daytona";

describe("DaytonaRuntime.create", () => {
  it("refuses staged trees, having no way to upload them (decision 158)", async () => {
    const runtime = new DaytonaRuntime({
      apiUrl: "http://daytona.invalid",
      apiKey: "k",
      log: createLogger({ service: "sandbox-mcp", sink: () => {} }),
    });
    await expect(
      runtime.create({ allowHosts: [], staged: { base: "/x/base.tgz", head: "/x/head.tgz" } }),
    ).rejects.toThrow("cannot take staged trees");
  });
});
