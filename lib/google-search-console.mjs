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

async function getAccessToken(credentials) {
  const client = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [SEARCH_CONSOLE_SCOPE]
  });

  const tokenResponse = await client.authorize();
  return tokenResponse.access_token;
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

export async function fetchSearchConsoleSnapshot({ credentials, siteUrl, delayDays = 2 }) {
  const today = new Date();
  const recentEnd = shiftDays(today, -Math.abs(delayDays));
  const recentStart = shiftDays(recentEnd, -27);
  const previousEnd = shiftDays(recentStart, -1);
  const previousStart = shiftDays(previousEnd, -27);

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

  const accessToken = await getAccessToken(credentials);

  const [
    recentSummaryRows,
    previousSummaryRows,
    trendRows,
    recentQueryRows,
    previousQueryRows,
    recentPageRows,
    previousPageRows
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
    })
  ]);

  const recentSummary = normalizeMetricRow(recentSummaryRows[0] ?? {}, "summary");
  const previousSummary = normalizeMetricRow(previousSummaryRows[0] ?? {}, "summary");

  const topQueries = attachComparisons(
    recentQueryRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown query")),
    previousQueryRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown query"))
  );

  const topPages = attachComparisons(
    recentPageRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown page")),
    previousPageRows.map((row) => normalizeMetricRow(row, row.keys?.[0] ?? "unknown page"))
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
    dateWindow,
    summary: summarizePeriods(recentSummary, previousSummary),
    trend,
    topQueries,
    topPages
  };
}
