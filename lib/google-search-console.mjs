import { JWT } from "google-auth-library";

const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDays(date, delta) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + delta);
  return nextDate;
}

function normalizeMetricRow(row, key) {
  return {
    key,
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0
  };
}

function rowToMap(rows) {
  return new Map(rows.map((row) => [row.key, row]));
}

function attachComparisons(rows, previousRows) {
  const previousMap = rowToMap(previousRows);

  return rows.map((row) => {
    const previous = previousMap.get(row.key);

    const clicksChange = previous?.clicks ? (row.clicks - previous.clicks) / previous.clicks : null;
    const impressionsChange = previous?.impressions
      ? (row.impressions - previous.impressions) / previous.impressions
      : null;

    return {
      ...row,
      clicksChange,
      impressionsChange
    };
  });
}

function attachValidation(rows, validationRows, validationWindow) {
  const validationMap = rowToMap(validationRows);

  return rows.map((row) => {
    const validation = validationMap.get(row.key);

    return {
      ...row,
      validation: validation
        ? {
            clicks: validation.clicks,
            impressions: validation.impressions,
            ctr: validation.ctr,
            position: validation.position,
            clicksChange: validation.clicksChange,
            impressionsChange: validation.impressionsChange,
            startDate: validationWindow.recent.startDate,
            endDate: validationWindow.recent.endDate
          }
        : null
    };
  });
}

function summarizePeriods(recent, previous) {
  const clicksChange = previous.clicks ? (recent.clicks - previous.clicks) / previous.clicks : null;
  const impressionsChange = previous.impressions
    ? (recent.impressions - previous.impressions) / previous.impressions
    : null;
  const ctrChange = previous.ctr ? recent.ctr - previous.ctr : null;
  const positionChange = recent.position - previous.position;

  return {
    clicks: recent.clicks,
    impressions: recent.impressions,
    ctr: recent.ctr,
    position: recent.position,
    clicksChange,
    impressionsChange,
    ctrChange,
    positionChange
  };
}

export function normalizeSearchConsoleWindowDays(value) {
  const parsed = Number.parseInt(value, 10);
  const allowed = [7, 14, 28, 60, 90];
  return allowed.includes(parsed) ? parsed : 28;
}

async function getAccessToken(credentials) {
  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [SEARCH_CONSOLE_SCOPE]
  });

  try {
    const tokenResponse = await client.authorize();
    return tokenResponse.access_token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/invalid_grant/i.test(message) && /invalid jwt signature/i.test(message)) {
      throw new Error(
        "Google Search Console authentication failed: the service account key signature is invalid. In Railway, replace GOOGLE_SERVICE_ACCOUNT_JSON with a fresh Google Cloud service-account JSON key and confirm client_email and private_key come from the same downloaded key."
      );
    }

    throw error;
  }
}

