"use strict";

const MODES = {
  pomodoro: { label: "Pomodoro", minutes: 25, shortLabel: "Focus", bodyClass: "mode-short" },
  short: { label: "Short break", minutes: 5, shortLabel: "Short break", bodyClass: "mode-short" },
  long: { label: "Long break", minutes: 15, shortLabel: "Long break", bodyClass: "mode-long" },
};

const STORAGE_KEY = "pomodoro.sessions.v1";
const STREAK_KEY = "pomodoro.streakNotified.v1";
const LONG_BREAK_CYCLE = 4;
const CIRC = 2 * Math.PI * 150;

let mode = "pomodoro";
let running = false;
let paused = false;
let totalSeconds = MODES.pomodoro.minutes * 60;
let remainingSeconds = totalSeconds;
let cycleCount = 0;
let timerId = null;
let deadline = 0;
let audioContext = null;
let focusRecorded = false;
let activeContext = null;
let sessionContext = null;

const $ = (id) => document.getElementById(id);
const timeDisplay = $("timeDisplay");
const sessionLabel = $("sessionLabel");
const ringFg = document.querySelector(".ring-fg");
const startBtn = $("startBtn");
const taskInput = $("taskInput");
const cycleEl = $("cycleCount");
const focusLink = $("focusLink");
const clearEventContextBtn = $("clearEventContext");
const focusContextBadge = $("focusContextBadge");
const appShell = $("appShell");

