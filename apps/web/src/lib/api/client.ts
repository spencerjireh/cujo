import { environmentManager } from "@tanstack/react-query";
import type { Run, RunList } from "./types";

/**
 * Two call paths for the same API. On the server the fetch goes straight to
 * `apps/cujo` over the compose network, because a Server Component calling its
 * own route handler is a wasted hop. In the browser it goes to `/api/cujo/*`,
 * same-origin, so no CORS is involved.
 *
 * Neither carries a credential. There is none to carry since decision 57:
 * every route this app reads is the anonymous board.
 */

/** The one plane there is. Kept as a prefix because it is the live URL shape
 * `apps/cujo` serves, and because the proxy route refuses anything outside it. */
const PUBLIC_PREFIX = "/public";

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
  const res = await fetch(`${CUJO_API_URL()}${path}`, {
    headers: { accept: "application/json" },
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
  return get<RunList>(`${PUBLIC_PREFIX}/runs`, signal);
}

export function fetchRun(id: string, signal?: AbortSignal): Promise<Run> {
  return get<Run>(`${PUBLIC_PREFIX}/runs/${encodeURIComponent(id)}`, signal);
}

/** The one stream. A fixed path, so nothing the browser sends chooses it. */
export function runStreamUrl(id: string): string {
  return `/api/public/runs/${encodeURIComponent(id)}/events`;
}
