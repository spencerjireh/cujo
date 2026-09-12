/**
 * The own runtime: a container on this host, with egress enforced outside it.
 *
 * This is the point of the whole track. Daytona tier one gives no sandbox-level
 * egress policy, which is why the in-sandbox logging proxy became load-bearing —
 * the thing enforcing the trust boundary sat on the untrusted side of it, which
 * was the weakest joint in the two-zone story. Here the control is a container
 * the pull request's code cannot reach, on a network it has no route off
 * (decisions 114, 116).
 *
 * **Shape.** One network per sandbox, created `--internal` so Docker installs no
 * default route. The sandbox joins it and nothing else. A gateway container joins
 * that network *and* a second one with outside access, holds the only route out,
 * and filters with nftables from the allowlist it was given at creation. Code
 * inside the sandbox can reach the gateway and cannot reconfigure it: they share
 * no namespace, no filesystem and no process tree.
 *
 * The in-sandbox proxy keeps running and keeps recording `egress[]` rows. It is a
 * sensor now, which is what it should always have been — its verdict is no longer
 * what refuses a connection.
 *
 * **gVisor over a microVM.** `runsc` installs as a Docker runtime beside the
 * default and needs no VMM, no rootfs pipeline and no per-VM bridge setup.
 * Firecracker buys isolation against a kernel escape and costs all of that; the
 * threat this sandbox exists to contain is exfiltration, and the deciding factor
 * was egress enforcement at the network layer rather than cold start. The runtime
 * name is configurable, so a host without `runsc` falls back to the default one
 * and says so rather than failing to start.
 *
 * **Everything vendor-shaped comes from this process's own environment**: the
 * image, the gateway image, the container runtime, the workdir. Nothing is taken
 * from a caller, for the reason `github-mcp` holds `publicBaseUrl` in its env.
 */

import { randomUUID } from "node:crypto";
import { type Logger, createLogger, errorFields } from "@cujo/log";
import { type Docker, dockerCli } from "../docker";
import {
  type ExecRequest,
  type ExecResult,
  type Sandbox,
  SandboxError,
  type SandboxRuntime,
  type SandboxSpec,
} from "../runtime";

export interface LocalRuntimeOptions {
  /** The sandbox image. This deployment's, never a caller's. */
  image: string;
  /** The egress gateway image, built from `gateway/Dockerfile`. */
  gatewayImage: string;
  /**
   * The container runtime. `runsc` is gVisor; empty uses Docker's default.
   *
   * Optional on purpose. A host that has not had gVisor installed yet still runs
   * sandboxes, with weaker isolation and a log line saying so — a sandbox
   * service that refuses to start on a half-provisioned host is a worse failure
   * than one that is honest about what it is.
   */
  containerRuntime?: string;
  /** The network the gateway reaches the internet through. */
  egressNetwork?: string;
  docker?: Docker;
  log?: Logger;
  /** Seconds a container may idle before it is reaped. */
  maxLifetimeMs?: number;
}

interface Box {
  id: string;
  container: string;
  gateway: string;
  network: string;
  createdAt: number;
}

const DEFAULT_EXEC_TIMEOUT_MS = 20 * 60 * 1000;
/** Names are derived from the id, so one sandbox's resources are findable. */
const PREFIX = "cujo-sbx";

export class LocalRuntime implements SandboxRuntime {
  readonly name = "local";
  private readonly boxes = new Map<string, Box>();
  private readonly docker: Docker;
  private readonly log: Logger;

  constructor(private readonly options: LocalRuntimeOptions) {
    this.docker = options.docker ?? dockerCli();
    this.log = options.log ?? createLogger({ service: "sandbox-mcp" });
  }

