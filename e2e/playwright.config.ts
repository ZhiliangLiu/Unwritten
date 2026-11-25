import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
