import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import cron from "node-cron";

import { createStore } from "./lib/data-store.mjs";
import { createDemoDashboard } from "./lib/demo-data.mjs";
import { fetchSearchConsoleSnapshot } from "./lib/google-search-console.mjs";
import { createIssue, listTeams } from "./lib/linear.mjs";
import { buildRecommendations, createIssuePayload } from "./lib/recommendations.mjs";
import { hasLinearConfig, hasSearchConsoleConfig, loadConfig } from "./lib/config.mjs";

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const store = createStore(path.join(__dirname, ".data", "dashboard-cache.json"));

let config = await loadConfig();
let syncInFlight = null;

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
app.use("/vendor/chart.js", express.static(path.join(__dirname, "node_modules", "chart.js", "dist")));
app.use(express.static(path.join(__dirname, "public")));

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

app.listen(config.port, () => {
  console.log(`Crawlipop running at http://localhost:${config.port}`);
});
