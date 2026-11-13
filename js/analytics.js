"use strict";

(function (global) {
  const Planner = global.Planner || (global.Planner = {});
  const Store = Planner.Store;
  const UI = Planner.UI;
  const { el, progressBar, percent } = UI;

  let rangeDays = 7;

  function rangeDates(days) {
    const today = Store.toDateKey(new Date());
    return Store.dateRangeKeys(Store.addDays(today, -(days - 1)), today);
  }

  function eventStatus(event, sessions) {
    return Store.effectiveStatus(event, sessions);
  }

  function countPlanned(state, date, sessions) {
    return state.events
      .filter((event) => event.date === date && !["cancelled", "rescheduled"].includes(event.status))
      .reduce((sum, event) => sum + event.plannedMin, 0);
  }

  function dueStats(state, dates, sessions, now = Date.now()) {
    let due = 0;
    let completed = 0;
    dates.forEach((date) => {
      state.events.forEach((event) => {
        if (event.date !== date) return;
        if (["cancelled", "rescheduled"].includes(event.status)) return;
        const status = eventStatus(event, sessions);
        if (status === "scheduled") return;
        if (Store.eventEndMs(event) >= now && event.date === Store.toDateKey(new Date())) return;
        due += 1;
        if (status === "completed") completed += 1;
      });
    });
    return { due, completed, rate: due > 0 ? (completed / due) * 100 : 0 };
  }

  function summaryCard(label, value, hint, color) {
    const card = el("div", "analytics-stat-card");
    if (color) card.style.setProperty("--stat-color", color);
    card.append(el("span", "detail-label", label), el("span", "analytics-stat-value", value));
    if (hint) card.appendChild(el("span", "analytics-stat-hint", hint));
    return card;
  }

  function renderSummary(state, sessions, dates) {
    const planned = dates.reduce((sum, date) => sum + countPlanned(state, date, sessions), 0);
    const actual = dates.reduce((sum, date) => sum + Store.actualMinutesForDate(sessions, date), 0);
    const due = dueStats(state, dates, sessions);
    const avg = dates.length ? actual / dates.length : 0;
    const grid = el("div", "analytics-stats");
    grid.append(
      summaryCard("Planned", Store.fmtDuration(planned), `across ${dates.length} days`, "var(--long)"),
      summaryCard("Actual focus", Store.fmtDuration(actual), planned > 0 ? `${Math.round((actual / planned) * 100)}% of plan` : "No planned time", "var(--accent)"),
      summaryCard("Completion rate", `${Math.round(due.rate)}%`, `${due.completed} of ${due.due} due sessions completed`, "var(--break)"),
      summaryCard("Daily average", Store.fmtDuration(avg), "actual focus per day", "#d29922")
    );
    return { grid, planned, actual, due };
  }

  function renderChart(state, sessions, dates) {
    const section = el("section", "analytics-card");
    const head = el("div", "dash-card-head");
    head.append(el("h3", "", "Planned vs actual"));
    section.appendChild(head);
    const values = dates.map((date) => ({
      date,
      planned: countPlanned(state, date, sessions),
      actual: Store.actualMinutesForDate(sessions, date),
    }));
    const max = Math.max(...values.map((value) => Math.max(value.planned, value.actual)), 1);
    const chart = el("div", `analytics-chart${dates.length > 7 ? " dense" : ""}`);
    values.forEach((value, index) => {
      const col = el("div", "analytics-bar-col");
      const bars = el("div", "analytics-bars");
      const planned = el("span", "analytics-bar planned");
      planned.style.height = `${Math.max(2, (value.planned / max) * 100)}%`;
      const actual = el("span", "analytics-bar actual");
      actual.style.height = `${Math.max(2, (value.actual / max) * 100)}%`;
      bars.append(planned, actual);
      const showLabel = dates.length <= 7 || index % 5 === 0 || index === values.length - 1;
      const label = el("span", "analytics-bar-label", showLabel ? String(Store.dateKeyToDate(value.date).getDate()) : "");
      col.append(bars, label);
      col.title = `${Store.fmtDateShort(value.date)} · ${Store.fmtDuration(value.planned)} planned · ${Store.fmtDuration(value.actual)} actual`;
      chart.appendChild(col);
    });
    section.appendChild(chart);
    const legend = el("div", "dash-legend");
    legend.append(el("span", "legend-item planned", "Planned"), el("span", "legend-item actual", "Actual"));
    section.appendChild(legend);
    return section;
  }

  function renderWeeklyBreakdown(state, sessions) {
    const section = el("section", "analytics-card");
    const head = el("div", "dash-card-head");
    head.append(el("h3", "", "Weekly progress"));
    section.appendChild(head);
    const thisWeekStart = Store.startOfWeekKey(Store.toDateKey(new Date()));
    const rows = [];
    for (let i = 3; i >= 0; i -= 1) {
      const start = Store.addDays(thisWeekStart, -7 * i);
      const dates = Store.weekKeys(start);
      const planned = dates.reduce((sum, date) => sum + countPlanned(state, date, sessions), 0);
      const actual = dates.reduce((sum, date) => sum + Store.actualMinutesForDate(sessions, date), 0);
      const due = dueStats(state, dates, sessions);
      rows.push({ start, end: dates[6], planned, actual, rate: due.rate, due: due.due });
    }
    const table = el("div", "weekly-table");
    const header = el("div", "weekly-row weekly-head");
    ["Week", "Planned", "Actual", "Completion"].forEach((label) => header.appendChild(el("span", "", label)));
    table.appendChild(header);
    rows.forEach((row) => {
      const line = el("div", "weekly-row");
      line.append(
        el("span", "weekly-week", `${Store.fmtDateShort(row.start)} – ${Store.fmtDateShort(row.end)}`),
        el("span", "", Store.fmtDuration(row.planned)),
        el("span", "", Store.fmtDuration(row.actual)),
        el("span", "", row.due ? `${Math.round(row.rate)}%` : "—")
      );
      table.appendChild(line);
    });
    section.appendChild(table);
    return section;
  }

  function renderLearningProgress(state, sessions) {
    const section = el("section", "analytics-card");
    const head = el("div", "dash-card-head");
    head.append(el("h3", "", "Learning progress"));
    section.appendChild(head);
    const entries = Store.listItems(state)
      .map(({ type, item }) => ({ type, item, progress: Store.computeProgress(state, type, item, sessions) }))
      .sort((a, b) => b.progress.percent - a.progress.percent);
    if (!entries.length) {
      section.appendChild(el("div", "dash-empty", "No learning items yet. Add courses, books, or tasks in the library."));
      return section;
    }
    const list = el("div", "analytics-progress-list");
    entries.forEach(({ type, item, progress }) => {
      const row = el("div", "analytics-progress-row");
      row.style.setProperty("--item-color", item.color);
      const top = el("div", "analytics-progress-top");
      top.append(
        el("span", "analytics-progress-title", item.title),
        el("span", "analytics-progress-value", `${percent(progress.percent)} · ${Store.fmtDuration(progress.remainingMin)} left`)
      );
      row.append(top, progressBar(progress.percent, item.color));
      row.appendChild(el("span", "analytics-progress-type", UI.typeLabel(type)));
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  function render() {
    const root = UI.$("analyticsContent");
    if (!root) return;
    const state = Store.loadState();
    const sessions = Store.loadSessions();
    const dates = rangeDates(rangeDays);
    root.innerHTML = "";
    const subtitle = UI.$("analyticsSubtitle");
    if (subtitle) {
      subtitle.textContent = `Last ${rangeDays} days · ${Store.fmtDateShort(dates[0])} to ${Store.fmtDateShort(dates[dates.length - 1])}`;
    }
    const summary = renderSummary(state, sessions, dates);
    root.appendChild(summary.grid);
    root.appendChild(renderChart(state, sessions, dates));
    const columns = el("div", "analytics-columns");
    columns.append(renderWeeklyBreakdown(state, sessions), renderLearningProgress(state, sessions));
    root.appendChild(columns);
  }

  function init() {
    const range = UI.$("analyticsRange");
    if (range) {
      range.addEventListener("click", (event) => {
        const button = event.target.closest("[data-range]");
        if (!button) return;
        rangeDays = Number(button.dataset.range) || 7;
        [...range.querySelectorAll("[data-range]")].forEach((node) => node.classList.toggle("active", node === button));
        render();
      });
    }
    document.addEventListener("planner:data-changed", () => {
      const view = UI.$("analyticsView");
      if (view && !view.classList.contains("hidden")) render();
    });
  }

  Planner.Analytics = { render, init };
  init();
})(typeof globalThis !== "undefined" ? globalThis : this);
