import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "", 10) || 3107;
const dataDir = path.join(os.tmpdir(), `crawlipop-e2e-${process.pid}`);

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  reporter: [["list"]],
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry"
  },
  webServer: {
    command: "node server.mjs",
    env: {
      AUTH_ALLOWED_EMAILS: "",
      AUTH_SESSION_SECRET: "",
      DATA_DIR: dataDir,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_SERVICE_ACCOUNT_JSON: "",
      GOOGLE_SERVICE_ACCOUNT_KEY_FILE: "",
      GOOGLE_SITE_URL: "sc-domain:example.com",
      LINEAR_API_KEY: "",
      LINEAR_DEFAULT_TEAM_ID: "",
      NODE_ENV: "test",
      PORT: String(port),
      POSTHOG_PERSONAL_API_KEY: "",
      POSTHOG_PROJECT_ID: "",
      PRODUCT_NAME: "Test Product"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    url: `http://127.0.0.1:${port}/health`
  },
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
