"use strict";

(function (global) {
  const Planner = global.Planner || (global.Planner = {});
  const Store = Planner.Store;
  const UI = Planner.UI;
  const { el, makeInput, makeSelect, makeButton, field, progressBar } = UI;
  const HOUR_HEIGHT = 48;

  let calendarView = "week";
  let anchorKey = Store.toDateKey(new Date());
  let savedScroll = null;
  let filters = { course: true, book: true, task: true, general: true, status: "all" };
  let currentEventId = null;

  function sessions() {
    return Store.loadSessions();
  }

  function stateNow() {
    return Store.loadState();
  }

  function filteredEvent(event, state, sessionList) {
    if (!filters[event.type]) return false;
    const status = Store.effectiveStatus(event, sessionList);
    if (filters.status !== "all" && status !== filters.status) return false;
    return true;
  }

  function eventsForDate(state, date, sessionList) {
    return state.events
      .filter((event) => event.date === date && filteredEvent(event, state, sessionList))
      .sort((a, b) => {
        if (a.flexible !== b.flexible) return a.flexible ? -1 : 1;
        if (a.flexible) return a.title.localeCompare(b.title);
        return a.startMin - b.startMin;
      });
  }

  function itemTitle(state, type, refId) {
    const item = Store.getItem(state, type, refId);
    return item ? item.title : "Study session";
  }

  function eventColor(state, event) {
    if (event.type === "general" || !event.refId) return Store.COLORS.general;
    return Store.itemColor(state, event.type, event.refId);
  }

  function applyEventStyle(node, state, event, sessionList) {
    const color = eventColor(state, event);
    const status = Store.effectiveStatus(event, sessionList);
    node.style.setProperty("--event-color", color);
    node.style.setProperty("--event-bg", UI.hexToRgba(color, status === "completed" ? 0.14 : 0.2));
    node.classList.add(`status-${status}`);
    node.title = `${event.title} · ${Store.statusLabel ? Store.statusLabel(status) : UI.statusLabel(status)}`;
  }

  function makeEventChip(event, state, sessionList, options = {}) {
    const chip = el("button", "cal-event");
    chip.type = "button";
    chip.dataset.eventId = event.id;
    applyEventStyle(chip, state, event, sessionList);
    const time =
      event.flexible
        ? "Flexible"
        : `${Store.fmtTime(event.startMin)}–${Store.fmtTime(event.endMin)}`;
    if (options.month) {
      const dot = el("span", "cal-event-dot");
      chip.append(dot, el("span", "cal-event-title", event.title));
    } else {
      chip.append(el("span", "cal-event-time", time), el("span", "cal-event-title", event.title));
    }
    if (options.month && event.flexible) chip.classList.add("event-flexible");
    const status = Store.effectiveStatus(event, sessionList);
    if (status === "scheduled" || status === "missed") {
      chip.draggable = true;
      chip.addEventListener("dragstart", (dragEvent) => {
        dragEvent.dataTransfer.setData("text/plain", event.id);
        dragEvent.dataTransfer.effectAllowed = "move";
        chip.classList.add("dragging");
      });
      chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    }
    chip.addEventListener("click", (clickEvent) => {
      clickEvent.stopPropagation();
      openEventDetail(event.id);
    });
    return chip;
  }

  function headerCells(dates, state, sessionList) {
    const head = el("div", "cal-week-head");
    head.style.setProperty("--cols", dates.length);
    head.appendChild(el("div", "cal-head-gutter", ""));
    dates.forEach((date) => {
      const today = date === Store.toDateKey(new Date());
      const cell = el("button", `cal-day-head${today ? " is-today" : ""}`);
      cell.type = "button";
      const weekday = Store.dateKeyToDate(date).toLocaleDateString([], { weekday: "short" });
      cell.append(el("span", "cal-day-name", weekday), el("span", "cal-day-number", Store.dateKeyToDate(date).getDate()));
      cell.addEventListener("click", () => {
        anchorKey = date;
        setView("day");
      });
      head.appendChild(cell);
    });
    return head;
  }

  function flexibleLane(dates, state, sessionList) {
    const row = el("div", "cal-flex-row");
    row.style.setProperty("--cols", dates.length);
    row.appendChild(el("div", "cal-flex-gutter", "Flexible"));
    dates.forEach((date) => {
      const cell = el("div", "cal-flex-cell");
      cell.dataset.date = date;
      cell.addEventListener("dragover", (event) => {
        event.preventDefault();
        cell.classList.add("drop-target");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drop-target"));
      cell.addEventListener("drop", (event) => {
        event.preventDefault();
        cell.classList.remove("drop-target");
        const id = event.dataTransfer.getData("text/plain");
        if (id) moveEventToDate(id, date);
      });
      eventsForDate(state, date, sessionList)
        .filter((event) => event.flexible)
        .forEach((event) => cell.appendChild(makeEventChip(event, state, sessionList, { month: true })));
      row.appendChild(cell);
    });
    return row;
  }

  function timeGrid(dates, state, sessionList) {
    const scroll = el("div", "cal-time-scroll");
    scroll.id = "calTimeScroll";
    const grid = el("div", "cal-time-grid");
    grid.style.setProperty("--cols", dates.length);
    const labels = el("div", "cal-hour-labels");
    for (let hour = 0; hour < 24; hour += 1) {
      const label = el("div", "cal-hour-label", `${String(hour).padStart(2, "0")}:00`);
      label.style.height = `${HOUR_HEIGHT}px`;
      labels.appendChild(label);
    }
    const columns = el("div", "cal-cols");
    const todayKey = Store.toDateKey(new Date());
    dates.forEach((date) => {
      const column = el("div", "cal-day-col");
      column.dataset.date = date;
      column.style.height = `${24 * HOUR_HEIGHT}px`;
      if (date === todayKey) column.classList.add("is-today");
      const nowLine = el("div", "cal-now-line");
      if (date === todayKey) {
        nowLine.style.top = `${(Store.nowMinutes() / 60) * HOUR_HEIGHT}px`;
        column.appendChild(nowLine);
      }
      eventsForDate(state, date, sessionList)
        .filter((event) => !event.flexible)
        .forEach((event) => {
          const chip = makeEventChip(event, state, sessionList);
          chip.classList.add("cal-event-block");
          chip.style.top = `${(event.startMin / 60) * HOUR_HEIGHT}px`;
          chip.style.height = `${Math.max(22, ((event.endMin - event.startMin) / 60) * HOUR_HEIGHT)}px`;
          column.appendChild(chip);
        });
      column.addEventListener("dragover", (event) => {
        event.preventDefault();
        column.classList.add("drop-target");
      });
      column.addEventListener("dragleave", () => column.classList.remove("drop-target"));
      column.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        column.classList.remove("drop-target");
        const id = event.dataTransfer.getData("text/plain");
        if (!id) return;
        const rect = column.getBoundingClientRect();
        const y = event.clientY - rect.top;
        const minutes = Math.round(((y / HOUR_HEIGHT) * 60) / 15) * 15;
        moveEventToTime(id, date, Store.clamp(minutes, 0, 23 * 60 + 45));
      });
      column.addEventListener("click", (event) => {
        if (event.target.closest(".cal-event")) return;
        const rect = column.getBoundingClientRect();
        const y = event.clientY - rect.top;
        const minutes = Math.round(((y / HOUR_HEIGHT) * 60) / 15) * 15;
        const start = Store.clamp(minutes, 0, 23 * 60 + 30);
        const length = Math.min(Store.defaultSettings().defaultSessionMin, 1440 - start);
        openEventModal({ date, startMin: start, endMin: start + length });
      });
      columns.appendChild(column);
    });
    grid.append(labels, columns);
    scroll.appendChild(grid);
    return scroll;
  }

  function renderDayWeek(root, state, sessionList) {
    const dates = calendarView === "day" ? [anchorKey] : Store.weekKeys(anchorKey);
    root.appendChild(headerCells(dates, state, sessionList));
    root.appendChild(flexibleLane(dates, state, sessionList));
    root.appendChild(timeGrid(dates, state, sessionList));
  }

  function renderMonth(root, state, sessionList) {
    const todayKey = Store.toDateKey(new Date());
    const anchorDate = Store.dateKeyToDate(anchorKey);
    const month = anchorDate.getMonth();
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const wrap = el("div", "cal-month");
    const head = el("div", "cal-month-head");
    weekdays.forEach((day) => head.appendChild(el("div", "cal-month-head-cell", day)));
    const grid = el("div", "cal-month-grid");
    const keys = Store.monthGridKeys(anchorKey);
    keys.forEach((date) => {
      const dateObj = Store.dateKeyToDate(date);
      const cell = el("div", "cal-month-cell");
      if (dateObj.getMonth() !== month) cell.classList.add("other-month");
      if (date === todayKey) cell.classList.add("is-today");
      cell.dataset.date = date;
      const top = el("div", "cal-month-cell-head");
      const dayButton = makeButton(String(dateObj.getDate()), "cal-month-date", () => {
        anchorKey = date;
        setView("day");
      });
      top.appendChild(dayButton);
      const events = eventsForDate(state, date, sessionList);
      if (events.length) top.appendChild(el("span", "cal-month-count", events.length));
      cell.appendChild(top);
      const list = el("div", "cal-month-events");
      events.slice(0, 3).forEach((event) => list.appendChild(makeEventChip(event, state, sessionList, { month: true })));
      if (events.length > 3) {
        const more = makeButton(`+${events.length - 3} more`, "cal-month-more", () => {
          anchorKey = date;
          setView("day");
        });
        list.appendChild(more);
      }
      cell.appendChild(list);
      cell.addEventListener("click", (event) => {
        if (event.target.closest(".cal-event, .cal-month-date, .cal-month-more")) return;
        openEventModal({ date });
      });
      cell.addEventListener("dragover", (event) => {
        event.preventDefault();
        cell.classList.add("drop-target");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drop-target"));
      cell.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cell.classList.remove("drop-target");
        const id = event.dataTransfer.getData("text/plain");
        if (id) moveEventToDate(id, date);
      });
      grid.appendChild(cell);
    });
    wrap.append(head, grid);
    root.appendChild(wrap);
  }

  function updateSubtitle(state, sessionList) {
    const subtitle = UI.$("calendarSubtitle");
    if (!subtitle) return;
    const today = Store.toDateKey(new Date());
    const todayEvents = state.events.filter((event) => event.date === today && event.status !== "cancelled");
    const todayPlanned = todayEvents.reduce((sum, event) => sum + event.plannedMin, 0);
    const todayActual = Store.actualMinutesForDate(sessionList, today);
    subtitle.textContent = `Today: ${Store.fmtDuration(todayPlanned)} planned · ${Store.fmtDuration(todayActual)} focused`;
  }

  function renderToolbar() {
    const toolbar = UI.$("calendarToolbar");
    if (!toolbar) return;
    toolbar.innerHTML = "";
    const tabs = el("div", "cal-tabs");
    [
      ["day", "Day"],
      ["week", "Week"],
      ["month", "Month"],
    ].forEach(([value, label]) => {
      const button = makeButton(label, `cal-tab${calendarView === value ? " active" : ""}`, () => setView(value));
      tabs.appendChild(button);
    });
    const nav = el("div", "cal-nav");
    nav.append(
      makeButton("‹", "cal-nav-btn", () => shift(-1), "button"),
      makeButton("Today", "cal-nav-btn cal-today-btn", () => {
        anchorKey = Store.toDateKey(new Date());
        render();
      }),
      makeButton("›", "cal-nav-btn", () => shift(1), "button")
    );
    const label = el("div", "cal-date-label", dateLabel());
    toolbar.append(tabs, label, nav);
  }

  function renderFilters() {
    const root = UI.$("calendarFilters");
    if (!root) return;
    root.innerHTML = "";
    [
      ["course", "Courses"],
      ["book", "Books"],
      ["task", "Tasks"],
      ["general", "General"],
    ].forEach(([type, label]) => {
      const chip = el("label", `filter-chip${filters[type] ? " active" : ""}`);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = filters[type];
      checkbox.addEventListener("change", () => {
        filters[type] = checkbox.checked;
        render();
      });
      const dot = el("span", `filter-dot type-${type}`);
      chip.append(checkbox, dot, el("span", "", label));
      root.appendChild(chip);
    });
    const select = makeSelect(
      [
        { value: "all", label: "All statuses" },
        { value: "scheduled", label: "Scheduled" },
        { value: "completed", label: "Completed" },
        { value: "partial", label: "Partial" },
        { value: "missed", label: "Missed" },
        { value: "rescheduled", label: "Rescheduled" },
      ],
      filters.status,
      "text-input status-filter"
    );
    select.addEventListener("change", () => {
      filters.status = select.value;
      render();
    });
    root.appendChild(select);
  }

  function renderUnscheduled(state, sessionList) {
    const root = UI.$("unscheduledList");
    if (!root) return;
    root.innerHTML = "";
    const entries = Store.listItems(state)
      .map(({ type, item }) => {
        const progress = Store.computeProgress(state, type, item, sessionList);
        return { type, item, remaining: progress.remainingMin, progress };
      })
      .filter((entry) => entry.remaining > 0)
      .sort((a, b) => a.remaining - b.remaining);
    if (!entries.length) {
      root.appendChild(el("div", "empty-state", "Everything is scheduled. Add a course, book, or task in the Library."));
      return;
    }
    entries.forEach(({ type, item, remaining }) => {
      const row = el("div", "unscheduled-row");
      row.style.setProperty("--item-color", item.color);
      const dot = el("span", "item-dot");
      dot.style.background = item.color;
      const info = el("div", "unscheduled-info");
      const titleRow = el("div", "unscheduled-title-row");
      titleRow.append(dot, el("span", "unscheduled-title", item.title));
      info.append(titleRow, el("span", "unscheduled-meta", `${UI.typeLabel(type)} · ${Store.fmtDuration(remaining)} remaining`));
      const plan = makeButton("Plan", "btn btn-ghost btn-sm", () => {
        openEventModal({
          type,
          refId: item.id,
          date: anchorKey,
          plannedMin: Math.min(remaining, state.settings.defaultSessionMin),
        });
      });
      row.append(info, plan);
      root.appendChild(row);
    });
  }

  function dateLabel() {
    if (calendarView === "day") return Store.fmtDateLong(anchorKey);
    if (calendarView === "month") return Store.fmtMonth(anchorKey);
    const dates = Store.weekKeys(anchorKey);
    return `${Store.fmtDateShort(dates[0])} – ${Store.fmtDateShort(dates[6])}`;
  }

  function shift(direction) {
    if (calendarView === "day") {
      anchorKey = Store.addDays(anchorKey, direction);
    } else if (calendarView === "week") {
      anchorKey = Store.addDays(anchorKey, direction * 7);
    } else {
      const date = Store.dateKeyToDate(anchorKey);
      date.setDate(1);
      date.setMonth(date.getMonth() + direction);
      anchorKey = Store.toDateKey(date);
    }
    savedScroll = null;
    render();
  }

  function setView(view) {
    calendarView = view;
    savedScroll = null;
    Store.updateState((state) => {
      state.settings.calendarView = view;
    }, { silent: true });
    render();
  }

  function render() {
    const state = stateNow();
    const sessionList = sessions();
    const body = UI.$("calendarBody");
    if (!body) return;
    const oldScroll = document.querySelector(".cal-time-scroll");
    if (oldScroll) savedScroll = oldScroll.scrollTop;
    body.innerHTML = "";
    renderToolbar();
    renderFilters();
    if (calendarView === "month") renderMonth(body, state, sessionList);
    else renderDayWeek(body, state, sessionList);
    updateSubtitle(state, sessionList);
    renderUnscheduled(state, sessionList);
    if (calendarView !== "month") {
      setTimeout(() => {
        const scroller = document.getElementById("calTimeScroll");
        if (scroller) scroller.scrollTop = savedScroll === null ? 7 * HOUR_HEIGHT : savedScroll;
        savedScroll = null;
      }, 0);
    }
  }

  function itemOptionsFor(state, type) {
    const items = type === "course" ? state.courses : type === "book" ? state.books : type === "task" ? state.tasks : [];
    return items.map((item) => ({ value: item.id, label: item.title }));
  }

  function chapterOptions(course) {
    const options = [{ value: "", label: "Whole course" }];
    if (course) course.chapters.forEach((chapter) => options.push({ value: chapter.id, label: chapter.title }));
    return options;
  }

  function defaultStartFor(date) {
    if (date !== Store.toDateKey(new Date())) {
      return Store.loadState().settings.studyStartMin;
    }
    const now = Store.nowMinutes();
    const start = Math.max(Store.loadState().settings.studyStartMin, Math.ceil((now + 10) / 15) * 15);
    return Math.min(start, 23 * 60);
  }

  function openEventModal(options = {}) {
    const state = stateNow();
    const sessionList = sessions();
    const editing = options.event || (options.eventId ? state.events.find((e) => e.id === options.eventId) : null);
    const initialType = editing ? editing.type : options.type || "general";
    const initialRefId = editing ? editing.refId : options.refId || "";
    const initialDate = editing ? editing.date : options.date || Store.toDateKey(new Date());
    const defaultStart = editing && !editing.flexible ? editing.startMin : options.startMin !== undefined ? options.startMin : defaultStartFor(initialDate);
    const defaultEnd =
      editing && !editing.flexible
        ? editing.endMin
        : options.endMin !== undefined
        ? options.endMin
        : Math.min(1440, defaultStart + (options.plannedMin || state.settings.defaultSessionMin));

    const form = document.createElement("form");
    form.className = "stack-form event-form";
    const title = makeInput({
      value: editing ? editing.title : options.title || "",
      placeholder: "Session title",
      maxLength: 160,
      required: true,
    });
    const type = makeSelect(
      [
        { value: "course", label: "Course" },
        { value: "book", label: "Book" },
        { value: "task", label: "Task" },
        { value: "general", label: "General study" },
      ],
      initialType
    );
    const item = makeSelect(itemOptionsFor(state, initialType), initialRefId);
    const chapter = makeSelect([], editing ? editing.chapterId || "" : "");
    const date = makeInput({ type: "date", value: initialDate, required: true });
    const flexible = document.createElement("input");
    flexible.type = "checkbox";
    flexible.checked = editing ? editing.flexible : Boolean(options.flexible);
    const flexibleLabel = el("label", "checkbox-row");
    flexibleLabel.append(flexible, el("span", "", "Flexible session without a fixed time"));
    const startTime = makeInput({ type: "time", value: Store.fmtTime(defaultStart), required: true });
    const endTime = makeInput({ type: "time", value: Store.fmtTime(defaultEnd), required: true });
    const planned = makeInput({
      type: "number",
      value: editing && editing.flexible ? editing.plannedMin : options.plannedMin || state.settings.defaultSessionMin,
      min: 5,
      max: 720,
      step: 5,
    });
    const notes = document.createElement("textarea");
    notes.className = "text-input";
    notes.placeholder = "Optional notes";
    notes.maxLength = 500;
    notes.value = editing ? editing.notes || "" : "";

    const typeGrid = el("div", "form-grid three");
    typeGrid.append(field("Title", title), field("Type", type), field("Learning item", item));
    const detailGrid = el("div", "form-grid two");
    detailGrid.append(field("Date", date), field("Chapter", chapter));
    const timeGrid = el("div", "form-grid three");
    timeGrid.append(field("Start", startTime), field("End", endTime), field("Planned minutes", planned));
    const errors = el("div", "form-errors hidden");
    const actions = el("div", "form-actions");
    const cancel = makeButton("Cancel", "btn btn-ghost", () => UI.closeModal());
    const save = makeButton(editing ? "Save session" : "Add session", "btn btn-primary", null, "submit");
    actions.append(cancel, save);
    form.append(typeGrid, detailGrid, flexibleLabel, timeGrid, field("Notes", notes), errors, actions);

    function syncFlexible() {
      const isFlexible = flexible.checked;
      startTime.closest(".field").classList.toggle("hidden", isFlexible);
      endTime.closest(".field").classList.toggle("hidden", isFlexible);
      planned.closest(".field").classList.toggle("hidden", !isFlexible);
      startTime.required = !isFlexible;
      endTime.required = !isFlexible;
    }

    function syncItems() {
      const previous = item.value || initialRefId;
      item.innerHTML = "";
      const options = itemOptionsFor(state, type.value);
      options.forEach((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        item.appendChild(node);
      });
      if (options.some((option) => option.value === previous)) item.value = previous;
      else if (options.length) item.value = options[0].value;
      const showItem = type.value !== "general";
      item.closest(".field").classList.toggle("hidden", !showItem);
      item.disabled = !showItem;
      syncChapters();
    }

    function syncChapters() {
      const course = type.value === "course" ? Store.getItem(state, "course", item.value) : null;
      const showChapter = Boolean(course && course.chapters.length);
      chapter.closest(".field").classList.toggle("hidden", !showChapter);
      chapter.innerHTML = "";
      chapterOptions(course).forEach((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        chapter.appendChild(node);
      });
      if (editing && editing.chapterId && course && course.chapters.some((c) => c.id === editing.chapterId)) {
        chapter.value = editing.chapterId;
      }
    }

    function fillFromItem() {
      const selected = Store.getItem(state, type.value, item.value);
      if (!selected) return;
      if (!title.value.trim()) title.value = selected.title;
      const progress = Store.computeProgress(state, type.value, selected, sessionList);
      const remaining = Math.max(5, progress.remainingMin);
      if (!editing) {
        const length = Math.min(remaining, state.settings.defaultSessionMin);
        planned.value = String(length);
        const start = Store.parseTimeToMin(startTime.value);
        if (start !== null) endTime.value = Store.fmtTime(Math.min(1440, start + length));
      }
    }

    type.addEventListener("change", () => {
      syncItems();
      if (type.value === "general") {
        title.value = title.value || "General study";
      } else {
        fillFromItem();
      }
    });
    item.addEventListener("change", () => {
      syncChapters();
      fillFromItem();
    });
    date.addEventListener("change", () => {
      if (!editing && !flexible.checked) {
        const start = defaultStartFor(date.value);
        startTime.value = Store.fmtTime(start);
        endTime.value = Store.fmtTime(Math.min(1440, start + (Number(planned.value) || state.settings.defaultSessionMin)));
      }
    });
    startTime.addEventListener("change", () => {
      if (flexible.checked) return;
      const start = Store.parseTimeToMin(startTime.value);
      if (start === null) return;
      const currentEnd = Store.parseTimeToMin(endTime.value);
      if (currentEnd === null || currentEnd <= start) {
        endTime.value = Store.fmtTime(Math.min(1440, start + state.settings.defaultSessionMin));
      }
    });
    flexible.addEventListener("change", syncFlexible);

    syncItems();
    syncFlexible();
    if (initialRefId && item.value === initialRefId) syncChapters();
    if (!editing && initialRefId) fillFromItem();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const problems = [];
      if (!title.value.trim()) problems.push("Session title is required.");
      if (!Store.isValidDateKey(date.value)) problems.push("Choose a valid date.");
      if (type.value !== "general" && !item.value) problems.push("Choose a learning item for this session.");
      const plannedMinutes = Math.round(Number(planned.value));
      let startMin = null;
      let endMin = null;
      if (flexible.checked) {
        if (!Number.isFinite(plannedMinutes) || plannedMinutes <= 0) problems.push("Planned minutes must be greater than zero.");
      } else {
        startMin = Store.parseTimeToMin(startTime.value);
        endMin = Store.parseTimeToMin(endTime.value);
        if (startMin === null || endMin === null) problems.push("Start and end times are required.");
        else if (endMin <= startMin) problems.push("End time must be after start time.");
      }
      if (!problems.length) {
        const candidate = {
          id: editing ? editing.id : "candidate",
          title: title.value.trim(),
          type: type.value,
          refId: type.value === "general" ? null : item.value,
          chapterId: type.value === "course" ? chapter.value || null : null,
          date: date.value,
          flexible: flexible.checked,
          startMin,
          endMin,
          plannedMin: flexible.checked ? plannedMinutes : endMin - startMin,
          status: editing ? editing.status : "scheduled",
        };
        const conflicts = Store.findConflicts(state, candidate, editing ? editing.id : null);
        if (conflicts.length) {
          problems.push(
            `This time overlaps: ${conflicts.map((conflict) => conflict.title).join(", ")}. Choose another time.`
          );
        }
      }
      if (problems.length) {
        UI.renderErrors(form, problems);
        return;
      }
      Store.updateState((next) => {
        const payload = {
          title: title.value.trim(),
          type: type.value,
          refId: type.value === "general" ? null : item.value,
          chapterId: type.value === "course" ? chapter.value || null : null,
          date: date.value,
          flexible: flexible.checked,
          startMin: flexible.checked ? null : Store.parseTimeToMin(startTime.value),
          endMin: flexible.checked ? null : Store.parseTimeToMin(endTime.value),
          plannedMin: flexible.checked
            ? Math.round(Number(planned.value))
            : Store.parseTimeToMin(endTime.value) - Store.parseTimeToMin(startTime.value),
          notes: notes.value.trim(),
          updatedAt: Date.now(),
        };
        if (editing) {
          const target = next.events.find((e) => e.id === editing.id);
          if (target) Object.assign(target, payload);
        } else {
          const created = Store.normalizeState({
            ...Store.defaultState(),
            events: [{ ...payload, createdAt: Date.now(), source: "manual" }],
          }).events[0];
          next.events.push(created);
        }
      });
      UI.closeModal();
      UI.toast(editing ? "Session updated." : "Session scheduled.", "success");
    });

    UI.openModal(editing ? "Edit session" : "New study session", form);
  }

  function openEventDetail(eventId) {
    const state = stateNow();
    const sessionList = sessions();
    const event = state.events.find((e) => e.id === eventId);
    if (!event) return;
    currentEventId = eventId;
    const actual = Store.eventActualMinutes(event.id, sessionList);
    const status = Store.effectiveStatus(event, sessionList);
    const color = eventColor(state, event);
    const content = el("div", "event-detail");
    const heading = el("div", "event-detail-head");
    const dot = el("span", "item-dot");
    dot.style.background = color;
    heading.append(dot, el("h3", "event-detail-title", event.title));
    heading.appendChild(el("span", `status-badge status-${status}`, UI.statusLabel(status)));
    content.appendChild(heading);
    const item = event.refId ? Store.getItem(state, event.type, event.refId) : null;
    const details = el("div", "detail-grid");
    const scheduleText = event.flexible
      ? `${Store.fmtDateShort(event.date)} · Flexible`
      : `${Store.fmtDateShort(event.date)} · ${Store.fmtTime(event.startMin)}–${Store.fmtTime(event.endMin)}`;
    [
      ["Type", UI.typeLabel(event.type) + (item ? ` · ${item.title}` : "")],
      ["Schedule", scheduleText],
      ["Planned", Store.fmtDuration(event.plannedMin)],
      ["Actual focus", Store.fmtDuration(actual)],
      ["Status", UI.statusLabel(status)],
    ].forEach(([label, value]) => {
      const cell = el("div", "detail-cell");
      cell.append(el("span", "detail-label", label), el("span", "detail-value", value));
      details.appendChild(cell);
    });
    content.appendChild(details);
    if (event.notes) content.appendChild(el("p", "event-notes", event.notes));

    const actions = el("div", "form-actions detail-actions");
    if (status === "scheduled" || status === "missed" || status === "partial") {
      const remaining = Math.max(0, event.plannedMin - actual);
      if (remaining > 0) {
        const reschedule = makeButton("Reschedule remaining", "btn btn-ghost", () => {
          UI.closeModal();
          if (Planner.Scheduler && Planner.Scheduler.openReschedule) {
            Planner.Scheduler.openReschedule(event.id);
          } else {
            UI.toast("Rescheduling is not available yet.", "error");
          }
        });
        actions.appendChild(reschedule);
      }
    }
    if (status === "scheduled" || status === "missed" || status === "partial") {
      actions.appendChild(
        makeButton("Start focus", "btn btn-primary", () => {
          UI.closeModal();
          if (typeof Planner.startFocus === "function") Planner.startFocus(event.id);
          else UI.toast("Timer integration is not available.", "error");
        })
      );
    }
    actions.appendChild(
      makeButton("Edit", "btn btn-ghost", () => {
        openEventModal({ event });
      })
    );
    actions.appendChild(
      makeButton("Delete", "btn btn-danger", () => {
        if (!window.confirm(`Delete "${event.title}"? Completed focus time is preserved in history.`)) return;
        Store.updateState((next) => {
          next.events = next.events.filter((e) => e.id !== event.id);
        });
        UI.closeModal();
        UI.toast("Session deleted.", "success");
      })
    );
    actions.appendChild(makeButton("Close", "btn btn-ghost", () => UI.closeModal()));
    content.appendChild(actions);
    UI.openModal("Session details", content);
  }

  function moveEventToDate(eventId, date) {
    const state = stateNow();
    const event = state.events.find((e) => e.id === eventId);
    if (!event || !["scheduled", "missed"].includes(event.status)) return;
    const conflicts = Store.findConflicts(state, { ...event, date }, event.id);
    if (conflicts.length) {
      UI.toast(`Cannot move: overlaps ${conflicts.map((c) => c.title).join(", ")}.`, "error");
      return;
    }
    Store.updateState((next) => {
      const target = next.events.find((e) => e.id === eventId);
      if (!target) return;
      target.date = date;
      if (target.status === "missed") target.status = "scheduled";
      target.updatedAt = Date.now();
    });
    UI.toast("Session moved.", "success");
  }

  function moveEventToTime(eventId, date, startMin) {
    const state = stateNow();
    const event = state.events.find((e) => e.id === eventId);
    if (!event || !["scheduled", "missed"].includes(event.status)) return;
    const duration = event.flexible ? event.plannedMin : event.endMin - event.startMin;
    const endMin = startMin + duration;
    if (endMin > 1440) {
      UI.toast("That session would run past midnight.", "error");
      return;
    }
    const candidate = {
      ...event,
      date,
      flexible: false,
      startMin,
      endMin,
      plannedMin: duration,
    };
    const conflicts = Store.findConflicts(state, candidate, event.id);
    if (conflicts.length) {
      UI.toast(`Cannot move: overlaps ${conflicts.map((c) => c.title).join(", ")}.`, "error");
      return;
    }
    Store.updateState((next) => {
      const target = next.events.find((e) => e.id === eventId);
      if (!target) return;
      target.date = date;
      target.flexible = false;
      target.startMin = startMin;
      target.endMin = endMin;
      target.plannedMin = duration;
      if (target.status === "missed") target.status = "scheduled";
      target.updatedAt = Date.now();
    });
    UI.toast("Session rescheduled.", "success");
  }

  function init() {
    const state = stateNow();
    calendarView = state.settings.calendarView || "week";
    const add = UI.$("addEventBtn");
    if (add) add.addEventListener("click", () => openEventModal({ date: anchorKey }));
    const auto = UI.$("autoScheduleBtn");
    if (auto) {
      auto.addEventListener("click", () => {
        if (Planner.Scheduler && Planner.Scheduler.open) Planner.Scheduler.open();
        else UI.toast("Auto scheduler is not available yet.", "error");
      });
    }
    document.addEventListener("planner:data-changed", () => {
      if (!UI.$("calendarView").classList.contains("hidden")) render();
    });
  }

  Planner.Calendar = {
    render,
    init,
    openEventModal,
    openEventDetail,
    setView,
    moveEventToDate,
    moveEventToTime,
    getView: () => calendarView,
    getAnchor: () => anchorKey,
    eventColor,
  };

  init();
})(typeof globalThis !== "undefined" ? globalThis : this);
