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

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

/** Discord channel types. Only these two accept a plain message from a bot. */
export const GUILD_TEXT = 0;
export const GUILD_ANNOUNCEMENT = 5;

/** Discord's "Unknown Message": the card was deleted underneath us. */
export const UNKNOWN_MESSAGE = 10008;

/**
 * The message wire shapes. They belong to the client rather than to the card
 * builder that fills them in: the builder is one caller of this API, not the
 * definition of it. Owning them here is also what keeps `clients/` a leaf —
 * a client that imported a type from `notify/` would depend on the context it
 * exists to serve, and could not be tested without it.
 */
export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
  /** Always present. `parse: []` is what stops a PR titled `@everyone`. */
  allowed_mentions: { parse: string[]; roles?: string[] };
}

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

  /**
   * The application behind the bot token. Its id is what command registration
   * is addressed to; read rather than configured, so there is one fewer value
   * to get wrong in a deploy.
   */
  application(): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>("GET", "/oauth2/applications/@me");
  }

  /**
   * Replace this server's command set. A full PUT rather than a diff, so a
   * command definition cannot drift from the code across deploys. Guild
   * commands appear at once, where a global one takes up to an hour
   * (decision 29).
   */
  putGuildCommands(
    applicationId: string,
    guildId: string,
    commands: unknown[],
  ): Promise<{ id: string; name: string }[]> {
    return this.request<{ id: string; name: string }[]>(
      "PUT",
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      commands,
    );
  }

  /**
   * Fill in a deferred interaction reply. The interaction token authenticates
   * it, so this call carries no bot token and stays valid for 15 minutes.
   */
  async editInteractionReply(
    applicationId: string,
    interactionToken: string,
    payload: unknown,
  ): Promise<void> {
    const res = await this.fetchImpl(
      `${API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", "user-agent": "cujo" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      throw new DiscordError(
        res.status,
        null,
        null,
        `Discord PATCH /webhooks/.../messages/@original returned ${res.status}`,
      );
    }
  }
}
