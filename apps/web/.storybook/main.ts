import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Local only, deliberately out of CI: the a11y and interaction runners want a
 * browser download, which would roughly double the install for every job.
 * Storybook is here to build and review components in states that are hard to
 * reproduce against a live run — a tripped detonation, a run someone else
 * already approved, a check that returned no report.
 *
 * Tailwind needs no extra wiring: Vite picks up postcss.config.mjs from the
 * project root, so preview.tsx importing globals.css compiles the same tokens
 * the Next build does.
 */
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-themes"],
};

export default config;