function loadSessions() {
  try {
    if (window.Planner && Planner.Store) return Planner.Store.loadSessions();
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  if (window.Planner && Planner.Store) {
    Planner.Store.saveSessions(sessions);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function fmtHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function fmtClock(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtMMSS(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function minutesInDay(sessions, dayStart) {
  return sessions
    .filter((s) => startOfDay(s.endTime) === dayStart)
    .reduce((acc, s) => acc + s.durationMin, 0);
}

function calcStreak(sessions) {
  const DAY = 24 * 3600 * 1000;
  const activeDays = new Set(sessions.map((s) => startOfDay(s.endTime)));
  const today = startOfDay(Date.now());
  let day = activeDays.has(today) ? today : today - DAY;
  let streak = 0;
  while (activeDays.has(day)) {
    streak += 1;
    day -= DAY;
  }
  return streak;
}

function calcLongestStreak(sessions) {
  const DAY = 24 * 3600 * 1000;
  const activeDays = [...new Set(sessions.map((s) => startOfDay(s.endTime)))].sort((a, b) => a - b);
  let longest = 0;
  let cur = 0;
  let prev = null;
  for (const d of activeDays) {
    cur = prev !== null && d - prev === DAY ? cur + 1 : 1;
    prev = d;
    if (cur > longest) longest = cur;
  }
  return longest;
}

function streakNotifyToday() {
  return localStorage.getItem(STREAK_KEY) === String(startOfDay(Date.now()));
}

function markStreakNotified() {
  localStorage.setItem(STREAK_KEY, String(startOfDay(Date.now())));
}

function renderRing(smooth) {
  const totalMs = totalSeconds * 1000;
  let ratio;
  if (smooth && deadline) {
    ratio = Math.max(0, (deadline - Date.now()) / totalMs);
  } else {
    ratio = totalMs > 0 ? remainingSeconds / totalSeconds : 0;
  }
  ringFg.style.strokeDashoffset = String(CIRC * (1 - Math.min(1, ratio)));
}

function renderTimer() {
  timeDisplay.textContent = fmtMMSS(remainingSeconds);
  sessionLabel.textContent = running || paused ? "In progress" : MODES[mode].shortLabel;
  syncContextControls();
}

function tick() {
  const now = Date.now();
  const remainingMs = deadline - now;

  if (remainingMs <= 0) {
    remainingSeconds = 0;
    renderRing();
    renderTimer();
    completeSession();
    return;
  }

  remainingSeconds = Math.ceil(remainingMs / 1000);
  renderRing(true);
  renderTimer();

  timerId = setTimeout(tick, 50);
}

function currentElapsedSeconds() {
  if (running && deadline) {
    return Math.min(totalSeconds, Math.max(0, totalSeconds - Math.ceil((deadline - Date.now()) / 1000)));
  }
  return Math.min(totalSeconds, Math.max(0, totalSeconds - remainingSeconds));
}

function startTimer() {
  if (running) return;
  unlockAudio();
  if (remainingSeconds <= 0) {
    remainingSeconds = totalSeconds;
  }
  if (!paused && remainingSeconds === totalSeconds) {
    sessionContext = activeContext ? { ...activeContext } : null;
    focusRecorded = false;
  }
  running = true;
  paused = false;
  deadline = Date.now() + remainingSeconds * 1000;
  startBtn.textContent = "Pause";
  renderRing();
  renderTimer();
  timerId = setTimeout(tick, 50);
}

function pauseTimer() {
  if (!running) return;
  running = false;
  paused = true;
  clearTimeout(timerId);
  timerId = null;
  remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  startBtn.textContent = "Resume";
  renderRing();
  renderTimer();
}

function resetTimer() {
  running = false;
  paused = false;
  clearTimeout(timerId);
  timerId = null;
  remainingSeconds = totalSeconds;
  startBtn.textContent = "Start";
  focusRecorded = false;
  sessionContext = null;
  renderRing();
  renderTimer();
}

function switchMode(newMode) {
  mode = newMode;
  clearTimeout(timerId);
  timerId = null;
  running = false;
  paused = false;
  totalSeconds = MODES[mode].minutes * 60;
  remainingSeconds = totalSeconds;
  startBtn.textContent = "Start";
  focusRecorded = false;
  sessionContext = null;
  document.body.classList.remove("mode-short", "mode-long");
  document.body.classList.add(MODES[mode].bodyClass);
  renderRing();
  renderTimer();
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
}

function contextToSession(context) {
  const data = {};
  if (!context) return data;
  data.contextType = context.type;
  data.refId = context.refId || null;
  if (context.type === "course" && context.refId) {
    data.courseId = context.refId;
    data.chapterId = context.chapterId || null;
  }
  if (context.type === "book" && context.refId) data.bookId = context.refId;
  if (context.type === "task" && context.refId) data.taskId = context.refId;
  if (context.eventId) data.eventId = context.eventId;
  if (context.label) data.linkTitle = context.label;
  return data;
}

function updateEventAfterFocus(eventId) {
  if (!eventId || !window.Planner || !Planner.Store) return;
  const sessionsNow = loadSessions();
  Planner.Store.updateState((state) => {
    const event = state.events.find((item) => item.id === eventId);
    if (!event) return;
    const actual = Planner.Store.eventActualMinutes(eventId, sessionsNow);
    if (actual <= 0) return;
    event.status = actual >= event.plannedMin - 0.5 ? "completed" : "partial";
    event.updatedAt = Date.now();
  });
}

function recordFocusSession(elapsedSeconds, interrupted) {
  if (focusRecorded || mode !== "pomodoro") return null;
  const seconds = Math.max(0, Math.round(elapsedSeconds));
  if (seconds < 30) return null;
  const now = Date.now();
  const minutes = Math.max(0.5, Math.round((seconds / 60) * 10) / 10);
  const context = sessionContext;
  const task =
    taskInput.value.trim() ||
    (context && (context.title || context.label)) ||
    "Focus session";
  const session = {
    id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
    task,
    startTime: now - seconds * 1000,
    endTime: now,
    durationMin: minutes,
    mode: "pomodoro",
    partial: Boolean(interrupted) || minutes < MODES.pomodoro.minutes,
    ...contextToSession(context),
  };
  const sessions = loadSessions();
  sessions.push(session);
  saveSessions(sessions);
  focusRecorded = true;
  updateEventAfterFocus(context && context.eventId);
  updateStats();
  if (!$("historyView").classList.contains("hidden")) renderHistory();
  if (context && context.eventId) {
    UIToast(
      "Focus saved",
      `${fmtHours(minutes)} recorded for ${context.title || "the session"}.`
    );
  }
  clearActiveContext();
  return session;
}

function completeSession(options = {}) {
  clearTimeout(timerId);
  timerId = null;
  running = false;
  paused = false;
  startBtn.textContent = "Start";

  const actualSeconds = options.actualSeconds !== undefined ? options.actualSeconds : totalSeconds;
  const interrupted = Boolean(options.interrupted);

  if (mode === "pomodoro") {
    const saved = recordFocusSession(actualSeconds, interrupted);
    const durationMin = saved ? saved.durationMin : 0;

    const sessions = loadSessions();
    const streak = calcStreak(sessions);
    if (saved && !streakNotifyToday()) {
      markStreakNotified();
      if (streak >= 2) {
        notify(`Day ${streak} streak! 🔥`, "Keep the momentum going.");
      } else {
        notify("Streak started! 🔥", "Come back tomorrow to keep it alive.");
      }
    }

    cycleCount += 1;
    cycleEl.textContent = cycleCount;
    if (saved) {
      notify(
        interrupted ? "Focus saved" : "Pomodoro complete 🎉",
        `Nice work — ${fmtHours(durationMin)} focused.`
      );
    } else {
      notify("Session ended", "No focus time was recorded.");
    }
    playChime();

    if (cycleCount >= LONG_BREAK_CYCLE) {
      cycleCount = 0;
      cycleEl.textContent = cycleCount;
      switchMode("long");
      autoStartBreak("Long break", "Take a longer rest.");
    } else {
      switchMode("short");
      autoStartBreak("Short break", "Well deserved pause.");
    }
  } else {
    playChime();
    notify("Break over", "Time to focus.");
    switchMode("pomodoro");
  }

  sessionLabel.textContent = "Complete";
  timeDisplay.textContent = "00:00";
  syncContextControls();
}

function autoStartBreak(title, body) {
  setTimeout(() => {
    notify(title, body);
    playChime();
    startTimer();
  }, 1200);
}

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext || audioContext.state === "closed") {
    try {
      audioContext = new AudioContextClass();
    } catch (error) {
      console.warn("Timer audio is unavailable.", error);
      return null;
    }
  }
  return audioContext;
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch((error) => {
      console.warn("Unable to unlock timer audio.", error);
    });
  }
}

function playChime() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const scheduleChime = () => {
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.4);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.5);
    });
  };

  if (ctx.state === "suspended") {
    ctx.resume().then(scheduleChime).catch((error) => {
      console.warn("Unable to play timer audio.", error);
    });
    return;
  }

  scheduleChime();
}

