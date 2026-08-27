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
  /** True once every bootstrap registration succeeded; webhooks wait for it. */
  ready = false;

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
    const step = async (name: string, apply: () => Promise<unknown>) => {
      try {
        await apply();
      } catch (error) {
        throw new Error(`bootstrap step ${name} failed: ${String(error)}`, { cause: error });
      }
      applied.push(name);
    };

    await step("mcp-server github-mcp", () =>
      this.client.settings.mcpServers.createOrUpdate({
        manifest: {
          name: "github-mcp",
          type: "remote",
          url: this.config.githubMcpUrl,
          description: "Posts PR reviews as the Cujo GitHub App. post_blocking_review is gated.",
        },
      }),
    );

    const provider = this.config.bootstrap.modelProvider;
    if (provider) {
      await step(`model-provider ${provider.name}`, () =>
        this.client.settings.modelProviders.createOrUpdate({
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
        }),
      );
    }

    const daytonaApiKey = this.config.bootstrap.daytonaApiKey;
    if (daytonaApiKey) {
      await step("sandbox-provider daytona", () =>
        this.client.settings.sandboxProviders.createOrUpdate({
          manifest: {
            type: "daytona",
            auth: { apiKey: daytonaApiKey },
            autoStopIntervalInMinutes: 15,
            autoArchiveIntervalInMinutes: 60,
            autoDeleteIntervalInMinutes: 24 * 60,
            execTimeoutMs: 20 * 60 * 1000,
          },
        }),
      );
    }
    // Only a complete bootstrap counts: a turn on an unregistered model or
    // sandbox provider fails just as surely as one without github-mcp.
    this.ready = true;
    return applied;
  }

  /**
   * Retry bootstrap until every registration succeeds; a turn cannot run
   * without them. Backoff starts at 5s and doubles to a 60s ceiling.
   */
  async bootstrapUntilReady(
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ): Promise<void> {
    let delay = 5_000;
    while (!this.ready) {
      try {
        const applied = await this.bootstrap();
        console.log(`trueforge bootstrap: ${applied.join(", ")}`);
      } catch (error) {
        console.error(`trueforge bootstrap failed; retrying in ${delay / 1000}s`, error);
        await sleep(delay);
        delay = Math.min(delay * 2, 60_000);
      }
    }
  }

  /** One session per PR (Contract 5); the session title is not settable via the API. */
  async createSession(spec: TrueForgeApi.AgentSpec): Promise<string> {
    const { data } = await this.client.sessions.create({ agent: { spec } });
    return data.id;
  }

  /**
   * Create the turn and return its id; the caller subscribes separately. Two
   * calls instead of one streaming call so the run can record the turn as its
   * own before the fallible subscribe, and never has to guess which turn on
   * the shared session is its own.
   */
  private async createTurn(
    sessionId: string,
    input: TrueForgeApi.TurnInputItem[],
  ): Promise<string> {
    const { data } = await this.client.sessions.createTurn(sessionId, { input });
    return data.id;
  }

  /** Start the run's first turn; resolves to the turn id. */
  startTurn(sessionId: string, message: string): Promise<string> {
    return this.createTurn(sessionId, [{ type: "user.message", content: message }]);
  }

  /** Contract 4: one send answers the pending approval and starts a new turn. */
  resume(
    sessionId: string,
    approval: { threadId: string; toolCallId: string },
    decision: "allow" | "deny",
  ): Promise<string> {
    return this.createTurn(sessionId, [
      {
        type: "user.tool_approval",
        threadId: approval.threadId,
        toolCallId: approval.toolCallId,
        approval:
          decision === "allow"
            ? { status: "allow" }
            : { status: "deny", reason: "Rejected by a Cujo operator. Post nothing and stop." },
      },
    ]);
  }

  subscribe(sessionId: string, turnId: string): Promise<AsyncIterable<StreamEvent>> {
    return this.client.sessions.subscribeToTurn(sessionId, turnId, {});
  }

  /** Cancel the session's running last turn, if any. */
  async cancelTurn(sessionId: string): Promise<void> {
    await this.client.sessions.cancel(sessionId, {});
  }

  /** Every persisted event on the session's active branch, oldest first. */
  async listEvents(sessionId: string): Promise<{ turnId: string; event: SessionEvent }[]> {
    const items: { turnId: string; event: SessionEvent }[] = [];
    // 100 is the server's maximum page size; the SDK page walks the rest.
    const page = await this.client.sessions.listEvents(sessionId, { limit: 100 });
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
