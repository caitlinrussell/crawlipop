import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PORT = 3000;
const DEFAULT_DELAY_DAYS = 2;
const DEFAULT_SYNC_SCHEDULE = "17 */6 * * *";

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

  return {
    port: Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT,
    siteUrl: process.env.GOOGLE_SITE_URL?.trim() || "sc-domain:example.com",
    googleCredentials,
    googleDataDelayDays: Number.isFinite(delayDays) ? delayDays : DEFAULT_DELAY_DAYS,
    syncSchedule: process.env.SYNC_SCHEDULE?.trim() || DEFAULT_SYNC_SCHEDULE,
    linearApiKey: process.env.LINEAR_API_KEY?.trim() || "",
    linearDefaultTeamId: process.env.LINEAR_DEFAULT_TEAM_ID?.trim() || ""
  };
}

export function hasSearchConsoleConfig(config) {
  return Boolean(config.siteUrl && config.googleCredentials?.client_email && config.googleCredentials?.private_key);
}

export function hasLinearConfig(config) {
  return Boolean(config.linearApiKey);
}
