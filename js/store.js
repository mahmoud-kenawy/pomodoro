"use strict";

(function (global) {
  const STORAGE_KEY = "pomodoro.planner.v1";
  const SESSIONS_KEY = "pomodoro.sessions.v1";
  const SCHEMA_VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const COLORS = { course: "#58a6ff", book: "#3fb950", task: "#d29922", general: "#a371f7" };
  const TYPES = ["course", "book", "task", "general"];
  const STATUSES = ["scheduled", "completed", "partial", "missed", "rescheduled", "cancelled"];
  const ACTIVE_STATUSES = ["scheduled", "completed", "partial"];

  const memoryData = new Map();
  const memoryStorage = {
    getItem(key) {
      return memoryData.has(key) ? memoryData.get(key) : null;
    },
    setItem(key, value) {
      memoryData.set(key, String(value));
    },
    removeItem(key) {
      memoryData.delete(key);
    },
  };

  let storageAdapter = null;

  function getStorage() {
    if (storageAdapter) return storageAdapter;
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch {}
    return memoryStorage;
  }

  function setStorage(storage) {
    storageAdapter = storage;
  }

  function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundMinutes(value) {
    return Math.round(value * 10) / 10;
  }

  function defaultSettings() {
    return {
      dailyGoalMin: 120,
      studyDays: [1, 2, 3, 4, 5],
      studyStartMin: 18 * 60,
      studyEndMin: 22 * 60,
      defaultSessionMin: 50,
      calendarView: "week",
    };
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      courses: [],
      books: [],
      tasks: [],
      events: [],
      settings: defaultSettings(),
    };
  }

  function toDateKey(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return toDateKey(new Date());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function dateKeyToDate(key) {
    const parts = String(key).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function isValidDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = dateKeyToDate(value);
    return !Number.isNaN(d.getTime()) && toDateKey(d) === value;
  }

  function addDays(key, amount) {
    const d = dateKeyToDate(key);
    d.setDate(d.getDate() + amount);
    return toDateKey(d);
  }

  function weekdayIndex(key) {
    return dateKeyToDate(key).getDay();
  }

  function startOfWeekKey(key, weekStartsOn = 1) {
    const day = weekdayIndex(key);
    const diff = (day - weekStartsOn + 7) % 7;
    return addDays(key, -diff);
  }

  function weekKeys(key, weekStartsOn = 1) {
    const start = startOfWeekKey(key, weekStartsOn);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  function monthGridKeys(key) {
    const d = dateKeyToDate(key);
    d.setDate(1);
    const start = startOfWeekKey(toDateKey(d), 1);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }

  function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function parseTimeToMin(value) {
    if (typeof value !== "string") return null;
    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  function fmtTime(min) {
    const value = clamp(Math.round(toNumber(min, 0)), 0, 1439);
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function fmtDuration(minutes) {
    const value = Math.max(0, Math.round(toNumber(minutes, 0)));
    const h = Math.floor(value / 60);
    const m = value % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function fmtDateShort(key) {
    return dateKeyToDate(key).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  function fmtDateLong(key) {
    return dateKeyToDate(key).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function fmtMonth(key) {
    return dateKeyToDate(key).toLocaleDateString([], { month: "long", year: "numeric" });
  }

  function eventDateTime(key, minute) {
    const d = dateKeyToDate(key);
    d.setMinutes(toNumber(minute, 0));
    return d.getTime();
  }

  function eventStartMs(event) {
    if (!event || event.flexible || event.startMin === null) return null;
    return eventDateTime(event.date, event.startMin);
  }

  function eventEndMs(event) {
    if (!event) return null;
    if (event.flexible) return dateKeyToDate(addDays(event.date, 1)).getTime() - 1;
    return eventDateTime(event.date, event.endMin);
  }

  function eventActualMinutes(eventId, sessions) {
    return roundMinutes(
      (sessions || []).filter((s) => s.eventId === eventId).reduce((sum, s) => sum + toNumber(s.durationMin, 0), 0)
    );
  }

  function effectiveStatus(event, sessions, now = Date.now()) {
    if (!event) return "scheduled";
    if (event.status === "scheduled" && eventEndMs(event) < now) {
      const actual = eventActualMinutes(event.id, sessions);
      if (actual > 0) return actual >= event.plannedMin - 0.5 ? "completed" : "partial";
      return "missed";
    }
    return event.status;
  }

  function normalizeColor(value, fallback) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  function normalizeChapter(raw, index) {
    return {
      id: raw && raw.id ? String(raw.id) : createId("chapter"),
      title: raw && raw.title ? String(raw.title).trim().slice(0, 120) : `Chapter ${index + 1}`,
      durationMin: Math.max(1, Math.round(toNumber(raw && raw.durationMin, 30))),
    };
  }

  function normalizeCourse(raw) {
    const chapters = Array.isArray(raw && raw.chapters)
      ? raw.chapters.map(normalizeChapter).filter((c) => c.title && c.durationMin > 0)
      : [];
    const chapterTotal = chapters.reduce((sum, c) => sum + c.durationMin, 0);
    const totalMinutes = Math.max(1, Math.round(toNumber(raw && raw.totalMinutes, chapterTotal || 60)));
    return {
      id: raw && raw.id ? String(raw.id) : createId("course"),
      title: raw && raw.title ? String(raw.title).trim().slice(0, 120) : "Untitled course",
      color: normalizeColor(raw && raw.color, COLORS.course),
      deadline: raw && isValidDateKey(raw.deadline) ? raw.deadline : null,
      totalMinutes: Math.max(chapterTotal, totalMinutes),
      chapters,
      createdAt: toNumber(raw && raw.createdAt, Date.now()),
      updatedAt: toNumber(raw && raw.updatedAt, Date.now()),
    };
  }

  function normalizeBook(raw) {
    const totalPages = Math.max(1, Math.round(toNumber(raw && raw.totalPages, 200)));
    const basePage = clamp(Math.round(toNumber(raw && raw.basePage, 0)), 0, totalPages);
    return {
      id: raw && raw.id ? String(raw.id) : createId("book"),
      title: raw && raw.title ? String(raw.title).trim().slice(0, 120) : "Untitled book",
      color: normalizeColor(raw && raw.color, COLORS.book),
      deadline: raw && isValidDateKey(raw.deadline) ? raw.deadline : null,
      totalPages,
      basePage,
      baseAt: toNumber(raw && raw.baseAt, Date.now()),
      minutesPerPage: Math.max(0.1, roundMinutes(toNumber(raw && raw.minutesPerPage, 2))),
      createdAt: toNumber(raw && raw.createdAt, Date.now()),
      updatedAt: toNumber(raw && raw.updatedAt, Date.now()),
    };
  }

  function normalizeTask(raw) {
    return {
      id: raw && raw.id ? String(raw.id) : createId("task"),
      title: raw && raw.title ? String(raw.title).trim().slice(0, 120) : "Untitled task",
      color: normalizeColor(raw && raw.color, COLORS.task),
      dueDate: raw && isValidDateKey(raw.dueDate) ? raw.dueDate : null,
      estimateMin: Math.max(1, Math.round(toNumber(raw && raw.estimateMin, 60))),
      createdAt: toNumber(raw && raw.createdAt, Date.now()),
      updatedAt: toNumber(raw && raw.updatedAt, Date.now()),
    };
  }

  function normalizeEvent(raw) {
    const type = TYPES.includes(raw && raw.type) ? raw.type : "general";
    const flexible = Boolean(raw && raw.flexible);
    const date = raw && isValidDateKey(raw.date) ? raw.date : toDateKey(new Date());
    let startMin = flexible ? null : clamp(Math.round(toNumber(raw && raw.startMin, 9 * 60)), 0, 1439);
    let endMin = flexible ? null : clamp(Math.round(toNumber(raw && raw.endMin, startMin + 60)), 1, 1440);
    if (!flexible && endMin <= startMin) endMin = startMin + 30;
    const plannedMin = flexible
      ? Math.max(1, Math.round(toNumber(raw && raw.plannedMin, 30)))
      : endMin - startMin;
    return {
      id: raw && raw.id ? String(raw.id) : createId("event"),
      title: raw && raw.title ? String(raw.title).trim().slice(0, 160) : "Study session",
      type,
      refId: raw && raw.refId ? String(raw.refId) : null,
      chapterId: raw && raw.chapterId ? String(raw.chapterId) : null,
      date,
      flexible,
      startMin,
      endMin,
      plannedMin,
      status: STATUSES.includes(raw && raw.status) ? raw.status : "scheduled",
      source: raw && raw.source ? String(raw.source) : "manual",
      rescheduledFrom: raw && raw.rescheduledFrom ? String(raw.rescheduledFrom) : null,
      notes: raw && raw.notes ? String(raw.notes).slice(0, 500) : "",
      createdAt: toNumber(raw && raw.createdAt, Date.now()),
      updatedAt: toNumber(raw && raw.updatedAt, Date.now()),
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    const settings = Object.assign({}, base.settings, raw.settings || {});
    settings.dailyGoalMin = clamp(Math.round(toNumber(settings.dailyGoalMin, 120)), 15, 720);
    settings.defaultSessionMin = clamp(Math.round(toNumber(settings.defaultSessionMin, 50)), 10, 180);
    settings.studyStartMin = clamp(Math.round(toNumber(settings.studyStartMin, 18 * 60)), 0, 1439);
    settings.studyEndMin = clamp(Math.round(toNumber(settings.studyEndMin, 22 * 60)), 1, 1440);
    if (settings.studyEndMin <= settings.studyStartMin) {
      settings.studyStartMin = 18 * 60;
      settings.studyEndMin = 22 * 60;
    }
    settings.studyDays = Array.isArray(settings.studyDays)
      ? [...new Set(settings.studyDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort()
      : base.settings.studyDays;
    if (!settings.studyDays.length) settings.studyDays = base.settings.studyDays;
    if (!["day", "week", "month"].includes(settings.calendarView)) settings.calendarView = "week";
    return {
      schemaVersion: SCHEMA_VERSION,
      courses: Array.isArray(raw.courses) ? raw.courses.map(normalizeCourse) : [],
      books: Array.isArray(raw.books) ? raw.books.map(normalizeBook) : [],
      tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [],
      events: Array.isArray(raw.events) ? raw.events.map(normalizeEvent) : [],
      settings,
    };
  }

  function loadState() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  function saveState(state, options = {}) {
    const normalized = normalizeState(state);
    getStorage().setItem(STORAGE_KEY, JSON.stringify(normalized));
    if (!options.silent) emitChange();
    return normalized;
  }

  function updateState(mutator, options = {}) {
    const state = loadState();
    const result = mutator(state);
    saveState(state, options);
    return result;
  }

  function loadSessions() {
    try {
      const raw = getStorage().getItem(SESSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveSessions(sessions) {
    getStorage().setItem(SESSIONS_KEY, JSON.stringify(sessions));
    emitChange();
  }

  function emitChange() {
    if (typeof document !== "undefined" && typeof CustomEvent !== "undefined") {
      document.dispatchEvent(new CustomEvent("planner:data-changed"));
    }
  }

  function getItem(state, type, id) {
    if (!id) return null;
    if (type === "course") return state.courses.find((c) => c.id === id) || null;
    if (type === "book") return state.books.find((b) => b.id === id) || null;
    if (type === "task") return state.tasks.find((t) => t.id === id) || null;
    return null;
  }

  function itemColor(state, type, refId) {
    const item = getItem(state, type, refId);
    return item ? item.color : COLORS[type] || COLORS.general;
  }

  function computeCourseProgress(state, course, sessions) {
    const relevant = sessions.filter((s) => s.courseId === course.id);
    const chapterIds = new Set(course.chapters.map((c) => c.id));
    let chapterDoneTotal = 0;
    const chapters = course.chapters.map((chapter) => {
      const linked = relevant
        .filter((s) => s.chapterId === chapter.id)
        .reduce((sum, s) => sum + toNumber(s.durationMin, 0), 0);
      const doneMin = clamp(roundMinutes(linked), 0, chapter.durationMin);
      chapterDoneTotal += doneMin;
      return {
        ...chapter,
        doneMin,
        remainingMin: Math.max(0, chapter.durationMin - doneMin),
        percent: chapter.durationMin > 0 ? Math.min(100, (doneMin / chapter.durationMin) * 100) : 0,
      };
    });
    const generalDone = relevant
      .filter((s) => !s.chapterId || !chapterIds.has(s.chapterId))
      .reduce((sum, s) => sum + toNumber(s.durationMin, 0), 0);
    const doneMin = clamp(roundMinutes(chapterDoneTotal + generalDone), 0, course.totalMinutes);
    return {
      totalMin: course.totalMinutes,
      doneMin,
      remainingMin: Math.max(0, course.totalMinutes - doneMin),
      percent: course.totalMinutes > 0 ? Math.min(100, (doneMin / course.totalMinutes) * 100) : 0,
      chapters,
    };
  }

  function computeBookProgress(state, book, sessions) {
    const relevant = sessions.filter((s) => s.bookId === book.id && toNumber(s.endTime, 0) > book.baseAt);
    const minutes = relevant.reduce((sum, s) => sum + toNumber(s.durationMin, 0), 0);
    const pagesFromSessions = book.minutesPerPage > 0 ? minutes / book.minutesPerPage : 0;
    const currentPage = clamp(Math.round(book.basePage + pagesFromSessions), 0, book.totalPages);
    const remainingPages = Math.max(0, book.totalPages - currentPage);
    return {
      totalPages: book.totalPages,
      currentPage,
      pagesRead: currentPage,
      remainingPages,
      remainingMin: Math.round(remainingPages * book.minutesPerPage),
      percent: book.totalPages > 0 ? Math.min(100, (currentPage / book.totalPages) * 100) : 0,
      minutes: roundMinutes(minutes),
    };
  }

  function computeTaskProgress(state, task, sessions) {
    const done = sessions
      .filter((s) => s.taskId === task.id)
      .reduce((sum, s) => sum + toNumber(s.durationMin, 0), 0);
    const doneMin = clamp(roundMinutes(done), 0, task.estimateMin);
    return {
      totalMin: task.estimateMin,
      doneMin,
      remainingMin: Math.max(0, task.estimateMin - doneMin),
      percent: task.estimateMin > 0 ? Math.min(100, (doneMin / task.estimateMin) * 100) : 0,
    };
  }

  function computeProgress(state, type, item, sessions) {
    if (type === "course") return computeCourseProgress(state, item, sessions);
    if (type === "book") return computeBookProgress(state, item, sessions);
    if (type === "task") return computeTaskProgress(state, item, sessions);
    return { percent: 0, remainingMin: 0, doneMin: 0, totalMin: 0 };
  }

  function listItems(state) {
    return [
      ...state.courses.map((item) => ({ type: "course", item })),
      ...state.books.map((item) => ({ type: "book", item })),
      ...state.tasks.map((item) => ({ type: "task", item })),
    ];
  }

  function itemRemaining(state, type, item, sessions) {
    return computeProgress(state, type, item, sessions).remainingMin;
  }

  function validateCourse(input) {
    const errors = [];
    if (!input || !String(input.title || "").trim()) errors.push("Course title is required.");
    const total = Math.round(toNumber(input && input.totalMinutes, 0));
    if (!Number.isFinite(total) || total <= 0) errors.push("Total duration must be greater than zero.");
    if (total > 100000) errors.push("Total duration is too large.");
    if (input && input.deadline && !isValidDateKey(input.deadline)) errors.push("Deadline is not a valid date.");
    const chapters = Array.isArray(input && input.chapters) ? input.chapters : [];
    let chapterTotal = 0;
    chapters.forEach((chapter, index) => {
      if (!String(chapter.title || "").trim()) errors.push(`Chapter ${index + 1} needs a title.`);
      const duration = Math.round(toNumber(chapter.durationMin, 0));
      if (duration <= 0) errors.push(`Chapter ${index + 1} duration must be greater than zero.`);
      chapterTotal += Math.max(0, duration);
    });
    if (chapterTotal > total) errors.push("Chapter durations cannot exceed the course total duration.");
    return errors;
  }

  function validateBook(input) {
    const errors = [];
    if (!input || !String(input.title || "").trim()) errors.push("Book title is required.");
    const totalPages = Math.round(toNumber(input && input.totalPages, 0));
    if (totalPages <= 0) errors.push("Total pages must be greater than zero.");
    const currentPage = Math.round(toNumber(input && input.currentPage, 0));
    if (currentPage < 0 || currentPage > totalPages) errors.push("Current page must be between 0 and total pages.");
    const minutesPerPage = toNumber(input && input.minutesPerPage, 0);
    if (minutesPerPage <= 0) errors.push("Minutes per page must be greater than zero.");
    if (input && input.deadline && !isValidDateKey(input.deadline)) errors.push("Deadline is not a valid date.");
    return errors;
  }

  function validateTask(input) {
    const errors = [];
    if (!input || !String(input.title || "").trim()) errors.push("Task title is required.");
    const estimate = Math.round(toNumber(input && input.estimateMin, 0));
    if (estimate <= 0) errors.push("Estimated duration must be greater than zero.");
    if (input && input.dueDate && !isValidDateKey(input.dueDate)) errors.push("Due date is not a valid date.");
    return errors;
  }

  function activeEventsForDate(state, date) {
    return state.events.filter(
      (e) => e.date === date && !["cancelled", "rescheduled"].includes(e.status)
    );
  }

  function findConflicts(state, candidate, ignoreId) {
    if (!candidate || candidate.flexible || candidate.startMin === null || candidate.endMin === null) return [];
    return state.events.filter((event) => {
      if (event.id === ignoreId) return false;
      if (event.flexible) return false;
      if (event.date !== candidate.date) return false;
      if (["cancelled", "rescheduled", "missed"].includes(event.status)) return false;
      return event.startMin < candidate.endMin && event.endMin > candidate.startMin;
    });
  }

  function refreshStatuses(state, sessions, now = Date.now()) {
    let changed = false;
    state.events.forEach((event) => {
      if (event.status !== "scheduled") return;
      if (eventEndMs(event) >= now) return;
      const actual = eventActualMinutes(event.id, sessions);
      if (actual > 0) {
        event.status = actual >= event.plannedMin - 0.5 ? "completed" : "partial";
      } else {
        event.status = "missed";
      }
      event.updatedAt = now;
      changed = true;
    });
    return changed;
  }

  function plannedMinutesForDate(state, date) {
    return state.events
      .filter((e) => e.date === date && !["cancelled", "rescheduled"].includes(e.status))
      .reduce((sum, e) => sum + toNumber(e.plannedMin, 0), 0);
  }

  function actualMinutesForDate(sessions, date) {
    return roundMinutes(
      sessions
        .filter((s) => toDateKey(toNumber(s.endTime, 0)) === date)
        .reduce((sum, s) => sum + toNumber(s.durationMin, 0), 0)
    );
  }

  function upcomingEvents(state, now = Date.now(), limit = 5) {
    return state.events
      .filter((e) => e.status === "scheduled" && eventEndMs(e) >= now)
      .sort((a, b) => {
        const aTime = eventStartMs(a) || eventEndMs(a);
        const bTime = eventStartMs(b) || eventEndMs(b);
        return aTime - bTime;
      })
      .slice(0, limit);
  }

  function dateRangeKeys(startKey, endKey) {
    const keys = [];
    let cursor = startKey;
    let guard = 0;
    while (cursor <= endKey && guard < 3660) {
      keys.push(cursor);
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    return keys;
  }

  function itemTypeLabel(type) {
    if (type === "course") return "Course";
    if (type === "book") return "Book";
    if (type === "task") return "Task";
    return "Study";
  }

  global.Planner = global.Planner || {};
  global.Planner.Store = {
    STORAGE_KEY,
    SESSIONS_KEY,
    SCHEMA_VERSION,
    COLORS,
    TYPES,
    STATUSES,
    ACTIVE_STATUSES,
    DAY_MS,
    getStorage,
    setStorage,
    createId,
    clamp,
    toNumber,
    roundMinutes,
    defaultSettings,
    defaultState,
    normalizeState,
    loadState,
    saveState,
    updateState,
    loadSessions,
    saveSessions,
    emitChange,
    toDateKey,
    dateKeyToDate,
    isValidDateKey,
    addDays,
    weekdayIndex,
    startOfWeekKey,
    weekKeys,
    monthGridKeys,
    nowMinutes,
    parseTimeToMin,
    fmtTime,
    fmtDuration,
    fmtDateShort,
    fmtDateLong,
    fmtMonth,
    eventDateTime,
    eventStartMs,
    eventEndMs,
    eventActualMinutes,
    effectiveStatus,
    normalizeColor,
    getItem,
    itemColor,
    computeProgress,
    computeCourseProgress,
    computeBookProgress,
    computeTaskProgress,
    listItems,
    itemRemaining,
    validateCourse,
    validateBook,
    validateTask,
    activeEventsForDate,
    findConflicts,
    refreshStatuses,
    plannedMinutesForDate,
    actualMinutesForDate,
    upcomingEvents,
    dateRangeKeys,
    itemTypeLabel,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = global.Planner;
})(typeof globalThis !== "undefined" ? globalThis : this);
