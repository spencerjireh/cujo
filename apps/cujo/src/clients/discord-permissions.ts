/**
 * Discord's permission arithmetic. Pure: bit fields in, a bit field out, no
 * request and no state.
 *
 * Split from the client because getting it wrong is not a transport failure.
 * A channel Cujo can read but not post an embed in binds cleanly and then
 * fails on every run, and the first anyone hears of it is a blocked review
 * nobody was told about — so this is the part worth testing exhaustively
 * without a fake fetch anywhere near it.
 */

import type { DiscordRole, PermissionOverwrite } from "./discord";

/** The permission bits Cujo needs, and the one that overrides all of them. */
const ADMINISTRATOR = 1n << 3n;
export const VIEW_CHANNEL = 1n << 10n;
export const SEND_MESSAGES = 1n << 11n;
export const EMBED_LINKS = 1n << 14n;
/** A card is an embed in a channel, so all three are needed to post one. */
export const REQUIRED_PERMISSIONS = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS;

const bits = (value: string | undefined): bigint => (value ? BigInt(value) : 0n);

/**
 * Discord's documented permission resolution: the roles the member holds,
 * then the channel's overwrites applied @everyone first, then the union of the
 * member's role overwrites, then the member's own. Administrator short-circuits
 * everything, and the @everyone role's id is the guild id.
 */
export function effectivePermissions(input: {
  guildId: string;
  memberId: string;
  memberRoles: string[];
  roles: DiscordRole[];
  overwrites: PermissionOverwrite[];
}): bigint {
  const held = new Set([...input.memberRoles, input.guildId]);
  let permissions = 0n;
  for (const role of input.roles) {
    if (held.has(role.id)) permissions |= bits(role.permissions);
  }
  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) return -1n;

  const find = (id: string) => input.overwrites.find((o) => o.id === id);
  const everyone = find(input.guildId);
  if (everyone) permissions = (permissions & ~bits(everyone.deny)) | bits(everyone.allow);

  let allow = 0n;
  let deny = 0n;
  for (const overwrite of input.overwrites) {
    if (overwrite.type !== 0 || overwrite.id === input.guildId) continue;
    if (!held.has(overwrite.id)) continue;
    allow |= bits(overwrite.allow);
    deny |= bits(overwrite.deny);
  }
  permissions = (permissions & ~deny) | allow;

  const member = input.overwrites.find((o) => o.type === 1 && o.id === input.memberId);
  if (member) permissions = (permissions & ~bits(member.deny)) | bits(member.allow);
  return permissions;
}

export function hasPermissions(permissions: bigint, required: bigint): boolean {
  // Administrator is returned as -1n, which has every bit set.
  return (permissions & required) === required;
}
