const DEFAULT_EVENT_LIMIT = 3000;

const MEANINGFUL_EVENTS = [
  "$pageview",
  "$pageleave",
  "$rageclick",
  "account_signup_started",
  "account_signup_completed",
  "sign_up",
  "recipe_create_started",
  "recipe_create_completed",
  "recipe_updated",
  "recipe_create_error",
  "start_draft_imported",
  "pet_created",
  "premium_upgrade_started",
  "premium_upgrade_completed",
  "pricing_plan_selected",
  "checkout_started",
  "checkout_completed",
  "checkout_error",
  "error_shown",
  "login",
  "logout",
  "settings_changed"
];

function normalizeHost(host) {
  return host.replace(/\/+$/, "");
}

function sqlString(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function buildEventList(events) {
  return events.map((event) => sqlString(event)).join(", ");
}

function readProperty(properties, key) {
  const value = properties?.[key];
  return value === undefined || value === null ? "" : String(value);
}

function readNestedProperty(properties, key) {
  const nested = properties?.$set;
  const value = nested && typeof nested === "object" ? nested[key] : null;
  return value === undefined || value === null ? "" : String(value);
}

function isInternalEvent(event, excludedDistinctIds, excludedEmails) {
  if (excludedDistinctIds.has(event.distinctId)) {
    return true;
  }

  const emailCandidates = [
    readProperty(event.properties, "email"),
    readProperty(event.properties, "$email"),
    readProperty(event.properties, "$user_id"),
    readProperty(event.properties, "user_email"),
    readNestedProperty(event.properties, "email"),
    readNestedProperty(event.properties, "$email")
  ]
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  return emailCandidates.some((email) => excludedEmails.has(email));
}

async function runPostHogQuery({ host, projectId, personalApiKey, query }) {
  const response = await fetch(`${normalizeHost(host)}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${personalApiKey}`
    },
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        query
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`PostHog query failed (${response.status}): ${message}`);
  }

  return response.json();
}

function normalizeEvent(row) {
  const [event, timestamp, distinctId, sessionId, currentUrl, pathname, properties] = row;
  let parsedProperties = properties;

  if (typeof properties === "string") {
    try {
      parsedProperties = JSON.parse(properties);
    } catch {
      parsedProperties = {};
    }
  }

  return {
    event,
    timestamp,
    distinctId,
    sessionId: sessionId || "",
    currentUrl: currentUrl || "",
    pathname: pathname || "",
    properties: parsedProperties && typeof parsedProperties === "object" ? parsedProperties : {}
  };
}

export async function fetchPostHogJourneys({
  host,
  projectId,
  personalApiKey,
  lookbackDays = 30,
  excludedDistinctIds = [],
  excludedEmails = [],
  limit = DEFAULT_EVENT_LIMIT
}) {
  const safeLookbackDays = Math.max(1, Math.min(Number.parseInt(lookbackDays, 10) || 30, 365));
  const safeLimit = Math.max(100, Math.min(Number.parseInt(limit, 10) || DEFAULT_EVENT_LIMIT, 10000));
  const events = buildEventList(MEANINGFUL_EVENTS);

  const data = await runPostHogQuery({
    host,
    projectId,
    personalApiKey,
    query: `
      SELECT
        event,
        timestamp,
        distinct_id,
        properties.$session_id,
        properties.$current_url,
        properties.$pathname,
        properties
      FROM events
      WHERE timestamp >= now() - INTERVAL ${safeLookbackDays} DAY
        AND event IN (${events})
      ORDER BY timestamp ASC
      LIMIT ${safeLimit}
    `
  });

  const internalDistinctIds = new Set(excludedDistinctIds);
  const internalEmails = new Set(excludedEmails.map((email) => email.toLowerCase()));
  const rows = data.results?.results ?? data.results ?? [];
  const normalizedEvents = rows
    .map(normalizeEvent)
    .filter((event) => !isInternalEvent(event, internalDistinctIds, internalEmails));

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - safeLookbackDays);

  return {
    window: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      lookbackDays: safeLookbackDays
    },
    events: normalizedEvents
  };
}
