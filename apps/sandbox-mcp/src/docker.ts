/**
 * The `docker` CLI, as a narrow typed call.
 *
 * `execFile` with an argv array and no shell, which is the same choice
 * `sniff.py run` makes and for the same reason: every string that reaches a
 * sandbox came out of a pull request, and a shell would make each one an
 * injection surface. Nothing here interpolates.
 *
 * The CLI rather than the Engine API over its unix socket, because the API needs
 * a dispatcher Node's `fetch` does not have and the only thing that would buy is
 * avoiding a binary the host already has.
 */

import { execFile } from "node:child_process";

export interface DockerResult {
  stdout: string;
  stderr: string;
  /** Null when docker itself was killed rather than exiting. */
  exitCode: number | null;
  timedOut: boolean;
}

export interface DockerOptions {
  /** Bound on one docker invocation, not on the command inside a container. */
  timeoutMs?: number;
  /** Bytes of each stream to keep. A runaway build log must not be unbounded. */
  maxBuffer?: number;
  stdin?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

export type Docker = (args: readonly string[], options?: DockerOptions) => Promise<DockerResult>;

/**
 * A `Docker` bound to a binary. Injected everywhere it is used, so the runtime
 * is testable with no daemon — the same shape `GitHubReader` takes `fetchImpl`.
 */
export function dockerCli(binary = "docker"): Docker {
  return (args, options = {}) =>
    new Promise<DockerResult>((resolve) => {
      const child = execFile(
        binary,
        [...args],
        {
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          // `killed` is how `execFile` reports its own timeout, and the signal
          // is the only thing that separates that from a command the runtime
          // stopped for its own reasons.
          const timedOut = Boolean(
            error && "killed" in error && (error as { killed?: boolean }).killed,
          );
          const code =
            error && "code" in error && typeof (error as { code?: unknown }).code === "number"
              ? ((error as { code: number }).code as number)
              : error
                ? null
                : 0;
          resolve({ stdout, stderr, exitCode: timedOut ? null : code, timedOut });
        },
      );
      if (options.stdin !== undefined) {
        child.stdin?.end(options.stdin);
      }
    });
}