function UIToast(title, body) {
  if (window.Planner && Planner.UI) Planner.UI.toast(`${title}: ${body}`, "success");
}

function updateStats() {
  const sessions = loadSessions();
  const now = Date.now();
  const todayStart = startOfDay(now);
  const today = minutesInDay(sessions, todayStart);
  const total = sessions.reduce((a, s) => a + s.durationMin, 0);
  $("todayHours").textContent = fmtHours(today);
  $("totalHours").textContent = fmtHours(total);
  const s = calcStreak(sessions);
  const best = calcLongestStreak(sessions);
  $("streakCount").textContent = s > 0 ? `${s}` : best > 0 ? `0 · best ${best}` : "0";
}

function renderHistory() {
  const sessions = loadSessions();
  const now = Date.now();
  const todayStart = startOfDay(now);
  const weekStart = todayStart - 6 * 24 * 3600 * 1000;

  const total = sessions.reduce((a, s) => a + s.durationMin, 0);
  const today = minutesInDay(sessions, todayStart);
  const week = sessions
    .filter((s) => s.endTime >= weekStart && s.endTime <= now)
    .reduce((a, s) => a + s.durationMin, 0);

  $("sumTotal").textContent = fmtHours(total);
  $("sumToday").textContent = fmtHours(today);
  $("sumWeek").textContent = fmtHours(week);
  $("sumCount").textContent = sessions.length;
  const s = calcStreak(sessions);
  const best = calcLongestStreak(sessions);
  $("sumStreak").textContent = s > 0 ? `${s} 🔥` : best > 0 ? `Best ${best} 🔥` : "0";

  renderChart(sessions, todayStart);
  renderList(sessions);
}

