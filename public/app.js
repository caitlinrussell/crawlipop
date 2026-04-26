const state = {
  dashboard: null,
  session: null,
  teams: [],
  selectedTeamId: localStorage.getItem("crawlipop:selected-team") ?? "",
  selectedSuggestionId: null,
  selectedBehaviorSuggestionId: null,
  selectedTrendIndex: null,
  loadingDashboard: true,
  syncing: false,
  analyzingBehavior: false,
  behaviorPollCount: 0,
  creatingSuggestionId: null,
  creatingBehaviorSuggestionId: null,
  dismissedSiteUrl: null,
  dismissedSuggestionIds: new Set(),
  showDismissed: localStorage.getItem("crawlipop:show-dismissed") === "true",
  dismissedBehaviorSuggestionIds: new Set(),
  showDismissedBehavior: localStorage.getItem("crawlipop:show-dismissed-behavior") === "true"
};

const elements = {
  authEmail: document.querySelector("#authEmail"),
  syncButton: document.querySelector("#syncButton"),
  teamSelect: document.querySelector("#teamSelect"),
  deskTitle: document.querySelector("#deskTitle"),
  overviewMeta: document.querySelector("#overviewMeta"),
  focusPrompt: document.querySelector("#focusPrompt"),
  summaryGrid: document.querySelector("#summaryGrid"),
  trendMeta: document.querySelector("#trendMeta"),
  trendChart: document.querySelector("#trendChart"),
  queueMeta: document.querySelector("#queueMeta"),
  queuePills: document.querySelector("#queuePills"),
  suggestionsList: document.querySelector("#suggestionsList"),
  suggestionDetail: document.querySelector("#suggestionDetail"),
  behaviorMeta: document.querySelector("#behaviorMeta"),
  behaviorPills: document.querySelector("#behaviorPills"),
  behaviorSyncButton: document.querySelector("#behaviorSyncButton"),
  behaviorSummary: document.querySelector("#behaviorSummary"),
  behaviorList: document.querySelector("#behaviorList"),
  behaviorDetail: document.querySelector("#behaviorDetail"),
  queriesTable: document.querySelector("#queriesTable"),
  pagesTable: document.querySelector("#pagesTable")
};

