import assert from "node:assert/strict";
import test from "node:test";

import { fetchPostHogJourneys } from "../lib/posthog.mjs";

test("fetchPostHogJourneys queries PostHog, normalizes rows, clamps inputs, and filters internal users", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });

    return {
      ok: true,
      async json() {
        return {
          results: {
            results: [
              [
                "account_signup_started",
                "2026-04-20T12:00:00.000Z",
                "external-user",
                "session-1",
                "https://app.example.com/signup",
                "/signup",
                JSON.stringify({ plan: "pro" })
              ],
              [
                "$rageclick",
                "2026-04-20T12:05:00.000Z",
                "internal-id",
                "session-2",
                "https://app.example.com/settings",
                "/settings",
                {}
              ],
              [
                "checkout_started",
                "2026-04-20T12:10:00.000Z",
                "internal-email",
                "session-3",
                "https://app.example.com/checkout",
                "/checkout",
                { $set: { email: "Owner@Example.com" } }
              ]
            ]
          }
        };
      }
    };
  };

  try {
    const result = await fetchPostHogJourneys({
      host: "https://us.posthog.com/",
      projectId: "project-id",
      personalApiKey: "ph-key",
      lookbackDays: 999,
      excludedDistinctIds: ["internal-id"],
      excludedEmails: ["owner@example.com"],
      limit: 50000
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://us.posthog.com/api/projects/project-id/query/");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Authorization, "Bearer ph-key");

    const body = JSON.parse(calls[0].options.body);
    assert.match(body.query.query, /INTERVAL 365 DAY/);
    assert.match(body.query.query, /LIMIT 10000/);
    assert.match(body.query.query, /account_signup_started/);

    assert.equal(result.window.lookbackDays, 365);
    assert.equal(result.events.length, 1);
    assert.deepEqual(result.events[0], {
      event: "account_signup_started",
      timestamp: "2026-04-20T12:00:00.000Z",
      distinctId: "external-user",
      sessionId: "session-1",
      currentUrl: "https://app.example.com/signup",
      pathname: "/signup",
      properties: {
        plan: "pro"
      }
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fetchPostHogJourneys surfaces failing PostHog responses", async () => {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async text() {
      return "forbidden";
    }
  });

  try {
    await assert.rejects(
      fetchPostHogJourneys({
        host: "https://us.posthog.com",
        projectId: "project-id",
        personalApiKey: "ph-key"
      }),
      /PostHog query failed \(403\): forbidden/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
