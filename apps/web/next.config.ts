import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // The Docker runner copies .next/standalone. Without an explicit trace root
  // the tracer stops at apps/web and drops the hoisted workspace symlinks.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Stated explicitly because the default is resolved against
  // outputFileTracingRoot, which would drop the build at the repo root. An
  // explicit value resolves against this app, so the output stays beside it.
  distDir: ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  // No `rewrites` for the API: rewrites are baked into routes-manifest.json at
  // build time, so a destination read from the environment would freeze the
  // build machine's value into the image. The proxy is a route handler instead
  // (src/app/api), which also lets it forward the Access assertion explicitly.
};

export default config;
