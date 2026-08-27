/**
 * The Discord REST client (spec Contract 7). Bot token, no gateway: Cujo only
 * writes, so a WebSocket would be a second always-on connection with its own
 * reconnect state machine and nothing to receive (decision 22).
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

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  guild_id?: string;
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
}
