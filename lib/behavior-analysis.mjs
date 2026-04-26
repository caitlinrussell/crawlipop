import crypto from "node:crypto";

const FUNNEL = [
  {
    key: "signup",
    label: "account signup",
    startEvents: ["account_signup_started"],
    completionEvents: ["account_signup_completed", "sign_up"],
    fallbackStartMatchers: [(event) => event.event === "$pageview" && /sign[-_/]?up|register|auth/i.test(event.pathname)]
  },
  {
    key: "recipe",
    label: "recipe creation",
    startEvents: ["recipe_create_started", "start_draft_imported"],
    completionEvents: ["recipe_create_completed", "recipe_updated"],
    fallbackStartMatchers: [(event) => event.event === "$pageview" && /recipe|draft|create/i.test(event.pathname)]
  },
  {
    key: "premium",
    label: "premium upgrade",
    startEvents: ["premium_upgrade_started", "checkout_started"],
    completionEvents: ["premium_upgrade_completed", "checkout_completed"],
    fallbackStartMatchers: [(event) => event.event === "$pageview" && /checkout|upgrade/i.test(event.pathname)]
  }
];

const BUG_EVENTS = new Set(["$rageclick", "checkout_error", "recipe_create_error", "error_shown"]);
const EXPLICIT_EVENTS = [
  "account_signup_started",
  "account_signup_completed",
  "recipe_create_started",
  "recipe_create_completed",
  "premium_upgrade_started",
  "premium_upgrade_completed",
  "checkout_completed",
  "checkout_error",
  "recipe_create_error"
];

function createId(parts) {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

function anonymousLabel(index) {
  return `Anonymous user ${index + 1}`;
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function eventPath(event) {
  if (event.pathname) {
    return event.pathname;
  }

  try {
    return new URL(event.currentUrl).pathname;
  } catch {
    return event.currentUrl || "unknown page";
  }
}

function eventPlan(event) {
  const plan = event.properties?.plan;
  return plan ? ` (${plan})` : "";
}

function groupEvents(events) {
  const users = new Map();
  const sessions = new Map();

  for (const event of events) {
    if (!users.has(event.distinctId)) {
      users.set(event.distinctId, []);
    }

    const sessionKey = event.sessionId || `${event.distinctId}:unknown`;
    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, []);
    }

    users.get(event.distinctId).push(event);
    sessions.get(sessionKey).push(event);
  }

  return {
    users: [...users.values()].map((entries, index) => ({
      label: anonymousLabel(index),
      events: entries.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
    })),
    sessions: [...sessions.values()].map((entries) =>
      entries.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
    )
  };
}

function matchesStart(step, event) {
  return step.startEvents.includes(event.event) || step.fallbackStartMatchers.some((matcher) => matcher(event));
}

function matchesCompletion(step, event) {
  return step.completionEvents.includes(event.event);
}

function confidenceFrom({ affectedUsers, totalUsers, explicitSignal = false, severe = false }) {
  const sampleShare = totalUsers ? affectedUsers / totalUsers : 0;
  const base = 0.34 + Math.min(0.28, affectedUsers * 0.08) + Math.min(0.2, sampleShare * 0.2);
  const signalBonus = explicitSignal ? 0.14 : 0;
  const severityBonus = severe ? 0.12 : 0;
  return Math.min(0.92, Number((base + signalBonus + severityBonus).toFixed(2)));
}

function priorityFor(confidence, severe = false) {
  if (severe || confidence >= 0.72) {
    return "high";
  }

  if (confidence >= 0.5) {
    return "medium";
  }

  return "low";
}

