import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      passWithNoTests: true,
      projects: [
        { extends: true, test: { name: "unit", environment: "node", include: ["src/**/*.test.ts"] } },
        {
          extends: true,
          test: {
            name: "browser",
            include: ["src/**/*.test.tsx"],
            browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium" }] },
          },
        },
      ],
    },
  }),
);
