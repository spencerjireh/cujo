import { describe, expect, it, vi } from "vitest";
import { DiscordError, UNKNOWN_MESSAGE } from "./discord";
import type { DiscordClient } from "./discord";
import type { DiscordMessagePayload } from "./discord-card";
import { emptyProjection } from "./folder";
import { DiscordNotifier } from "./notifier";
import type { RunView } from "./runner";
import { Store } from "./store";
import type { RunStatus } from "./types";

const UI = "https://cujo.example.com";

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

function build(options: { roleId?: string | null; bind?: boolean } = {}) {
  const store = new Store(":memory:");
  const { run } = store.createRun({
    repo: "o/r",
    prNumber: 7,
    headSha: "abc1234",
    sessionId: "s1",
  });
  store.putProjection(run.id, emptyProjection());
  if (options.bind !== false) {
    store.putDiscordChannel({
      repo: "o/r",
      channelId: "c1",
      guildId: "g1",
      channelName: "reviews",
      notifyRoleId: options.roleId ?? null,
    });
  }
  const client = fakeClient();
  const notifier = new DiscordNotifier({
    store,
    client: client as unknown as DiscordClient,
    uiBaseUrl: UI,
    sleepImpl: async () => {},
  });
  const emit = (status?: RunStatus): void => {
    if (status) store.updateRun(run.id, { status });
    const current = store.getRun(run.id);
    notifier.onRunChanged(
      current ? ({ run: current, projection: emptyProjection() } as RunView) : null,
    );
  };
  return { store, client, notifier, runId: run.id, emit };
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
      store,
      client: fresh as unknown as DiscordClient,
      uiBaseUrl: UI,
    });
    const run = store.getRun(runId);
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
    store.updateRun(runId, { status: "blocked_pending" });
    store.putRunDiscordMessage({
      runId,
      channelId: "c1",
      messageId: "m1",
      pingMessageId: null,
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
    expect(store.getRunDiscordMessage(runId)).toBeNull();

    emit("clean");
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledTimes(2);
    expect(client.editMessage).not.toHaveBeenCalled();
    expect(store.getRunDiscordMessage(runId)?.lastNotifiedStatus).toBe("clean");
  });

  it("reposts a card someone deleted", async () => {
    const { store, client, notifier, runId, emit } = build();
    store.putRunDiscordMessage({
      runId,
      channelId: "c1",
      messageId: "gone",
      pingMessageId: null,
      lastNotifiedStatus: "running",
    });
    client.editMessage.mockRejectedValueOnce(
      new DiscordError(404, UNKNOWN_MESSAGE, null, "Discord PATCH /x returned 404"),
    );
    emit("clean");
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledOnce();
    expect(store.getRunDiscordMessage(runId)?.messageId).toBe("m1");
  });

  it("retries once when Discord rate-limits the send", async () => {
    const { client, notifier, emit } = build();
    client.createMessage.mockRejectedValueOnce(rateLimited());
    emit();
    await notifier.flush();
    expect(client.createMessage).toHaveBeenCalledTimes(2);
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
    store.putDiscordChannel({
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