async function querySearchAnalytics({ accessToken, siteUrl, body }) {
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Search Console request failed (${response.status}): ${message}`);
  }

  return response.json();
}

async function fetchMetricRows({ accessToken, siteUrl, startDate, endDate, dimensions = [], rowLimit = 25 }) {
  const data = await querySearchAnalytics({
    accessToken,
    siteUrl,
    body: {
      startDate,
      endDate,
      ...(dimensions.length ? { dimensions } : {}),
      rowLimit
    }
  });

  return data.rows ?? [];
}

export async function fetchSearchConsoleSnapshot({ credentials, siteUrl, delayDays = 2, windowDays = 28 }) {
  const safeWindowDays = normalizeSearchConsoleWindowDays(windowDays);
  const today = new Date();
  const recentEnd = shiftDays(today, -Math.abs(delayDays));
  const recentStart = shiftDays(recentEnd, -(safeWindowDays - 1));
  const previousEnd = shiftDays(recentStart, -1);
  const previousStart = shiftDays(previousEnd, -(safeWindowDays - 1));
  const validationDays = Math.min(7, safeWindowDays);
  const validationEnd = recentEnd;
  const validationStart = shiftDays(validationEnd, -(validationDays - 1));
  const previousValidationEnd = shiftDays(validationStart, -1);
  const previousValidationStart = shiftDays(previousValidationEnd, -(validationDays - 1));

  const dateWindow = {
    recent: {
      startDate: toIsoDate(recentStart),
      endDate: toIsoDate(recentEnd)
    },
    previous: {
      startDate: toIsoDate(previousStart),
      endDate: toIsoDate(previousEnd)
    }
  };
  const validationWindow = {
    recent: {
      startDate: toIsoDate(validationStart),
      endDate: toIsoDate(validationEnd)
    },
    previous: {
      startDate: toIsoDate(previousValidationStart),
      endDate: toIsoDate(previousValidationEnd)
    }
  };

  const accessToken = await getAccessToken(credentials);

  const [
    recentSummaryRows,
    previousSummaryRows,
    trendRows,
    recentQueryRows,
    previousQueryRows,
    recentPageRows,
    previousPageRows,
    validationQueryRows,
    previousValidationQueryRows,
    validationPageRows,
    previousValidationPageRows
  ] = await Promise.all([
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: dateWindow.recent.startDate,
      endDate: dateWindow.recent.endDate,
      rowLimit: 1
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: dateWindow.previous.startDate,
      endDate: dateWindow.previous.endDate,
      rowLimit: 1
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: dateWindow.recent.startDate,
      endDate: dateWindow.recent.endDate,
      dimensions: ["date"],
      rowLimit: 60
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: dateWindow.recent.startDate,
      endDate: dateWindow.recent.endDate,
      dimensions: ["query"],
      rowLimit: 20
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: dateWindow.previous.startDate,
      endDate: dateWindow.previous.endDate,
      dimensions: ["query"],
      rowLimit: 20
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: dateWindow.recent.startDate,
      endDate: dateWindow.recent.endDate,
      dimensions: ["page"],
      rowLimit: 20
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: dateWindow.previous.startDate,
      endDate: dateWindow.previous.endDate,
      dimensions: ["page"],
      rowLimit: 20
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: validationWindow.recent.startDate,
      endDate: validationWindow.recent.endDate,
      dimensions: ["query"],
      rowLimit: 100
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: validationWindow.previous.startDate,
      endDate: validationWindow.previous.endDate,
      dimensions: ["query"],
      rowLimit: 100
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: validationWindow.recent.startDate,
      endDate: validationWindow.recent.endDate,
      dimensions: ["page"],
      rowLimit: 100
    }),
    fetchMetricRows({
      accessToken,
      siteUrl,
      startDate: validationWindow.previous.startDate,
      endDate: validationWindow.previous.endDate,
      dimensions: ["page"],
      rowLimit: 100
    })
  ]);

  const recentSummary = normalizeMetricRow(recentSummaryRows[0] ?? {}, "summary");
  const previousSummary = normalizeMetricRow(previousSummaryRows[0] ?? {}, "summary");

  const topQueries = attachValidation(
    attachComparisons(
      recentQueryRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown query")),
      previousQueryRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown query"))
    ),
    attachComparisons(
      validationQueryRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown query")),
      previousValidationQueryRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown query"))
    ),
    validationWindow
  );

  const topPages = attachValidation(
    attachComparisons(
      recentPageRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown page")),
      previousPageRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown page"))
    ),
    attachComparisons(
      validationPageRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown page")),
      previousValidationPageRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown page"))
    ),
    validationWindow
  );

  const trend = trendRows.map((row) => ({
    date: row.keys?.[0],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0
  }));

  return {
    source: "live",
    siteUrl,
    lastSyncedAt: new Date().toISOString(),
    searchConsoleWindowDays: safeWindowDays,
    dateWindow,
    validationWindow,
    summary: summarizePeriods(recentSummary, previousSummary),
    trend,
    topQueries,
    topPages
  };
}
