import { environmentManager } from "@tanstack/react-query";
import { ApiError, CUJO_API_URL } from "./client";
import type { Run, RunList } from "./types";

/**
 * The owner plane's client (decision 156). Two call paths like the board's:
 * in the browser through `/api/cujo/owner/*`, where the proxy turns the
 * session cookie into the bearer; on the server straight to `apps/cujo`
 * with the bearer the page read off the cookie and passes in. Neither path
 * ever sees the client secret; only `apps/cujo` holds that.
 */

export interface Me {
  login: string;
  is_owner: boolean;
  expires_at: string;
}

export interface OwnedRepository {
  repo: string;
  displayName: string;
  installationId: number;
  isPrivate: boolean;
  enabled: boolean;
  addedAt: string;
  removedAt: string | null;
  updatedAt: string;
}

export type ReviewMode = "sandbox" | "diff";
type Layer = "file" | "board" | "instance";

export interface RepositorySettingsView {
  board: { mode: ReviewMode | null; instructions: string | null; updated_at: string | null };
  file: { mode: ReviewMode | null; instructions: string | null; path: string };
  instance: { mode: ReviewMode };
  effective: {
    mode: { value: ReviewMode; source: Layer };
    instructions: { text: string; truncated: boolean; source: "file" | "board" } | null;
  };
}

const OWNER = "/owner";

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // the status text is what is left
  }
  return res.statusText || `request failed with ${res.status}`;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; session?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const server = environmentManager.isServer();
  const url = server ? `${CUJO_API_URL()}${OWNER}${path}` : `/api/cujo${OWNER}${path}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(server && init.session ? { authorization: `Bearer ${init.session}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: init.signal,
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as T;
}

/** Who is signed in. 401 means nobody; the caller decides what that looks like. */
export function fetchMe(session?: string, signal?: AbortSignal): Promise<Me> {
  return call<Me>("/me", { session, signal });
}

/**
 * The runs as an owner sees them, private ones included (decision 159): the
 * public plane's shapes, so every component that draws a run draws these.
 */
export function fetchOwnerRuns(session?: string, signal?: AbortSignal): Promise<RunList> {
  return call<RunList>("/runs", { session, signal });
}

export function fetchOwnerRun(id: string, session?: string, signal?: AbortSignal): Promise<Run> {
  return call<Run>(`/runs/${encodeURIComponent(id)}`, { session, signal });
}

export async function fetchRepositories(
  session?: string,
  signal?: AbortSignal,
): Promise<OwnedRepository[]> {
  const body = await call<{ repositories: OwnedRepository[] }>("/repositories", {
    session,
    signal,
  });
  return body.repositories;
}

export function fetchRepositorySettings(
  repo: string,
  session?: string,
  signal?: AbortSignal,
): Promise<RepositorySettingsView> {
  return call<RepositorySettingsView>(`/repositories/${repoPath(repo)}/settings`, {
    session,
    signal,
  });
}

export async function setRepositoryEnabled(
  repo: string,
  enabled: boolean,
): Promise<OwnedRepository> {
  const body = await call<{ repository: OwnedRepository }>(`/repositories/${repoPath(repo)}`, {
    method: "PATCH",
    body: { enabled },
  });
  return body.repository;
}

export function saveRepositorySettings(
  repo: string,
  patch: { mode?: ReviewMode | null; instructions?: string | null },
): Promise<unknown> {
  return call(`/repositories/${repoPath(repo)}/settings`, { method: "PATCH", body: patch });
}

/** `owner/name` as two path segments, each encoded. */
function repoPath(repo: string): string {
  return repo
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/** The eight instance settings (decision 152), the provider's key masked. */
export interface InstanceSettings {
  model: string;
  modelReasoningEffort: string;
  modelTemperature: number | null;
  modelMaxTokens: number | null;
  diffModel: string;
  diffBudgetTokens: number;
  reviewMode: ReviewMode;
  modelProvider: {
    name: string;
    baseUrl: string;
    apiKey: string;
    models: { name: string; modelId: string }[];
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
  } | null;
}

type SettingSource = "seed" | "owner";

export interface InstanceSettingsView {
  settings: InstanceSettings;
  sources: Record<keyof InstanceSettings, SettingSource>;
}

export interface BotState {
  app: {
    slug: string;
    name: string;
    htmlUrl: string;
    permissions: Record<string, string>;
    events: string[];
  };
  permissions: { name: string; needed: "read" | "write"; held: string | null; ok: boolean }[];
  installations: {
    id: number;
    account: { login: string; type: string };
    suspended: boolean;
    repositorySelection: string;
    repositories: number;
  }[];
  deliveries: {
    id: number;
    event: string;
    action: string | null;
    deliveredAt: string;
    status: string;
    statusCode: number | null;
    durationS: number | null;
    redelivery: boolean;
  }[];
}

export interface Health {
  harness: "ready" | "bootstrapping";
  store: "ok" | "error";
  uptimeMs: number;
  ready: boolean;
}

export function fetchInstanceSettings(
  session?: string,
  signal?: AbortSignal,
): Promise<InstanceSettingsView> {
  return call<InstanceSettingsView>("/settings", { session, signal });
}

export function saveInstanceSettings(
  patch: Partial<InstanceSettings>,
): Promise<InstanceSettingsView> {
  return call<InstanceSettingsView>("/settings", { method: "PATCH", body: patch });
}

export function fetchBot(session?: string, signal?: AbortSignal): Promise<BotState> {
  return call<BotState>("/bot", { session, signal });
}

export function fetchHealth(session?: string, signal?: AbortSignal): Promise<Health> {
  return call<Health>("/health", { session, signal });
}
