import assert from "node:assert/strict";
import test from "node:test";

import { buildRecommendations, createIssuePayload } from "../lib/recommendations.mjs";

const topQueries = [
  {
    key: "meta title ideas",
    clicks: 25,
    impressions: 1200,
    ctr: 0.012,
    position: 4.2
  },
  {
    key: "near page one query",
    clicks: 80,
    impressions: 900,
    ctr: 0.089,
    position: 11.3
  },
  {
    key: "same source gets one recommendation",
    clicks: 10,
    impressions: 700,
    ctr: 0.01,
    position: 8.5
  }
];

const topPages = [
  {
    key: "https://crawlipop.dev/stale-page",
    clicks: 120,
    impressions: 2000,
    ctr: 0.06,
    position: 7.1,
    clicksChange: -0.31
  },
  {
    key: "https://crawlipop.dev/low-ctr-page",
    clicks: 3,
    impressions: 160,
    ctr: 0.018,
    position: 6.2,
    clicksChange: 0.02
  },
  {
    key: "https://crawlipop.dev/emerging-page",
    clicks: 0,
    impressions: 15,
    ctr: 0,
    position: 4.7,
    clicksChange: null
  },
  {
    key: "https://crawlipop.dev/momentum-page",
    clicks: 95,
    impressions: 1800,
    ctr: 0.053,
    position: 9.8,
    clicksChange: 0.24
  }
];

test("buildRecommendations creates prioritized SEO recommendations from query and page signals", () => {
  const recommendations = buildRecommendations({ topQueries, topPages });
  const kinds = recommendations.map((recommendation) => recommendation.kind);

  assert.ok(recommendations.length <= 8);
  assert.ok(kinds.includes("ctr"));
  assert.ok(kinds.includes("expansion"));
  assert.ok(kinds.includes("refresh"));
  assert.ok(kinds.includes("pageCtr"));
  assert.ok(kinds.includes("emerging"));
  assert.ok(kinds.includes("momentum"));

  assert.equal(recommendations[0].priority, "high");
  assert.equal(new Set(recommendations.map((entry) => entry.sourceKey)).size, recommendations.length);

  const ctr = recommendations.find((entry) => entry.kind === "ctr" && entry.sourceKey === "meta title ideas");
  assert.match(ctr.title, /meta title ideas/);
  assert.deepEqual(ctr.metrics, {
    clicks: 25,
    impressions: 1200,
    ctr: 0.012,
    position: 4.2
  });
  assert.ok(ctr.evidence.some((entry) => entry.includes("1,200 impressions")));
});

test("buildRecommendations attaches existing Linear tickets by suggestion id", () => {
  const firstPass = buildRecommendations({ topQueries, topPages });
  const target = firstPass.find((entry) => entry.kind === "refresh");
  const ticket = {
    id: "issue-id",
    identifier: "SEO-123",
    title: target.title,
    url: "https://linear.app/example/issue/SEO-123"
  };

  const secondPass = buildRecommendations({
    topQueries,
    topPages,
    ticketsBySuggestion: {
      [target.id]: ticket
    }
  });

  assert.deepEqual(
    secondPass.find((entry) => entry.id === target.id).ticket,
    ticket
  );
});

test("buildRecommendations suppresses suggestions that recovered in the latest validation window", () => {
  const recommendations = buildRecommendations({
    topQueries: [
      {
        key: "fixed low ctr query",
        clicks: 8,
        impressions: 800,
        ctr: 0.01,
        position: 4.8,
        validation: {
          clicks: 12,
          impressions: 120,
          ctr: 0.1,
          position: 3.9,
          clicksChange: 0.5,
          startDate: "2026-05-03",
          endDate: "2026-05-09"
        }
      },
      {
        key: "still low ctr query",
        clicks: 2,
        impressions: 820,
        ctr: 0.0024,
        position: 5.2,
        validation: {
          clicks: 1,
          impressions: 110,
          ctr: 0.009,
          position: 5.1,
          clicksChange: null,
          startDate: "2026-05-03",
          endDate: "2026-05-09"
        }
      }
    ],
    topPages: []
  });

  assert.equal(recommendations.some((entry) => entry.sourceKey === "fixed low ctr query"), false);
  assert.equal(recommendations.some((entry) => entry.sourceKey === "still low ctr query"), true);
  assert.ok(
    recommendations
      .find((entry) => entry.sourceKey === "still low ctr query")
      .evidence.some((entry) => entry.includes("Latest check 2026-05-03 to 2026-05-09"))
  );
});

test("createIssuePayload formats a Linear-ready SEO issue", () => {
  const recommendation = buildRecommendations({ topQueries, topPages }).find((entry) => entry.kind === "ctr");
  const payload = createIssuePayload({
    recommendation,
    siteUrl: "sc-domain:crawlipop.dev",
    dateWindow: {
      recent: {
        startDate: "2026-03-29",
        endDate: "2026-04-25"
      }
    }
  });

  assert.equal(payload.title, `[SEO] ${recommendation.title}`);
  assert.match(payload.description, /Suggested from Crawlipop for `sc-domain:crawlipop.dev`/);
  assert.match(payload.description, /Window: 2026-03-29 to 2026-04-25/);
  assert.match(payload.description, /Key metrics:/);
  assert.match(payload.description, /- Impressions: 1,200/);
  assert.match(payload.description, /Evidence:/);
  assert.match(payload.description, /Next steps:/);
});
