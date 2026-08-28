import { generateKeyPairSync, sign as signEd25519 } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DiscordClient } from "../src/discord";
import type { GitHubReader } from "../src/github";
import { interactionRoutes, verifyInteraction } from "../src/interactions";
import { Store } from "../src/store";

const GUILD = "222222222222222222";
const CHANNEL = "111111111111111111";
const ROLE = "333333333333333333";
const BOT_ROLE = "444444444444444444";
const USER = "555555555555555555";
const MANAGE_GUILD = "32";
/** View Channel + Send Messages + Embed Links. */
const CAN_POST = String((1n << 10n) | (1n << 11n) | (1n << 14n));

let privateKey: KeyObject;
let publicKey: string;

beforeAll(() => {
  const pair = generateKeyPairSync("ed25519");
  privateKey = pair.privateKey;
  // Raw 32 bytes: the DER SPKI wrapper is a fixed 12-byte prefix.
  publicKey = pair.publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
});

function signed(body: string, timestamp = "1756300000") {
  return {
    "x-signature-ed25519": signEd25519(
      null,
      Buffer.from(`${timestamp}${body}`, "utf8"),
      privateKey,
    ).toString("hex"),
    "x-signature-timestamp": timestamp,
    "content-type": "application/json",
  };
}

function fakeDiscord(overrides: Record<string, unknown> = {}) {
  return {
    getChannel: vi.fn(async () => ({
      id: CHANNEL,
      type: 0,
      name: "reviews",
      guild_id: GUILD,
      permission_overwrites: [],
    })),
    listRoles: vi.fn(async () => [
      { id: GUILD, name: "@everyone", permissions: CAN_POST },
      { id: ROLE, name: "oncall", permissions: "0" },
      { id: BOT_ROLE, name: "bots", permissions: "0" },
    ]),
    currentUser: vi.fn(async () => ({ id: "777777777777777777" })),
    guildMember: vi.fn(async () => ({ roles: [BOT_ROLE] })),
    createMessage: vi.fn(async () => ({ id: "m1" })),
    editInteractionReply: vi.fn(async () => {}),
    ...overrides,
  };
}

function build(
  options: {
    discord?: Record<string, unknown>;
    repos?: string[];
    /** What the repo names in its `.cujo.yml`; null is "no declaration". */
    declaredGuild?: string | null;
  } = {},
) {
  const store = new Store(":memory:");
  const discord = fakeDiscord(options.discord);
  const github = {
    installedRepos: vi.fn(async () => options.repos ?? ["spencerjireh/orders-api"]),
    declaredGuild: vi.fn(async () => options.declaredGuild ?? null),
  };
  const settled: ((name: string) => void)[] = [];
  const nextSettled = () => new Promise<string>((resolve) => settled.push(resolve));
  const app = interactionRoutes({
    publicKey,
    store,
    discord: discord as unknown as DiscordClient,
    github: github as unknown as GitHubReader,
    uiBaseUrl: "https://cujo.example.com",
    onSettled: (name) => settled.shift()?.(name),
  });
  return { app, store, discord, github, nextSettled };
}

function post(
  app: ReturnType<typeof build>["app"],
  payload: unknown,
  headers?: Record<string, string>,
) {
  const body = JSON.stringify(payload);
  return app.request("/discord/interactions", {
    method: "POST",
    headers: headers ?? signed(body),
    body,
  });
}

function command(name: string, options: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    type: 2,
    application_id: "app1",
    token: "tok",
    guild_id: GUILD,
    member: { user: { id: USER }, permissions: MANAGE_GUILD },
    data: { name: "cujo", options: [{ type: 1, name, options }] },
    ...overrides,
  };
}

/** The one line the deferred reply eventually carries. */
async function reply(built: ReturnType<typeof build>, payload: unknown): Promise<string> {
  const settled = built.nextSettled();
  const res = await post(built.app, payload);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
  await settled;
  const call = built.discord.editInteractionReply.mock.calls.at(-1) as
    | [string, string, { content: string }]
    | undefined;
  return call?.[2].content ?? "";
}

function authorize(store: Store, repo = "spencerjireh/orders-api") {
  store.authorizeGuildRepo({
    guildId: GUILD,
    repo,
    guildName: "My Server",
    authorizedBy: "op@example.com",
  });
}

