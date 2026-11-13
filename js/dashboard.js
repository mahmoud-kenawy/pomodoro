"use strict";

(function (global) {
  const Planner = global.Planner || (global.Planner = {});
  const Store = Planner.Store;
  const UI = Planner.UI;
  const { el, makeButton, progressBar, percent } = UI;

  function statCard(label, value, hint, color) {
    const card = el("div", "dash-stat-card");
    if (color) card.style.setProperty("--stat-color", color);
    card.append(el("span", "detail-label", label), el("span", "dash-stat-value", value));
    if (hint) card.appendChild(el("span", "dash-stat-hint", hint));
    return card;
  }

  function renderGoal(state, sessions, today) {
    const settings = state.settings;
    const planned = Store.plannedMinutesForDate(state, today);
    const actual = Store.actualMinutesForDate(sessions, today);
    const goal = settings.dailyGoalMin;
    const goalPercent = goal > 0 ? (actual / goal) * 100 : 0;
    const plannedPercent = goal > 0 ? (planned / goal) * 100 : 0;
    const grid = el("div", "dashboard-stats");
    grid.append(
      statCard("Today's target", Store.fmtDuration(goal), `${Store.fmtDuration(planned)} planned`, "var(--long)"),
      statCard("Actual focus", Store.fmtDuration(actual), `${percent(goalPercent)} of daily target`, "var(--accent)"),
      statCard("Remaining target", Store.fmtDuration(Math.max(0, goal - actual)), actual >= goal ? "Daily target reached" : "Keep focusing", "var(--break)"),
      statCard("Planned sessions", String(state.events.filter((event) => event.date === today && !["cancelled", "rescheduled"].includes(event.status)).length), `${Store.fmtDuration(planned)} on the calendar`, "#d29922")
    );
    const goalCard = el("section", "dash-card goal-card");
    const head = el("div", "dash-card-head");
    head.append(el("h3", "", "Today's goal"), el("span", "dash-card-meta", Store.fmtDateLong(today)));
    goalCard.appendChild(head);
    const rows = el("div", "goal-rows");
    const actualRow = el("div", "goal-row");
    actualRow.append(
      el("span", "goal-row-label", "Actual focus"),
      progressBar(goalPercent, "var(--accent)"),
      el("span", "goal-row-value", `${Store.fmtDuration(actual)} / ${Store.fmtDuration(goal)}`)
    );
    const plannedRow = el("div", "goal-row");
    plannedRow.append(
      el("span", "goal-row-label", "Planned"),
      progressBar(Math.min(100, plannedPercent), "var(--long)"),
      el("span", "goal-row-value", Store.fmtDuration(planned))
    );
    rows.append(actualRow, plannedRow);
    goalCard.appendChild(rows);
    if (planned > goal) {
      goalCard.appendChild(el("p", "dash-note", "Today's plan is above your daily target. Adjust the calendar if this feels heavy."));
    } else if (planned < goal) {
      goalCard.appendChild(el("p", "dash-note", `${Store.fmtDuration(goal - planned)} of study time is still unscheduled today.`));
    }
    return { grid, goalCard, planned, actual };
  }

  function renderUpcoming(state, sessions) {
    const section = el("section", "dash-card");
    const head = el("div", "dash-card-head");
    head.append(el("h3", "", "Upcoming sessions"));
    head.appendChild(
      makeButton("Open calendar", "btn btn-ghost btn-sm", () => {
        const nav = document.querySelector('[data-view="calendar"]');
        if (nav) nav.click();
      })
    );
    section.appendChild(head);
    const events = Store.upcomingEvents(state, Date.now(), 5);
    if (!events.length) {
      section.appendChild(el("div", "dash-empty", "No upcoming scheduled sessions. Plan one from the calendar or library."));
      return section;
    }
    const list = el("div", "upcoming-list");
    events.forEach((event) => {
      const row = el("button", "upcoming-row");
      row.type = "button";
      const color = event.type === "general" || !event.refId
        ? Store.COLORS.general
        : Store.itemColor(state, event.type, event.refId);
      row.style.setProperty("--item-color", color);
      const when = `${Store.fmtDateShort(event.date)} · ${Store.fmtDuration(event.plannedMin)}`;
      const info = el("div", "upcoming-info");
      info.append(el("span", "upcoming-title", event.title), el("span", "upcoming-meta", when));
      row.append(info, el("span", "upcoming-time", event.flexible ? "Flexible" : Store.fmtTime(event.startMin)));
      row.addEventListener("click", () => {
        if (Planner.Calendar && Planner.Calendar.openEventDetail) Planner.Calendar.openEventDetail(event.id);
      });
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  function renderActive(state, sessions) {
    const section = el("section", "dash-card");
    const head = el("div", "dash-card-head");
    head.append(el("h3", "", "Active learning"));
    head.appendChild(
      makeButton("Library", "btn btn-ghost btn-sm", () => {
        const nav = document.querySelector('[data-view="library"]');
        if (nav) nav.click();
      })
    );
    section.appendChild(head);
    const active = Store.listItems(state)
      .map(({ type, item }) => ({ type, item, progress: Store.computeProgress(state, type, item, sessions) }))
      .filter((entry) => entry.progress.percent < 100)
      .sort((a, b) => b.progress.percent - a.progress.percent)
      .slice(0, 6);
    if (!active.length) {
      section.appendChild(el("div", "dash-empty", "No active courses or books. Add learning material in the library."));
      return section;
    }
    const list = el("div", "active-learning-list");
    active.forEach(({ type, item, progress }) => {
      const row = el("div", "active-learning-row");
      row.style.setProperty("--item-color", item.color);
      const top = el("div", "active-learning-top");
      top.append(
        el("span", "active-learning-title", item.title),
        el("span", "active-learning-value", `${percent(progress.percent)}`)
      );
      row.append(top, progressBar(progress.percent, item.color));
      row.appendChild(el("span", "active-learning-meta", `${UI.typeLabel(type)} · ${Store.fmtDuration(progress.remainingMin)} left`));
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  function renderWeek(state, sessions, today) {
    const section = el("section", "dash-card");
    const head = el("div", "dash-card-head");
    head.append(el("h3", "", "This week"));
    section.appendChild(head);
    const dates = [];
    for (let i = 6; i >= 0; i -= 1) dates.push(Store.addDays(today, -i));
    const values = dates.map((date) => ({
      date,
      planned: Store.plannedMinutesForDate(state, date),
      actual: Store.actualMinutesForDate(sessions, date),
    }));
    const max = Math.max(...values.map((value) => Math.max(value.planned, value.actual)), 1);
    const chart = el("div", "dash-chart");
    values.forEach((value) => {
      const col = el("div", "dash-bar-col");
      const bars = el("div", "dash-bars");
      const planned = el("span", "dash-bar planned");
      planned.style.height = `${Math.max(2, (value.planned / max) * 100)}%`;
      const actual = el("span", "dash-bar actual");
      actual.style.height = `${Math.max(2, (value.actual / max) * 100)}%`;
      bars.append(planned, actual);
      col.append(bars, el("span", "dash-bar-label", Store.dateKeyToDate(value.date).toLocaleDateString([], { weekday: "narrow" })));
      col.title = `${Store.fmtDateShort(value.date)} · ${Store.fmtDuration(value.planned)} planned · ${Store.fmtDuration(value.actual)} actual`;
      chart.appendChild(col);
    });
    section.appendChild(chart);
    const legend = el("div", "dash-legend");
    legend.append(el("span", "legend-item planned", "Planned"), el("span", "legend-item actual", "Actual"));
    section.appendChild(legend);
    const plannedTotal = values.reduce((sum, value) => sum + value.planned, 0);
    const actualTotal = values.reduce((sum, value) => sum + value.actual, 0);
    section.appendChild(el("p", "dash-note", `${Store.fmtDuration(actualTotal)} focused of ${Store.fmtDuration(plannedTotal)} planned this week.`));
    return section;
  }

  function render() {
    const root = UI.$("dashboardContent");
    if (!root) return;
    const state = Store.loadState();
    const sessions = Store.loadSessions();
    const today = Store.toDateKey(new Date());
    root.innerHTML = "";
    const dateEl = UI.$("dashboardDate");
    if (dateEl) dateEl.textContent = Store.fmtDateLong(today);
    const { grid, goalCard } = renderGoal(state, sessions, today);
    root.appendChild(grid);
    root.appendChild(goalCard);
    const columns = el("div", "dashboard-columns");
    columns.append(renderUpcoming(state, sessions), renderActive(state, sessions));
    root.appendChild(columns);
    root.appendChild(renderWeek(state, sessions, today));
  }

  function init() {
    document.addEventListener("planner:data-changed", () => {
      const view = UI.$("dashboardView");
      if (view && !view.classList.contains("hidden")) render();
    });
    const calendarBtn = UI.$("dashboardCalendarBtn");
    if (calendarBtn) {
      calendarBtn.addEventListener("click", () => {
        const nav = document.querySelector('[data-view="calendar"]');
        if (nav) nav.click();
      });
    }
  }

  Planner.Dashboard = { render, init };
  init();
})(typeof globalThis !== "undefined" ? globalThis : this);
