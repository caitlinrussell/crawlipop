import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PORT = 3000;
const DEFAULT_DELAY_DAYS = 2;
const DEFAULT_SYNC_SCHEDULE = "17 */6 * * *";
const DEFAULT_DATA_DIR = ".data";
const DEFAULT_PRODUCT_NAME = "your product";
const DEFAULT_POSTHOG_HOST = "https://us.posthog.com";
const DEFAULT_POSTHOG_LOOKBACK_DAYS = 30;
const DEFAULT_POSTHOG_ANALYSIS_MAX_AGE_HOURS = 24;

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadGoogleCredentials() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

  if (rawJson) {
    return JSON.parse(rawJson);
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.trim();
  if (!keyFile) {
    return null;
  }

  const resolvedPath = path.resolve(process.cwd(), keyFile);
  return readJsonFile(resolvedPath);
}

export async function loadConfig() {
  const googleCredentials = await loadGoogleCredentials();
  const delayDays = Number.parseInt(process.env.GOOGLE_DATA_DELAY_DAYS ?? "", 10);
  const posthogLookbackDays = Number.parseInt(process.env.POSTHOG_LOOKBACK_DAYS ?? "", 10);
  const posthogAnalysisMaxAgeHours = Number.parseInt(process.env.POSTHOG_ANALYSIS_MAX_AGE_HOURS ?? "", 10);

  return {
    port: Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT,
    dataDir: process.env.DATA_DIR?.trim() || DEFAULT_DATA_DIR,
    productName: process.env.PRODUCT_NAME?.trim() || DEFAULT_PRODUCT_NAME,
    siteUrl: process.env.GOOGLE_SITE_URL?.trim() || "sc-domain:example.com",
    googleCredentials,
    googleDataDelayDays: Number.isFinite(delayDays) ? delayDays : DEFAULT_DELAY_DAYS,
    syncSchedule: process.env.SYNC_SCHEDULE?.trim() || DEFAULT_SYNC_SCHEDULE,
    linearApiKey: process.env.LINEAR_API_KEY?.trim() || "",
    linearDefaultTeamId: process.env.LINEAR_DEFAULT_TEAM_ID?.trim() || "",
    posthogHost: process.env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST,
    posthogProjectId: process.env.POSTHOG_PROJECT_ID?.trim() || "",
    posthogPersonalApiKey: process.env.POSTHOG_PERSONAL_API_KEY?.trim() || "",
    posthogLookbackDays: Number.isFinite(posthogLookbackDays)
      ? posthogLookbackDays
      : DEFAULT_POSTHOG_LOOKBACK_DAYS,
    posthogAnalysisMaxAgeHours: Number.isFinite(posthogAnalysisMaxAgeHours)
      ? posthogAnalysisMaxAgeHours
      : DEFAULT_POSTHOG_ANALYSIS_MAX_AGE_HOURS,
    posthogExcludedDistinctIds: (process.env.POSTHOG_EXCLUDED_DISTINCT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    posthogExcludedEmails: (process.env.POSTHOG_EXCLUDED_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  };
}

export function hasSearchConsoleConfig(config) {
  return Boolean(config.siteUrl && config.googleCredentials?.client_email && config.googleCredentials?.private_key);
}

export function hasLinearConfig(config) {
  return Boolean(config.linearApiKey);
}

export function hasPostHogConfig(config) {
  return Boolean(config.posthogHost && config.posthogProjectId && config.posthogPersonalApiKey);
}