describe("verifyInteraction", () => {
  it("accepts a signature over the timestamp and the raw body", () => {
    const body = '{"type":1}';
    const headers = signed(body);
    expect(
      verifyInteraction({
        publicKey,
        signature: headers["x-signature-ed25519"],
        timestamp: headers["x-signature-timestamp"],
        body,
      }),
    ).toBe(true);
  });

  it("refuses a tampered body, a swapped timestamp, and a malformed signature", () => {
    const body = '{"type":1}';
    const headers = signed(body);
    const base = {
      publicKey,
      signature: headers["x-signature-ed25519"],
      timestamp: headers["x-signature-timestamp"],
      body,
    };
    expect(verifyInteraction({ ...base, body: '{"type":2}' })).toBe(false);
    expect(verifyInteraction({ ...base, timestamp: "1756300001" })).toBe(false);
    expect(verifyInteraction({ ...base, signature: "not-hex" })).toBe(false);
    expect(verifyInteraction({ ...base, signature: undefined })).toBe(false);
    expect(verifyInteraction({ ...base, timestamp: undefined })).toBe(false);
    // Same length, wrong bytes: must be false, not a throw.
    expect(verifyInteraction({ ...base, signature: "ab".repeat(64) })).toBe(false);
  });
});

describe("interactions endpoint", () => {
  it("answers 401 to a bad signature, which Discord probes for", async () => {
    const built = build();
    const res = await post(built.app, { type: 1 }, { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });

  it("answers a PING with a PONG", async () => {
    const built = build();
    const res = await post(built.app, { type: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("defers, then fills in the reply", async () => {
    const built = build();
    authorize(built.store);
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
        { name: "role", type: 8, value: ROLE },
      ]),
    );
    expect(content).toContain(`<#${CHANNEL}>`);
    expect(content).toContain(`<@&${ROLE}>`);
    const binding = built.store.getDiscordChannel("spencerjireh/orders-api");
    expect(binding).toMatchObject({
      channelId: CHANNEL,
      guildId: GUILD,
      notifyRoleId: ROLE,
      boundBy: `discord:${USER}`,
    });
  });

  it("watches a repo that named this server, with no operator involved", async () => {
    const built = build({ declaredGuild: GUILD });
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain(`<#${CHANNEL}>`);
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")?.guildId).toBe(GUILD);
    // Nothing was written to the operator table to make this work.
    expect(built.store.listGuildRepos()).toHaveLength(0);
  });

  it("tells a server that has not been named exactly what to add, and where", async () => {
    const built = build();
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain(".cujo.yml");
    expect(content).toContain(`discord_guild: "${GUILD}"`);
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
    expect(built.discord.getChannel).not.toHaveBeenCalled();
  });

  it("says so plainly when the repo named a different server", async () => {
    const built = build({ declaredGuild: "999999999999999999" });
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain("a different Discord server");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("still honours an operator's allowance when the repo declares nothing", async () => {
    const built = build();
    authorize(built.store);
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain(`<#${CHANNEL}>`);
  });

  it("checks Manage Server itself, not only through Discord's own gate", async () => {
    const built = build();
    authorize(built.store);
    const content = await reply(
      built,
      command(
        "watch",
        [
          { name: "repo", type: 3, value: "spencerjireh/orders-api" },
          { name: "channel", type: 7, value: CHANNEL },
        ],
        { member: { user: { id: USER }, permissions: "0" } },
      ),
    );
    expect(content).toContain("Manage Server");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("refuses a channel in another server, whatever the option said", async () => {
    const built = build({
      discord: {
        getChannel: vi.fn(async () => ({
          id: CHANNEL,
          type: 0,
          name: "elsewhere",
          guild_id: "999999999999999999",
          permission_overwrites: [],
        })),
      },
    });
    authorize(built.store);
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain("not in this server");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("refuses a channel the bot cannot post an embed in", async () => {
    const built = build({
      discord: {
        getChannel: vi.fn(async () => ({
          id: CHANNEL,
          type: 0,
          name: "reviews",
          guild_id: GUILD,
          permission_overwrites: [{ id: BOT_ROLE, type: 0, allow: "0", deny: String(1n << 11n) }],
        })),
      },
    });
    authorize(built.store);
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain("Send Messages");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("unwatches, and says so when there was nothing to unwatch", async () => {
    const built = build();
    authorize(built.store);
    built.store.putDiscordChannel({
      repo: "spencerjireh/orders-api",
      channelId: CHANNEL,
      guildId: GUILD,
      channelName: "reviews",
      notifyRoleId: null,
    });
    const first = await reply(
      built,
      command("unwatch", [{ name: "repo", type: 3, value: "spencerjireh/orders-api" }]),
    );
    expect(first).toContain("Stopped");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
    const second = await reply(
      built,
      command("unwatch", [{ name: "repo", type: 3, value: "spencerjireh/orders-api" }]),
    );
    expect(second).toContain("not being sent");
  });

  it("reports what this server watches, and what it merely may watch", async () => {
    const built = build();
    authorize(built.store);
    authorize(built.store, "spencerjireh/other-repo");
    built.store.putDiscordChannel({
      repo: "spencerjireh/orders-api",
      channelId: CHANNEL,
      guildId: GUILD,
      channelName: "reviews",
      notifyRoleId: ROLE,
    });
    const content = await reply(built, command("status"));
    expect(content).toContain(`spencerjireh/orders-api\` → <#${CHANNEL}>`);
    expect(content).toContain(`<@&${ROLE}>`);
    expect(content).toContain("other-repo` — allowed, not being sent anywhere");
    // It cannot list every repo that named this server without reading each
    // one's .cujo.yml, so it says how to add one instead.
    expect(content).toContain(`discord_guild: "${GUILD}"`);
  });

  it("lists a repo watched here even when no operator allowed it", async () => {
    const built = build({ declaredGuild: GUILD });
    built.store.putDiscordChannel({
      repo: "spencerjireh/orders-api",
      channelId: CHANNEL,
      guildId: GUILD,
      channelName: "reviews",
      notifyRoleId: null,
    });
    const content = await reply(built, command("status"));
    expect(content).toContain(`spencerjireh/orders-api\` → <#${CHANNEL}>`);
  });

  it("posts a sample card, and reports a channel it cannot post to", async () => {
    const built = build();
    authorize(built.store);
    built.store.putDiscordChannel({
      repo: "spencerjireh/orders-api",
      channelId: CHANNEL,
      guildId: GUILD,
      channelName: "reviews",
      notifyRoleId: null,
    });
    const ok = await reply(
      built,
      command("test", [{ name: "repo", type: 3, value: "spencerjireh/orders-api" }]),
    );
    expect(ok).toContain("Posted a sample card");
    expect(built.discord.createMessage).toHaveBeenCalledOnce();

    built.discord.createMessage.mockRejectedValueOnce(new Error("forbidden"));
    const failed = await reply(
      built,
      command("test", [{ name: "repo", type: 3, value: "spencerjireh/orders-api" }]),
    );
    expect(failed).toContain("could not post");
  });

  it("completes the repo box from every repo Cujo could review", async () => {
    const built = build({ repos: ["spencerjireh/orders-api", "spencerjireh/other"] });
    const res = await post(built.app, {
      type: 4,
      application_id: "app1",
      token: "tok",
      guild_id: GUILD,
      member: { user: { id: USER }, permissions: MANAGE_GUILD },
      data: { name: "cujo", options: [{ type: 1, name: "watch", options: [] }] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: number; data: { choices: { value: string }[] } };
    expect(body.type).toBe(8);
    // Narrowing by authorization would mean one .cujo.yml read per repo, per
    // keystroke. `watch` refuses with the fix instead.
    expect(body.data.choices.map((c) => c.value)).toEqual([
      "spencerjireh/orders-api",
      "spencerjireh/other",
    ]);
    expect(built.github.declaredGuild).not.toHaveBeenCalled();
  });

  it("narrows the box as the invoker types", async () => {
    const built = build({ repos: ["spencerjireh/orders-api", "spencerjireh/other"] });
    const res = await post(built.app, {
      type: 4,
      application_id: "app1",
      token: "tok",
      guild_id: GUILD,
      data: {
        name: "cujo",
        options: [
          {
            type: 1,
            name: "watch",
            options: [{ name: "repo", type: 3, value: "orders", focused: true }],
          },
        ],
      },
    });
    const body = (await res.json()) as { data: { choices: { value: string }[] } };
    expect(body.data.choices.map((c) => c.value)).toEqual(["spencerjireh/orders-api"]);
  });

  it("falls back to what it knows when GitHub cannot be reached", async () => {
    const built = build();
    authorize(built.store);
    built.github.installedRepos.mockRejectedValueOnce(new Error("github is down"));
    const res = await post(built.app, {
      type: 4,
      application_id: "app1",
      token: "tok",
      guild_id: GUILD,
      data: {
        name: "cujo",
        options: [
          {
            type: 1,
            name: "watch",
            options: [{ name: "repo", type: 3, value: "ord", focused: true }],
          },
        ],
      },
    });
    const body = (await res.json()) as { data: { choices: { value: string }[] } };
    expect(body.data.choices.map((c) => c.value)).toEqual(["spencerjireh/orders-api"]);
  });

  it("will not take a repo another authorized server already claimed", async () => {
    const built = build();
    authorize(built.store);
    built.store.putDiscordChannel({
      repo: "spencerjireh/orders-api",
      channelId: "888888888888888888",
      guildId: "999999999999999999",
      channelName: "theirs",
      notifyRoleId: null,
    });
    const watched = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(watched).toContain("another server");
    // And it cannot silence them either.
    const unwatched = await reply(
      built,
      command("unwatch", [{ name: "repo", type: 3, value: "spencerjireh/orders-api" }]),
    );
    expect(unwatched).toContain("another server");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")?.channelId).toBe(
      "888888888888888888",
    );
  });

  it("re-checks authorization after the Discord round trips, not only before", async () => {
    const built = build();
    authorize(built.store);
    // Revoked while `watch` was awaiting Discord.
    built.discord.listRoles.mockImplementationOnce(async () => {
      built.store.revokeGuildRepo(GUILD, "spencerjireh/orders-api");
      return [{ id: GUILD, name: "@everyone", permissions: CAN_POST }];
    });
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain("no longer allowed");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("re-checks a repo declaration reverted during the Discord round trips", async () => {
    const built = build({ declaredGuild: GUILD });
    built.discord.listRoles.mockImplementationOnce(async () => {
      // The declaration was reverted on the default branch mid-command.
      built.github.declaredGuild.mockResolvedValue(null);
      return [{ id: GUILD, name: "@everyone", permissions: CAN_POST }];
    });
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain("no longer allowed");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("refuses a repo the GitHub App is not installed on", async () => {
    const built = build({ repos: ["spencerjireh/something-else"] });
    authorize(built.store);
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain("not installed");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("still binds when GitHub cannot be reached", async () => {
    const built = build();
    authorize(built.store);
    built.github.installedRepos.mockRejectedValueOnce(new Error("github is down"));
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain(`<#${CHANNEL}>`);
  });

  it("keeps a long status reply under Discord's message limit", async () => {
    const built = build();
    for (let i = 0; i < 200; i++) authorize(built.store, `spencerjireh/repo-${i}`);
    const content = await reply(built, command("status"));
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain("more");
  });

  it("never offers a repo name Discord would refuse as a choice", async () => {
    const long = `spencerjireh/${"x".repeat(120)}`;
    const built = build({ repos: ["spencerjireh/orders-api", long] });
    authorize(built.store);
    authorize(built.store, long);
    const res = await post(built.app, {
      type: 4,
      application_id: "app1",
      token: "tok",
      guild_id: GUILD,
      data: { name: "cujo", options: [{ type: 1, name: "watch", options: [] }] },
    });
    const body = (await res.json()) as { data: { choices: { value: string }[] } };
    expect(body.data.choices.map((c) => c.value)).toEqual(["spencerjireh/orders-api"]);
    for (const choice of body.data.choices) expect(choice.value.length).toBeLessThanOrEqual(100);
  });

  it("lets a server stop receiving a repo that revoked its declaration", async () => {
    // The commit that revokes is the one that makes the binding stale, so
    // gating cleanup behind the declaration would strand the channel.
    const built = build({ declaredGuild: null });
    built.store.putDiscordChannel({
      repo: "spencerjireh/orders-api",
      channelId: CHANNEL,
      guildId: GUILD,
      channelName: "reviews",
      notifyRoleId: null,
    });
    const content = await reply(
      built,
      command("unwatch", [{ name: "repo", type: 3, value: "spencerjireh/orders-api" }]),
    );
    expect(content).toContain("Stopped");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("lets a server stop receiving a repo the App was removed from", async () => {
    const built = build({ repos: ["spencerjireh/something-else"] });
    built.store.putDiscordChannel({
      repo: "spencerjireh/orders-api",
      channelId: CHANNEL,
      guildId: GUILD,
      channelName: "reviews",
      notifyRoleId: null,
    });
    const content = await reply(
      built,
      command("unwatch", [{ name: "repo", type: 3, value: "spencerjireh/orders-api" }]),
    );
    expect(content).toContain("Stopped");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("asks for a retry rather than refusing when GitHub cannot be read", async () => {
    const built = build();
    built.github.declaredGuild.mockRejectedValueOnce(new Error("github is down"));
    const content = await reply(
      built,
      command("watch", [
        { name: "repo", type: 3, value: "spencerjireh/orders-api" },
        { name: "channel", type: 7, value: CHANNEL },
      ]),
    );
    expect(content).toContain("could not read");
    expect(content).toContain("Try again");
    expect(built.store.getDiscordChannel("spencerjireh/orders-api")).toBeNull();
  });

  it("refuses to act outside a server", async () => {
    const built = build();
    const content = await reply(built, command("status", [], { guild_id: undefined }));
    expect(content).toContain("in a server");
  });
});
