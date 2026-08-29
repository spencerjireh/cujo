import { type Logger, createLogger, errorFields } from "@cujo/log";
import { TrueForge, type TrueForgeApi } from "@truefoundry/trueforge-sdk";
import type { Config } from "../config";

export type StreamEvent = TrueForgeApi.TurnStreamingEvent;
export type SessionEvent = TrueForgeApi.SessionEvent;
export type TurnCreatedEvent = TrueForgeApi.TurnCreatedEvent;
export type TurnDoneEvent = TrueForgeApi.TurnDoneEvent;
export type ToolApprovalRequiredEvent = TrueForgeApi.ToolApprovalRequiredEvent;

/** A human looked at the drafted block and said no. */
export const OPERATOR_DENY_REASON = "Rejected by a Cujo operator. Post nothing and stop.";

/**
 * Nobody said no. The approval is answered only so the session can take
 * another turn (decision 39); the commit the block described is no longer the
 * head, so there is nothing left to post about it.
 */
export const STALE_DENY_REASON =
  "Superseded: a newer commit replaced the review this block belongs to. Post nothing and end your turn.";

/** Minutes of idle before Daytona stops a sandbox: the turn timeout plus slack. */
export function sandboxAutoStopMinutes(turnTimeoutMs: number): number {
  return Math.ceil(turnTimeoutMs / 60_000) + 15;
}

/**
 * The only client of the TrueForge server (decision 17). Thin: it names the
 * calls apps/cujo makes so the rest of the code never touches the SDK shapes.
 */
export class Harness {
  readonly client: TrueForge;
  /** True once every bootstrap registration succeeded; webhooks wait for it. */
  ready = false;

  constructor(
    private readonly config: Config,
    private readonly log: Logger = createLogger({ service: "cujo" }),
  ) {
    // No token: the server runs without OIDC on the compose network, which
    // gives every caller the fixed local admin identity.
    // The SDK timeout also bounds a turn subscription, so it must outlast a
    // whole turn or the stream ends early on every long review.
    this.client = new TrueForge({
      baseUrl: config.trueforgeBaseUrl,
      timeoutInSeconds: Math.ceil((config.turnTimeoutMs ?? 30 * 60 * 1000) / 1000) + 60,
    });
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
          description: "Posts PR reviews as the Cujo GitHub App. post_gated_review is gated.",
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
              // What each model will accept as `model.params.reasoningEffort`
              // (decision 56). This was `{}`, which told the server the model
              // supports no effort at all — and a session naming one is then
              // refused, so every review 502s at the webhook while this process
              // still reports healthy.
              //
              // Declared per model because that is the only place it can go:
              // `CustomModelProvider` has no such field, and the catalog's
              // `supportedReasoningEfforts` is read-only.
              properties: provider.reasoningEfforts.length
                ? { reasoningEfforts: provider.reasoningEfforts as TrueForgeApi.ReasoningEffort[] }
                : {},
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
            // Idle stop must outlast a whole turn, or a long review loses its
            // sandbox mid-run; the sandbox is idle only after the turn ends.
            autoStopIntervalInMinutes: sandboxAutoStopMinutes(this.config.turnTimeoutMs),
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
    // The webhook answers 503 until this succeeds, and the loop is patient by
    // design, so `attempt` and `elapsed_ms` are what tell an operator whether
    // the harness is starting slowly or is never coming back.
    let attempt = 0;
    const startedAt = Date.now();
    while (!this.ready) {
      attempt += 1;
      try {
        const applied = await this.bootstrap();
        this.log.info("harness.bootstrap.ok", { steps: applied.length, attempt });
        this.log.info("harness.ready", { attempt, elapsed_ms: Date.now() - startedAt });
      } catch (error) {
        this.log.error("harness.bootstrap.failed", {
          attempt,
          retry_in_ms: delay,
          ...errorFields(error),
        });
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

  /**
   * Contract 4: one send answers the pending approval and starts a new turn.
   * The deny reason reaches the model, which `agent/SKILL.md` tells to end the
   * turn saying the block was denied, so it must say who denied it and why.
   */
  resume(
    sessionId: string,
    approval: { threadId: string; toolCallId: string },
    decision: "allow" | "deny",
    denyReason: string = OPERATOR_DENY_REASON,
  ): Promise<string> {
    return this.createTurn(sessionId, [
      {
        type: "user.tool_approval",
        threadId: approval.threadId,
        toolCallId: approval.toolCallId,
        approval:
          decision === "allow" ? { status: "allow" } : { status: "deny", reason: denyReason },
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
