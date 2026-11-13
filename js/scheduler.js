"use strict";

(function (global) {
  const Planner = global.Planner || (global.Planner = {});
  const Store = Planner.Store;
  const UI = Planner.UI;
  const { el, makeInput, makeButton, field } = UI;
  const MIN_BLOCK = 15;
  const MAX_SESSION = 180;

  function splitChunk(minutes, sessionMin) {
    const length = Math.max(1, Math.round(minutes));
    const block = Math.max(10, Math.min(MAX_SESSION, Math.round(sessionMin)));
    const parts = [];
    let remaining = length;
    while (remaining > 0) {
      const part = Math.min(block, remaining);
      parts.push(part);
      remaining -= part;
    }
    return parts;
  }

  function buildChunks(state, sessions, selectedItems, sessionMin, extraChunks) {
    const chunks = [];
    selectedItems.forEach(({ type, item }) => {
      if (type === "course") {
        const progress = Store.computeCourseProgress(state, item, sessions);
        let remaining = progress.remainingMin;
        progress.chapters.forEach((chapter) => {
          if (remaining <= 0 || chapter.remainingMin <= 0) return;
          const take = Math.min(chapter.remainingMin, remaining);
          splitChunk(take, sessionMin).forEach((minutes) => {
            chunks.push({
              type,
              refId: item.id,
              chapterId: chapter.id,
              title: item.title,
              label: chapter.title,
              minutes,
              remaining: minutes,
            });
          });
          remaining -= take;
        });
        if (remaining > 0) {
          splitChunk(remaining, sessionMin).forEach((minutes) => {
            chunks.push({
              type,
              refId: item.id,
              chapterId: null,
              title: item.title,
              label: "Course study",
              minutes,
              remaining: minutes,
            });
          });
        }
      } else {
        const progress = Store.computeProgress(state, type, item, sessions);
        if (progress.remainingMin > 0) {
          splitChunk(progress.remainingMin, sessionMin).forEach((minutes) => {
            chunks.push({
              type,
              refId: item.id,
              chapterId: null,
              title: item.title,
              label: type === "book" ? "Reading" : "Task work",
              minutes,
              remaining: minutes,
            });
          });
        }
      }
    });
    (extraChunks || []).forEach((chunk) => {
      splitChunk(chunk.minutes, sessionMin).forEach((minutes) => {
        chunks.push({ ...chunk, minutes, remaining: minutes });
      });
    });
    return chunks;
  }

  function busyForDate(state, date, proposed) {
    const events = state.events
      .filter(
        (event) =>
          event.date === date &&
          !event.flexible &&
          !["cancelled", "rescheduled", "missed"].includes(event.status)
      )
      .map((event) => ({ start: event.startMin, end: event.endMin }));
    proposed
      .filter((event) => event.date === date)
      .forEach((event) => events.push({ start: event.startMin, end: event.endMin }));
    return events.sort((a, b) => a.start - b.start);
  }

  function plannedForDate(state, date) {
    return state.events
      .filter(
        (event) =>
          event.date === date && !["cancelled", "rescheduled", "missed"].includes(event.status)
      )
      .reduce((sum, event) => sum + Store.toNumber(event.plannedMin, 0), 0);
  }

  function freeGaps(start, end, busy) {
    const gaps = [];
    let cursor = start;
    busy
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((interval) => {
        if (interval.end <= cursor) return;
        if (interval.start >= end) return;
        if (interval.start > cursor) gaps.push({ start: cursor, end: Math.min(interval.start, end) });
        cursor = Math.max(cursor, interval.end);
      });
    if (cursor < end) gaps.push({ start: cursor, end });
    return gaps.filter((gap) => gap.end - gap.start >= MIN_BLOCK);
  }

  function generateSchedule(state, sessions, options) {
    const startDate = Store.isValidDateKey(options.startDate) ? options.startDate : Store.toDateKey(new Date());
    const deadline = Store.isValidDateKey(options.deadline) ? options.deadline : null;
    const dailyGoal = Store.clamp(Math.round(Store.toNumber(options.dailyGoalMin, 120)), 15, 720);
    const sessionMin = Store.clamp(Math.round(Store.toNumber(options.sessionMin, 50)), 10, 180);
    const studyStart = Store.clamp(Math.round(Store.toNumber(options.studyStartMin, 18 * 60)), 0, 1439);
    const studyEnd = Store.clamp(Math.round(Store.toNumber(options.studyEndMin, 22 * 60)), 1, 1440);
    const studyDays = new Set((options.studyDays || []).map(Number));
    const selectedItems = options.selectedItems || [];
    const extraChunks = options.extraChunks || [];
    const warnings = [];
    const chunks = buildChunks(state, sessions, selectedItems, sessionMin, extraChunks);
    if (!chunks.length) {
      return {
        events: [],
        days: [],
        unscheduled: [],
        warnings: ["Nothing to schedule. Add a course, book, task, or choose a different item."],
        totalMinutes: 0,
        options: { startDate, deadline, dailyGoal, sessionMin, studyStart, studyEnd },
      };
    }
    if (studyEnd <= studyStart) {
      return {
        events: [],
        days: [],
        unscheduled: chunks,
        warnings: ["The study window end must be after its start."],
        totalMinutes: 0,
        options: { startDate, deadline, dailyGoal, sessionMin, studyStart, studyEnd },
      };
    }
    if (!studyDays.size) {
      return {
        events: [],
        days: [],
        unscheduled: chunks,
        warnings: ["Select at least one available weekday."],
        totalMinutes: 0,
        options: { startDate, deadline, dailyGoal, sessionMin, studyStart, studyEnd },
      };
    }
    if (deadline && deadline < startDate) {
      return {
        events: [],
        days: [],
        unscheduled: chunks,
        warnings: ["The deadline cannot be before the start date."],
        totalMinutes: 0,
        options: { startDate, deadline, dailyGoal, sessionMin, studyStart, studyEnd },
      };
    }

    const proposed = [];
    let date = startDate;
    let guard = 0;
    const maxDays = deadline ? Math.min(730, Store.dateRangeKeys(startDate, deadline).length + 1) : 120;
    const today = Store.toDateKey(new Date());
    const now = Store.nowMinutes();

    while (chunks.some((chunk) => chunk.remaining > 0) && guard < maxDays) {
      guard += 1;
      if (deadline && date > deadline) break;
      if (!studyDays.has(Store.weekdayIndex(date))) {
        date = Store.addDays(date, 1);
        continue;
      }
      let windowStart = studyStart;
      if (date === today) {
        const roundedNow = Math.ceil((now + 5) / 5) * 5;
        windowStart = Math.max(windowStart, roundedNow);
      }
      if (date === today && windowStart >= studyEnd) {
        date = Store.addDays(date, 1);
        continue;
      }
      const existingPlanned = plannedForDate(state, date);
      let capacity = Math.min(dailyGoal, studyEnd - windowStart) - existingPlanned;
      if (capacity < MIN_BLOCK) {
        date = Store.addDays(date, 1);
        continue;
      }
      const gaps = freeGaps(windowStart, studyEnd, busyForDate(state, date, proposed));
      let chunkIndex = 0;
      let scheduledToday = 0;

      gaps.forEach((gap) => {
        let cursor = gap.start;
        while (
          cursor < gap.end - 1 &&
          capacity >= 1 &&
          chunkIndex < chunks.length
        ) {
          const chunk = chunks[chunkIndex];
          if (chunk.remaining <= 0) {
            chunkIndex += 1;
            continue;
          }
          const available = Math.min(gap.end - cursor, capacity);
          const take = Math.min(chunk.remaining, available);
          if (take < MIN_BLOCK && chunk.remaining > take) break;
          if (take < 1) break;
          const event = {
            title: chunk.chapterId && chunk.label ? `${chunk.title} · ${chunk.label}` : chunk.title,
            type: chunk.type,
            refId: chunk.refId || null,
            chapterId: chunk.chapterId || null,
            date,
            flexible: false,
            startMin: cursor,
            endMin: cursor + take,
            plannedMin: take,
            status: "scheduled",
            source: "auto",
            notes: "",
            tempKey: `${chunkIndex}_${cursor}`,
          };
          proposed.push(event);
          cursor += take;
          capacity -= take;
          scheduledToday += take;
          chunk.remaining -= take;
          if (chunk.remaining <= 0) chunkIndex += 1;
        }
      });

      if (scheduledToday <= 0) {
        date = Store.addDays(date, 1);
        continue;
      }
      date = Store.addDays(date, 1);
    }

    const unscheduled = chunks.filter((chunk) => chunk.remaining > 0);
    if (unscheduled.length) {
      const total = unscheduled.reduce((sum, chunk) => sum + chunk.remaining, 0);
      if (deadline) {
        warnings.push(
          `${Store.fmtDuration(total)} could not fit before the deadline. Add more study time or move the deadline.`
        );
      } else {
        warnings.push(`${Store.fmtDuration(total)} could not fit in the generated horizon.`);
      }
    }
    const totalMinutes = proposed.reduce((sum, event) => sum + event.plannedMin, 0);
    const days = [];
    proposed
      .slice()
      .sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date)))
      .forEach((event) => {
        let day = days.find((entry) => entry.date === event.date);
        if (!day) {
          day = { date: event.date, events: [], minutes: 0 };
          days.push(day);
        }
        day.events.push(event);
        day.minutes += event.plannedMin;
      });

    return {
      events: proposed,
      days,
      unscheduled,
      warnings,
      totalMinutes,
      options: { startDate, deadline, dailyGoal, sessionMin, studyStart, studyEnd },
    };
  }

  let pendingPreview = null;
  let pendingOptions = null;

  function itemSelection(state, sessions, options) {
    const wrap = el("div", "schedule-items");
    const items = Store.listItems(state);
    items.forEach(({ type, item }) => {
      const progress = Store.computeProgress(state, type, item, sessions);
      if (progress.remainingMin <= 0) return;
      const label = el("label", "schedule-item-row");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = `${type}:${item.id}`;
      checkbox.checked = options.focusItem
        ? options.focusItem.type === type && options.focusItem.id === item.id
        : true;
      if (options.focusItem) checkbox.disabled = true;
      const dot = el("span", "item-dot");
      dot.style.background = item.color;
      label.append(checkbox, dot, el("span", "schedule-item-title", item.title));
      label.appendChild(el("span", "schedule-item-meta", `${Store.fmtDuration(progress.remainingMin)} left`));
      wrap.appendChild(label);
    });
    return wrap;
  }

  function selectedFromForm(container) {
    return [...container.querySelectorAll(".schedule-item-row input:checked")].map((checkbox) => {
      const [type, id] = checkbox.value.split(":");
      const item = Store.getItem(Store.loadState(), type, id);
      return { type, item };
    }).filter((entry) => entry.item);
  }

  function weekdayPicker(selected) {
    const wrap = el("div", "weekday-picker");
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    names.forEach((name, index) => {
      const label = el("label", `weekday-chip${selected.includes(index) ? " active" : ""}`);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = String(index);
      checkbox.checked = selected.includes(index);
      checkbox.addEventListener("change", () => label.classList.toggle("active", checkbox.checked));
      label.append(checkbox, el("span", "", name));
      wrap.appendChild(label);
    });
    return wrap;
  }

  function renderPreview(container, preview, state) {
    container.innerHTML = "";
    if (!preview) return;
    const summary = el("div", "schedule-summary");
    const cards = [
      ["Sessions", String(preview.events.length)],
      ["Total", Store.fmtDuration(preview.totalMinutes)],
      ["Days", String(preview.days.length)],
    ];
    cards.forEach(([label, value]) => {
      const card = el("div", "schedule-summary-card");
      card.append(el("span", "detail-label", label), el("span", "detail-value", value));
      summary.appendChild(card);
    });
    container.appendChild(summary);
    if (preview.warnings.length) {
      const warn = el("div", "schedule-warnings");
      preview.warnings.forEach((message) => warn.appendChild(el("div", "", message)));
      container.appendChild(warn);
    }
    if (!preview.events.length) return;
    const days = el("div", "schedule-preview-days");
    preview.days.forEach((day) => {
      const block = el("div", "schedule-day");
      const head = el("div", "schedule-day-head");
      head.append(el("span", "", Store.fmtDateShort(day.date)), el("span", "schedule-day-total", Store.fmtDuration(day.minutes)));
      block.appendChild(head);
      day.events.forEach((event) => {
        const row = el("div", "schedule-preview-row");
        const color = event.type === "general" || !event.refId
          ? Store.COLORS.general
          : Store.itemColor(state, event.type, event.refId);
        const dot = el("span", "item-dot");
        dot.style.background = color;
        row.append(
          dot,
          el("span", "schedule-preview-time", `${Store.fmtTime(event.startMin)}–${Store.fmtTime(event.endMin)}`),
          el("span", "schedule-preview-title", event.title),
          el("span", "schedule-preview-minutes", Store.fmtDuration(event.plannedMin))
        );
        block.appendChild(row);
      });
      days.appendChild(block);
    });
    container.appendChild(days);
  }

  function buildModal(options = {}) {
    const state = Store.loadState();
    const sessions = Store.loadSessions();
    const settings = state.settings;
    const rescheduleEvent = options.rescheduleEventId
      ? state.events.find((event) => event.id === options.rescheduleEventId)
      : null;
    const rescheduleActual = rescheduleEvent
      ? Store.eventActualMinutes(rescheduleEvent.id, sessions)
      : 0;
    const rescheduleRemaining = rescheduleEvent
      ? Math.max(0, rescheduleEvent.plannedMin - rescheduleActual)
      : 0;
    const extraChunks = rescheduleEvent && rescheduleRemaining > 0
      ? [{
          type: rescheduleEvent.type,
          refId: rescheduleEvent.refId,
          chapterId: rescheduleEvent.chapterId,
          title: rescheduleEvent.title,
          label: "",
          minutes: rescheduleRemaining,
        }]
      : [];

    const form = document.createElement("form");
    form.className = "stack-form scheduler-form";
    if (rescheduleEvent) {
      const intro = el("div", "schedule-intro");
      intro.append(
        el("strong", "", `Rescheduling: ${rescheduleEvent.title}`),
        el("span", "", `${Store.fmtDuration(rescheduleActual)} completed · ${Store.fmtDuration(rescheduleRemaining)} remaining`)
      );
      form.appendChild(intro);
    }
    const startDate = makeInput({
      type: "date",
      value: options.startDate || Store.toDateKey(new Date()),
      required: true,
    });
    const todayKey = Store.toDateKey(new Date());
    const linkedItem = rescheduleEvent && rescheduleEvent.refId
      ? Store.getItem(state, rescheduleEvent.type, rescheduleEvent.refId)
      : null;
    const deadlines = state.courses
      .concat(state.books)
      .map((item) => item.deadline)
      .filter((value) => value && value >= todayKey)
      .sort();
    const earliestDeadline =
      options.deadline ||
      (linkedItem && linkedItem.deadline && linkedItem.deadline >= todayKey ? linkedItem.deadline : null) ||
      deadlines[0] ||
      "";
    const deadline = makeInput({ type: "date", value: earliestDeadline || "" });
    const dailyGoal = makeInput({
      type: "number",
      value: settings.dailyGoalMin,
      min: 15,
      max: 720,
      step: 15,
      required: true,
    });
    const sessionMin = makeInput({
      type: "number",
      value: settings.defaultSessionMin,
      min: 10,
      max: 180,
      step: 5,
      required: true,
    });
    const startTime = makeInput({ type: "time", value: Store.fmtTime(settings.studyStartMin), required: true });
    const endTime = makeInput({ type: "time", value: Store.fmtTime(settings.studyEndMin), required: true });
    const dateGrid = el("div", "form-grid two");
    dateGrid.append(field("Start date", startDate), field("Deadline (optional)", deadline));
    const durationGrid = el("div", "form-grid three");
    durationGrid.append(field("Daily study target (minutes)", dailyGoal), field("Session length (minutes)", sessionMin), el("div", ""));
    const windowGrid = el("div", "form-grid two");
    windowGrid.append(field("Study window start", startTime), field("Study window end", endTime));
    const weekdays = weekdayPicker(settings.studyDays);
    form.append(dateGrid, durationGrid, windowGrid, field("Available weekdays", weekdays));

    const itemsWrap = el("div", "schedule-items-wrap");
    if (!rescheduleEvent) {
      itemsWrap.appendChild(field("Learning items to include", itemSelection(state, sessions, options)));
      form.appendChild(itemsWrap);
    }

    const errors = el("div", "form-errors hidden");
    const previewBox = el("div", "schedule-preview hidden");
    const actionRow = el("div", "form-actions schedule-actions");
    const generate = makeButton("Generate preview", "btn btn-primary", null, "button");
    const confirm = makeButton("Add sessions", "btn btn-primary hidden", null, "button");
    const cancel = makeButton("Cancel", "btn btn-ghost", () => UI.closeModal());
    actionRow.append(cancel, generate, confirm);
    form.append(errors, previewBox, actionRow);

    function readOptions() {
      const selectedItems = rescheduleEvent ? [] : selectedFromForm(itemsWrap);
      const studyStartMin = Store.parseTimeToMin(startTime.value);
      const studyEndMin = Store.parseTimeToMin(endTime.value);
      const selectedDays = [...weekdays.querySelectorAll("input:checked")].map((input) => Number(input.value));
      return {
        startDate: startDate.value,
        deadline: deadline.value || null,
        dailyGoalMin: Number(dailyGoal.value),
        sessionMin: Number(sessionMin.value),
        studyStartMin,
        studyEndMin,
        studyDays: selectedDays,
        selectedItems,
        extraChunks,
        rescheduleEventId: rescheduleEvent ? rescheduleEvent.id : null,
      };
    }

    function validateOptions(opts) {
      const problems = [];
      if (!Store.isValidDateKey(opts.startDate)) problems.push("Choose a valid start date.");
      if (opts.deadline && !Store.isValidDateKey(opts.deadline)) problems.push("Choose a valid deadline.");
      if (opts.deadline && opts.deadline < opts.startDate) problems.push("Deadline must be on or after the start date.");
      if (!Number.isFinite(opts.dailyGoalMin) || opts.dailyGoalMin < 15) problems.push("Daily target must be at least 15 minutes.");
      if (!Number.isFinite(opts.sessionMin) || opts.sessionMin < 10) problems.push("Session length must be at least 10 minutes.");
      if (opts.studyStartMin === null || opts.studyEndMin === null) problems.push("Enter valid study window times.");
      else if (opts.studyEndMin <= opts.studyStartMin) problems.push("Study window end must be after its start.");
      if (!opts.studyDays.length) problems.push("Select at least one available weekday.");
      if (!rescheduleEvent && !opts.selectedItems.length) problems.push("Select at least one learning item.");
      if (rescheduleEvent && rescheduleRemaining <= 0) problems.push("This session has no remaining work to reschedule.");
      return problems;
    }

    generate.addEventListener("click", () => {
      pendingPreview = null;
      confirm.classList.add("hidden");
      UI.renderErrors(form, []);
      const opts = readOptions();
      const problems = validateOptions(opts);
      if (problems.length) {
        UI.renderErrors(form, problems);
        return;
      }
      pendingOptions = opts;
      pendingPreview = generateSchedule(Store.loadState(), Store.loadSessions(), opts);
      previewBox.classList.remove("hidden");
      renderPreview(previewBox, pendingPreview, Store.loadState());
      confirm.classList.toggle("hidden", !pendingPreview.events.length);
      confirm.textContent = pendingPreview.events.length
        ? `Add ${pendingPreview.events.length} session${pendingPreview.events.length === 1 ? "" : "s"}`
        : "Add sessions";
    });

    confirm.addEventListener("click", () => {
      if (!pendingPreview || !pendingOptions || !pendingPreview.events.length) return;
      const freshState = Store.loadState();
      const conflicts = [];
      pendingPreview.events.forEach((event) => {
        const match = Store.findConflicts(freshState, event, null);
        if (match.length) conflicts.push(`${event.title} on ${Store.fmtDateShort(event.date)}`);
      });
      if (conflicts.length) {
        UI.renderErrors(form, [`Some slots are no longer available: ${conflicts.join(", ")}. Generate a new preview.`]);
        confirm.classList.add("hidden");
        pendingPreview = null;
        return;
      }
      Store.updateState((next) => {
        const additions = pendingPreview.events.map((event) =>
          Store.normalizeState({
            ...Store.defaultState(),
            events: [{
              ...event,
              rescheduledFrom: pendingOptions.rescheduleEventId || null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }],
          }).events[0]
        );
        additions.forEach((event) => next.events.push(event));
        if (pendingOptions.rescheduleEventId) {
          const original = next.events.find((event) => event.id === pendingOptions.rescheduleEventId);
          if (original) {
            const actual = Store.eventActualMinutes(original.id, Store.loadSessions());
            if (actual > 0) {
              original.status = "partial";
              original.plannedMin = actual;
            } else {
              original.status = "rescheduled";
            }
            original.updatedAt = Date.now();
          }
        }
      });
      const count = pendingPreview.events.length;
      pendingPreview = null;
      pendingOptions = null;
      UI.closeModal();
      UI.toast(`${count} study session${count === 1 ? "" : "s"} scheduled.`, "success");
    });

    UI.openModal(rescheduleEvent ? "Reschedule remaining work" : "Auto scheduler", form, { wide: true });
  }

  function open(options = {}) {
    pendingPreview = null;
    pendingOptions = null;
    buildModal(options);
  }

  function openReschedule(eventId) {
    open({ rescheduleEventId: eventId, startDate: Store.toDateKey(new Date()) });
  }

  Planner.Scheduler = {
    generateSchedule,
    buildChunks,
    freeGaps,
    open,
    openReschedule,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
