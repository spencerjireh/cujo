/**
 * The two images the local runtime runs, built by this process at boot.
 *
 * Nothing else in the deployment can build them. They are not compose services
 * -- the runtime starts them with `docker run` per sandbox -- so `up --build`
 * never sees them, and an image the deploy does not build is an image the deploy
 * cannot promise exists. So `sandbox-mcp` carries both build contexts in its own
 * image and builds them through the socket it already holds, which is also what
 * makes the sensor code a review runs exactly the code the deploy shipped
 * (decision 118).
 *
 * Sequential, not parallel: the two share a daemon, and a cold build of the
 * sandbox image is minutes of apt and pip that a parallel gateway build would
 * only contend with.
 */

import type { Logger } from "@cujo/log";
import type { Docker } from "./docker";

export interface ImageBuild {
  /** The tag the runtime will `docker run`. */
  tag: string;
  /** A directory holding a `Dockerfile`, inside this container. */
  context: string;
}

export interface BuildImagesOptions {
  docker: Docker;
  log: Logger;
  /** Bound on one build. A cold sandbox image build is minutes; this is not seconds. */
  timeoutMs?: number;
}

/** Twenty minutes: a cold build on a slow host, with room. */
const DEFAULT_BUILD_TIMEOUT_MS = 20 * 60 * 1000;
/** A build log is bigger than a `docker run` result, and only its tail matters. */
const BUILD_MAX_BUFFER = 32 * 1024 * 1024;

export async function buildImages(
  builds: readonly ImageBuild[],
  options: BuildImagesOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
  for (const build of builds) {
    const started = Date.now();
    // `reason` carries the tag, as `sandbox.created` carries the runtime name:
    // the vocabulary has no image field and one tag is not worth a class.
    options.log.info("sandbox.image.build.started", { reason: build.tag });
    const result = await options.docker(
      // No `--pull`: the base images are whatever the host has, and a registry
      // that is down must not stop a deploy whose layers are already cached.
      ["build", "--tag", build.tag, build.context],
      { timeoutMs, maxBuffer: BUILD_MAX_BUFFER },
    );
    if (result.exitCode !== 0) {
      const reason = result.timedOut ? "timed out" : `exited ${result.exitCode}`;
      throw new Error(`docker build ${build.tag} ${reason}: ${result.stderr.trim().slice(-400)}`);
    }
    options.log.info("sandbox.image.build.finished", {
      reason: build.tag,
      duration_ms: Date.now() - started,
    });
  }
}
