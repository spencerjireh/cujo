import { createLogger } from "@cujo/log";
import { describe, expect, it, vi } from "vitest";
import { DiscordError, UNKNOWN_MESSAGE } from "../../src/clients/discord";
import type { DiscordClient } from "../../src/clients/discord";
import type { DiscordMessagePayload } from "../../src/clients/discord";
import type { GitHubReader } from "../../src/clients/github";
import { DiscordNotifier } from "../../src/notify/notifier.service";
import { emptyProjection } from "../../src/review/fold";
import type { RunView } from "../../src/review/runner.service";
import type { RunStatus } from "../../src/review/types";
import { Store } from "../../src/store";

/** Tests assert on behaviour, not on log output; the sink swallows it. */
const silentLog = createLogger({ service: "cujo", sink: () => {} });

const PUBLIC_UI = "https://cujo.example.com";
const LINKS = { publicBaseUrl: PUBLIC_UI };

function fakeClient() {
  let created = 0;
  return {
    createMessage: vi.fn(async (_channelId: string, _payload: DiscordMessagePayload) => ({
      id: `m${++created}`,
    })),
    editMessage: vi.fn(
      async (_channelId: string, _messageId: string, _payload: DiscordMessagePayload) => ({
        id: "m1",
      }),
    ),
  };
}

/** The repo's `.cujo.yml`, which the notifier consults before every send. */
function fakeGithub(declared: string | null | "unreadable" = "g1") {
  return {
    declaredGuild: vi.fn(async () => {
      if (declared === "unreadable") throw new Error("github is down");
      return declared;
    }),
  };
}

function build(
  options: {
    roleId?: string | null;
    bind?: boolean;
    declaredGuild?: string | null | "unreadable";
    defaultGuild?: string | null;
  } = {},
) {
  const store = new Store(":memory:");
  const { run } = store.runs.createRun({
    repo: "o/r",
    prNumber: 7,
    headSha: "abc1234",
    sessionId: "s1",
    isPublic: true,
  });
  store.runs.putProjection(run.id, emptyProjection());
  if (options.bind !== false) {
    store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: "reviews",
      notifyRoleId: options.roleId ?? null,
    });
  }
  const client = fakeClient();
  const github = fakeGithub(options.declaredGuild);
  const notifier = new DiscordNotifier({
    log: silentLog,
    store,
    client: client as unknown as DiscordClient,
    github: github as unknown as GitHubReader,
    links: LINKS,
    defaultGuild: options.defaultGuild ?? null,
    sleepImpl: async () => {},
  });
  const emit = (status?: RunStatus): void => {
    if (status) store.runs.updateRun(run.id, { status });
    const current = store.runs.getRun(run.id);
    notifier.onRunChanged(
      current ? ({ run: current, projection: emptyProjection() } as RunView) : null,
    );
  };
  return { store, client, github, notifier, runId: run.id, emit };
}

function rateLimited(): DiscordError {
  return new DiscordError(429, null, 250, "Discord POST /x returned 429");
}

