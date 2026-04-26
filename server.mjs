import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import cron from "node-cron";

import {
  clearGoogleAuthFlowCookies,
  clearSessionCookie,
  createGoogleAuthorizationRequest,
  exchangeGoogleCallbackCode,
  getAuthConfigurationErrors,
  getSessionFromRequest,
  isGoogleAuthConfigured,
  readGoogleAuthFlowCookies,
  sanitizeReturnTo,
  setGoogleAuthFlowCookies,
  setSessionCookie
} from "./lib/auth.mjs";
import { createStore } from "./lib/data-store.mjs";
import { createDemoDashboard } from "./lib/demo-data.mjs";
import { fetchSearchConsoleSnapshot } from "./lib/google-search-console.mjs";
import { createIssue, listTeams } from "./lib/linear.mjs";
import { buildRecommendations, createIssuePayload } from "./lib/recommendations.mjs";
import { hasLinearConfig, hasSearchConsoleConfig, loadConfig } from "./lib/config.mjs";

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

let config = await loadConfig();
const store = createStore(path.resolve(process.cwd(), config.dataDir, "dashboard-cache.json"));
let syncInFlight = null;

const AUTH_ERROR_MESSAGES = {
  callback: "Google sign-in did not complete. Try again.",
  config: "Google auth is not configured yet. Fill in the required environment variables before signing in.",
  oauth: "Google sign-in was canceled or rejected.",
  unauthorized: "That Google account is not on the Crawlipop allowlist."
};

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildLoginUrl({ error, next = "/" } = {}) {
  const params = new URLSearchParams();
  const sanitizedNext = sanitizeReturnTo(next === "/login" ? "/" : next);

  if (sanitizedNext !== "/") {
    params.set("next", sanitizedNext);
  }

  if (error) {
    params.set("error", error);
  }

  return params.size ? `/login?${params.toString()}` : "/login";
}