  private async run(args: readonly string[], timeoutMs?: number): Promise<string> {
    const result = await this.docker(args, timeoutMs === undefined ? {} : { timeoutMs });
    if (result.exitCode !== 0) {
      // `args[0]` and not the whole argv: the rest can hold a caller's command,
      // and this message reaches a log and possibly a tool result.
      throw new SandboxError(
        "provision_failed",
        `docker ${args[0]} exited ${result.exitCode}: ${result.stderr.trim().slice(0, 400)}`,
      );
    }
    return result.stdout.trim();
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const started = Date.now();
    const id = randomUUID();
    const network = `${PREFIX}-net-${id.slice(0, 8)}`;
    const container = `${PREFIX}-${id.slice(0, 8)}`;
    const gateway = `${PREFIX}-gw-${id.slice(0, 8)}`;
    const runtimeArgs = this.options.containerRuntime
      ? ["--runtime", this.options.containerRuntime]
      : [];
    if (runtimeArgs.length === 0) {
      this.log.warn("sandbox.runtime.default", {
        reason: "no_container_runtime_configured",
      });
    }

    try {
      // `--internal` is the load-bearing flag: Docker installs no default route
      // on an internal network, so the sandbox's only way out is a container
      // that is also on another one.
      await this.run(["network", "create", "--internal", network]);

      // The gateway first, so the sandbox never exists with no filter in front
      // of it. NET_ADMIN because it writes its own nftables rules; it is the one
      // container here that gets a capability, and it holds no pull request code.
      await this.run([
        "run",
        "--detach",
        "--name",
        gateway,
        "--network",
        network,
        "--cap-add",
        "NET_ADMIN",
        "--env",
        // One argv entry, so a hostname cannot become two. Already validated as
        // hostnames with no whitespace or control characters (`allowlist.ts`).
        `CUJO_ALLOW_HOSTS=${spec.allowHosts.join(",")}`,
        this.options.gatewayImage,
      ]);
      // Its second leg, which is the only route off the internal network.
      await this.run(["network", "connect", this.options.egressNetwork ?? "bridge", gateway]);

      await this.run([
        "run",
        "--detach",
        ...runtimeArgs,
        "--name",
        container,
        "--network",
        network,
        // No capability at all, and no new ones: this is where the pull request's
        // code runs.
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        // Keeps the container alive so `exec` has something to enter. The image
        // owns this command; a caller never chooses it.
        "--entrypoint",
        "sleep",
        this.options.image,
        "infinity",
      ]);

      const box: Box = { id, container, gateway, network, createdAt: Date.now() };
      this.boxes.set(id, box);
      const provisionedMs = Date.now() - started;
      this.log.info("sandbox.created", {
        reason: this.name,
        duration_ms: provisionedMs,
      });
      return { id, provisionedMs };
    } catch (error) {
      // Half a sandbox is worse than none: it holds a network and two containers
      // nobody will ever ask about again.
      await this.reap({ id, container, gateway, network, createdAt: started }).catch(() => {});
      if (error instanceof SandboxError) throw error;
      throw new SandboxError("provision_failed", String(error));
    }
  }

  private box(id: string): Box {
    const box = this.boxes.get(id);
    if (!box) throw new SandboxError("no_such_sandbox", "no such sandbox");
    return box;
  }

  async exec(id: string, request: ExecRequest): Promise<ExecResult> {
    const box = this.box(id);
    if (request.argv.length === 0) {
      throw new SandboxError("refused", "argv is empty");
    }
    const args = ["exec"];
    if (request.cwd) args.push("--workdir", request.cwd);
    for (const [key, value] of Object.entries(request.env ?? {})) {
      // One `--env` per pair, values passed as a single argv entry, so nothing
      // in a value can become another flag.
      args.push("--env", `${key}=${value}`);
    }
    args.push(box.container, ...request.argv);
    const started = Date.now();
    const timeoutMs = request.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const result = await this.docker(args, { timeoutMs });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - started,
      timedOut: result.timedOut,
    };
  }

  async writeFile(id: string, path: string, contents: string): Promise<void> {
    const box = this.box(id);
    // Through stdin rather than `docker cp` from a host temp file: nothing the
    // caller sends ever lands on this host's filesystem.
    const result = await this.docker(
      ["exec", "--interactive", box.container, "sh", "-c", 'cat > "$1"', "sh", path],
      { stdin: contents },
    );
    if (result.exitCode !== 0) {
      throw new SandboxError("io_failed", `write failed: ${result.stderr.trim().slice(0, 200)}`);
    }
  }

  async readFile(id: string, path: string, maxBytes = 1024 * 1024): Promise<string> {
    const box = this.box(id);
    const result = await this.docker(
      ["exec", box.container, "head", "-c", String(maxBytes), path],
      { maxBuffer: maxBytes + 1024 },
    );
    if (result.exitCode !== 0) {
      throw new SandboxError("io_failed", `read failed: ${result.stderr.trim().slice(0, 200)}`);
    }
    return result.stdout;
  }

  private async reap(box: Box): Promise<void> {
    // Each step on its own, because one failure must not leave the others behind.
    for (const name of [box.container, box.gateway]) {
      const result = await this.docker(["rm", "--force", name]);
      if (result.exitCode !== 0) {
        this.log.warn("sandbox.reap.failed", { reason: "container" });
      }
    }
    const net = await this.docker(["network", "rm", box.network]);
    if (net.exitCode !== 0) this.log.warn("sandbox.reap.failed", { reason: "network" });
  }

  async destroy(id: string): Promise<void> {
    const box = this.boxes.get(id);
    if (!box) return;
    this.boxes.delete(id);
    await this.reap(box);
  }

  /**
   * Drop anything older than the lifetime bound.
   *
   * A sandbox whose caller went away still holds a network and two containers,
   * and this process is the only thing that knows they belong together. Called
   * on a timer by `index.ts`.
   */
  async reapExpired(now = Date.now()): Promise<number> {
    const limit = this.options.maxLifetimeMs ?? 2 * 60 * 60 * 1000;
    let reaped = 0;
    for (const [id, box] of [...this.boxes]) {
      if (now - box.createdAt < limit) continue;
      this.boxes.delete(id);
      reaped += 1;
      await this.reap(box).catch((error) =>
        this.log.warn("sandbox.reap.failed", { reason: "expired", ...errorFields(error) }),
      );
    }
    return reaped;
  }
}
