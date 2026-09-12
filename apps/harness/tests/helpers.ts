import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSpec, SessionEvent, StreamEvent } from "@cujo/harness-contract";
import { createLogger } from "@cujo/log";
import { Engine, type EngineOptions } from "../src/engine";
import { Models } from "../src/model";
import { Store, openDatabase } from "../src/store";
import { STUB_MODEL, StubModel } from "./stub-model";

export interface Harness {
  engine: Engine;
  store: Store;
  models: Models;
  stub: StubModel;
  dataDir: string;
}

export async function harness(
  overrides: Partial<EngineOptions> & { dataDir?: string; stub?: StubModel } = {},
): Promise<Harness> {
  const dataDir = overrides.dataDir ?? mkdtempSync(join(tmpdir(), "cujo-harness-"));
  const store = overrides.store ?? new Store(openDatabase(join(dataDir, "harness.db")));
  const models = overrides.models ?? (await Models.create());
  const stub = overrides.stub ?? new StubModel();
  stub.register(models);
  const engine = new Engine({
    store,
    models,
    dataDir,
    log: createLogger({ service: "harness", level: "error", sink: () => undefined }),
    ...(overrides.connect ? { connect: overrides.connect } : {}),
  });
  return { engine, store, models, stub, dataDir };
}

export function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    model: { name: STUB_MODEL },
    instructions: "You review pull requests.",
    mcpServers: [],
    config: { iterationLimit: 20, compaction: { enabled: false } },
    ...overrides,
  };
}

export async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

export async function finished(
  engine: Engine,
  sessionId: string,
  turnId: string,
): Promise<SessionEvent[]> {
  const events = await collect(engine.subscribe(sessionId, turnId));
  return events.filter((event): event is SessionEvent => event.type !== "model.message.delta");
}

export const ofType = <T extends StreamEvent["type"]>(events: StreamEvent[], type: T) =>
  events.filter((event): event is Extract<StreamEvent, { type: T }> => event.type === type);

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
