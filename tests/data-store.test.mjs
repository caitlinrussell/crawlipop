import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStore } from "../lib/data-store.mjs";

test("store loads an empty default state when the cache file is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawlipop-store-"));
  const store = createStore(path.join(tempDir, "nested", "dashboard-cache.json"));

  const state = await store.load();

  assert.equal(state.source, "demo");
  assert.equal(state.lastSyncedAt, null);
  assert.deepEqual(state.recommendations, []);
  assert.deepEqual(state.behaviorAnalysis.suggestions, []);
});

test("store saves, reloads, merges, and returns cloned state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawlipop-store-"));
  const cachePath = path.join(tempDir, "dashboard-cache.json");
  const store = createStore(cachePath);

  const saved = await store.save({
    siteUrl: "sc-domain:crawlipop.dev",
    source: "live",
    lastSyncedAt: "2026-04-27T12:00:00.000Z",
    recommendations: [{ id: "one", title: "One" }]
  });

  saved.recommendations.push({ id: "mutated" });
  assert.equal(store.getState().recommendations.length, 1);

  const reloadedStore = createStore(cachePath);
  const reloaded = await reloadedStore.load();
  assert.equal(reloaded.siteUrl, "sc-domain:crawlipop.dev");
  assert.equal(reloaded.source, "live");
  assert.equal(reloaded.connection.searchConsole.configured, false);

  const merged = await reloadedStore.merge((state) => ({
    ...state,
    ticketsBySuggestion: {
      one: {
        identifier: "SEO-1"
      }
    }
  }));

  assert.deepEqual(merged.ticketsBySuggestion.one, { identifier: "SEO-1" });
  assert.match(await fs.readFile(cachePath, "utf8"), /"SEO-1"/);
});