function renderChart(sessions, todayStart) {
  const chart = $("chart");
  chart.innerHTML = "";

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * 24 * 3600 * 1000;
    const min = minutesInDay(sessions, dayStart);
    days.push({ dayStart, min });
  }

  const maxMin = Math.max(...days.map((d) => d.min), 1);

  days.forEach((d) => {
    const col = document.createElement("div");
    col.className = "chart-bar-col";

    const track = document.createElement("div");
    track.className = "chart-bar-track";

    const hours = document.createElement("div");
    hours.className = "chart-bar-hours";
    hours.textContent = fmtHours(d.min);

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${(d.min / maxMin) * 100}%`;
    if (d.min === 0) bar.style.height = "2px";
    bar.style.opacity = d.min === 0 ? "0.25" : "1";

    track.appendChild(hours);
    track.appendChild(bar);

    const label = document.createElement("div");
    label.className = "chart-bar-label";
    label.textContent = fmtDate(d.dayStart);

    col.appendChild(track);
    col.appendChild(label);
    chart.appendChild(col);
  });
}

function renderList(sessions) {
  const list = $("sessionList");
  list.innerHTML = "";

  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No sessions yet. Complete a pomodoro to see it here.";
    list.appendChild(empty);
    return;
  }

  const sorted = [...sessions].sort((a, b) => b.endTime - a.endTime);

  sorted.forEach((s) => {
    const row = document.createElement("div");
    row.className = "session-row";

    const task = document.createElement("div");
    task.className = "session-task";
    task.textContent = s.task;
    task.title = s.task;

    const date = document.createElement("div");
    date.className = "session-meta";
    date.textContent = `${fmtDate(s.endTime)} · ${fmtClock(s.startTime)}–${fmtClock(s.endTime)}`;

    const dur = document.createElement("div");
    dur.className = "session-meta";
    dur.textContent = `${s.partial ? "partial · " : ""}${Math.round(s.durationMin)} min`;

    const hours = document.createElement("div");
    hours.className = "session-hours";
    hours.textContent = fmtHours(s.durationMin);

    const del = document.createElement("button");
    del.className = "session-delete";
    del.textContent = "✕";
    del.title = "Delete session";
    del.addEventListener("click", () => {
      const sessionsNow = loadSessions().filter((x) => x.id !== s.id);
      saveSessions(sessionsNow);
      renderHistory();
      updateStats();
    });

    row.appendChild(task);
    row.appendChild(date);
    row.appendChild(dur);
    row.appendChild(hours);
    row.appendChild(del);
    list.appendChild(row);
  });
}

function exportCsv() {
  const sessions = loadSessions();
  if (sessions.length === 0) {
    alert("No sessions to export.");
    return;
  }
  const rows = [
    ["Task", "Date", "Start", "End", "Minutes", "Hours", "Partial", "Event"],
    ...sessions.map((s) => [
      `"${(s.task || "").replace(/"/g, '""')}"`,
      new Date(s.endTime).toISOString().slice(0, 10),
      new Date(s.startTime).toISOString(),
      new Date(s.endTime).toISOString(),
      s.durationMin,
      (s.durationMin / 60).toFixed(3),
      s.partial ? "yes" : "no",
      s.eventId || "",
    ]),
  ];
  download("pomodoro-history.csv", "\ufeff" + rows.map((r) => r.join(",")).join("\r\n"), "text/csv");
}

