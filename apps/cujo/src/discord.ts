/**
 * The Discord REST client (spec Contract 7). Bot token, no gateway: Cujo only
 * writes, so a WebSocket would be a second always-on connection with its own
 * reconnect state machine and nothing to receive (decision 23).
 *
 * Thin, like `github.ts`: it throws and the caller decides what that means.
 * The one thing it does beyond that is surface `retry_after` and Discord's
 * error `code`, because the notifier cannot act on a 429 or an Unknown Message
 * without them.
 *
 * The token never appears in an error message or a log line.
 */

import type { DiscordMessagePayload } from "./discord-card";

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

/** Discord channel types. Only these two accept a plain message from a bot. */
export const GUILD_TEXT = 0;
export const GUILD_ANNOUNCEMENT = 5;

/** Discord's "Unknown Message": the card was deleted underneath us. */
export const UNKNOWN_MESSAGE = 10008;

/** A channel-level permission grant. `type` 0 is a role, 1 is a member. */
export interface PermissionOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  guild_id?: string;
  permission_overwrites?: PermissionOverwrite[];
}

export interface DiscordGuild {
  id: string;
  name: string;
}

export interface DiscordGuildChannel {
  id: string;
  name: string;
  type: number;
  position?: number;
  parent_id?: string | null;
}

export interface DiscordRole {
  id: string;
  name: string;
  /** A bitfield, sent as a decimal string because it exceeds 53 bits. */
  permissions: string;
}

export interface DiscordGuildMember {
  roles: string[];
}

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
 *
 * Pure, because getting it wrong means binding a channel Cujo cannot post in
 * and finding out only when a run blocks and nobody is told.
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

export interface DiscordMessage {
  id: string;
}

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    /** Discord's JSON error code, when the body carried one. */
    readonly code: number | null,
    /** Milliseconds to wait, from a 429. Discord sends fractional seconds. */
    readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

export class DiscordClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bot ${this.token}`,
        "content-type": "application/json",
        "user-agent": "cujo",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body can carry a model-authored echo of what we sent, so it is
      // read for `code` and `retry_after` and never put in the message.
      let code: number | null = null;
      let retryAfterMs: number | null = null;
      const parsed = (await res.json().catch(() => null)) as {
        code?: number;
        retry_after?: number;
      } | null;
      if (typeof parsed?.code === "number") code = parsed.code;
      if (typeof parsed?.retry_after === "number") {
        retryAfterMs = Math.round(parsed.retry_after * 1000);
      }
      throw new DiscordError(
        res.status,
        code,
        retryAfterMs,
        `Discord ${method} ${path} returned ${res.status}`,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  createMessage(channelId: string, payload: DiscordMessagePayload): Promise<DiscordMessage> {
    return this.request<DiscordMessage>("POST", `/channels/${channelId}/messages`, payload);
  }

  editMessage(
    channelId: string,
    messageId: string,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage> {
    return this.request<DiscordMessage>(
      "PATCH",
      `/channels/${channelId}/messages/${messageId}`,
      payload,
    );
  }

  getChannel(channelId: string): Promise<DiscordChannel> {
    return this.request<DiscordChannel>("GET", `/channels/${channelId}`);
  }

  /**
   * One page. A bot in more than 200 servers would need `?after=`, which this
   * single-tenant deployment does not.
   */
  listGuilds(): Promise<DiscordGuild[]> {
    return this.request<DiscordGuild[]>("GET", "/users/@me/guilds?limit=200");
  }

  listChannels(guildId: string): Promise<DiscordGuildChannel[]> {
    return this.request<DiscordGuildChannel[]>("GET", `/guilds/${guildId}/channels`);
  }

  listRoles(guildId: string): Promise<DiscordRole[]> {
    return this.request<DiscordRole[]>("GET", `/guilds/${guildId}/roles`);
  }

  /** The bot's own user, whose id the member and overwrite lookups need. */
  currentUser(): Promise<{ id: string }> {
    return this.request<{ id: string }>("GET", "/users/@me");
  }

  guildMember(guildId: string, userId: string): Promise<DiscordGuildMember> {
    return this.request<DiscordGuildMember>("GET", `/guilds/${guildId}/members/${userId}`);
  }
}