describe("DiscordNotifier", () => {
  it("collapses a storm of folds into one card and one edit", async () => {
    const { client, notifier, emit } = build();
    emit();
    emit();
    emit();
    await notifier.flush();
    emit("clean");
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledOnce();
    expect(client.editMessage).toHaveBeenCalledOnce();
  });

  it("sends nothing for a status it already sent, restart included", async () => {
    const { store, client, notifier, runId, emit } = build();
    emit();
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledOnce();

    // A fresh notifier over the same store is what a restart looks like.
    const fresh = fakeClient();
    const restarted = new DiscordNotifier({
      log: silentLog,
      store,
      client: fresh as unknown as DiscordClient,
      github: fakeGithub() as unknown as GitHubReader,
      links: LINKS,
      defaultGuild: null,
    });
    const run = store.runs.getRun(runId);
    restarted.onRunChanged(run ? ({ run, projection: emptyProjection() } as RunView) : null);
    await restarted.flush();
    expect(fresh.createMessage).not.toHaveBeenCalled();
    expect(fresh.editMessage).not.toHaveBeenCalled();
  });

  it("pings once when a run blocks, because an edit notifies nobody", async () => {
    const { client, notifier, emit } = build({ roleId: "123456789012345678" });
    emit();
    await notifier.flush();
    emit("blocked_pending");
    await notifier.flush();
    expect(client.editMessage).toHaveBeenCalledOnce();
    // The card create, then the ping.
    expect(client.createMessage).toHaveBeenCalledTimes(2);
    const ping = client.createMessage.mock.calls[1]?.[1];
    expect(ping?.content).toContain("<@&123456789012345678>");

    emit();
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledTimes(2);
  });

  it("sends only the ping when a restart finds the card written and the ping not", async () => {
    const { store, client, notifier, runId, emit } = build();
    store.runs.updateRun(runId, { status: "blocked_pending" });
    store.notifications.putRunDiscordMessage({
      runId,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: null,
      pingResolved: false,
      lastNotifiedStatus: "blocked_pending",
    });
    emit();
    await notifier.flush();
    expect(client.editMessage).not.toHaveBeenCalled();
    expect(client.createMessage).toHaveBeenCalledOnce();
  });

  it("edits the ping once the run leaves blocked_pending", async () => {
    const { client, notifier, emit } = build();
    emit("blocked_pending");
    await notifier.flush();
    emit("blocked_posted");
    await notifier.flush();
    // The card edit, then the ping edit.
    expect(client.editMessage).toHaveBeenCalledTimes(2);
    const resolved = client.editMessage.mock.calls[1]?.[2];
    expect(resolved?.content).toContain("Resolved");
  });

  it("retries resolving the ping until it lands, restart included", async () => {
    const { store, client, notifier, runId, emit } = build();
    emit("blocked_pending");
    await notifier.flush();
    // The card write persists the new status before the ping is edited, so a
    // failed ping edit must not look like work already done. The card's own
    // edit succeeds first, which is what makes the status look settled.
    client.editMessage
      .mockImplementationOnce(async () => ({ id: "m1" }))
      .mockRejectedValueOnce(new Error("discord is down"));
    emit("blocked_posted");
    await notifier.flush();
    expect(store.notifications.getRunDiscordMessage(runId)?.pingResolved).toBe(false);

    const fresh = fakeClient();
    const restarted = new DiscordNotifier({
      log: silentLog,
      store,
      client: fresh as unknown as DiscordClient,
      github: fakeGithub() as unknown as GitHubReader,
      links: LINKS,
      defaultGuild: null,
    });
    const run = store.runs.getRun(runId);
    restarted.onRunChanged(run ? ({ run, projection: emptyProjection() } as RunView) : null);
    await restarted.flush();
    expect(fresh.editMessage).toHaveBeenCalledOnce();
    expect(fresh.editMessage.mock.calls[0]?.[2]?.content).toContain("Resolved");
    expect(store.notifications.getRunDiscordMessage(runId)?.pingResolved).toBe(true);

    // And once resolved it is left alone.
    restarted.onRunChanged(run ? ({ run, projection: emptyProjection() } as RunView) : null);
    await restarted.flush();
    expect(fresh.editMessage).toHaveBeenCalledOnce();
  });

  it("does not mention another server's role when a repo is re-bound mid-run", async () => {
    const { store, client, github, notifier, emit } = build({ roleId: "111111111111111111" });
    emit();
    await notifier.flush();
    // Re-bound to a different server, which is now the one the repo declares —
    // the only way to move a repo since decision 54 deleted the operator
    // override. Its role still means nothing in the channel this run's card
    // already lives in.
    github.declaredGuild.mockResolvedValue("g2");
    store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c2",
      guildId: "g2",
      channelName: "elsewhere",
      notifyRoleId: "999999999999999999",
    });
    emit("blocked_pending");
    await notifier.flush();
    const ping = client.createMessage.mock.calls[1];
    expect(ping?.[0]).toBe("c1");
    expect(ping?.[1].content).not.toContain("<@&");
  });

  it("never lets an edit overtake the create it depends on", async () => {
    const { client, notifier, emit } = build();
    let release!: (value: { id: string }) => void;
    client.createMessage.mockReturnValueOnce(
      new Promise<{ id: string }>((resolve) => {
        release = resolve;
      }),
    );
    emit();
    // Let the create start before the next status arrives, so the second send
    // really is queued behind an in-flight one.
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit("clean");
    expect(client.editMessage).not.toHaveBeenCalled();
    release({ id: "m9" });
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledOnce();
    expect(client.editMessage).toHaveBeenCalledWith("c1", "m9", expect.anything());
  });

  it("swallows a failed send and creates rather than edits on the next status", async () => {
    const { store, client, notifier, runId, emit } = build();
    client.createMessage.mockRejectedValueOnce(new Error("discord is down"));
    emit();
    await expect(notifier.flush()).resolves.toBeUndefined();
    expect(store.notifications.getRunDiscordMessage(runId)).toBeNull();

    emit("clean");
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledTimes(2);
    expect(client.editMessage).not.toHaveBeenCalled();
    expect(store.notifications.getRunDiscordMessage(runId)?.lastNotifiedStatus).toBe("clean");
  });

  it("reposts a card someone deleted", async () => {
    const { store, client, notifier, runId, emit } = build();
    store.notifications.putRunDiscordMessage({
      runId,
      channelId: "c1",
      messageId: "gone",
      pingMessageId: null,
      pingResolved: false,
      lastNotifiedStatus: "running",
    });
    client.editMessage.mockRejectedValueOnce(
      new DiscordError(404, UNKNOWN_MESSAGE, null, "Discord PATCH /x returned 404"),
    );
    emit("clean");
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledOnce();
    expect(store.notifications.getRunDiscordMessage(runId)?.messageId).toBe("m1");
  });

  it("retries once when Discord rate-limits the send", async () => {
    const { client, notifier, emit } = build();
    client.createMessage.mockRejectedValueOnce(rateLimited());
    emit();
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledTimes(2);
  });

  it("stops and drops the binding once the repo stops naming the server", async () => {
    // "Revoked by a commit" has to be true of delivery, not only of the bind:
    // a binding written before the revert would otherwise deliver forever.
    const built = build({ declaredGuild: null });
    built.emit();
    await built.notifier.flush();
    expect(built.client.createMessage).not.toHaveBeenCalled();
    expect(built.store.notifications.getDiscordChannel("o/r")).toBeNull();
  });

  it("stops when the repo names a different server", async () => {
    const built = build({ declaredGuild: "g9" });
    built.emit();
    await built.notifier.flush();
    expect(built.client.createMessage).not.toHaveBeenCalled();
    expect(built.store.notifications.getDiscordChannel("o/r")).toBeNull();
  });

  it("delivers to the default server for a repo that declares nothing", async () => {
    // The binding the default created is re-checked on this path like any
    // other, so it has to survive the check that would otherwise drop it.
    const built = build({ declaredGuild: null, defaultGuild: "g1" });
    built.emit();
    await built.notifier.flush();
    expect(built.client.createMessage).toHaveBeenCalledOnce();
    expect(built.store.notifications.getDiscordChannel("o/r")).not.toBeNull();
  });

  it("drops that binding once the default is unset", async () => {
    // Unsetting the variable revokes exactly as reverting the commit does,
    // which is what makes the default a declaration and not a permanent grant.
    const built = build({ declaredGuild: null, defaultGuild: null });
    built.emit();
    await built.notifier.flush();
    expect(built.client.createMessage).not.toHaveBeenCalled();
    expect(built.store.notifications.getDiscordChannel("o/r")).toBeNull();
  });

  it("keeps delivering when GitHub cannot be reached", async () => {
    // Unreadable says nothing about what the repo declares. Treating it as a
    // revocation would let a GitHub hiccup silence a team's reviews.
    const built = build({ declaredGuild: "unreadable" });
    built.emit();
    await built.notifier.flush();
    expect(built.client.createMessage).toHaveBeenCalledOnce();
    expect(built.store.notifications.getDiscordChannel("o/r")).not.toBeNull();
  });

  it("makes no request at all for a repo with no channel bound", async () => {
    const { client, notifier, emit } = build({ bind: false });
    emit();
    await notifier.flush();
    expect(client.createMessage).not.toHaveBeenCalled();
  });

  it("keeps editing the channel the card was posted in when a repo is re-pointed", async () => {
    const { store, client, notifier, emit } = build();
    emit();
    await notifier.flush();
    store.notifications.putDiscordChannel({
      repo: "o/r",
      channelId: "c2",
      guildId: "g1",
      channelName: "elsewhere",
      notifyRoleId: null,
    });
    emit("clean");
    await notifier.flush();
    expect(client.editMessage).toHaveBeenCalledWith("c1", "m1", expect.anything());
  });

  it("says nothing about a run that errored before it ever had a turn", async () => {
    const { client, notifier, emit } = build();
    emit("error");
    await notifier.flush();
    expect(client.createMessage).not.toHaveBeenCalled();
  });

  it("ignores a view for a run that has gone", async () => {
    const { client, notifier } = build();
    notifier.onRunChanged(null);
    await notifier.flush();
    expect(client.createMessage).not.toHaveBeenCalled();
  });
});
