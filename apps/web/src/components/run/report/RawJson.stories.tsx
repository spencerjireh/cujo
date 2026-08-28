import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { RawJson } from "./RawJson";

/**
 * The fallback for a report matching no known shape. It must never be the
 * reason a page fails, so the awkward inputs are the point of these stories.
 */
const meta: Meta<typeof RawJson> = {
  title: "Run/Report/RawJson",
  component: RawJson,
};
export default meta;

type Story = StoryObj<typeof RawJson>;

export const SmallObject: Story = {
  args: { value: { verdict: "ok", notes: ["nothing to add"] } },
};

export const Large: Story = {
  args: {
    value: {
      entries: Array.from({ length: 400 }, (_, i) => ({
        index: i,
        detail: `line ${i} of an unrecognised report`,
      })),
    },
  },
};

export const Primitive: Story = { args: { value: "the check returned a bare string" } };

/** A value JSON.stringify cannot serialize still has to render something. */
export const Unserializable: Story = {
  args: {
    value: (() => {
      const circular: Record<string, unknown> = { name: "loop" };
      circular.self = circular;
      return circular;
    })(),
  },
};
