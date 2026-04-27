import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hasLinearConfig, hasPostHogConfig, hasSearchConsoleConfig, loadConfig } from "../lib/config.mjs";

const CONFIG_ENV_KEYS = [
  "DATA_DIR",
  "GOOGLE_DATA_DELAY_DAYS",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_KEY_FILE",
  "GOOGLE_SITE_URL",
  "LINEAR_API_KEY",
  "LINEAR_DEFAULT_TEAM_ID",
  "PORT",
  "POSTHOG_ANALYSIS_MAX_AGE_HOURS",
  "POSTHOG_EXCLUDED_DISTINCT_IDS",
  "POSTHOG_EXCLUDED_EMAILS",
  "POSTHOG_HOST",
  "POSTHOG_LOOKBACK_DAYS",
  "POSTHOG_PERSONAL_API_KEY",
  "POSTHOG_PROJECT_ID",
  "PRODUCT_NAME",
  "SYNC_SCHEDULE"
];

async function withEnv(overrides, run) {
  const previous = Object.fromEntries(CONFIG_ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of CONFIG_ENV_KEYS) {
    delete process.env[key];
  }

  Object.assign(process.env, overrides);

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("loadConfig applies safe defaults for an unconfigured demo environment", async () => {
  await withEnv({}, async () => {
    const config = await loadConfig();

    assert.equal(config.port, 3000);
    assert.equal(config.dataDir, ".data");
    assert.equal(config.productName, "your product");
    assert.equal(config.siteUrl, "sc-domain:example.com");
    assert.equal(config.googleCredentials, null);
    assert.equal(config.googleDataDelayDays, 2);
    assert.equal(config.syncSchedule, "17 */6 * * *");
    assert.equal(config.posthogHost, "https://us.posthog.com");
    assert.equal(config.posthogLookbackDays, 30);
    assert.equal(config.posthogAnalysisMaxAgeHours, 24);
    assert.deepEqual(config.posthogExcludedDistinctIds, []);
    assert.deepEqual(config.posthogExcludedEmails, []);
  });
});

test("loadConfig parses explicit values and inline Google credentials", async () => {
  const credentials = {
    client_email: "service@example.iam.gserviceaccount.com",
    private_key: "private-key"
  };

  await withEnv(
    {
      DATA_DIR: "tmp-data",
      GOOGLE_DATA_DELAY_DAYS: "5",
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials),
      GOOGLE_SITE_URL: "sc-domain:crawlipop.dev",
      LINEAR_API_KEY: "lin-api-key",
      LINEAR_DEFAULT_TEAM_ID: "team-id",
      PORT: "4321",
      POSTHOG_ANALYSIS_MAX_AGE_HOURS: "12",
      POSTHOG_EXCLUDED_DISTINCT_IDS: "one, two",
      POSTHOG_EXCLUDED_EMAILS: "Owner@Example.com, teammate@example.com",
      POSTHOG_HOST: "https://eu.posthog.com",
      POSTHOG_LOOKBACK_DAYS: "14",
      POSTHOG_PERSONAL_API_KEY: "ph-key",
      POSTHOG_PROJECT_ID: "123",
      PRODUCT_NAME: "Crawlipop",
      SYNC_SCHEDULE: "*/15 * * * *"
    },
    async () => {
      const config = await loadConfig();

      assert.equal(config.port, 4321);
      assert.equal(config.dataDir, "tmp-data");
      assert.equal(config.productName, "Crawlipop");
      assert.equal(config.siteUrl, "sc-domain:crawlipop.dev");
      assert.deepEqual(config.googleCredentials, credentials);
      assert.equal(config.googleDataDelayDays, 5);
      assert.equal(config.syncSchedule, "*/15 * * * *");
      assert.equal(config.linearApiKey, "lin-api-key");
      assert.equal(config.linearDefaultTeamId, "team-id");
      assert.equal(config.posthogHost, "https://eu.posthog.com");
      assert.equal(config.posthogProjectId, "123");
      assert.equal(config.posthogPersonalApiKey, "ph-key");
      assert.equal(config.posthogLookbackDays, 14);
      assert.equal(config.posthogAnalysisMaxAgeHours, 12);
      assert.deepEqual(config.posthogExcludedDistinctIds, ["one", "two"]);
      assert.deepEqual(config.posthogExcludedEmails, ["owner@example.com", "teammate@example.com"]);
      assert.equal(hasSearchConsoleConfig(config), true);
      assert.equal(hasLinearConfig(config), true);
      assert.equal(hasPostHogConfig(config), true);
    }
  );
});

test("loadConfig reads Google credentials from a key file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawlipop-config-"));
  const keyFile = path.join(tempDir, "service-account.json");
  const credentials = {
    client_email: "file@example.iam.gserviceaccount.com",
    private_key: "file-private-key"
  };

  await fs.writeFile(keyFile, JSON.stringify(credentials), "utf8");

  await withEnv({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: keyFile }, async () => {
    const config = await loadConfig();
    assert.deepEqual(config.googleCredentials, credentials);
    assert.equal(hasSearchConsoleConfig(config), true);
  });
});

test("config helpers require the minimum credentials for each integration", () => {
  assert.equal(hasSearchConsoleConfig({ siteUrl: "sc-domain:example.com", googleCredentials: {} }), false);
  assert.equal(
    hasSearchConsoleConfig({
      siteUrl: "sc-domain:example.com",
      googleCredentials: {
        client_email: "service@example.com",
        private_key: "private-key"
      }
    }),
    true
  );
  assert.equal(hasLinearConfig({ linearApiKey: "" }), false);
  assert.equal(hasLinearConfig({ linearApiKey: "lin-api-key" }), true);
  assert.equal(hasPostHogConfig({ posthogHost: "https://us.posthog.com", posthogProjectId: "1" }), false);
  assert.equal(
    hasPostHogConfig({
      posthogHost: "https://us.posthog.com",
      posthogProjectId: "1",
      posthogPersonalApiKey: "ph-key"
    }),
    true
  );
});
