import { check, cleanChecks, detonationChecks } from "@/lib/fixtures";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CheckReports } from "./CheckReports";

const meta: Meta<typeof CheckReports> = {
  title: "Run/CheckReports",
  component: CheckReports,
};
export default meta;

type Story = StoryObj<typeof CheckReports>;

/** The forensic view the operator reads before blocking. Closed until a card is picked. */
export const Detonation: Story = { args: { checks: detonationChecks } };

/** Checks that ran but returned no parseable report. */
export const NoReports: Story = { args: { checks: cleanChecks } };

/**
 * What a timeline lane does to this section: the card it names opens, scrolls
 * itself into view and takes the keyboard.
 */
export const PickedFromTheTimeline: Story = {
  args: { checks: cleanChecks, picked: { check: "smoke", nonce: 1 } },
};

export const CheckErrored: Story = {
  args: {
    checks: [
      check({
        title: "smoke",
        status: "error",
        error: "the sandbox exited before the app bound a port",
      }),
    ],
  },
};

/** A report in a shape no contract describes falls back to the raw view. */
export const UnrecognisedShape: Story = {
  args: {
    checks: [check({ title: "probes", report: { verdict: "ok", notes: ["nothing to add"] } })],
  },
};

/** Long lists are windowed rather than rendered whole. */
export const ManyEgressRows: Story = {
  args: {
    checks: [
      check({
        title: "detonation",
        report: {
          egress: Array.from({ length: 500 }, (_, i) => ({
            host: `host-${i}.example`,
            port: 443,
            bytes: i * 97,
            known: i % 7 !== 0,
          })),
        },
      }),
    ],
  },
};
