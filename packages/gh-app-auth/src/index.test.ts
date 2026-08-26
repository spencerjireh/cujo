import { describe, expect, it } from "vitest";
import { getInstallationToken } from "./index";

describe("getInstallationToken", () => {
  it("is exported and rejects until implemented", async () => {
    await expect(
      getInstallationToken({ appId: "1", privateKey: "x", installationId: 1 }),
    ).rejects.toThrow("not implemented");
  });
});
