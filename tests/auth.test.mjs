import assert from "node:assert/strict";
import test from "node:test";

import {
  clearGoogleAuthFlowCookies,
  clearSessionCookie,
  getAuthConfigurationErrors,
  getSessionFromRequest,
  isGoogleAuthConfigured,
  readGoogleAuthFlowCookies,
  sanitizeReturnTo,
  setGoogleAuthFlowCookies,
  setSessionCookie
} from "../lib/auth.mjs";

const AUTH_ENV_KEYS = [
  "AUTH_ALLOWED_EMAILS",
  "AUTH_SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NODE_ENV"
];

async function withEnv(overrides, run) {
  const previous = Object.fromEntries(AUTH_ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of AUTH_ENV_KEYS) {
    delete process.env[key];
  }

  Object.assign(process.env, overrides);

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createCookieResponse() {
  const cookies = [];

  return {
    cookies,
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    }
  };
}

function cookieHeader(cookies) {
  return cookies
    .filter((cookie) => cookie.options?.maxAge !== 0)
    .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
    .join("; ");
}

test("sanitizeReturnTo only allows same-origin relative paths", () => {
  assert.equal(sanitizeReturnTo("/dashboard?tab=seo"), "/dashboard?tab=seo");
  assert.equal(sanitizeReturnTo("https://example.com/dashboard"), "/");
  assert.equal(sanitizeReturnTo("//example.com/dashboard"), "/");
  assert.equal(sanitizeReturnTo("dashboard"), "/");
  assert.equal(sanitizeReturnTo(""), "/");
});

test("auth configuration reports missing production requirements", async () => {
  await withEnv({ NODE_ENV: "production" }, () => {
    assert.deepEqual(getAuthConfigurationErrors(), [
      "Missing GOOGLE_CLIENT_ID.",
      "Missing GOOGLE_CLIENT_SECRET.",
      "Missing AUTH_SESSION_SECRET.",
      "Missing AUTH_ALLOWED_EMAILS."
    ]);
    assert.equal(isGoogleAuthConfigured(), false);
  });
});

test("auth configuration is ready when Google credentials and an allowlist are present", async () => {
  await withEnv(
    {
      AUTH_ALLOWED_EMAILS: "owner@example.com",
      AUTH_SESSION_SECRET: "test-session-secret",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      NODE_ENV: "production"
    },
    () => {
      assert.deepEqual(getAuthConfigurationErrors(), []);
      assert.equal(isGoogleAuthConfigured(), true);
    }
  );
});

test("session cookies round-trip signed session data and clear with matching cookie options", async () => {
  await withEnv({ AUTH_SESSION_SECRET: "test-session-secret", NODE_ENV: "test" }, async () => {
    const response = createCookieResponse();

    await setSessionCookie(response, {
      email: "Owner@Example.com",
      name: "Owner",
      picture: "https://example.com/avatar.png",
      sub: "google-subject"
    });

    assert.equal(response.cookies.length, 1);
    assert.equal(response.cookies[0].name, "crawlipop_session");
    assert.equal(response.cookies[0].options.httpOnly, true);
    assert.equal(response.cookies[0].options.sameSite, "lax");
    assert.equal(response.cookies[0].options.secure, false);

    const request = {
      headers: {
        cookie: cookieHeader(response.cookies)
      }
    };

    assert.deepEqual(await getSessionFromRequest(request), {
      email: "Owner@Example.com",
      name: "Owner",
      picture: "https://example.com/avatar.png",
      sub: "google-subject"
    });

    const clearingResponse = createCookieResponse();
    clearSessionCookie(clearingResponse);
    assert.equal(clearingResponse.cookies[0].name, "crawlipop_session");
    assert.equal(clearingResponse.cookies[0].value, "");
    assert.equal(clearingResponse.cookies[0].options.maxAge, 0);
  });
});

test("Google auth flow cookies preserve verifier state and sanitize return targets", () => {
  const response = createCookieResponse();

  setGoogleAuthFlowCookies(response, {
    codeVerifier: "verifier",
    nonce: "nonce",
    returnTo: "/queue",
    state: "state"
  });

  assert.equal(response.cookies.length, 4);
  assert.deepEqual(
    readGoogleAuthFlowCookies({
      headers: {
        cookie: cookieHeader(response.cookies)
      }
    }),
    {
      codeVerifier: "verifier",
      nonce: "nonce",
      returnTo: "/queue",
      state: "state"
    }
  );

  const badResponse = createCookieResponse();
  setGoogleAuthFlowCookies(badResponse, {
    codeVerifier: "verifier",
    nonce: "nonce",
    returnTo: "https://evil.example",
    state: "state"
  });

  assert.equal(
    readGoogleAuthFlowCookies({
      headers: {
        cookie: cookieHeader(badResponse.cookies)
      }
    }).returnTo,
    "/"
  );

  const clearingResponse = createCookieResponse();
  clearGoogleAuthFlowCookies(clearingResponse);
  assert.equal(clearingResponse.cookies.length, 4);
  assert.ok(clearingResponse.cookies.every((cookie) => cookie.options.maxAge === 0));
});
