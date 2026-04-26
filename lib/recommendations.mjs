import crypto from "node:crypto";

function createId(parts) {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function safePathname(value) {
  try {
    return new URL(value).pathname || value;
  } catch {
    return value;
  }
}

function buildCtrSuggestions(topQueries) {
  return topQueries
    .filter((row) => row.impressions >= 400 && row.position <= 10 && row.ctr <= 0.03)
    .map((row) => ({
      id: createId(["ctr", row.key]),
      priority: row.ctr < 0.02 ? "high" : "medium",
      kind: "ctr",
      title: `Tighten the snippet for “${row.key}”`,
      summary: "This query shows up often enough that a title and meta rewrite should be worth shipping.",
      metrics: {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      },
      evidence: [
        `${compactNumber(row.impressions)} impressions in the latest window`,
        `CTR is ${formatPercent(row.ctr)} at an average position of ${row.position.toFixed(1)}`
      ],
      nextSteps: [
        "Rewrite the title tag with a clearer promise",
        "Refresh the meta description with stronger outcome language",
        "Make sure the page intro matches the search intent"
      ],
      sourceKey: row.key,
      ticket: null
    }));
}

function buildPositionSuggestions(topQueries) {
  return topQueries
    .filter((row) => row.impressions >= 250 && row.position >= 5 && row.position <= 15)
    .map((row) => ({
      id: createId(["position", row.key]),
      priority: row.position <= 10 ? "high" : "medium",
      kind: "expansion",
      title: `Push “${row.key}” closer to the top results`,
      summary: "This term is close enough that a focused content expansion or internal-link pass could move it.",
      metrics: {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      },
      evidence: [
        `Average position is ${row.position.toFixed(1)}`,
        `${compactNumber(row.clicks)} clicks already arrive from this query`
      ],
      nextSteps: [
        "Add a dedicated section or FAQ that answers the query directly",
        "Point more internal links at the target page with natural anchor text",
        "Check competing pages for missing subtopics"
      ],
      sourceKey: row.key,
      ticket: null
    }));
}

function buildRefreshSuggestions(topPages) {
  return topPages
    .filter((row) => row.clicksChange !== null && row.clicksChange <= -0.15 && row.position <= 12)
    .map((row) => ({
      id: createId(["refresh", row.key]),
      priority: row.clicksChange <= -0.25 ? "high" : "medium",
      kind: "refresh",
      title: `Refresh ${safePathname(row.key)}`,
      summary: "Traffic is slipping faster than rankings, which usually means the page needs a fresher pitch or stronger relevance.",
      metrics: {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        clicksChange: row.clicksChange
      },
      evidence: [
        `Clicks changed ${formatPercent(row.clicksChange)} compared with the previous window`,
        `Average position is still ${row.position.toFixed(1)}`
      ],
      nextSteps: [
        "Refresh the publish date and examples",
        "Update headings with the language showing up in queries",
        "Add 2-3 new internal links from recently updated pages"
      ],
      sourceKey: row.key,
      ticket: null
    }));
}

function buildPageCtrSuggestions(topPages) {
  return topPages
    .filter((row) => row.impressions >= 20 && row.position <= 12 && row.ctr <= 0.03)
    .map((row) => ({
      id: createId(["page-ctr", row.key]),
      priority: row.impressions >= 100 || row.ctr <= 0.01 ? "high" : "medium",
      kind: "pageCtr",
      title: `Improve the search snippet for ${safePathname(row.key)}`,
      summary:
        "This page is visible enough in search to learn from, but its click-through rate is still leaving room for a stronger title and description.",
      metrics: {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        clicksChange: row.clicksChange
      },
      evidence: [
        `${compactNumber(row.impressions)} impressions in the latest window`,
        `CTR is ${formatPercent(row.ctr)} at an average position of ${row.position.toFixed(1)}`
      ],
      nextSteps: [
        "Rewrite the title around the clearest user outcome",
        "Make the meta description answer the searcher's next question",
        "Check that the page H1 and intro match the promise in the snippet"
      ],
      sourceKey: row.key,
      ticket: null
    }));
}

function buildEmergingPageSuggestions(topPages) {
  return topPages
    .filter((row) => row.clicks === 0 && row.impressions >= 10 && row.position <= 8)
    .map((row) => ({
      id: createId(["emerging-page", row.key]),
      priority: row.position <= 5 ? "high" : "medium",
      kind: "emerging",
      title: `Turn early visibility into clicks for ${safePathname(row.key)}`,
      summary:
        "This page is already showing near the top results, so a small snippet or intent-matching pass could create the first clicks.",
      metrics: {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        clicksChange: row.clicksChange
      },
      evidence: [
        `Average position is ${row.position.toFixed(1)}`,
        `${compactNumber(row.impressions)} impressions but no clicks in the latest window`
      ],
      nextSteps: [
        "Compare the current title against the top-ranking result for the same intent",
        "Add a more specific benefit or use case to the title tag",
        "Make the page intro answer the query in the first few lines"
      ],
      sourceKey: row.key,
      ticket: null
    }));
}

function buildMomentumSuggestions(topPages) {
  return topPages
    .filter((row) => row.clicksChange !== null && row.clicksChange >= 0.2 && row.position >= 6 && row.position <= 15)
    .map((row) => ({
      id: createId(["momentum", row.key]),
      priority: "medium",
      kind: "momentum",
      title: `Double down on ${safePathname(row.key)}`,
      summary: "The page already has momentum, so this is a good time to add supporting content before demand plateaus.",
      metrics: {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        clicksChange: row.clicksChange
      },
      evidence: [
        `Clicks are up ${formatPercent(row.clicksChange)} versus the prior window`,
        `Average position is ${row.position.toFixed(1)}`
      ],
      nextSteps: [
        "Add adjacent long-tail sections",
        "Link out to supporting pages and cluster them back",
        "Revisit the title after shipping the content update"
      ],
      sourceKey: row.key,
      ticket: null
    }));
}

export function buildRecommendations({ topQueries, topPages, ticketsBySuggestion = {} }) {
  const combined = [
    ...buildCtrSuggestions(topQueries),
    ...buildPositionSuggestions(topQueries),
    ...buildRefreshSuggestions(topPages),
    ...buildPageCtrSuggestions(topPages),
    ...buildEmergingPageSuggestions(topPages),
    ...buildMomentumSuggestions(topPages)
  ];

  const unique = new Map();

  for (const recommendation of combined) {
    if (!unique.has(recommendation.id)) {
      unique.set(recommendation.id, recommendation);
    }
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const kindOrder = { ctr: 0, pageCtr: 1, emerging: 2, refresh: 3, expansion: 4, momentum: 5 };
  const sorted = [...unique.values()].sort((left, right) => {
    const leftPriority = priorityOrder[left.priority] ?? 3;
    const rightPriority = priorityOrder[right.priority] ?? 3;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftKind = kindOrder[left.kind] ?? 99;
    const rightKind = kindOrder[right.kind] ?? 99;

    if (leftKind !== rightKind) {
      return leftKind - rightKind;
    }

    return right.metrics.impressions - left.metrics.impressions;
  });

  const bySource = new Map();

  for (const recommendation of sorted) {
    if (!bySource.has(recommendation.sourceKey)) {
      bySource.set(recommendation.sourceKey, recommendation);
    }
  }

  return [...bySource.values()]
    .slice(0, 8)
    .map((recommendation) => ({
      ...recommendation,
      ticket: ticketsBySuggestion[recommendation.id] ?? null
    }));
}

export function createIssuePayload({ recommendation, siteUrl, dateWindow }) {
  const lines = [
    `Suggested from Crawlipop for \`${siteUrl}\`.`,
    "",
    `Recommendation: **${recommendation.title}**`,
    "",
    recommendation.summary,
    "",
    "Key metrics:",
    `- Clicks: ${compactNumber(recommendation.metrics.clicks)}`,
    `- Impressions: ${compactNumber(recommendation.metrics.impressions)}`,
    `- CTR: ${formatPercent(recommendation.metrics.ctr)}`,
    `- Avg. position: ${recommendation.metrics.position.toFixed(1)}`,
    "",
    "Evidence:",
    ...recommendation.evidence.map((entry) => `- ${entry}`),
    "",
    "Next steps:",
    ...recommendation.nextSteps.map((entry) => `- ${entry}`)
  ];

  if (dateWindow?.recent?.startDate && dateWindow?.recent?.endDate) {
    lines.splice(2, 0, `Window: ${dateWindow.recent.startDate} to ${dateWindow.recent.endDate}`);
  }

  return {
    title: `[SEO] ${recommendation.title}`,
    description: lines.join("\n")
  };
}
