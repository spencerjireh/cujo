/**
 * What a sandbox is, as an interface.
 *
 * The whole reason this file exists is one string literal. TrueForge's SDK types
 * its sandbox provider as `type: "daytona"` — not a union, and the wire
 * serializer uses `stringLiteral("daytona")`, so casting past the type is
 * rejected at runtime too. `auth` is `DaytonaSandboxProviderAuth` directly, there
 * is no image field anywhere in the SDK, and the provider is a singleton per
 * tenant with only `get()` and `createOrUpdate()`. On that shape you cannot drop
 * Daytona and keep the harness, and you cannot register a second provider and
 * switch (decision 113).
 *
 * So nothing here may name a vendor. No API key, no auto-archive interval, no
 * exec timeout named after somebody's knob. A runtime is five operations and a
 * name, and the deployment picks one with an environment variable.
 *
 * **Ids are the server's, not the vendor's.** `Sandbox.id` is minted here and
 * means nothing outside this process, for the reason `github-mcp` mints its own
 * run id rather than taking a URL from the agent: the caller's input has been
 * read out of a pull request, and a vendor handle that crossed back in would let
 * it name a box somebody else is using.
 */

/** What a caller asks for. Nothing vendor-specific, and nothing a host. */
export interface SandboxSpec {
  /**
   * Hostnames the sandbox may reach, already validated (see `allowlist.ts`).
   *
   * This list is derived from a repository's own `.cujo.yml`, so it is untrusted
   * text reaching a trusted-side control — which is a new crossing and is why it
   * is validated before a runtime ever sees it (decision 116).
   */
  allowHosts: readonly string[];
}

export interface Sandbox {
  /** Minted by this process. Opaque, and never a vendor handle. */
  readonly id: string;
  /**
   * How long provisioning took.
   *
   * Load-bearing rather than informational. `sandbox.created` is a *harness*
   * event, and with the harness no longer provisioning anything it is never
   * emitted — so `setup.sandboxCreatedAt` and every `sandboxMs` on the board
   * would go permanently null, and the spec documents null as meaning the
   * sandbox was already there. This number is what keeps that field from
   * quietly becoming a lie (decision 115).
   */
  readonly provisionedMs: number;
}

export interface ExecRequest {
  /**
   * The command, as argv. Never a shell string: the caller's text came out of a
   * pull request, and a shell would make it an injection surface. `sniff.py run`
   * takes argv for the same reason.
   */
  argv: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** Killed at this bound. The runtime's own default applies when absent. */
  timeoutMs?: number;
}

export interface ExecResult {
  /** Null when the process was killed rather than exiting on its own. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Whether the runtime stopped it at `timeoutMs`, which `exitCode` cannot say. */
  timedOut: boolean;
}

/**
 * One sandbox runtime. Daytona is one implementation of this and not its shape.
 *
 * Every method takes the sandbox id rather than a handle object, so the server
 * stays stateless per request the way `github-mcp` is and a restart loses
 * nothing but the in-memory index.
 */
export interface SandboxRuntime {
  /** For the log and the healthcheck. Not a discriminator anybody switches on. */
  readonly name: string;
  create(spec: SandboxSpec): Promise<Sandbox>;
  exec(id: string, request: ExecRequest): Promise<ExecResult>;
  writeFile(id: string, path: string, contents: string): Promise<void>;
  readFile(id: string, path: string, maxBytes?: number): Promise<string>;
  destroy(id: string): Promise<void>;
}

/** A runtime refusing a request, with a reason a caller may be told. */
export class SandboxError extends Error {
  constructor(
    readonly reason:
      | "no_such_sandbox"
      | "provision_failed"
      | "exec_failed"
      | "io_failed"
      | "refused",
    message: string,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}
