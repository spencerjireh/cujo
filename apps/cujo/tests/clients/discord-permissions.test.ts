import { describe, expect, it } from "vitest";
import {
  REQUIRED_PERMISSIONS,
  SEND_MESSAGES,
  effectivePermissions,
  hasPermissions,
} from "../../src/clients/discord-permissions";

describe("effectivePermissions", () => {
  const GUILD = "222222222222222222";
  const ME = "777777777777777777";
  const ROLE = "333333333333333333";
  const base = {
    guildId: GUILD,
    memberId: ME,
    memberRoles: [ROLE],
    roles: [
      { id: GUILD, name: "@everyone", permissions: String(REQUIRED_PERMISSIONS) },
      { id: ROLE, name: "bots", permissions: "0" },
    ],
    overwrites: [],
  };

  it("unions the roles the bot holds, @everyone included", () => {
    expect(hasPermissions(effectivePermissions(base), REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("lets a channel deny take a permission the roles granted", () => {
    const permissions = effectivePermissions({
      ...base,
      overwrites: [{ id: ROLE, type: 0, allow: "0", deny: String(SEND_MESSAGES) }],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(false);
  });

  it("applies the member overwrite last, so it can grant back what a role denied", () => {
    const permissions = effectivePermissions({
      ...base,
      overwrites: [
        { id: ROLE, type: 0, allow: "0", deny: String(SEND_MESSAGES) },
        { id: ME, type: 1, allow: String(SEND_MESSAGES), deny: "0" },
      ],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("ignores an overwrite for a role the bot does not hold", () => {
    const permissions = effectivePermissions({
      ...base,
      overwrites: [{ id: "444444444444444444", type: 0, allow: "0", deny: String(SEND_MESSAGES) }],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("short-circuits on administrator, which no overwrite can take away", () => {
    const permissions = effectivePermissions({
      ...base,
      roles: [
        { id: GUILD, name: "@everyone", permissions: "0" },
        { id: ROLE, name: "admin", permissions: String(1n << 3n) },
      ],
      overwrites: [{ id: ROLE, type: 0, allow: "0", deny: String(REQUIRED_PERMISSIONS) }],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(true);
  });

  it("grants nothing when no role carries the bits", () => {
    const permissions = effectivePermissions({
      ...base,
      roles: [
        { id: GUILD, name: "@everyone", permissions: "0" },
        { id: ROLE, name: "bots", permissions: "0" },
      ],
    });
    expect(hasPermissions(permissions, REQUIRED_PERMISSIONS)).toBe(false);
  });
});
