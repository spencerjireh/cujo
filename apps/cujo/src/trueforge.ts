import { TrueForge, type TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type { Config } from "./config";

export type StreamEvent = TrueForgeApi.TurnStreamingEvent;
export type SessionEvent = TrueForgeApi.SessionEvent;

/**
 * The only client of the TrueForge server (decision 17). Thin: it names the
 * calls apps/cujo makes so the rest of the code never touches the SDK shapes.
 */
export class Harness {
  readonly client: TrueForge;

  constructor(private readonly config: Config) {
    // No token: the server runs without OIDC on the compose network, which
    // gives every caller the fixed local admin identity.
    this.client = new TrueForge({ baseUrl: config.trueforgeBaseUrl, timeoutInSeconds: 600 });
  }

  /**
   * Register what the agent spec references by name. Idempotent: every call is
   * a create-or-update, so a restart re-applies the same settings.
   */
  async bootstrap(): Promise<string[]> {
    const applied: string[] = [];
    await this.client.settings.mcpServers.createOrUpdate({
      manifest: {
        name: "github-mcp",
        type: "remote",
        url: this.config.githubMcpUrl,
        description: "Posts PR reviews as the Cujo GitHub App. post_blocking_review is gated.",
      },
    });
    applied.push("mcp-server github-mcp");

    const provider = this.config.bootstrap.modelProvider;
    if (provider) {
      await this.client.settings.modelProviders.createOrUpdate({
        manifest: {
          type: "custom",
          name: provider.name,
          baseUrl: provider.baseUrl,
          auth: { apiKey: provider.apiKey },
          models: provider.models.map((m) => ({
            name: m.name,
            modelId: m.modelId,
            properties: {},
          })),
        },
      });
      applied.push(`model-provider ${provider.name}`);
    }

    const daytonaApiKey = this.config.bootstrap.daytonaApiKey;
    if (daytonaApiKey) {
      await this.client.settings.sandboxProviders.createOrUpdate({
        manifest: {
          type: "daytona",
          auth: { apiKey: daytonaApiKey },
          autoStopIntervalInMinutes: 15,
          autoArchiveIntervalInMinutes: 60,
          autoDeleteIntervalInMinutes: 24 * 60,
          execTimeoutMs: 20 * 60 * 1000,
        },
      });
      applied.push("sandbox-provider daytona");
    }
    return applied;
  }

  /** One session per PR (Contract 5); the session title is not settable via the API. */
  async createSession(spec: TrueForgeApi.AgentSpec): Promise<string> {
    const { data } = await this.client.sessions.create({ agent: { spec } });
    return data.id;
  }

  startTurn(sessionId: string, message: string): Promise<AsyncIterable<StreamEvent>> {
    return this.client.sessions.createTurnStream(sessionId, {
      input: [{ type: "user.message", content: message }],
    });
  }

  /** Contract 4: one send answers the pending approval and starts a new turn. */
  resume(
    sessionId: string,
    approval: { threadId: string; toolCallId: string },
    decision: "allow" | "deny",
  ): Promise<AsyncIterable<StreamEvent>> {
    return this.client.sessions.createTurnStream(sessionId, {
      input: [
        {
          type: "user.tool_approval",
          threadId: approval.threadId,
          toolCallId: approval.toolCallId,
          approval:
            decision === "allow"
              ? { status: "allow" }
              : { status: "deny", reason: "Rejected by a Cujo operator. Post nothing and stop." },
        },
      ],
    });
  }

  subscribe(sessionId: string, turnId: string): Promise<AsyncIterable<StreamEvent>> {
    return this.client.sessions.subscribeToTurn(sessionId, turnId, {});
  }

  /** Every persisted event on the session's active branch, oldest first. */
  async listEvents(sessionId: string): Promise<{ turnId: string; event: SessionEvent }[]> {
    const items: { turnId: string; event: SessionEvent }[] = [];
    const page = await this.client.sessions.listEvents(sessionId, { limit: 200 });
    for await (const item of page) items.push({ turnId: item.turnId, event: item.event });
    // The API lists newest first.
    return items.reverse();
  }

  async listTurns(sessionId: string): Promise<TrueForgeApi.Turn[]> {
    const turns: TrueForgeApi.Turn[] = [];
    const page = await this.client.sessions.listTurns(sessionId, {});
    for await (const turn of page) turns.push(turn);
    return turns;
  }
}
