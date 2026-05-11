import fs from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = {
  siteUrl: "",
  source: "demo",
  lastSyncedAt: null,
  searchConsoleWindowDays: 28,
  dateWindow: null,
  validationWindow: null,
  connection: {
    searchConsole: {
      configured: false,
      ok: false,
      message: "Search Console is not configured yet."
    },
    linear: {
      configured: false,
      ok: false,
      message: "Linear is not configured yet."
    }
  },
  summary: null,
  trend: [],
  topQueries: [],
  topPages: [],
  recommendations: [],
  behaviorAnalysis: {
    status: "idle",
    configured: false,
    ok: false,
    message: "PostHog is not configured yet.",
    lastAnalyzedAt: null,
    window: null,
    summary: null,
    suggestions: [],
    ticketsBySuggestion: {},
    error: null
  },
  ticketsBySuggestion: {}
};

export function createStore(cachePath) {
  let state = structuredClone(EMPTY_STATE);

  async function ensureDir() {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
  }

  async function load() {
    try {
      const raw = await fs.readFile(cachePath, "utf8");
      state = { ...structuredClone(EMPTY_STATE), ...JSON.parse(raw) };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    return getState();
  }

  async function save(nextState) {
    state = { ...structuredClone(EMPTY_STATE), ...nextState };
    await ensureDir();
    await fs.writeFile(cachePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return getState();
  }

  function getState() {
    return structuredClone(state);
  }

  async function merge(updater) {
    const nextState = updater(getState());
    return save(nextState);
  }

  return {
    load,
    save,
    merge,
    getState
  };
}