function renderLoginPage({ authErrors, errorCode, next }) {
  const safeNext = sanitizeReturnTo(next === "/login" ? "/" : next);
  const startUrl =
    safeNext === "/" ? "/api/auth/google/start" : `/api/auth/google/start?next=${encodeURIComponent(safeNext)}`;
  const message = errorCode ? AUTH_ERROR_MESSAGES[errorCode] ?? AUTH_ERROR_MESSAGES.callback : "";
  const authReady = authErrors.length === 0;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Crawlipop Login</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="login-page">
    <div class="orb orb-1" aria-hidden="true"></div>
    <div class="orb orb-2" aria-hidden="true"></div>
    <div class="orb orb-3" aria-hidden="true"></div>
    <main class="login-shell">
      <section class="login-card">
        <div class="login-brand">
          <div class="brand-mark" aria-hidden="true">
            <img class="brand-avatar" src="/crawlipop-avatar.png" alt="" />
          </div>
          <div>
            <p class="brand-name">Crawlipop</p>
            <p class="brand-meta">Search Console insights and Linear handoff, now gated behind Google auth.</p>
          </div>
        </div>
        <p class="login-kicker">Protected workspace</p>
        <h1>Sign in with Google</h1>
        <p class="login-copy">
          This deployment uses the same Google allowlist pattern as Ember. Sign in with an approved Google account to open the dashboard.
        </p>
        ${
          message
            ? `<div class="login-message login-message-error" role="alert">${escapeHtml(message)}</div>`
            : ""
        }
        ${
          authReady
            ? `<a class="primary-button login-button" href="${startUrl}">Continue with Google</a>`
            : `<div class="login-message login-message-warning" role="status">Google auth is not ready in this environment yet.</div>`
        }
        ${
          authErrors.length
            ? `<div class="login-config">
                <strong>Missing configuration</strong>
                <ul class="login-config-list">
                  ${authErrors.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}
                </ul>
              </div>`
            : ""
        }
      </section>
    </main>
  </body>
</html>`;
}

function createDashboardState(baseState) {
  const ticketsBySuggestion = baseState.ticketsBySuggestion ?? {};
  const searchConsoleConfigured = hasSearchConsoleConfig(config);
  const linearConfigured = hasLinearConfig(config);
  const searchConsoleMessage = searchConsoleConfigured
    ? baseState.connection?.searchConsole?.message ??
      (baseState.source === "live"
        ? "Search Console sync is ready."
        : "Search Console is configured, but the dashboard is still using fallback data.")
    : "Add Search Console credentials to replace the demo snapshot.";
  const linearMessage = linearConfigured
    ? "Linear ticket creation is ready."
    : "Add a Linear API key to create issues.";

  return {
    ...baseState,
    connection: {
      searchConsole: {
        configured: searchConsoleConfigured,
        ok: searchConsoleConfigured && baseState.source === "live" && baseState.connection?.searchConsole?.ok !== false,
        message: searchConsoleMessage
      },
      linear: {
        configured: linearConfigured,
        ok: linearConfigured,
        message: linearMessage
      }
    },
    recommendations: buildRecommendations({
      topQueries: baseState.topQueries ?? [],
      topPages: baseState.topPages ?? [],
      ticketsBySuggestion
    }),
    ticketsBySuggestion
  };
}

async function initializeDashboard() {
  const cachedState = await store.load();

  if (cachedState.lastSyncedAt) {
    await store.save(createDashboardState(cachedState));
    return;
  }

  await store.save(createDashboardState(createDemoDashboard(config.siteUrl)));
}

async function syncDashboard() {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    config = await loadConfig();
    const currentState = store.getState();

    try {
      const snapshot = hasSearchConsoleConfig(config)
        ? await fetchSearchConsoleSnapshot({
            credentials: config.googleCredentials,
            siteUrl: config.siteUrl,
            delayDays: config.googleDataDelayDays
          })
        : createDemoDashboard(config.siteUrl);

      const nextState = createDashboardState({
        ...snapshot,
        ticketsBySuggestion: currentState.ticketsBySuggestion ?? {}
      });

      await store.save(nextState);
      return nextState;
    } catch (error) {
      const fallbackState = createDashboardState({
        ...(currentState.lastSyncedAt ? currentState : createDemoDashboard(config.siteUrl)),
        ticketsBySuggestion: currentState.ticketsBySuggestion ?? {},
        connection: {
          ...(currentState.connection ?? {}),
          searchConsole: {
            configured: hasSearchConsoleConfig(config),
            ok: false,
            message: error.message
          }
        }
      });

      await store.save(fallbackState);
      throw error;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

await initializeDashboard();
void syncDashboard().catch(() => {});

if (cron.validate(config.syncSchedule)) {
  cron.schedule(config.syncSchedule, () => {
    void syncDashboard().catch(() => {});
  });
}

app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    source: store.getState().source,
    lastSyncedAt: store.getState().lastSyncedAt
  });
});

app.get("/styles.css", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "styles.css"));
});

app.get("/crawlipop-avatar.png", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "crawlipop-avatar.png"));
});

app.get("/login", async (request, response) => {
  const session = await getSessionFromRequest(request);
  const next = sanitizeReturnTo(getQueryValue(request.query.next));

  if (session) {
    response.redirect(303, next === "/login" ? "/" : next);
    return;
  }

  response.type("html").send(
    renderLoginPage({
      authErrors: getAuthConfigurationErrors(),
      errorCode: getQueryValue(request.query.error),
      next
    })
  );
});

app.get("/api/auth/google/start", async (request, response) => {
  const next = sanitizeReturnTo(getQueryValue(request.query.next));

  if (!isGoogleAuthConfigured()) {
    response.redirect(303, buildLoginUrl({ error: "config", next }));
    return;
  }

  try {
    const authorizationRequest = await createGoogleAuthorizationRequest(request, next);
    setGoogleAuthFlowCookies(response, authorizationRequest);
    response.redirect(303, authorizationRequest.authorizationUrl.toString());
  } catch {
    response.redirect(303, buildLoginUrl({ error: "callback", next }));
  }
});

app.get("/api/auth/google/callback", async (request, response) => {
  const oauthError = getQueryValue(request.query.error);
  const requestedState = getQueryValue(request.query.state);
  const code = getQueryValue(request.query.code);
  const { codeVerifier, nonce, returnTo, state } = readGoogleAuthFlowCookies(request);

  if (oauthError) {
    clearGoogleAuthFlowCookies(response);
    response.redirect(303, buildLoginUrl({ error: "oauth", next: returnTo }));
    return;
  }

  if (!state || !requestedState || state !== requestedState || !codeVerifier || !nonce || !code) {
    clearGoogleAuthFlowCookies(response);
    response.redirect(303, buildLoginUrl({ error: "callback", next: returnTo }));
    return;
  }

  try {
    const session = await exchangeGoogleCallbackCode(request, code, codeVerifier, nonce);
    clearGoogleAuthFlowCookies(response);
    await setSessionCookie(response, session);
    response.redirect(303, returnTo || "/");
  } catch (error) {
    clearGoogleAuthFlowCookies(response);
    response.redirect(
      303,
      buildLoginUrl({
        error: error instanceof Error && error.message.includes("allowlist") ? "unauthorized" : "callback",
        next: returnTo
      })
    );
  }
});

app.post("/api/auth/logout", (_request, response) => {
  clearSessionCookie(response);
  response.redirect(303, "/login");
});

app.use(async (request, response, next) => {
  if (request.path === "/health" || request.path === "/login" || request.path.startsWith("/api/auth/")) {
    next();
    return;
  }

  const session = await getSessionFromRequest(request);

  if (session) {
    request.authSession = session;
    next();
    return;
  }

  if (request.path.startsWith("/api/")) {
    response.status(401).json({
      error: "Unauthorized"
    });
    return;
  }

  response.redirect(303, buildLoginUrl({ next: request.originalUrl }));
});

app.use("/vendor/chart.js", express.static(path.join(__dirname, "node_modules", "chart.js", "dist")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/auth/session", (request, response) => {
  response.json({
    authenticated: true,
    session: request.authSession
  });
});

app.get("/api/dashboard", async (_request, response) => {
  response.json(store.getState());
});

app.post("/api/sync", async (_request, response) => {
  try {
    const dashboard = await syncDashboard();
    response.json(dashboard);
  } catch (error) {
    response.status(500).json({
      error: error.message,
      dashboard: store.getState()
    });
  }
});

app.get("/api/linear/teams", async (_request, response) => {
  if (!hasLinearConfig(config)) {
    response.json({
      configured: false,
      defaultTeamId: config.linearDefaultTeamId,
      teams: []
    });
    return;
  }

  try {
    const teams = await listTeams(config.linearApiKey);
    response.json({
      configured: true,
      defaultTeamId: config.linearDefaultTeamId,
      teams
    });
  } catch (error) {
    response.status(500).json({
      configured: true,
      error: error.message,
      teams: []
    });
  }
});

app.post("/api/linear/issues", async (request, response) => {
  if (!hasLinearConfig(config)) {
    response.status(400).json({
      error: "Linear is not configured."
    });
    return;
  }

  const { suggestionId, teamId } = request.body ?? {};
  const dashboard = store.getState();
  const recommendation = dashboard.recommendations.find((entry) => entry.id === suggestionId);
  const resolvedTeamId = teamId || config.linearDefaultTeamId;

  if (!recommendation) {
    response.status(404).json({ error: "Suggestion not found." });
    return;
  }

  if (!resolvedTeamId) {
    response.status(400).json({ error: "Choose a Linear team first." });
    return;
  }

  try {
    const issueInput = createIssuePayload({
      recommendation,
      siteUrl: dashboard.siteUrl,
      dateWindow: dashboard.dateWindow
    });

    const issue = await createIssue({
      apiKey: config.linearApiKey,
      teamId: resolvedTeamId,
      title: issueInput.title,
      description: issueInput.description
    });

    const nextState = await store.merge((currentState) => {
      const ticketsBySuggestion = {
        ...(currentState.ticketsBySuggestion ?? {}),
        [suggestionId]: issue
      };

      return createDashboardState({
        ...currentState,
        ticketsBySuggestion
      });
    });

    response.json({
      issue,
      dashboard: nextState
    });
  } catch (error) {
    response.status(500).json({
      error: error.message
    });
  }
});

app.get("/{*path}", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(config.port, () => {
  console.log(`Crawlipop running at http://localhost:${config.port}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});
