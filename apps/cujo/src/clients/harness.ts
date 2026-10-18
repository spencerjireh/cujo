import {
  type AgentSpecInput,
  type ModelProviderManifestInput,
  type ProviderModel,
  type ProviderTestResult,
  type SessionEvent,
  SessionEventSchema,
  type StreamEvent,
  StreamEventSchema,
  type Turn,
  type TurnInputItem,
} from "@cujo/harness-contract";
import { type Logger, createLogger, errorFields } from "@cujo/log";
import type { Config, ProviderConfig } from "../config";

export type { SessionEvent, StreamEvent };
export type {
  TurnCreatedEvent,
  TurnDoneEvent,
} from "@cujo/harness-contract";

/**
 * The wire shape of a provider. An OpenAI-compatible host's limits are one
 * value per provider on the board and one per model on the harness, so they
 * are copied onto each.
 */
function manifestOf(provider: ProviderConfig): ModelProviderManifestInput {
  if (provider.kind === "anthropic") return provider;
  return {
    kind: "openai",
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    models: provider.models.map((m) => ({
      name: m.name,
      modelId: m.modelId,
      contextWindow: provider.contextWindow,
      maxTokens: provider.maxTokens,
      reasoning: provider.reasoning,
    })),
  };
}

/** What the harness answers a refused request with. */
export class HarnessRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    message: string,
  ) {
    super(message);
    this.name = "HarnessRequestError";
  }
}

/**
 * The only client of `apps/harness` (decision 123). Thin: it names the eight
 * calls apps/cujo makes, so the rest of the code never touches a wire shape.
 */
export class Harness {
  /** True once every bootstrap registration succeeded; webhooks wait for it. */
  ready = false;
  /**
   * Where the providers to register come from. The environment at first, and
   * the settings store once `index.ts` points this at it (decisions 152, 174),
   * so a provider changed at runtime is what the next registration carries.
   */
  modelProviders: () => ProviderConfig[];
  /** The provider names the harness holds right now, for "is a model configured". */
  private readonly registered = new Set<string>();
  private readonly baseUrl: string;

