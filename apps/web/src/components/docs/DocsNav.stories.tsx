import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DocsNav } from "./DocsNav";

/**
 * The sidebar reads the current route to decide which link is lit, so the
 * story that matters is the one standing on a page: Storybook's Next router
 * mock supplies the pathname.
 */
const meta: Meta<typeof DocsNav> = {
  title: "Docs/DocsNav",
  component: DocsNav,
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/docs/checks" } } },
};
export default meta;

type Story = StoryObj<typeof DocsNav>;

export const OnATopic: Story = {};

/** Nothing lit, which is what the nav looks like anywhere off the manual. */
export const NoCurrentPage: Story = {
  parameters: { nextjs: { appDirectory: true, navigation: { pathname: "/" } } },
};