function findDropoffs(users, totalUsers) {
  const suggestions = [];

  for (const step of FUNNEL) {
    const affected = users
      .map((user) => {
        const startedIndex = user.events.findIndex((event) => matchesStart(step, event));
        const completedIndex = user.events.findIndex((event, index) => index >= startedIndex && matchesCompletion(step, event));

        if (startedIndex === -1 || completedIndex !== -1) {
          return null;
        }

        const startEvent = user.events[startedIndex];
        const laterEvents = user.events.slice(startedIndex + 1);
        const leaveEvent = laterEvents.find((event) => event.event === "$pageleave");

        return {
          user,
          startEvent,
          leaveEvent,
          laterEvents
        };
      })
      .filter(Boolean);

    if (!affected.length) {
      continue;
    }

    const explicitSignal = affected.some((entry) => step.startEvents.includes(entry.startEvent.event));
    const confidence = confidenceFrom({
      affectedUsers: affected.length,
      totalUsers,
      explicitSignal
    });

    suggestions.push({
      id: createId(["dropoff", step.key, affected.map((entry) => entry.user.label).join(",")]),
      priority: priorityFor(confidence),
      confidence,
      kind: "dropoff",
      title: `Users start ${step.label} but do not finish`,
      summary: `${affected.length} ${affected.length === 1 ? "journey reaches" : "journeys reach"} ${step.label} intent without a matching completion event.`,
      reasoning:
        "The behavior shows intent followed by silence or a page leave. With a small audience this is still worth inspecting because each incomplete journey can hide a confusing step, unclear copy, or a broken action.",
      metrics: {
        usersAffected: affected.length,
        totalUsers
      },
      evidence: affected.slice(0, 3).map((entry) => {
        const exitCopy = entry.leaveEvent ? ` and then left from ${eventPath(entry.leaveEvent)}` : "";
        return `${entry.user.label} triggered ${entry.startEvent.event}${eventPlan(entry.startEvent)} on ${eventPath(entry.startEvent)}${exitCopy}.`;
      }),
      nextSteps: [
        `Review the ${step.label} screen for unclear required fields, weak next-step copy, or missing loading/error states.`,
        `Add or verify ${step.completionEvents[0]} so the funnel can distinguish true dropoff from missing instrumentation.`,
        "Create a short checklist for this flow and run through it on mobile and desktop."
      ],
      sourceKey: step.key,
      ticket: null
    });
  }

  return suggestions;
}

function findBugSignals(users, totalUsers) {
  const affected = users
    .map((user) => {
      const bugEvents = user.events.filter((event) => BUG_EVENTS.has(event.event));
      if (!bugEvents.length) {
        return null;
      }

      return {
        user,
        bugEvents
      };
    })
    .filter(Boolean);

  if (!affected.length) {
    return [];
  }

  const eventCounts = new Map();
  for (const entry of affected) {
    for (const event of entry.bugEvents) {
      eventCounts.set(event.event, (eventCounts.get(event.event) ?? 0) + 1);
    }
  }

  const severe = eventCounts.has("checkout_error") || eventCounts.has("recipe_create_error");
  const confidence = confidenceFrom({
    affectedUsers: affected.length,
    totalUsers,
    explicitSignal: true,
    severe
  });

  return [
    {
      id: createId(["bug", [...eventCounts.entries()].flat().join(",")]),
      priority: priorityFor(confidence, severe),
      confidence,
      kind: "bug",
      title: "Recent journeys contain bug or frustration signals",
      summary: `${affected.length} ${affected.length === 1 ? "user has" : "users have"} explicit error or rage-click events in the analysis window.`,
      reasoning:
        "Rage clicks and error events are direct signs that the UI did not respond as expected. These should outrank speculative conversion ideas because they can block signup, recipe creation, or checkout.",
      metrics: {
        usersAffected: affected.length,
        totalUsers,
        eventCount: [...eventCounts.values()].reduce((sum, count) => sum + count, 0)
      },
      evidence: affected.slice(0, 4).map((entry) => {
        const first = entry.bugEvents[0];
        return `${entry.user.label} triggered ${entry.bugEvents.length} bug/frustration event${entry.bugEvents.length === 1 ? "" : "s"}, starting with ${first.event} on ${eventPath(first)}.`;
      }),
      nextSteps: [
        "Inspect the affected path and reproduce the click or submit path manually.",
        "Add explicit error metadata to checkout and recipe creation failures so future tickets can point to the failing step.",
        "Prioritize this before copy experiments if it touches signup, recipe creation, or premium checkout."
      ],
      sourceKey: "bug-signals",
      ticket: null
    }
  ];
}