function exportJson() {
  const sessions = loadSessions();
  if (sessions.length === 0) {
    alert("No sessions to export.");
    return;
  }
  download("pomodoro-history.json", JSON.stringify(sessions, null, 2), "application/json");
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function contextKey(context) {
  if (!context || !context.refId) return "";
  return `${context.type}:${context.refId}`;
}

function refreshFocusLinkOptions() {
  if (!focusLink) return;
  const state = Planner.Store.loadState();
  const current = contextKey(activeContext);
  focusLink.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No course, book, or task";
  focusLink.appendChild(none);
  const groups = [
    ["Courses", state.courses],
    ["Books", state.books],
    ["Tasks", state.tasks],
  ];
  groups.forEach(([label, items]) => {
    if (!items.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = `${item.id}`;
      option.dataset.type = label === "Courses" ? "course" : label === "Books" ? "book" : "task";
      option.textContent = item.title;
      group.appendChild(option);
    });
    focusLink.appendChild(group);
  });
  if (current) {
    const [type, id] = current.split(":");
    const option = [...focusLink.querySelectorAll("option")].find(
      (node) => node.value === id && node.dataset.type === type
    );
    if (option) {
      focusLink.value = id;
    } else {
      activeContext = null;
    }
  } else {
    focusLink.value = "";
  }
  updateContextBadge();
}

function updateContextBadge() {
  if (!focusContextBadge) return;
  if (!activeContext || (!activeContext.refId && !activeContext.eventId)) {
    focusContextBadge.classList.add("hidden");
    focusContextBadge.textContent = "";
    if (clearEventContextBtn) clearEventContextBtn.classList.add("hidden");
    return;
  }
  const parts = [];
  if (activeContext.eventId) parts.push(`Event: ${activeContext.title || "study session"}`);
  if (activeContext.refId) {
    parts.push(`${Planner.UI.typeLabel(activeContext.type)}: ${activeContext.label || activeContext.title || ""}`);
  }
  focusContextBadge.textContent = parts.join(" · ");
  focusContextBadge.classList.remove("hidden");
  if (clearEventContextBtn) {
    clearEventContextBtn.classList.toggle("hidden", !activeContext.eventId);
  }
}

function syncContextControls() {
  if (focusLink) focusLink.disabled = running || paused;
  if (clearEventContextBtn) clearEventContextBtn.disabled = running || paused;
}

function clearActiveContext() {
  activeContext = null;
  if (focusLink) focusLink.value = "";
  updateContextBadge();
}

function setActiveContext(context) {
  activeContext = context;
  refreshFocusLinkOptions();
  updateContextBadge();
}

function startFocusFromEvent(eventId) {
  const state = Planner.Store.loadState();
  const event = state.events.find((item) => item.id === eventId);
  if (!event) {
    Planner.UI.toast("That session no longer exists.", "error");
    return;
  }
  const status = Planner.Store.effectiveStatus(event, loadSessions());
  if (status === "completed") {
    Planner.UI.toast("This session is already complete.", "error");
    return;
  }
  if (running || paused) {
    if (mode === "pomodoro" && !focusRecorded) {
      const elapsed = currentElapsedSeconds();
      if (elapsed >= 30) {
        if (!window.confirm(`Save ${fmtHours(elapsed / 60)} of current focus and start this session?`)) return;
        recordFocusSession(elapsed, true);
      }
    }
    clearTimeout(timerId);
    timerId = null;
    running = false;
    paused = false;
    if (mode !== "pomodoro") switchMode("pomodoro");
  }
  if (mode !== "pomodoro") switchMode("pomodoro");
  resetTimer();
  const item = event.refId ? Planner.Store.getItem(state, event.type, event.refId) : null;
  setActiveContext({
    type: event.type,
    refId: event.refId,
    chapterId: event.chapterId,
    eventId: event.id,
    title: event.title,
    label: item ? item.title : event.title,
  });
  taskInput.value = event.title;
  showView("timer");
  sessionContext = activeContext ? { ...activeContext } : null;
  startTimer();
}

