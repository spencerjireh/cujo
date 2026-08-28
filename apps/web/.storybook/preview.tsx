import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview, ReactRenderer } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

/**
 * The addon sets `data-theme` on the document element, which is exactly the
 * selector brand/tokens.css uses, so both themes come from the token file with
 * nothing restated here. A story left on `system` removes the attribute and
 * follows prefers-color-scheme, matching the third state the app supports.
 */
const preview: Preview = {
  decorators: [
    withThemeByDataAttribute<ReactRenderer>({
      themes: { light: "light", dark: "dark", system: "" },
      defaultTheme: "dark",
      attributeName: "data-theme",
    }),
  ],
  parameters: {
    nextjs: { appDirectory: true },
    // The tokens own the page background; the addon's own swatches would fight them.
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
};

export default preview;
