import { environmentManager } from "@tanstack/react-query";
import type { ApproveResult, Run, RunList } from "./types";

/**
 * Two call paths for the same API. On the server the fetch goes straight to
 * `apps/cujo` over the compose network, because a Server Component calling its
 * own route handler is a wasted hop. In the browser it goes to `/api/cujo/*`,
 * same-origin, so the Cloudflare Access cookie rides along and no CORS is
 * involved.
 */

export const CUJO_API_URL = () => process.env.CUJO_API_URL ?? "http://cujo:8080";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // fall through to the status text
  }
  return res.statusText || `request failed with ${res.status}`;
}

async function serverGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  // Imported lazily so the module stays usable from a client component.
  const { headers } = await import("next/headers");
  const incoming = await headers();
  const assertion = incoming.get("cf-access-jwt-assertion");
  const host = incoming.get("host");
  const res = await fetch(`${CUJO_API_URL()}${path}`, {
    headers: {
      accept: "application/json",
      ...(assertion ? { "cf-access-jwt-assertion": assertion } : {}),
      ...(host ? { "x-forwarded-host": host } : {}),
    },
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as T;
}

async function browserGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/cujo${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as T;
}

function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return environmentManager.isServer() ? serverGet<T>(path, signal) : browserGet<T>(path, signal);
}

export function fetchRuns(signal?: AbortSignal): Promise<RunList> {
  return get<RunList>("/runs", signal);
}

export function fetchRun(id: string, signal?: AbortSignal): Promise<Run> {
  return get<Run>(`/runs/${encodeURIComponent(id)}`, signal);
}

/** Browser-only: the decision always originates from a click. */
export async function approveRun(id: string, decision: "allow" | "deny"): Promise<ApproveResult> {
  const res = await fetch(`/api/cujo/runs/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as ApproveResult;
}

export function runStreamUrl(id: string): string {
  return `/api/runs/${encodeURIComponent(id)}/events`;
}
