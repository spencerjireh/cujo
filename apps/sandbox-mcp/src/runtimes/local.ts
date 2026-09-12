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
 * **Shape.** One network per sandbox, created with the bridge's own address
 * inhibited and host masquerade off, so the host holds no address on it and
 * routes nothing for it. Docker still installs the sandbox's default route via
 * the subnet's gateway address; the gateway container claims that address and
 * so is the only thing the route leads to (decision 121). The gateway joins that
 * network *and* a second one with outside access, forwards through nftables from
 * the allowlist it was given at creation, and runs the resolver the sandbox is
 * pointed at, which answers for allowlisted names and nothing else. Code inside
 * the sandbox can reach the gateway and cannot reconfigure it: they share no
 * namespace, no filesystem and no process tree, and the sandbox holds no
 * capability that could change a route.
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
  /**
   * Hosts every sandbox may reach, before a repository asks for anything.
   * Default: `BASELINE_HOSTS`, the clone host and the package indexes.
   */
  baselineHosts?: string[];
  /** How long to wait for the gateway to report its rules armed. */
  gatewayReadyTimeoutMs?: number;
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
/**
 * Hosts an install legitimately talks to, allowed on every sandbox.
 *
 * The same set as `KNOWN_INDEX_HOSTS` in `sandbox/cujo_sniff/policy.py`, and a
 * test holds the two in step. The sensor uses it to say which egress was
 * *expected*; the gateway uses it to say which egress is *possible*. Those have
 * to be one list: an install that the sensor would call clean and the gateway
 * refuses is a review with no evidence, which is what orders-api #40 was
 * (decision 122). A repository's `allow_hosts` adds to this; it cannot remove
 * from it, and it never needs to name a registry.
 */
export const BASELINE_HOSTS: readonly string[] = [
  "github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
  "pypi.org",
  "files.pythonhosted.org",
  "registry.npmjs.org",
  "crates.io",
  "static.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
  "rubygems.org",
  "index.rubygems.org",
];
const DEFAULT_GATEWAY_READY_TIMEOUT_MS = 15_000;
/** The line `gateway/entrypoint.sh` prints once its rules and resolver are up. */
const GATEWAY_ARMED = "gateway.armed";

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

    // The baseline first, then the repository's additions, minus repeats: a
    // name that is both would otherwise be two rules and two resolver entries.
    const allowHosts = [
      ...new Set([...(this.options.baselineHosts ?? BASELINE_HOSTS), ...spec.allowHosts]),
    ];

    try {
      // Not `--internal`, which is what this first shipped as: an internal
      // network gives the sandbox no default route at all and no upstream DNS,
      // so nothing in it could reach the gateway as a router, and nothing could
      // resolve a name (decision 121). Instead the two bridge options below:
      // `inhibit_ipv4` keeps the host from taking the subnet's gateway address,
      // so the default route Docker installs in the sandbox leads to an address
      // nobody holds until the gateway container claims it; and no masquerade,
      // so the host NATs nothing for this subnet even if a packet reached it.
      await this.run([
        "network",
        "create",
        "--opt",
        "com.docker.network.bridge.inhibit_ipv4=true",
        "--opt",
        "com.docker.network.bridge.enable_ip_masquerade=false",
        network,
      ]);
      // The address the sandbox's default route points at, reserved by IPAM and
      // held by nobody on the wire. The gateway takes it.
      const gatewayIp = await this.run([
        "network",
        "inspect",
        "--format",
        "{{(index .IPAM.Config 0).Gateway}}",
        network,
      ]);
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(gatewayIp)) {
        throw new SandboxError("provision_failed", "network has no IPv4 gateway address");
      }

      // The gateway first, so the sandbox never exists with no filter in front
      // of it. NET_ADMIN because it writes its own nftables rules and claims the
      // gateway address; it is the one container here that gets a capability,
      // and it holds no pull request code. Forwarding is switched on here rather
      // than by the script, because `/proc/sys` is read-only in a container.
      //
      // Created, connected, then started -- not `run`: the script reads its
      // routing table on its first line, and a container started with one leg
      // has that leg as its default route until the second is attached, which
      // is the wrong answer to "which way is out".
      await this.run([
        "create",
        "--name",
        gateway,
        "--network",
        network,
        "--cap-add",
        "NET_ADMIN",
        "--sysctl",
        "net.ipv4.ip_forward=1",
        "--env",
        `CUJO_GATEWAY_IP=${gatewayIp}`,
        "--env",
        // One argv entry, so a hostname cannot become two. Already validated as
        // hostnames with no whitespace or control characters (`allowlist.ts`).
        `CUJO_ALLOW_HOSTS=${allowHosts.join(",")}`,
        this.options.gatewayImage,
      ]);
      // Its second leg, which is the only route off the sandbox's network.
      // Highest gateway priority, so the container's own default route goes out
      // this leg and never back at the address it is about to claim.
      await this.run([
        "network",
        "connect",
        "--gw-priority",
        "100",
        this.options.egressNetwork ?? "bridge",
        gateway,
      ]);
      await this.run(["start", gateway]);

      await this.run([
        "run",
        "--detach",
        ...runtimeArgs,
        "--name",
        container,
        "--network",
        network,
        // Every name the sandbox resolves goes to the gateway's resolver, which
        // answers for the allowlist and nothing else. Docker's embedded resolver
        // still sits at 127.0.0.11 inside the box; this is what it forwards to.
        "--dns",
        gatewayIp,
        // No capability at all, and no new ones: this is where the pull request's
        // code runs, and without NET_ADMIN it cannot change the route it was given.
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

      // The first `exec` may come within a second of this returning, and a
      // resolver that is not listening yet is a clone that fails on DNS.
      await this.waitForGateway(gateway);

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

  /**
   * Block until the gateway has printed `gateway.armed`, or fail the provision.
   *
   * The script sets its drop policy before anything else and prints that line
   * last, after the allowlist rules and the resolver are up, so seeing it means
   * the sandbox can be handed to a caller. A gateway that exits instead — no
   * default route, a refused rule — is reported by name rather than surfacing
   * later as a clone that could not resolve anything.
   */
  private async waitForGateway(gateway: string): Promise<void> {
    const deadline =
      Date.now() + (this.options.gatewayReadyTimeoutMs ?? DEFAULT_GATEWAY_READY_TIMEOUT_MS);
    for (;;) {
      const logs = await this.docker(["logs", gateway]);
      const output = `${logs.stdout}\n${logs.stderr}`;
      if (output.includes(GATEWAY_ARMED)) return;
      const state = await this.docker(["inspect", "--format", "{{.State.Running}}", gateway]);
      if (state.exitCode === 0 && state.stdout.trim() === "false") {
        throw new SandboxError(
          "provision_failed",
          `gateway exited before arming: ${output.trim().slice(-300)}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new SandboxError("provision_failed", "gateway did not arm in time");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
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