  constructor(
    private readonly config: Config,
    private readonly log: Logger = createLogger({ service: "cujo" }),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // No token: the harness sits on the compose network and answers to nobody
    // else; there is no credential to present.
    this.baseUrl = config.harnessBaseUrl.replace(/\/+$/, "");
    this.modelProviders = () => config.bootstrap.modelProviders;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
        : {}),
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const error = (json ?? {}) as Record<string, unknown>;
      throw new HarnessRequestError(
        response.status,
        error,
        `harness ${method} ${path} answered ${response.status}: ${String(error.error ?? text)}`,
      );
    }
    return json as T;
  }

  /**
   * Register what the agent spec references by name. Idempotent: every call is
   * an upsert, so a restart re-applies the same settings.
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
      this.request("PUT", "/settings/mcp-servers", {
        name: "github-mcp",
        url: this.config.githubMcpUrl,
        description: "Posts PR reviews as the Cujo GitHub App.",
      }),
    );

    await step("mcp-server sandbox-mcp", () =>
      this.request("PUT", "/settings/mcp-servers", {
        name: "sandbox-mcp",
        url: this.config.sandboxMcpUrl,
        description:
          "Provisions a disposable sandbox and runs commands in it. " +
          "Egress is denied by default and enforced outside the sandbox.",
      }),
    );

    for (const provider of this.modelProviders()) {
      await step(`model-provider ${provider.name}`, () => this.registerModelProvider(provider));
    }

    // Only a complete bootstrap counts: a turn on an unregistered model fails
    // just as surely as one without github-mcp.
    this.ready = true;
    return applied;
  }

  /**
   * One provider, upserted by name (decision 127): the harness persists it and
   * re-registers it live, so a call after boot takes effect on the next turn.
   * Called by `bootstrap` and, at runtime, when the setting changes.
   */
  async registerModelProvider(provider: ProviderConfig): Promise<void> {
    await this.request("PUT", "/settings/model-providers", manifestOf(provider));
    this.registered.add(provider.name);
  }

  async unregisterModelProvider(name: string): Promise<void> {
    await this.request("DELETE", `/settings/model-providers/${encodeURIComponent(name)}`);
    this.registered.delete(name);
  }

  /**
   * Bring the harness from one list to the next: every provider that is new
   * or changed is put, every one that is gone is deleted. Each is its own
   * call, so one that fails leaves the rest applied; the error names it.
   */
  async syncModelProviders(previous: ProviderConfig[], next: ProviderConfig[]): Promise<void> {
    const failures: string[] = [];
    const before = new Map(previous.map((provider) => [provider.name, JSON.stringify(provider)]));
    for (const provider of next) {
      if (before.get(provider.name) === JSON.stringify(provider)) continue;
      await this.registerModelProvider(provider).catch(() => failures.push(provider.name));
    }
    const kept = new Set(next.map((provider) => provider.name));
    for (const name of before.keys()) {
      if (kept.has(name)) continue;
      await this.unregisterModelProvider(name).catch(() => failures.push(name));
    }
    if (failures.length > 0) throw new Error(`providers not synced: ${failures.join(", ")}`);
  }

  isRegistered(name: string): boolean {
    return this.registered.has(name);
  }

  /** What a provider offers, asked before it is saved (decision 174). */
  async listProviderModels(provider: ProviderConfig): Promise<ProviderModel[]> {
    const { models } = await this.request<{ models: ProviderModel[] }>(
      "POST",
      "/settings/model-providers/models",
      { manifest: manifestOf(provider) },
    );
    return models;
  }

  /** One short call on a provider that is not registered; a failure is an answer, not a throw. */
  testProvider(provider: ProviderConfig, model: string): Promise<ProviderTestResult> {
    return this.request("POST", "/settings/model-providers/test", {
      manifest: manifestOf(provider),
      model,
    });
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

  /** One session per PR (Contract 5). */
  async createSession(spec: AgentSpecInput): Promise<string> {
    const { id } = await this.request<{ id: string }>("POST", "/sessions", { spec });
    return id;
  }

  /**
   * Create the turn and return its id; the caller subscribes separately. Two
   * calls instead of one streaming call so the run can record the turn as its
   * own before the fallible subscribe, and never has to guess which turn on
   * the shared session is its own.
   */
  private async createTurn(sessionId: string, input: TurnInputItem[]): Promise<string> {
    const { id } = await this.request<{ id: string }>("POST", `/sessions/${sessionId}/turns`, {
      input,
    });
    return id;
  }

  /** Start the run's first turn; resolves to the turn id. */
  startTurn(sessionId: string, message: string): Promise<string> {
    return this.createTurn(sessionId, [{ type: "user.message", content: message }]);
  }

  /**
   * The turn's events from its `turn.created`, replayed then live, until its
   * `turn.done`. The harness closes the stream after that; an end before it is
   * a dropped connection.
   */
  async subscribe(sessionId: string, turnId: string): Promise<AsyncIterable<StreamEvent>> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/sessions/${sessionId}/turns/${turnId}/subscribe`,
      { headers: { accept: "text/event-stream" } },
    );
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new HarnessRequestError(
        response.status,
        {},
        `harness subscribe answered ${response.status}: ${text}`,
      );
    }
    return readSse(response.body);
  }

  /** Cancel the session's running turn, if any. */
  async cancelTurn(sessionId: string): Promise<void> {
    await this.request("POST", `/sessions/${sessionId}/cancel`);
  }

  /** Every stored event on the session, oldest first. No cap (decision 123). */
  async listEvents(sessionId: string): Promise<{ turnId: string; event: SessionEvent }[]> {
    const items = await this.request<{ turnId: string; event: unknown }[]>(
      "GET",
      `/sessions/${sessionId}/events`,
    );
    return items.map((item) => ({
      turnId: item.turnId,
      event: SessionEventSchema.parse(item.event),
    }));
  }

  listTurns(sessionId: string): Promise<Turn[]> {
    return this.request<Turn[]>("GET", `/sessions/${sessionId}/turns`);
  }
}

/**
 * The harness's SSE framing: `event: event` frames carry one JSON event in
 * `data:`; `keepalive` frames carry nothing. Blank line ends a frame.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): StreamEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (name !== "event" || data.length === 0) return null;
  return StreamEventSchema.parse(JSON.parse(data.join("\n")));
}
