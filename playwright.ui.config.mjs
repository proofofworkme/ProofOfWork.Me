import { defineConfig } from "@playwright/test";

const browserChannel = process.env.POW_PLAYWRIGHT_CHANNEL || "chrome";
const externalBaseUrl = (
  process.env.POW_UI_BASE_URL ||
  process.env.POW_COMPUTER_BASE_URL ||
  process.env.POW_MARKETPLACE_BASE_URL ||
  ""
).replace(/\/$/u, "");
const localBaseUrl = "http://127.0.0.1:4173";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir:
    process.env.POW_PLAYWRIGHT_OUTPUT_DIR ||
    "/tmp/proofofwork-me-playwright-results",
  reporter: "line",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/browser",
  timeout: 90_000,
  use: {
    baseURL: externalBaseUrl || localBaseUrl,
    browserName: "chromium",
    channel: browserChannel,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        url: localBaseUrl,
      },
  workers: process.env.CI ? 2 : 4,
});