function findRepeatedActions(users, totalUsers) {
  const affected = [];

  for (const user of users) {
    const counts = new Map();

    for (const event of user.events) {
      if (event.event === "$pageview" || event.event === "$pageleave") {
        continue;
      }

      const key = `${event.event}:${eventPath(event)}`;
      counts.set(key, {
        event,
        count: (counts.get(key)?.count ?? 0) + 1
      });
    }

    const repeated = [...counts.values()].filter((entry) => entry.count >= 3).sort((left, right) => right.count - left.count);

    if (repeated.length) {
      affected.push({
        user,
        repeated: repeated[0]
      });
    }
  }

  if (!affected.length) {
    return [];
  }

  const confidence = confidenceFrom({
    affectedUsers: affected.length,
    totalUsers,
    explicitSignal: false
  });

  return [
    {
      id: createId(["confusion", affected.map((entry) => `${entry.repeated.event.event}:${entry.repeated.count}`).join(",")]),
      priority: priorityFor(confidence),
      confidence,
      kind: "confusion",
      title: "Some users repeat the same action several times",
      summary: "Repeated actions can mean a button lacks feedback, a save action is ambiguous, or the user is unsure whether progress stuck.",
      reasoning:
        "This is a speculative pattern, but it is useful with low traffic because repetition in a single journey often reveals a missing success state or a control that appears clickable but does not advance the flow.",
      metrics: {
        usersAffected: affected.length,
        totalUsers
      },
      evidence: affected.slice(0, 3).map((entry) => {
        const event = entry.repeated.event;
        return `${entry.user.label} triggered ${event.event} ${entry.repeated.count} times on ${eventPath(event)}.`;
      }),
      nextSteps: [
        "Check whether the repeated control gives immediate success, error, disabled, or loading feedback.",
        "If the interaction is expected, add a more specific event name so the analysis can tell progress from confusion.",
        "Consider adding inline validation near repeated form actions."
      ],
      sourceKey: "repeated-actions",
      ticket: null
    }
  ];
}

function findPremiumIntent(users, totalUsers) {
  const affected = users
    .map((user) => {
      const selected = user.events.find((event) => event.event === "pricing_plan_selected");
      const startedCheckout = user.events.find((event) => ["premium_upgrade_started", "checkout_started"].includes(event.event));
      const completed = user.events.find((event) => ["premium_upgrade_completed", "checkout_completed"].includes(event.event));

      return selected && !startedCheckout && !completed ? { user, selected } : null;
    })
    .filter(Boolean);

  if (!affected.length) {
    return [];
  }

  const confidence = confidenceFrom({
    affectedUsers: affected.length,
    totalUsers,
    explicitSignal: true
  });

  return [
    {
      id: createId(["premium-intent", affected.map((entry) => entry.user.label).join(",")]),
      priority: priorityFor(confidence),
      confidence,
      kind: "opportunity",
      title: "Premium intent is not reaching completion",
      summary: `${affected.length} ${affected.length === 1 ? "journey shows" : "journeys show"} premium intent without a recorded upgrade completion.`,
      reasoning:
        "Plan selection and checkout start are strong intent signals. If users stop here, the pricing page, checkout handoff, account requirement, or payment flow may need clarification.",
      metrics: {
        usersAffected: affected.length,
        totalUsers
      },
      evidence: affected.slice(0, 3).map((entry) => {
        return `${entry.user.label} triggered ${entry.selected.event}${eventPlan(entry.selected)} on ${eventPath(entry.selected)}.`;
      }),
      nextSteps: [
        "Make sure the selected plan, next charge, and account requirement are visible before checkout.",
        "Track premium_upgrade_completed or checkout_completed so this can be separated from missing instrumentation.",
        "Add a follow-up affordance for users who return after selecting a premium plan."
      ],
      sourceKey: "premium-intent",
      ticket: null
    }
  ];
}

function findInstrumentationGaps(events, totalUsers) {
  const present = new Set(events.map((event) => event.event));
  const missing = EXPLICIT_EVENTS.filter((event) => !present.has(event));
  const hasFallbackSignals = events.some((event) =>
    ["sign_up", "recipe_updated", "pricing_plan_selected", "checkout_started", "start_draft_imported"].includes(event.event)
  );

  if (!missing.length || !hasFallbackSignals) {
    return [];
  }

  const confidence = totalUsers <= 2 ? 0.58 : 0.66;

  return [
    {
      id: createId(["instrumentation", missing.join(",")]),
      priority: "medium",
      confidence,
      kind: "instrumentation",
      title: "Add explicit funnel start and completion events",
      summary: "The current data has useful product events, but several key funnel events are missing from the window.",
      reasoning:
        "The analysis can infer from existing events, but explicit start, completion, and error events will make dropoff tickets more trustworthy and easier to verify after changes ship.",
      metrics: {
        missingEvents: missing.length,
        totalUsers
      },
      evidence: [
        `Missing in this window: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? `, and ${missing.length - 6} more` : ""}.`,
        "Existing fallback signals include sign_up, recipe_updated, pricing_plan_selected, checkout_started, or start_draft_imported."
      ],
      nextSteps: [
        "Add account_signup_started/completed, recipe_create_started/completed, and premium_upgrade_started/completed.",
        "Add checkout_error and recipe_create_error with a safe error code or step name.",
        "Keep event payloads free of raw user identifiers in the Crawlipop UI."
      ],
      sourceKey: "instrumentation",
      ticket: null
    }
  ];
}

