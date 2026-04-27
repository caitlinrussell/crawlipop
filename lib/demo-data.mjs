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

function makeBehaviorTrend(anchorDate) {
  const events = [38, 42, 47, 44, 58, 63, 71, 68, 76, 82, 79, 88, 94, 101];
  const users = [12, 14, 15, 13, 18, 20, 23, 22, 25, 27, 26, 29, 31, 34];
  const conversions = [2, 3, 2, 2, 4, 4, 5, 4, 6, 6, 5, 7, 7, 8];
  const friction = [1, 0, 2, 1, 1, 3, 2, 1, 4, 2, 2, 3, 1, 2];

  return events.map((value, index) => ({
    date: daysAgo(anchorDate, events.length - index - 1),
    events: value,
    users: users[index],
    conversions: conversions[index],
    friction: friction[index]
  }));
}

function createDemoBehaviorAnalysis(anchorDate) {
  const windowStart = `${daysAgo(anchorDate, 13)}T00:00:00.000Z`;
  const windowEnd = `${anchorDate}T23:59:59.000Z`;

  return {
    demo: true,
    status: "ready",
    configured: true,
    ok: true,
    message: "3 behavior suggestions found.",
    lastAnalyzedAt: `${anchorDate}T16:30:00.000Z`,
    window: {
      start: windowStart,
      end: windowEnd,
      lookbackDays: 14
    },
    summary: {
      usersAnalyzed: 128,
      sessionsAnalyzed: 186,
      eventsAnalyzed: 951,
      rageClicks: 14,
      signups: 42,
      keyActions: 67,
      conversionSignals: 29,
      behaviorRows: [
        { key: "friction", label: "Bug or frustration signal", kind: "Friction", events: 19, users: 14, sessions: 16 },
        { key: "signup-completed", label: "Signup completed", kind: "Conversion", events: 42, users: 42, sessions: 42 },
        { key: "activation-completed", label: "Activation completed", kind: "Conversion", events: 31, users: 29, sessions: 30 },
        { key: "conversion-completed", label: "Conversion completed", kind: "Conversion", events: 8, users: 8, sessions: 8 },
        { key: "signup-started", label: "Signup started", kind: "Intent", events: 64, users: 58, sessions: 61 },
        { key: "activation-started", label: "Activation started", kind: "Intent", events: 67, users: 54, sessions: 59 },
        { key: "plan-selected", label: "Plan selected", kind: "Intent", events: 21, users: 18, sessions: 19 },
        { key: "checkout-started", label: "Checkout started", kind: "Intent", events: 13, users: 11, sessions: 11 },
        { key: "profile-created", label: "Profile or setup completed", kind: "Setup", events: 38, users: 37, sessions: 37 }
      ],
      activityTrend: makeBehaviorTrend(anchorDate)
    },
    suggestions: [
      {
        id: "demo-activation-dropoff",
        priority: "high",
        confidence: 0.78,
        kind: "dropoff",
        title: "Users start activation but do not finish",
        summary: "18 journeys reach key-action intent without a matching completion event.",
        reasoning:
          "The behavior shows clear intent followed by silence or a page leave. That pattern often points to a confusing required field, weak next-step copy, or a missing loading or success state.",
        metrics: {
          usersAffected: 18,
          totalUsers: 128
        },
        evidence: [
          "Anonymous user 7 triggered activation_started on /onboarding/import and then left from /onboarding/import.",
          "Anonymous user 19 triggered primary_action_started on /workspace/new without a matching completion event.",
          "Anonymous user 34 returned to /workspace/new three times before leaving."
        ],
        nextSteps: [
          "Review the activation screen for unclear required fields and missing error states.",
          "Add or verify activation_completed so the funnel can separate true dropoff from missing instrumentation.",
          "Run through the activation flow on mobile and desktop with a fresh account."
        ],
        sourceKey: "activation",
        ticket: null
      },
      {
        id: "demo-friction-signals",
        priority: "high",
        confidence: 0.74,
        kind: "bug",
        title: "Recent journeys contain friction signals",
        summary: "14 users triggered rage-click or error events in the analysis window.",
        reasoning:
          "Rage clicks and error events are direct signs that the UI did not respond as expected. These should outrank speculative conversion ideas because they can block signup, activation, or checkout.",
        metrics: {
          usersAffected: 14,
          totalUsers: 128,
          eventCount: 19
        },
        evidence: [
          "Anonymous user 4 triggered $rageclick twice on /pricing.",
          "Anonymous user 22 triggered checkout_error on /checkout.",
          "Anonymous user 31 triggered key_action_error on /workspace/new."
        ],
        nextSteps: [
          "Inspect the affected paths and reproduce the click or submit path manually.",
          "Add safe error codes or step names to checkout_error and key_action_error payloads.",
          "Prioritize this before copy experiments if it touches signup, activation, or checkout."
        ],
        sourceKey: "bug-signals",
        ticket: null
      },
      {
        id: "demo-conversion-intent",
        priority: "medium",
        confidence: 0.61,
        kind: "opportunity",
        title: "Conversion intent is not reaching checkout",
        summary: "10 journeys show plan selection without a recorded conversion completion.",
        reasoning:
          "Plan selection and checkout start are strong intent signals. If users stop here, the pricing page, checkout handoff, account requirement, or payment flow may need clarification.",
        metrics: {
          usersAffected: 10,
          totalUsers: 128
        },
        evidence: [
          "Anonymous user 12 triggered pricing_plan_selected on /pricing.",
          "Anonymous user 41 selected a plan and returned to /pricing later in the same session.",
          "Anonymous user 58 reached /checkout but did not trigger conversion_completed."
        ],
        nextSteps: [
          "Make the selected plan, next charge, and account requirement visible before checkout.",
          "Track conversion_completed or checkout_completed so this can be separated from missing instrumentation.",
          "Add a follow-up affordance for users who return after selecting a plan."
        ],
        sourceKey: "conversion-intent",
        ticket: null
      }
    ],
    ticketsBySuggestion: {},
    error: null
  };
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
    behaviorAnalysis: createDemoBehaviorAnalysis(dataAnchor),
    ticketsBySuggestion: {}
  };
}
