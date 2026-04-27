import assert from "node:assert/strict";
import test from "node:test";

import { analyzeBehaviorJourneys, createBehaviorIssuePayload } from "../lib/behavior-analysis.mjs";

const analysisWindow = {
  start: "2026-04-01T00:00:00.000Z",
  end: "2026-04-27T00:00:00.000Z",
  lookbackDays: 26
};

function event({ name, user, minute, path = "/", session = `${user}-session`, properties = {} }) {
  return {
    event: name,
    timestamp: new Date(Date.UTC(2026, 3, 20, 12, minute)).toISOString(),
    distinctId: user,
    sessionId: session,
    currentUrl: `https://app.example.com${path}`,
    pathname: path,
    properties
  };
}

test("analyzeBehaviorJourneys returns an empty summary when no events are present", () => {
  const analysis = analyzeBehaviorJourneys({ events: [], window: analysisWindow });

  assert.equal(analysis.status, "empty");
  assert.equal(analysis.summary.usersAnalyzed, 0);
  assert.equal(analysis.summary.sessionsAnalyzed, 0);
  assert.equal(analysis.summary.eventsAnalyzed, 0);
  assert.deepEqual(analysis.suggestions, []);
});

test("analyzeBehaviorJourneys finds bug, dropoff, conversion, repetition, and instrumentation suggestions", () => {
  const events = [
    event({ name: "$pageleave", user: "u1", minute: 2, path: "/signup" }),
    event({ name: "account_signup_started", user: "u1", minute: 1, path: "/signup" }),
    event({ name: "checkout_error", user: "u2", minute: 3, path: "/checkout" }),
    event({ name: "pricing_plan_selected", user: "u3", minute: 4, path: "/pricing", properties: { plan: "pro" } }),
    event({ name: "primary_action_started", user: "u4", minute: 5, path: "/activate" }),
    event({ name: "primary_action_started", user: "u4", minute: 6, path: "/activate" }),
    event({ name: "primary_action_started", user: "u4", minute: 7, path: "/activate" })
  ];

  const analysis = analyzeBehaviorJourneys({ events, window: analysisWindow });
  const kinds = analysis.suggestions.map((suggestion) => suggestion.kind);

  assert.equal(analysis.status, "ready");
  assert.equal(analysis.summary.usersAnalyzed, 4);
  assert.equal(analysis.summary.sessionsAnalyzed, 4);
  assert.equal(analysis.summary.eventsAnalyzed, events.length);
  assert.equal(analysis.summary.conversionSignals, 1);
  assert.equal(analysis.summary.keyActions, 3);
  assert.equal(analysis.summary.behaviorRows.find((row) => row.key === "friction").events, 1);
  assert.equal(analysis.summary.activityTrend.length, 1);

  assert.ok(kinds.includes("bug"));
  assert.ok(kinds.includes("dropoff"));
  assert.ok(kinds.includes("opportunity"));
  assert.ok(kinds.includes("confusion"));
  assert.ok(kinds.includes("instrumentation"));

  const bug = analysis.suggestions.find((suggestion) => suggestion.kind === "bug");
  assert.equal(bug.priority, "high");
  assert.equal(bug.metrics.eventCount, 1);
  assert.match(bug.evidence[0], /checkout_error/);

  const dropoff = analysis.suggestions.find((suggestion) => suggestion.kind === "dropoff");
  assert.match(dropoff.title, /Users start account signup/);
  assert.match(dropoff.evidence[0], /left from \/signup/);

  const opportunity = analysis.suggestions.find((suggestion) => suggestion.kind === "opportunity");
  assert.match(opportunity.evidence[0], /pricing_plan_selected \(pro\)/);
});

test("analyzeBehaviorJourneys attaches tickets by behavior suggestion id", () => {
  const events = [event({ name: "checkout_error", user: "u1", minute: 1, path: "/checkout" })];
  const firstPass = analyzeBehaviorJourneys({ events, window: analysisWindow });
  const target = firstPass.suggestions[0];
  const ticket = {
    id: "issue-id",
    identifier: "BUG-1",
    url: "https://linear.app/example/issue/BUG-1"
  };

  const secondPass = analyzeBehaviorJourneys({
    events,
    window: analysisWindow,
    ticketsBySuggestion: {
      [target.id]: ticket
    }
  });

  assert.deepEqual(secondPass.suggestions.find((suggestion) => suggestion.id === target.id).ticket, ticket);
});

test("createBehaviorIssuePayload formats a Linear-ready behavior issue", () => {
  const analysis = analyzeBehaviorJourneys({
    events: [event({ name: "checkout_error", user: "u1", minute: 1, path: "/checkout" })],
    window: analysisWindow
  });
  const suggestion = analysis.suggestions.find((entry) => entry.kind === "bug");
  const payload = createBehaviorIssuePayload({
    suggestion,
    siteUrl: "Crawlipop",
    analysisWindow
  });

  assert.equal(payload.title, `[Bug] ${suggestion.title}`);
  assert.match(payload.description, /Suggested from Crawlipop behavior analysis for Crawlipop/);
  assert.match(payload.description, /Window: 2026-04-01T00:00:00.000Z to 2026-04-27T00:00:00.000Z/);
  assert.match(payload.description, /Confidence:/);
  assert.match(payload.description, /Reasoning:/);
  assert.match(payload.description, /Evidence:/);
  assert.match(payload.description, /Metrics:/);
});
