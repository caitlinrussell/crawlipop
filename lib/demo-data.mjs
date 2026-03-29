function daysAgo(isoDate, count) {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function makeTrend(anchorDate) {
  const clicks = [38, 42, 44, 47, 45, 54, 58, 55, 63, 61, 66, 70, 68, 73];
  const impressions = [820, 910, 975, 1010, 990, 1110, 1160, 1155, 1280, 1325, 1390, 1450, 1480, 1560];

  return clicks.map((value, index) => ({
    date: daysAgo(anchorDate, clicks.length - index - 1),
    clicks: value,
    impressions: impressions[index]
  }));
}

export function createDemoDashboard(siteUrl) {
  const lastSyncedAt = new Date().toISOString();
  const dataAnchor = daysAgo(lastSyncedAt, 2);
  const trend = makeTrend(dataAnchor);

  return {
    siteUrl,
    source: "demo",
    lastSyncedAt,
    dateWindow: {
      recent: {
        startDate: daysAgo(dataAnchor, 27),
        endDate: dataAnchor
      },
      previous: {
        startDate: daysAgo(dataAnchor, 55),
        endDate: daysAgo(dataAnchor, 28)
      }
    },
    connection: {
      searchConsole: {
        configured: false,
        ok: false,
        message: "Showing demo data until Search Console credentials are added."
      },
      linear: {
        configured: false,
        ok: false,
        message: "Add a Linear API key to turn suggestions into tickets."
      }
    },
    summary: {
      clicks: 1584,
      impressions: 32640,
      ctr: 0.0485,
      position: 11.3,
      clicksChange: 0.214,
      impressionsChange: 0.182,
      ctrChange: 0.031,
      positionChange: -1.2
    },
    trend,
    topQueries: [
      {
        key: "crawlipop seo audit",
        clicks: 214,
        impressions: 4620,
        ctr: 0.0463,
        position: 5.9,
        clicksChange: 0.17,
        impressionsChange: 0.12
      },
      {
        key: "cute seo dashboard",
        clicks: 186,
        impressions: 6730,
        ctr: 0.0276,
        position: 7.8,
        clicksChange: 0.36,
        impressionsChange: 0.4
      },
      {
        key: "search console recommendations",
        clicks: 125,
        impressions: 3240,
        ctr: 0.0386,
        position: 9.2,
        clicksChange: 0.11,
        impressionsChange: 0.07
      },
      {
        key: "seo ticket workflow",
        clicks: 92,
        impressions: 1890,
        ctr: 0.0487,
        position: 6.4,
        clicksChange: 0.08,
        impressionsChange: 0.03
      },
      {
        key: "meta title ideas",
        clicks: 79,
        impressions: 4410,
        ctr: 0.0179,
        position: 4.8,
        clicksChange: -0.05,
        impressionsChange: 0.16
      }
    ],
    topPages: [
      {
        key: "https://crawlipop.dev/blog/seo-dashboard",
        clicks: 438,
        impressions: 8340,
        ctr: 0.0525,
        position: 6.3,
        clicksChange: 0.19,
        impressionsChange: 0.14
      },
      {
        key: "https://crawlipop.dev/templates/search-console-notes",
        clicks: 304,
        impressions: 7190,
        ctr: 0.0423,
        position: 8.9,
        clicksChange: 0.28,
        impressionsChange: 0.34
      },
      {
        key: "https://crawlipop.dev/blog/metadata-checklist",
        clicks: 227,
        impressions: 5150,
        ctr: 0.0441,
        position: 7.1,
        clicksChange: -0.18,
        impressionsChange: -0.06
      },
      {
        key: "https://crawlipop.dev/library/internal-linking-playbook",
        clicks: 188,
        impressions: 3860,
        ctr: 0.0487,
        position: 9.6,
        clicksChange: 0.22,
        impressionsChange: 0.17
      }
    ],
    recommendations: [
      {
        id: "ctr-cute-seo-dashboard",
        priority: "high",
        kind: "ctr",
        title: "Rewrite the title and meta for “cute seo dashboard”",
        summary: "High impressions and a soft CTR usually means the snippet is underselling the page.",
        metrics: {
          clicks: 186,
          impressions: 6730,
          ctr: 0.0276,
          position: 7.8
        },
        evidence: [
          "6,730 impressions in the current window",
          "CTR is 2.8% despite an average position of 7.8"
        ],
        nextSteps: [
          "Test a clearer outcome-first title",
          "Add a richer meta description with the Linear workflow hook",
          "Refresh the first screen copy so the page matches the new promise"
        ],
        ticket: null
      },
      {
        id: "refresh-metadata-checklist",
        priority: "medium",
        kind: "refresh",
        title: "Refresh the metadata checklist article",
        summary: "Clicks fell faster than impressions, which points to stale positioning or weaker relevance.",
        metrics: {
          clicks: 227,
          impressions: 5150,
          ctr: 0.0441,
          position: 7.1,
          clicksChange: -0.18
        },
        evidence: [
          "Clicks are down 18% versus the previous window",
          "Average position is still healthy at 7.1"
        ],
        nextSteps: [
          "Update examples and publish date",
          "Tighten the H1 and title tag around current search language",
          "Link to it from newer blog posts"
        ],
        ticket: null
      },
      {
        id: "expand-search-console-recommendations",
        priority: "medium",
        kind: "expansion",
        title: "Expand content around “search console recommendations”",
        summary: "This query is close enough to page one to justify a focused supporting section or FAQ.",
        metrics: {
          clicks: 125,
          impressions: 3240,
          ctr: 0.0386,
          position: 9.2
        },
        evidence: [
          "Average position is 9.2",
          "The query already drives 125 clicks"
        ],
        nextSteps: [
          "Add a recommendation framework section",
          "Include examples of title, CTR, and content refresh tickets",
          "Strengthen internal links using the exact phrase"
        ],
        ticket: null
      }
    ],
    ticketsBySuggestion: {}
  };
}