let trendChart = null;
let behaviorPollTimer = null;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options
  });

  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    throw new Error("Unauthorized");
  }

  const payload = await response.json().catch(() => ({}));
  return { payload, response };
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return `${(value * 100).toFixed(digits)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "Not synced yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatDelta(value, invert = false) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      text: "No baseline",
      trend: "flat"
    };
  }

  const adjusted = invert ? value * -1 : value;
  const trend = adjusted > 0.01 ? "up" : adjusted < -0.01 ? "down" : "flat";
  const sign = adjusted > 0 ? "+" : "";

  return {
    text: `${sign}${(adjusted * 100).toFixed(1)}%`,
    trend
  };
}

function formatPositionDelta(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      text: "No baseline",
      trend: "flat"
    };
  }

  const trend = value < 0 ? "up" : value > 0 ? "down" : "flat";
  const sign = value > 0 ? "+" : "";

  return {
    text: `${sign}${value.toFixed(1)}`,
    trend
  };
}

function truncateUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname || parsed.hostname;
  } catch {
    return url;
  }
}

function humanizeSite(siteUrl) {
  return (siteUrl || "")
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function describeKind(kind) {
  const labels = {
    ctr: "Snippet",
    refresh: "Refresh",
    expansion: "Expansion",
    momentum: "Momentum"
  };

  return labels[kind] ?? titleCase(kind);
}

function describeBehaviorKind(kind) {
  const labels = {
    bug: "Bug",
    confusion: "Confusion",
    dropoff: "Dropoff",
    instrumentation: "Instrumentation",
    opportunity: "Opportunity"
  };

  return labels[kind] ?? titleCase(kind);
}

function formatConfidence(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return `${Math.round(value * 100)}%`;
}

function getDismissedStorageKey(siteUrl = state.dashboard?.siteUrl) {
  return `crawlipop:dismissed:${siteUrl || "default"}`;
}

function readDismissedSuggestions(siteUrl) {
  try {
    const parsed = JSON.parse(localStorage.getItem(getDismissedStorageKey(siteUrl)) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function syncDismissedSuggestions(siteUrl) {
  const nextSiteUrl = siteUrl || "default";
  if (state.dismissedSiteUrl === nextSiteUrl) {
    return;
  }

  state.dismissedSiteUrl = nextSiteUrl;
  state.dismissedSuggestionIds = new Set(readDismissedSuggestions(nextSiteUrl));
}

function persistDismissedSuggestions() {
  if (!state.dismissedSiteUrl) {
    return;
  }

  localStorage.setItem(
    getDismissedStorageKey(state.dismissedSiteUrl),
    JSON.stringify([...state.dismissedSuggestionIds])
  );
}

function isDismissedSuggestion(suggestionId) {
  return state.dismissedSuggestionIds.has(suggestionId);
}

function readDismissedBehaviorSuggestions() {
  try {
    const parsed = JSON.parse(localStorage.getItem("crawlipop:behavior-dismissed") ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function syncDismissedBehaviorSuggestions() {
  if (state.dismissedBehaviorSuggestionIds.size) {
    return;
  }

  state.dismissedBehaviorSuggestionIds = new Set(readDismissedBehaviorSuggestions());
}

function persistDismissedBehaviorSuggestions() {
  localStorage.setItem(
    "crawlipop:behavior-dismissed",
    JSON.stringify([...state.dismissedBehaviorSuggestionIds])
  );
}

function isDismissedBehaviorSuggestion(suggestionId) {
  return state.dismissedBehaviorSuggestionIds.has(suggestionId);
}

function toggleDismissedBehaviorVisibility() {
  state.showDismissedBehavior = !state.showDismissedBehavior;
  localStorage.setItem("crawlipop:show-dismissed-behavior", String(state.showDismissedBehavior));

  if (
    !state.showDismissedBehavior &&
    state.selectedBehaviorSuggestionId &&
    isDismissedBehaviorSuggestion(state.selectedBehaviorSuggestionId)
  ) {
    state.selectedBehaviorSuggestionId = null;
  }

  renderDashboard();
}

function dismissBehaviorSuggestion(suggestionId) {
  state.dismissedBehaviorSuggestionIds.add(suggestionId);
  persistDismissedBehaviorSuggestions();

  if (!state.showDismissedBehavior && state.selectedBehaviorSuggestionId === suggestionId) {
    state.selectedBehaviorSuggestionId = null;
  }

  renderDashboard();
}

function restoreBehaviorSuggestion(suggestionId) {
  state.dismissedBehaviorSuggestionIds.delete(suggestionId);
  persistDismissedBehaviorSuggestions();
  state.selectedBehaviorSuggestionId = suggestionId;
  renderDashboard();
}

function getVisibleBehaviorSuggestions(suggestions = []) {
  if (state.showDismissedBehavior) {
    return [...suggestions];
  }

  return suggestions.filter((entry) => !isDismissedBehaviorSuggestion(entry.id));
}

function toggleDismissedVisibility() {
  state.showDismissed = !state.showDismissed;
  localStorage.setItem("crawlipop:show-dismissed", String(state.showDismissed));

  if (!state.showDismissed && state.selectedSuggestionId && isDismissedSuggestion(state.selectedSuggestionId)) {
    state.selectedSuggestionId = null;
  }

  renderDashboard();
}

function dismissSuggestion(suggestionId) {
  state.dismissedSuggestionIds.add(suggestionId);
  persistDismissedSuggestions();

  if (!state.showDismissed && state.selectedSuggestionId === suggestionId) {
    state.selectedSuggestionId = null;
  }

  renderDashboard();
}

function restoreSuggestion(suggestionId) {
  state.dismissedSuggestionIds.delete(suggestionId);
  persistDismissedSuggestions();
  state.selectedSuggestionId = suggestionId;
  renderDashboard();
}

function getVisibleSuggestions(recommendations = []) {
  if (state.showDismissed) {
    return [...recommendations];
  }

  return recommendations.filter((entry) => !isDismissedSuggestion(entry.id));
}

function sortSuggestions(recommendations = []) {
  return [...recommendations].sort((left, right) => {
    const leftWeight = Number(Boolean(left.ticket)) + Number(isDismissedSuggestion(left.id)) * 2;
    const rightWeight = Number(Boolean(right.ticket)) + Number(isDismissedSuggestion(right.id)) * 2;
    return leftWeight - rightWeight;
  });
}

function getSelectedSuggestion(recommendations = []) {
  if (!recommendations.length) {
    state.selectedSuggestionId = null;
    return null;
  }

  const selected = recommendations.find((entry) => entry.id === state.selectedSuggestionId) ?? recommendations[0];
  state.selectedSuggestionId = selected.id;
  return selected;
}

function renderSpinner(label = "Waiting for data") {
  return `
    <div class="widget-spinner" role="status" aria-live="polite" aria-label="${label}">
      <span class="widget-spinner-ring" aria-hidden="true"></span>
      <span class="widget-spinner-label">${label}</span>
    </div>
  `;
}

function syncLoadingTargets() {
  return [
    elements.summaryGrid,
    elements.trendChart,
    elements.suggestionsList,
    elements.suggestionDetail,
    elements.queriesTable.closest(".table-wrap"),
    elements.pagesTable.closest(".table-wrap")
  ].filter(Boolean);
}

function setWidgetLoading(active) {
  for (const target of syncLoadingTargets()) {
    target.classList.add("widget-busy-target");

    let overlay = target.querySelector(":scope > .widget-busy-overlay");

    if (active) {
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "widget-busy-overlay";
        overlay.innerHTML = renderSpinner("Refreshing data");
        target.append(overlay);
      }
      continue;
    }

    overlay?.remove();
  }
}

function renderLoadingDashboard() {
  if (elements.authEmail) {
    elements.authEmail.textContent = "Loading...";
  }

  elements.deskTitle.textContent = "SEO desk";
  elements.overviewMeta.textContent = "Fetching the latest Search Console snapshot...";
  elements.focusPrompt.textContent = "Loading your queries, pages, and recommendations.";
  elements.trendMeta.textContent = "Waiting for trend data";
  elements.queueMeta.textContent = "Building the latest suggestion queue.";
  elements.queuePills.replaceChildren();
  elements.behaviorMeta.textContent = "Checking PostHog behavior analysis.";
  elements.behaviorPills.replaceChildren();
  elements.behaviorSummary.replaceChildren();

  elements.summaryGrid.innerHTML = `
    <article class="stat-card loading-card">
      <p class="stat-label">Clicks</p>
      ${renderSpinner("Loading clicks")}
    </article>
    <article class="stat-card loading-card">
      <p class="stat-label">Impressions</p>
      ${renderSpinner("Loading impressions")}
    </article>
    <article class="stat-card loading-card">
      <p class="stat-label">CTR</p>
      ${renderSpinner("Loading CTR")}
    </article>
    <article class="stat-card loading-card">
      <p class="stat-label">Average position</p>
      ${renderSpinner("Loading position")}
    </article>
  `;

  elements.trendChart.innerHTML = `
    <div class="widget-loading-block">
      ${renderSpinner("Loading trend data")}
    </div>
  `;

  elements.suggestionsList.innerHTML = `
    <div class="suggestion-item loading-card loading-suggestion">
      ${renderSpinner("Loading suggestions")}
    </div>
    <div class="suggestion-item loading-card loading-suggestion">
      ${renderSpinner("Loading suggestions")}
    </div>
  `;

  elements.suggestionDetail.className = "detail-card loading-card";
  elements.suggestionDetail.innerHTML = `
    <div class="widget-loading-block">
      ${renderSpinner("Loading recommendation detail")}
    </div>
  `;

  elements.behaviorList.innerHTML = `
    <div class="suggestion-item loading-card loading-suggestion">
      ${renderSpinner("Loading behavior queue")}
    </div>
  `;

  elements.behaviorDetail.className = "detail-card loading-card";
  elements.behaviorDetail.innerHTML = `
    <div class="widget-loading-block">
      ${renderSpinner("Loading behavior detail")}
    </div>
  `;

  elements.queriesTable.innerHTML = `
    <tr>
      <td colspan="5">
        <div class="table-loading">
          ${renderSpinner("Loading queries")}
        </div>
      </td>
    </tr>
  `;

  elements.pagesTable.innerHTML = `
    <tr>
      <td colspan="5">
        <div class="table-loading">
          ${renderSpinner("Loading pages")}
        </div>
      </td>
    </tr>
  `;
}

function renderSession() {
  if (!elements.authEmail) {
    return;
  }

  elements.authEmail.textContent = state.session?.email ?? "Signed in";
}

function renderSummary(summary) {
  elements.summaryGrid.replaceChildren();

  const stats = [
    {
      label: "Clicks",
      value: compactNumber(summary?.clicks),
      delta: formatDelta(summary?.clicksChange)
    },
    {
      label: "Impressions",
      value: compactNumber(summary?.impressions),
      delta: formatDelta(summary?.impressionsChange)
    },
    {
      label: "CTR",
      value: formatPercent(summary?.ctr),
      delta: formatDelta(summary?.ctrChange)
    },
    {
      label: "Average position",
      value: summary?.position !== null && summary?.position !== undefined ? summary.position.toFixed(1) : "--",
      delta: formatPositionDelta(summary?.positionChange)
    }
  ];

  for (const stat of stats) {
    const card = document.createElement("article");
    card.className = "stat-card";
    card.innerHTML = `
      <p class="stat-label">${stat.label}</p>
      <p class="stat-value">${stat.value}</p>
      <span class="stat-delta" data-trend="${stat.delta.trend}">${stat.delta.text}</span>
    `;
    elements.summaryGrid.append(card);
  }
}

function renderTrend(trend = []) {
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }

  if (!trend.length) {
    elements.trendChart.innerHTML = `<div class="empty-state">No trend data yet.</div>`;
    return;
  }

  elements.trendChart.innerHTML = `
    <div class="trend-chart-shell">
      <p class="trend-chart-note">Hover the chart to compare clicks and impressions day by day.</p>
      <canvas id="trendCanvas" aria-label="Clicks and impressions over time"></canvas>
    </div>
  `;

  if (typeof window.Chart !== "function") {
    elements.trendChart.innerHTML = `<div class="empty-state">Chart library failed to load.</div>`;
    return;
  }

  const canvas = elements.trendChart.querySelector("#trendCanvas");
  trendChart = new window.Chart(canvas, {
    type: "line",
    data: {
      labels: trend.map((entry) => formatShortDate(entry.date)),
      datasets: [
        {
          label: "Clicks",
          data: trend.map((entry) => entry.clicks),
          yAxisID: "clicks",
          borderColor: "#ff6bca",
          backgroundColor: "rgba(255, 107, 202, 0.18)",
          pointHoverBackgroundColor: "#ff6bca",
          pointHoverBorderColor: "#1a1545",
          pointHoverBorderWidth: 2,
          tension: 0.32,
          borderWidth: 3,
          fill: false
        },
        {
          label: "Impressions",
          data: trend.map((entry) => entry.impressions ?? 0),
          yAxisID: "impressions",
          borderColor: "#6bc5ff",
          backgroundColor: "rgba(107, 197, 255, 0.18)",
          pointHoverBackgroundColor: "#6bc5ff",
          pointHoverBorderColor: "#1a1545",
          pointHoverBorderWidth: 2,
          tension: 0.32,
          borderWidth: 3,
          borderDash: [7, 5],
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      animation: {
        duration: 220
      },
      plugins: {
        legend: {
          labels: {
            color: "#f0eaff",
            usePointStyle: true,
            boxWidth: 8,
            padding: 16
          }
        },
        tooltip: {
          backgroundColor: "rgba(10, 8, 26, 0.96)",
          borderColor: "rgba(255, 255, 255, 0.12)",
          borderWidth: 1,
          titleColor: "#f0eaff",
          bodyColor: "#f0eaff",
          displayColors: true,
          callbacks: {
            title(items) {
              return formatShortDate(trend[items[0].dataIndex].date);
            },
            label(context) {
              return `${context.dataset.label}: ${compactNumber(context.parsed.y)}`;
            }
          }
        }
      },
      elements: {
        point: {
          radius: 0,
          hoverRadius: 5,
          hitRadius: 18
        }
      },
      scales: {
        x: {
          grid: {
            color: "rgba(255, 255, 255, 0.05)"
          },
          ticks: {
            color: "rgba(224, 210, 255, 0.68)",
            maxTicksLimit: 7
          }
        },
        clicks: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          grid: {
            color: "rgba(255, 255, 255, 0.07)"
          },
          ticks: {
            color: "#ff9fdb",
            precision: 0
          }
        },
        impressions: {
          type: "linear",
          position: "right",
          beginAtZero: true,
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: "#8bd4ff",
            callback(value) {
              return compactNumber(value);
            }
          }
        }
      }
    }
  });
}

function renderQueuePills(recommendations = [], dismissedCount = 0) {
  elements.queuePills.replaceChildren();

  const highCount = recommendations.filter((entry) => entry.priority === "high").length;
  const ticketedCount = recommendations.filter((entry) => entry.ticket).length;
  const chips = [
    `${recommendations.length} queued`,
    `${highCount} high priority`,
    `${ticketedCount} ticketed`
  ];

  for (const chip of chips) {
    const element = document.createElement("span");
    element.className = "queue-chip";
    element.textContent = chip;
    elements.queuePills.append(element);
  }

  if (dismissedCount) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `queue-chip queue-toggle${state.showDismissed ? " active" : ""}`;
    toggle.textContent = state.showDismissed ? "Hide dismissed" : `Show ${dismissedCount} dismissed`;
    toggle.addEventListener("click", toggleDismissedVisibility);
    elements.queuePills.append(toggle);
  }
}

function renderSuggestions(recommendations = [], linearConfigured, dismissedCount = 0) {
  const queuedRecommendations = sortSuggestions(recommendations);
  elements.suggestionsList.replaceChildren();
  const selectedSuggestion = getSelectedSuggestion(queuedRecommendations);

  if (!queuedRecommendations.length) {
    elements.suggestionsList.innerHTML = `<div class="empty-state">${
      dismissedCount
        ? "Everything in this window is dismissed for now. Use the queue toggle to bring items back."
        : "No suggestions surfaced for this window yet."
    }</div>`;
    elements.suggestionDetail.className = "detail-card empty";
    elements.suggestionDetail.innerHTML = `<div>Select a suggestion when one appears.</div>`;
    return;
  }

  for (const recommendation of queuedRecommendations) {
    const dismissed = isDismissedSuggestion(recommendation.id);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `suggestion-item${recommendation.id === selectedSuggestion?.id ? " selected" : ""}${
      recommendation.ticket ? " ticketed" : ""
    }${dismissed ? " dismissed" : ""}`;
    item.setAttribute("aria-pressed", recommendation.id === selectedSuggestion?.id ? "true" : "false");
    item.innerHTML = `
      <div class="suggestion-topline">
        <span class="priority-pill ${recommendation.priority}">${recommendation.priority}</span>
        <span class="kind-pill">${describeKind(recommendation.kind)}</span>
        ${dismissed ? '<span class="ticket-state dismissed-state">Dismissed</span>' : ""}
        ${recommendation.ticket ? '<span class="ticket-state">Ticketed</span>' : ""}
      </div>
      <strong class="suggestion-title">${recommendation.title}</strong>
      <p class="suggestion-summary">${recommendation.summary}</p>
      <div class="suggestion-foot">
        <span><strong>${compactNumber(recommendation.metrics.impressions)}</strong> impressions</span>
        <span>${
          dismissed
            ? "Hidden from active queue"
            : recommendation.ticket?.identifier
              ? recommendation.ticket.identifier
              : linearConfigured
                ? "Ready for ticket"
                : "Needs Linear"
        }</span>
      </div>
    `;

    item.addEventListener("click", () => {
      state.selectedSuggestionId = recommendation.id;
      renderDashboard();
    });

    elements.suggestionsList.append(item);
  }

  renderSuggestionDetail(selectedSuggestion, linearConfigured);
}

function renderSuggestionDetail(recommendation, linearConfigured) {
  if (!recommendation) {
    elements.suggestionDetail.className = "detail-card empty";
    elements.suggestionDetail.innerHTML = `<div>Select a suggestion to inspect it.</div>`;
    return;
  }

  elements.suggestionDetail.className = "detail-card";

  const readyForTicket = linearConfigured && Boolean(state.selectedTeamId);
  const isCreating = state.creatingSuggestionId === recommendation.id;
  const dismissed = isDismissedSuggestion(recommendation.id);
  const actionLabel = recommendation.ticket?.identifier
    ? recommendation.ticket.identifier
    : isCreating
      ? "Creating..."
      : readyForTicket
        ? "Create Linear ticket"
        : linearConfigured
          ? "Pick a team first"
          : "Connect Linear first";

  elements.suggestionDetail.innerHTML = `
    <div class="detail-top">
      <div class="detail-lead">
        <div class="detail-badges">
          <span class="priority-pill ${recommendation.priority}">${recommendation.priority}</span>
          <span class="kind-pill">${describeKind(recommendation.kind)}</span>
          ${dismissed ? '<span class="ticket-state dismissed-state">Dismissed</span>' : ""}
        </div>
        <h3>${recommendation.title}</h3>
        <p>${recommendation.summary}</p>
      </div>
      <div class="detail-actions">
        <button class="secondary-button detail-dismiss-button" id="detailDismiss" type="button">
          ${dismissed ? "Restore to queue" : "Dismiss for now"}
        </button>
        <button class="primary-button" id="detailAction" type="button" ${recommendation.ticket?.url || !readyForTicket || isCreating ? "disabled" : ""}>
          ${actionLabel}
        </button>
      </div>
    </div>
    <dl class="detail-metrics">
      <div class="detail-metric">
        <dt>Clicks</dt>
        <dd>${compactNumber(recommendation.metrics.clicks)}</dd>
      </div>
      <div class="detail-metric">
        <dt>Impressions</dt>
        <dd>${compactNumber(recommendation.metrics.impressions)}</dd>
      </div>
      <div class="detail-metric">
        <dt>CTR</dt>
        <dd>${formatPercent(recommendation.metrics.ctr)}</dd>
      </div>
      <div class="detail-metric">
        <dt>Avg. position</dt>
        <dd>${recommendation.metrics.position.toFixed(1)}</dd>
      </div>
    </dl>
    <div class="detail-columns">
      <section class="detail-section">
        <h4>Why this surfaced</h4>
        <ul>
          ${recommendation.evidence.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </section>
      <section class="detail-section">
        <h4>What to do next</h4>
        <ul>
          ${recommendation.nextSteps.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </section>
    </div>
    <div class="detail-footer">
      <span class="detail-note">${
        dismissed
          ? "Dismissed suggestions stay out of the active queue until you restore them."
          : recommendation.ticket?.url
          ? "Ticket already created."
          : readyForTicket
            ? "This suggestion is ready to send to Linear."
            : linearConfigured
              ? "Choose a team above to enable the ticket action."
              : "Add Linear credentials to turn this into a ticket."
      }</span>
      ${
        recommendation.ticket?.url
          ? `<a class="ticket-link" href="${recommendation.ticket.url}" target="_blank" rel="noreferrer">Open ${recommendation.ticket.identifier ?? "ticket"} in Linear</a>`
          : ""
      }
    </div>
  `;

  elements.suggestionDetail.querySelector("#detailDismiss")?.addEventListener("click", () => {
    if (dismissed) {
      restoreSuggestion(recommendation.id);
      return;
    }

    dismissSuggestion(recommendation.id);
  });

  if (!recommendation.ticket?.url && readyForTicket) {
    elements.suggestionDetail.querySelector("#detailAction")?.addEventListener("click", () => {
      void createLinearIssue(recommendation.id);
    });
  }
}

function sortBehaviorSuggestions(suggestions = []) {
  return [...suggestions].sort((left, right) => {
    const leftTicketed = Number(Boolean(left.ticket)) + Number(isDismissedBehaviorSuggestion(left.id)) * 2;
    const rightTicketed = Number(Boolean(right.ticket)) + Number(isDismissedBehaviorSuggestion(right.id)) * 2;

    if (leftTicketed !== rightTicketed) {
      return leftTicketed - rightTicketed;
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const leftPriority = priorityOrder[left.priority] ?? 9;
    const rightPriority = priorityOrder[right.priority] ?? 9;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return (right.confidence ?? 0) - (left.confidence ?? 0);
  });
}

function getSelectedBehaviorSuggestion(suggestions = []) {
  if (!suggestions.length) {
    state.selectedBehaviorSuggestionId = null;
    return null;
  }

  const selected =
    suggestions.find((entry) => entry.id === state.selectedBehaviorSuggestionId) ?? suggestions[0];
  state.selectedBehaviorSuggestionId = selected.id;
  return selected;
}

function renderBehaviorSummary(behaviorAnalysis = {}) {
  elements.behaviorSummary.replaceChildren();

  const summary = behaviorAnalysis.summary;
  if (!summary) {
    return;
  }

  const stats = [
    ["Users", compactNumber(summary.usersAnalyzed)],
    ["Sessions", compactNumber(summary.sessionsAnalyzed)],
    ["Events", compactNumber(summary.eventsAnalyzed)],
    ["Rage clicks", compactNumber(summary.rageClicks)],
    ["Signups", compactNumber(summary.signups)],
    ["Recipe actions", compactNumber(summary.recipeActions)],
    ["Premium signals", compactNumber(summary.premiumSignals)]
  ];

  for (const [label, value] of stats) {
    const item = document.createElement("div");
    item.className = "behavior-stat";
    item.innerHTML = `
      <span>${label}</span>
      <strong>${value}</strong>
    `;
    elements.behaviorSummary.append(item);
  }
}

function renderBehaviorPills(suggestions = [], dismissedCount = 0) {
  elements.behaviorPills.replaceChildren();

  const highCount = suggestions.filter((entry) => entry.priority === "high").length;
  const ticketedCount = suggestions.filter((entry) => entry.ticket).length;
  const chips = [
    `${suggestions.length} queued`,
    `${highCount} high priority`,
    `${ticketedCount} ticketed`
  ];

  for (const chip of chips) {
    const element = document.createElement("span");
    element.className = "queue-chip";
    element.textContent = chip;
    elements.behaviorPills.append(element);
  }

  if (dismissedCount) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `queue-chip queue-toggle${state.showDismissedBehavior ? " active" : ""}`;
    toggle.textContent = state.showDismissedBehavior ? "Hide dismissed" : `Show ${dismissedCount} dismissed`;
    toggle.addEventListener("click", toggleDismissedBehaviorVisibility);
    elements.behaviorPills.append(toggle);
  }
}

function renderBehaviorQueue(behaviorAnalysis = {}, linearConfigured) {
  const visibleSuggestions = getVisibleBehaviorSuggestions(behaviorAnalysis.suggestions ?? []);
  const suggestions = sortBehaviorSuggestions(visibleSuggestions);
  const selectedSuggestion = getSelectedBehaviorSuggestion(suggestions);
  elements.behaviorList.replaceChildren();

  if (!behaviorAnalysis.configured) {
    elements.behaviorList.innerHTML = `<div class="empty-state">Add PostHog credentials to analyze Pawprint Kitchen behavior.</div>`;
    elements.behaviorDetail.className = "detail-card empty";
    elements.behaviorDetail.innerHTML = `<div>PostHog is not connected yet.</div>`;
    return;
  }

  if (behaviorAnalysis.status === "running") {
    elements.behaviorList.innerHTML = `
      <div class="suggestion-item loading-card loading-suggestion">
        ${renderSpinner("Analyzing behavior")}
      </div>
    `;
  }

  if (behaviorAnalysis.status === "error") {
    elements.behaviorList.innerHTML = `<div class="empty-state">Behavior analysis failed: ${escapeHtml(behaviorAnalysis.error ?? behaviorAnalysis.message)}</div>`;
    elements.behaviorDetail.className = "detail-card empty";
    elements.behaviorDetail.innerHTML = `<div>Fix the PostHog configuration or try again.</div>`;
    return;
  }

  if (!suggestions.length && behaviorAnalysis.status !== "running") {
    elements.behaviorList.innerHTML = `<div class="empty-state">${
      (behaviorAnalysis.suggestions ?? []).some((entry) => isDismissedBehaviorSuggestion(entry.id))
        ? "Everything in this behavior window is dismissed for now."
        : "No behavior suggestions surfaced in this window."
    }</div>`;
    elements.behaviorDetail.className = "detail-card empty";
    elements.behaviorDetail.innerHTML = `<div>The next analysis will run when fresh PostHog events arrive.</div>`;
    return;
  }

  if (suggestions.length) {
    const productSuggestions = suggestions.filter((entry) => entry.kind !== "instrumentation");
    const instrumentationSuggestions = suggestions.filter((entry) => entry.kind === "instrumentation");
    renderBehaviorSuggestionGroup(productSuggestions, "Product issues", selectedSuggestion, linearConfigured);
    renderBehaviorSuggestionGroup(instrumentationSuggestions, "Instrumentation", selectedSuggestion, linearConfigured);
  }

  renderBehaviorDetail(selectedSuggestion, linearConfigured);
}

function renderBehaviorSuggestionGroup(suggestions, label, selectedSuggestion, linearConfigured) {
  if (!suggestions.length) {
    return;
  }

  const groupLabel = document.createElement("div");
  groupLabel.className = "behavior-group-label";
  groupLabel.textContent = label;
  elements.behaviorList.append(groupLabel);

  for (const suggestion of suggestions) {
    renderBehaviorListItem(suggestion, selectedSuggestion, linearConfigured);
  }
}

function renderBehaviorListItem(suggestion, selectedSuggestion, linearConfigured) {
  const dismissed = isDismissedBehaviorSuggestion(suggestion.id);
  const item = document.createElement("button");
  item.type = "button";
  item.className = `suggestion-item behavior-item${suggestion.kind === "instrumentation" ? " instrumentation-item" : ""}${
    suggestion.id === selectedSuggestion?.id ? " selected" : ""
  }${suggestion.ticket ? " ticketed" : ""}${dismissed ? " dismissed" : ""}`;
  item.setAttribute("aria-pressed", suggestion.id === selectedSuggestion?.id ? "true" : "false");
  item.innerHTML = `
    <div class="suggestion-topline">
      <span class="priority-pill ${suggestion.priority}">${suggestion.priority}</span>
      <span class="kind-pill">${escapeHtml(describeBehaviorKind(suggestion.kind))}</span>
      <span class="confidence-pill">${formatConfidence(suggestion.confidence)} confidence</span>
      ${dismissed ? '<span class="ticket-state dismissed-state">Dismissed</span>' : ""}
      ${suggestion.ticket ? '<span class="ticket-state">Ticketed</span>' : ""}
    </div>
    <strong class="suggestion-title">${escapeHtml(suggestion.title)}</strong>
    <p class="suggestion-summary">${escapeHtml(suggestion.summary)}</p>
    <div class="suggestion-foot">
      <span><strong>${compactNumber(suggestion.metrics?.usersAffected ?? suggestion.metrics?.missingEvents ?? 0)}</strong> signal${(suggestion.metrics?.usersAffected ?? suggestion.metrics?.missingEvents ?? 0) === 1 ? "" : "s"}</span>
      <span>${
        suggestion.ticket?.identifier
          ? suggestion.ticket.identifier
          : dismissed
            ? "Hidden from active queue"
            : linearConfigured
              ? "Ready for ticket"
              : "Needs Linear"
      }</span>
    </div>
  `;

  item.addEventListener("click", () => {
    state.selectedBehaviorSuggestionId = suggestion.id;
    renderDashboard();
  });

  elements.behaviorList.append(item);
}

function renderBehaviorDetail(suggestion, linearConfigured) {
  if (!suggestion) {
    elements.behaviorDetail.className = "detail-card empty";
    elements.behaviorDetail.innerHTML = `<div>Select a behavior suggestion to inspect it.</div>`;
    return;
  }

  const readyForTicket = linearConfigured && Boolean(state.selectedTeamId);
  const isCreating = state.creatingBehaviorSuggestionId === suggestion.id;
  const dismissed = isDismissedBehaviorSuggestion(suggestion.id);
  const actionLabel = suggestion.ticket?.identifier
    ? suggestion.ticket.identifier
    : isCreating
      ? "Creating..."
      : readyForTicket
        ? "Create Linear ticket"
        : linearConfigured
          ? "Pick a team first"
          : "Connect Linear first";

  elements.behaviorDetail.className = "detail-card";
  elements.behaviorDetail.innerHTML = `
    <div class="detail-top">
      <div class="detail-lead">
        <div class="detail-badges">
          <span class="priority-pill ${suggestion.priority}">${suggestion.priority}</span>
          <span class="kind-pill">${escapeHtml(describeBehaviorKind(suggestion.kind))}</span>
          <span class="confidence-pill">${formatConfidence(suggestion.confidence)} confidence</span>
          ${dismissed ? '<span class="ticket-state dismissed-state">Dismissed</span>' : ""}
        </div>
        <h3>${escapeHtml(suggestion.title)}</h3>
        <p>${escapeHtml(suggestion.summary)}</p>
      </div>
      <div class="detail-actions">
        <button class="secondary-button detail-dismiss-button" id="behaviorDetailDismiss" type="button">
          ${dismissed ? "Restore to queue" : "Dismiss for now"}
        </button>
        <button class="primary-button" id="behaviorDetailAction" type="button" ${suggestion.ticket?.url || !readyForTicket || isCreating ? "disabled" : ""}>
          ${actionLabel}
        </button>
      </div>
    </div>
    <dl class="detail-metrics behavior-metrics">
      <div class="detail-metric">
        <dt>Confidence</dt>
        <dd>${formatConfidence(suggestion.confidence)}</dd>
      </div>
      <div class="detail-metric">
        <dt>Users affected</dt>
        <dd>${compactNumber(suggestion.metrics?.usersAffected)}</dd>
      </div>
      <div class="detail-metric">
        <dt>Total users</dt>
        <dd>${compactNumber(suggestion.metrics?.totalUsers)}</dd>
      </div>
    </dl>
    <section class="detail-section behavior-reasoning">
      <h4>Plain-logic reasoning</h4>
      <p>${escapeHtml(suggestion.reasoning)}</p>
    </section>
    <div class="detail-columns">
      <section class="detail-section">
        <h4>Evidence</h4>
        <ul>
          ${(suggestion.evidence ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
      <section class="detail-section">
        <h4>Next steps</h4>
        <ul>
          ${(suggestion.nextSteps ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    </div>
    <div class="detail-footer">
      <span class="detail-note">${
        dismissed
          ? "Dismissed behavior suggestions stay out of the active queue until you restore them."
          : suggestion.ticket?.url
          ? "Ticket already created."
          : readyForTicket
            ? "This behavior suggestion is ready to send to Linear."
            : linearConfigured
              ? "Choose a team above to enable the ticket action."
              : "Add Linear credentials to turn this into a ticket."
      }</span>
      ${
        suggestion.ticket?.url
          ? `<a class="ticket-link" href="${suggestion.ticket.url}" target="_blank" rel="noreferrer">Open ${suggestion.ticket.identifier ?? "ticket"} in Linear</a>`
          : ""
      }
    </div>
  `;

  elements.behaviorDetail.querySelector("#behaviorDetailDismiss")?.addEventListener("click", () => {
    if (dismissed) {
      restoreBehaviorSuggestion(suggestion.id);
      return;
    }

    dismissBehaviorSuggestion(suggestion.id);
  });

  if (!suggestion.ticket?.url && readyForTicket) {
    elements.behaviorDetail.querySelector("#behaviorDetailAction")?.addEventListener("click", () => {
      void createBehaviorLinearIssue(suggestion.id);
    });
  }
}

async function createLinearIssue(suggestionId) {
  state.creatingSuggestionId = suggestionId;
  renderDashboard();

  try {
    const { payload, response } = await requestJson("/api/linear/issues", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        suggestionId,
        teamId: state.selectedTeamId
      })
    });

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to create issue.");
    }

    state.dashboard = payload.dashboard;
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.creatingSuggestionId = null;
    renderDashboard();
  }
}

async function createBehaviorLinearIssue(suggestionId) {
  state.creatingBehaviorSuggestionId = suggestionId;
  renderDashboard();

  try {
    const { payload, response } = await requestJson("/api/linear/behavior-issues", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        suggestionId,
        teamId: state.selectedTeamId
      })
    });

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to create behavior issue.");
    }

    state.dashboard = payload.dashboard;
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.creatingBehaviorSuggestionId = null;
    renderDashboard();
  }
}

function renderTable(target, rows, type) {
  target.replaceChildren();

  const visibleRows = [...rows]
    .sort((left, right) => {
      if (type === "query") {
        if (right.impressions !== left.impressions) {
          return right.impressions - left.impressions;
        }

        if (left.position !== right.position) {
          return left.position - right.position;
        }
      } else {
        if (right.clicks !== left.clicks) {
          return right.clicks - left.clicks;
        }
      }

      if (right.impressions !== left.impressions) {
        return right.impressions - left.impressions;
      }

      return left.position - right.position;
    })
    .slice(0, 8);

  if (!visibleRows.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="5">No data yet.</td>`;
    target.append(row);
    return;
  }

  visibleRows.forEach((entry, index) => {
    const delta = formatDelta(entry.clicksChange);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="table-key">
          <span class="table-rank">${index + 1}</span>
          <span class="${type === "query" ? "query-key" : "page-key"}">${type === "query" ? entry.key : truncateUrl(entry.key)}</span>
        </div>
      </td>
      <td>${compactNumber(entry.clicks)}</td>
      <td>${formatPercent(entry.ctr)}</td>
      <td>${entry.position.toFixed(1)}</td>
      <td><span class="delta-chip" data-trend="${delta.trend}">${delta.text}</span></td>
    `;
    target.append(row);
  });
}

function renderDashboard() {
  const dashboard = state.dashboard;
  if (!dashboard) {
    if (state.loadingDashboard) {
      renderLoadingDashboard();
    }
    return;
  }

  syncDismissedSuggestions(dashboard.siteUrl);
  syncDismissedBehaviorSuggestions();

  const siteLabel = humanizeSite(dashboard.siteUrl);
  const sourceLabel = dashboard.source === "live" ? "Live Search Console snapshot" : "Demo preview";
  const visibleRecommendations = getVisibleSuggestions(dashboard.recommendations);
  const dismissedCount = dashboard.recommendations.filter((entry) => isDismissedSuggestion(entry.id)).length;
  const queuedRecommendations = sortSuggestions(visibleRecommendations);
  const selectedSuggestion = getSelectedSuggestion(queuedRecommendations);
  const teamLabel = elements.teamSelect.options[elements.teamSelect.selectedIndex]?.textContent;
  const ticketReady = dashboard.connection?.linear?.configured && Boolean(state.selectedTeamId);
  const behaviorAnalysis = dashboard.behaviorAnalysis ?? {};
  const behaviorStatus = behaviorAnalysis.status ?? "idle";
  const behaviorWindow = behaviorAnalysis.window;
  const visibleBehaviorSuggestions = getVisibleBehaviorSuggestions(behaviorAnalysis.suggestions ?? []);
  const dismissedBehaviorCount = (behaviorAnalysis.suggestions ?? []).filter((entry) =>
    isDismissedBehaviorSuggestion(entry.id)
  ).length;

  elements.deskTitle.textContent = siteLabel ? `${siteLabel} SEO desk` : "SEO desk";
  elements.overviewMeta.textContent = `${sourceLabel} for ${dashboard.siteUrl} • synced ${formatDateTime(dashboard.lastSyncedAt)}`;
  elements.focusPrompt.textContent = selectedSuggestion
    ? ticketReady
      ? `Start with “${selectedSuggestion.title}” and send it to ${teamLabel} when it looks right.`
      : `Start with “${selectedSuggestion.title}”. The detail pane keeps the evidence and ticket action together.`
    : "No suggestions surfaced yet. Run a sync after your next content or ranking movement.";

  if (dashboard.dateWindow?.recent) {
    elements.trendMeta.textContent = `${dashboard.dateWindow.recent.startDate} to ${dashboard.dateWindow.recent.endDate}`;
  }

  elements.queueMeta.textContent = visibleRecommendations.length
    ? `${visibleRecommendations.length} suggestions in view, with ticketed items tucked to the end.${
        dismissedCount ? ` ${dismissedCount} dismissed item${dismissedCount === 1 ? "" : "s"} hidden for now.` : ""
      }`
    : dismissedCount
      ? "Everything in this window is dismissed for now."
      : "Nothing urgent surfaced in the latest window.";

  elements.behaviorMeta.textContent = behaviorAnalysis.configured
    ? behaviorWindow?.start && behaviorWindow?.end
      ? `Pawprint Kitchen behavior from ${formatShortDate(behaviorWindow.start)} to ${formatShortDate(behaviorWindow.end)} • analyzed ${formatDateTime(behaviorAnalysis.lastAnalyzedAt)}`
      : behaviorStatus === "running"
        ? "Analyzing Pawprint Kitchen behavior from PostHog."
        : "Ready to analyze Pawprint Kitchen behavior."
    : "Connect PostHog to analyze Pawprint Kitchen behavior.";

  elements.behaviorSyncButton.disabled = state.analyzingBehavior || behaviorStatus === "running" || !behaviorAnalysis.configured;
  elements.behaviorSyncButton.textContent =
    state.analyzingBehavior || behaviorStatus === "running" ? "Analyzing..." : "Analyze behavior";

  renderSummary(dashboard.summary);
  renderTrend(dashboard.trend);
  renderQueuePills(visibleRecommendations, dismissedCount);
  renderSuggestions(visibleRecommendations, dashboard.connection?.linear?.configured, dismissedCount);
  renderBehaviorSummary(behaviorAnalysis);
  renderBehaviorPills(visibleBehaviorSuggestions, dismissedBehaviorCount);
  renderBehaviorQueue(behaviorAnalysis, dashboard.connection?.linear?.configured);
  renderTable(elements.queriesTable, dashboard.topQueries, "query");
  renderTable(elements.pagesTable, dashboard.topPages, "page");
  setWidgetLoading(state.syncing);
}

function renderTeamOptions(teamsResponse) {
  const { teams = [], defaultTeamId = "", configured } = teamsResponse;
  state.teams = teams;

  const desiredTeam = state.selectedTeamId || defaultTeamId;

  elements.teamSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = configured ? "Select a team" : "Linear not connected";
  elements.teamSelect.append(placeholder);

  for (const team of teams) {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = `${team.name} (${team.key})`;
    elements.teamSelect.append(option);
  }

  state.selectedTeamId = teams.some((team) => team.id === desiredTeam) ? desiredTeam : "";
  elements.teamSelect.value = state.selectedTeamId;
  elements.teamSelect.disabled = !configured || teams.length === 0;
}

async function fetchDashboard() {
  const { payload } = await requestJson("/api/dashboard");
  state.dashboard = payload;
  state.loadingDashboard = false;
  renderDashboard();
  scheduleBehaviorPoll();
}

async function fetchTeams() {
  const { payload } = await requestJson("/api/linear/teams");
  renderTeamOptions(payload);
  renderDashboard();
}

async function fetchSession() {
  const { payload } = await requestJson("/api/auth/session");
  state.session = payload.session;
  renderSession();
}

async function syncDashboard() {
  state.syncing = true;
  elements.syncButton.disabled = true;
  elements.syncButton.textContent = "Syncing...";
  renderDashboard();

  try {
    const { payload, response } = await requestJson("/api/sync", {
      method: "POST"
    });

    if (!response.ok) {
      state.dashboard = payload.dashboard;
      renderDashboard();
      throw new Error(payload.error ?? "Sync failed.");
    }

    state.dashboard = payload;
    renderDashboard();
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.syncing = false;
    elements.syncButton.disabled = false;
    elements.syncButton.textContent = "Sync Search Console";
  }
}

function scheduleBehaviorPoll() {
  window.clearTimeout(behaviorPollTimer);

  const behaviorAnalysis = state.dashboard?.behaviorAnalysis;
  if (!behaviorAnalysis?.configured) {
    return;
  }

  const shouldPoll =
    behaviorAnalysis.status === "running" ||
    behaviorAnalysis.status === "idle" ||
    !behaviorAnalysis.lastAnalyzedAt ||
    state.behaviorPollCount < 1;

  if (!shouldPoll) {
    return;
  }

  behaviorPollTimer = window.setTimeout(async () => {
    try {
      const { payload } = await requestJson("/api/dashboard");
      state.behaviorPollCount += 1;
      state.dashboard = payload;
      renderDashboard();
      scheduleBehaviorPoll();
    } catch {
      window.clearTimeout(behaviorPollTimer);
    }
  }, behaviorAnalysis.status === "running" ? 2200 : 1600);
}

async function syncBehaviorAnalysis() {
  state.analyzingBehavior = true;
  elements.behaviorSyncButton.disabled = true;
  elements.behaviorSyncButton.textContent = "Analyzing...";
  renderDashboard();

  try {
    const { payload, response } = await requestJson("/api/behavior-analysis/sync", {
      method: "POST"
    });

    state.dashboard = payload.dashboard ?? {
      ...state.dashboard,
      behaviorAnalysis: payload.behaviorAnalysis
    };
    renderDashboard();

    if (!response.ok) {
      throw new Error(payload.error ?? "Behavior analysis failed.");
    }
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.analyzingBehavior = false;
    renderDashboard();
  }
}

elements.syncButton.addEventListener("click", () => {
  void syncDashboard();
});

elements.behaviorSyncButton.addEventListener("click", () => {
  void syncBehaviorAnalysis();
});

elements.teamSelect.addEventListener("change", (event) => {
  state.selectedTeamId = event.target.value;
  localStorage.setItem("crawlipop:selected-team", state.selectedTeamId);
  renderDashboard();
});

renderLoadingDashboard();
await Promise.all([fetchSession(), fetchDashboard(), fetchTeams()]);