function attachTickets(suggestions, ticketsBySuggestion) {
  return suggestions.map((suggestion) => ({
    ...suggestion,
    ticket: ticketsBySuggestion[suggestion.id] ?? null
  }));
}

export function analyzeBehaviorJourneys({ events = [], window, ticketsBySuggestion = {} }) {
  const sortedEvents = [...events].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
  const { users, sessions } = groupEvents(sortedEvents);
  const totalUsers = users.length;
  const totalSessions = sessions.length;

  const baseSummary = {
    usersAnalyzed: totalUsers,
    sessionsAnalyzed: totalSessions,
    eventsAnalyzed: sortedEvents.length,
    rageClicks: sortedEvents.filter((event) => event.event === "$rageclick").length,
    signups: sortedEvents.filter((event) => ["account_signup_completed", "sign_up"].includes(event.event)).length,
    recipeActions: sortedEvents.filter((event) =>
      ["recipe_create_started", "recipe_create_completed", "recipe_updated", "start_draft_imported"].includes(event.event)
    ).length,
    premiumSignals: sortedEvents.filter((event) =>
      ["pricing_plan_selected", "premium_upgrade_started", "premium_upgrade_completed", "checkout_started", "checkout_completed"].includes(event.event)
    ).length
  };

  if (!sortedEvents.length) {
    return {
      status: "empty",
      window,
      summary: baseSummary,
      suggestions: []
    };
  }

  const suggestions = [
    ...findBugSignals(users, totalUsers),
    ...findDropoffs(users, totalUsers),
    ...findPremiumIntent(users, totalUsers),
    ...findRepeatedActions(users, totalUsers),
    ...findInstrumentationGaps(sortedEvents, totalUsers)
  ].sort((left, right) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const leftPriority = priorityOrder[left.priority] ?? 9;
    const rightPriority = priorityOrder[right.priority] ?? 9;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return right.confidence - left.confidence;
  });

  return {
    status: suggestions.length ? "ready" : "empty",
    window,
    summary: baseSummary,
    suggestions: attachTickets(suggestions.slice(0, 8), ticketsBySuggestion)
  };
}

export function createBehaviorIssuePayload({ suggestion, siteUrl, analysisWindow }) {
  const lines = [
    `Suggested from Crawlipop behavior analysis for ${siteUrl || "Pawprint Kitchen"}.`,
    "",
    `Recommendation: **${suggestion.title}**`,
    "",
    suggestion.summary,
    "",
    `Confidence: ${formatPercent(suggestion.confidence)}`,
    "",
    "Reasoning:",
    suggestion.reasoning,
    "",
    "Evidence:",
    ...suggestion.evidence.map((entry) => `- ${entry}`),
    "",
    "Next steps:",
    ...suggestion.nextSteps.map((entry) => `- ${entry}`)
  ];

  if (analysisWindow?.start && analysisWindow?.end) {
    lines.splice(
      2,
      0,
      `Window: ${new Date(analysisWindow.start).toISOString()} to ${new Date(analysisWindow.end).toISOString()}`
    );
  }

  if (suggestion.metrics) {
    lines.push("", "Metrics:");
    for (const [key, value] of Object.entries(suggestion.metrics)) {
      lines.push(`- ${key}: ${typeof value === "number" ? compactNumber(value) : value}`);
    }
  }

  const prefixes = {
    bug: "Bug",
    confusion: "UX",
    dropoff: "UX",
    instrumentation: "Instrumentation",
    opportunity: "Growth"
  };
  const prefix = prefixes[suggestion.kind] ?? "UX";

  return {
    title: `[${prefix}] ${suggestion.title}`,
    description: lines.join("\n")
  };
}
