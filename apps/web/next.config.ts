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
  // `@cujo/log` is a raw-TypeScript workspace package (it has no build step,
  // like `@cujo/gh-app-auth`), so Next has to compile it rather than treat it
  // as a prebuilt dependency. Without this the route handlers below fail to
  // build; with it the standalone tracer follows the hoisted symlink the way
  // `outputFileTracingRoot` above already arranges for.
  transpilePackages: ["@cujo/log"],
  poweredByHeader: false,
  reactStrictMode: true,
  // The only remote images this app loads: a PR author's GitHub avatar
  // (decision 54). Routed through `/_next/image` rather than loaded straight
  // from the browser, so opening a run on the anonymous board does not make a
  // request to github.com carrying the visitor's address. The path is
  // `/u/<numeric id>` and nothing else, because the id is the only part of an
  // author this app is willing to put in a URL.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/u/**",
      },
    ],
  },
  // No `rewrites` for the API: rewrites are baked into routes-manifest.json at
  // build time, so a destination read from the environment would freeze the
  // build machine's value into the image. The proxy is a route handler instead
  // (src/app/api), which also lets it forward the Access assertion explicitly.
};

export default config;
