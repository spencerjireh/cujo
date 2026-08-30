/**
 * Compile-time guard: the fields our schema requires must exist on the SDK's
 * event types. If the SDK drops or renames a field we declared as required,
 * `tsc --noEmit` fails here — catching drift at build time.
 *
 * Zod's `.passthrough()` adds an index signature (`{ [k: string]: unknown }`)
 * that TypeScript interfaces don't carry, so a direct union assignability
 * check is not possible. Instead, we verify each SDK event variant's fields
 * individually.
 */

import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { describe, expect, it } from "vitest";
import type {
  SessionEvent,
  ToolApprovalRequiredEvent,
  TurnCreatedEvent,
  TurnDoneEvent,
} from "../../src/clients/trueforge";

describe("SDK event types carry the fields the schema requires", () => {
  it("TurnCreatedEvent has turnId, previousTurnId, createdAt, id", () => {
    const _check = (e: TurnCreatedEvent) => {
      const _turnId: string = e.turnId;
      const _prev: string | null | undefined = e.previousTurnId;
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_turnId, _prev, _id, _at];
    };
    expect(true).toBe(true);
  });

  it("TurnDoneEvent has state with status, createdAt, id", () => {
    const _check = (e: TurnDoneEvent) => {
      const _status: string = e.state.status;
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_status, _id, _at];
    };
    expect(true).toBe(true);
  });

  it("ModelMessageEvent has threadId, id, createdAt", () => {
    const _check = (e: TrueForgeApi.ModelMessageEvent) => {
      const _thread: string = e.threadId;
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_thread, _id, _at];
    };
    expect(true).toBe(true);
  });

  it("ThreadCreatedEvent has threadId, title, id, createdAt", () => {
    const _check = (e: TrueForgeApi.ThreadCreatedEvent) => {
      const _thread: string = e.threadId;
      const _title: string = e.title;
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_thread, _title, _id, _at];
    };
    expect(true).toBe(true);
  });

  it("ToolApprovalRequiredEvent has threadId, toolCalls, id, createdAt", () => {
    const _check = (e: ToolApprovalRequiredEvent) => {
      const _thread: string = e.threadId;
      const _calls: { id: string; sourceEventId: string }[] = e.toolCalls;
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_thread, _calls, _id, _at];
    };
    expect(true).toBe(true);
  });

  it("ThreadDoneEvent has threadId, state with status, id, createdAt", () => {
    const _check = (e: TrueForgeApi.ThreadDoneEvent) => {
      const _thread: string = e.threadId;
      const _status: string = e.state.status;
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_thread, _status, _id, _at];
    };
    expect(true).toBe(true);
  });

  it("ToolResponseEvent has toolCallId, id, createdAt", () => {
    const _check = (e: TrueForgeApi.ToolResponseEvent) => {
      const _callId: string = e.toolCallId;
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_callId, _id, _at];
    };
    expect(true).toBe(true);
  });

  it("SandboxCreatedEvent has id, createdAt", () => {
    const _check = (e: TrueForgeApi.SandboxCreatedEvent) => {
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_id, _at];
    };
    expect(true).toBe(true);
  });

  it("all SessionEvent variants have id and createdAt", () => {
    const _check = (e: SessionEvent) => {
      const _id: string = e.id;
      const _at: string = e.createdAt;
      void [_id, _at];
    };
    expect(true).toBe(true);
  });
});