function handleReset() {
  if (mode === "pomodoro" && !focusRecorded) {
    const elapsed = currentElapsedSeconds();
    if (elapsed >= 60) {
      if (!window.confirm(`Save ${fmtHours(elapsed / 60)} of focus before resetting?`)) return;
      recordFocusSession(elapsed, true);
    }
  }
  resetTimer();
}

const VIEWS = {
  timer: "timerView",
  dashboard: "dashboardView",
  calendar: "calendarView",
  library: "libraryView",
  history: "historyView",
  analytics: "analyticsView",
};

function showView(view) {
  if (!VIEWS[view]) return;
  Object.entries(VIEWS).forEach(([key, id]) => {
    const root = $(id);
    if (root) root.classList.toggle("hidden", key !== view);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  appShell.classList.toggle("app-wide", view === "calendar");
  if (view === "history") renderHistory();
  if (view === "library" && Planner.Learning) Planner.Learning.render();
  if (view === "calendar" && Planner.Calendar) Planner.Calendar.render();
  if (view === "dashboard" && Planner.Dashboard) Planner.Dashboard.render();
  if (view === "analytics" && Planner.Analytics) Planner.Analytics.render();
  if (view === "timer") updateStats();
}

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const nextMode = tab.dataset.mode;
    if (nextMode === mode) return;
    if (mode === "pomodoro" && !focusRecorded) {
      const elapsed = currentElapsedSeconds();
      if (elapsed >= 60) {
        if (!window.confirm(`Save ${fmtHours(elapsed / 60)} of focus and switch modes?`)) return;
        recordFocusSession(elapsed, true);
      }
    }
    switchMode(nextMode);
  });
});

startBtn.addEventListener("click", () => {
  if (running) {
    pauseTimer();
  } else {
    startTimer();
  }
});

$("resetBtn").addEventListener("click", handleReset);
$("skipBtn").addEventListener("click", () => {
  const elapsed = mode === "pomodoro" ? currentElapsedSeconds() : 0;
  completeSession({
    actualSeconds: elapsed,
    interrupted: mode === "pomodoro" && elapsed < totalSeconds,
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

$("exportCsv").addEventListener("click", exportCsv);
$("exportJson").addEventListener("click", exportJson);
$("clearAll").addEventListener("click", () => {
  if (loadSessions().length === 0) return;
  if (confirm("Delete ALL sessions? This cannot be undone.")) {
    saveSessions([]);
    renderHistory();
    updateStats();
  }
});

if (focusLink) {
  focusLink.addEventListener("change", () => {
    if (!focusLink.value) {
      clearActiveContext();
      return;
    }
    const option = focusLink.selectedOptions[0];
    const type = option ? option.dataset.type : null;
    const state = Planner.Store.loadState();
    const item = type ? Planner.Store.getItem(state, type, focusLink.value) : null;
    if (!item) {
      clearActiveContext();
      return;
    }
    setActiveContext({
      type,
      refId: item.id,
      chapterId: null,
      eventId: null,
      title: item.title,
      label: item.title,
    });
  });
}

if (clearEventContextBtn) {
  clearEventContextBtn.addEventListener("click", () => {
    if (running || paused) return;
    clearActiveContext();
    refreshFocusLinkOptions();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, button, [contenteditable]")) return;
  if (document.body.classList.contains("modal-open")) return;
  if (e.code === "Space") {
    e.preventDefault();
    startBtn.click();
  } else if (e.code === "KeyR") {
    resetTimer();
  }
});

document.addEventListener("planner:data-changed", () => {
  updateStats();
  refreshFocusLinkOptions();
  if (!$("historyView").classList.contains("hidden")) renderHistory();
});

Planner.startFocus = startFocusFromEvent;
Planner.showView = showView;

if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}

const initialState = Planner.Store.loadState();
const initialSessions = Planner.Store.loadSessions();
if (Planner.Store.refreshStatuses(initialState, initialSessions)) {
  Planner.Store.saveState(initialState, { silent: true });
}

switchMode("pomodoro");
updateStats();
refreshFocusLinkOptions();
showView("timer");
