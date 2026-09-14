/**
 * A subprocess as a narrow typed call: `execFile` with an argv array and no
 * shell, the same choice `apps/sandbox-mcp/src/docker.ts` and `sniff.py run`
 * make and for the same reason. Every string that reaches this service came
 * out of a pull request — a clone URL, a title, a body — and a shell would
 * make each one an injection surface. Nothing here interpolates.
 */

import { execFile } from "node:child_process";

interface ExecResult {
  stdout: string;
  stderr: string;
  /** Null when the process was killed rather than exiting. */
  exitCode: number | null;
  timedOut: boolean;
}

interface ExecOptions {
  cwd?: string;
  /** The whole environment the child sees; nothing is inherited by default. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Bytes of each stream to keep. A runaway stream must not be unbounded. */
  maxBuffer?: number;
}

export type Exec = (
  binary: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

export function execFileNoShell(): Exec {
  return (binary, args, options = {}) =>
    new Promise<ExecResult>((resolve) => {
      execFile(
        binary,
        [...args],
        {
          cwd: options.cwd,
          env: options.env ?? {},
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          // `killed` is how `execFile` reports its own timeout.
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
    });
}
