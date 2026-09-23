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

// ---- State ----
let mode = "pomodoro";
let running = false;
let paused = false;
let totalSeconds = MODES.pomodoro.minutes * 60;
let remainingSeconds = totalSeconds;
let cycleCount = 0; // completed pomodoros in current cycle
let timerId = null;
let deadline = 0;
let audioContext = null;

// ---- DOM refs ----
const $ = (id) => document.getElementById(id);
const timeDisplay = $("timeDisplay");
const sessionLabel = $("sessionLabel");
const ringFg = document.querySelector(".ring-fg");
const startBtn = $("startBtn");
const taskInput = $("taskInput");
const cycleEl = $("cycleCount");

// ---- Storage helpers ----
function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

// ---- Time helpers ----
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

// ---- Ring ----
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
}

// ---- Timer engine (deadline-based, smooth) ----
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

function startTimer() {
  if (running) return;
  unlockAudio();
  running = true;
  paused = false;
  if (remainingSeconds <= 0) {
    remainingSeconds = totalSeconds;
  }
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
  document.body.classList.remove("mode-short", "mode-long");
  document.body.classList.add(MODES[mode].bodyClass);
  renderRing();
  renderTimer();
  // tab active state
  document.querySelectorAll(".mode-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.mode === mode);
  });
}

// ---- Session completion ----
function completeSession() {
  clearTimeout(timerId);
  timerId = null;
  running = false;
  paused = false;
  startBtn.textContent = "Start";

  const now = Date.now();

  if (mode === "pomodoro") {
    const durationMin = MODES.pomodoro.minutes;
    const session = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      task: taskInput.value.trim() || "Focus session",
      startTime: now - durationMin * 60 * 1000,
      endTime: now,
      durationMin: durationMin,
      mode: "pomodoro",
    };
    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);
    updateStats();

    const streak = calcStreak(sessions);
    if (!streakNotifyToday()) {
      markStreakNotified();
      if (streak >= 2) {
        notify(`Day ${streak} streak! 🔥`, "Keep the momentum going.");
      } else {
        notify("Streak started! 🔥", "Come back tomorrow to keep it alive.");
      }
    }

    cycleCount += 1;
    cycleEl.textContent = cycleCount;
    notify("Pomodoro complete 🎉", `Nice work — ${fmtHours(durationMin)} focused.`);
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
}

function autoStartBreak(title, body) {
  setTimeout(() => {
    notify(title, body);
    playChime();
    startTimer();
  }, 1200);
}

// ---- Notification + sound ----
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

// ---- Stats on timer view ----
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

// ---- History view ----
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
    dur.textContent = `${s.durationMin} min`;

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

// ---- Export ----
function exportCsv() {
  const sessions = loadSessions();
  if (sessions.length === 0) {
    alert("No sessions to export.");
    return;
  }
  const rows = [
    ["Task", "Date", "Start", "End", "Minutes", "Hours"],
    ...sessions.map((s) => [
      `"${(s.task || "").replace(/"/g, '""')}"`,
      new Date(s.endTime).toISOString().slice(0, 10),
      new Date(s.startTime).toISOString(),
      new Date(s.endTime).toISOString(),
      s.durationMin,
      (s.durationMin / 60).toFixed(3),
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

// ---- View switching ----
function showView(view) {
  const timer = $("timerView");
  const history = $("historyView");
  const isTimer = view === "timer";
  timer.classList.toggle("hidden", !isTimer);
  history.classList.toggle("hidden", isTimer);
  $("viewTimer").classList.toggle("active", isTimer);
  $("viewHistory").classList.toggle("active", !isTimer);
  if (!isTimer) renderHistory();
}

// ---- Events ----
document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
});

startBtn.addEventListener("click", () => {
  if (running) {
    pauseTimer();
  } else {
    startTimer();
  }
});

$("resetBtn").addEventListener("click", resetTimer);
$("skipBtn").addEventListener("click", () => {
  remainingSeconds = 0;
  renderRing();
  renderTimer();
  completeSession();
});

$("viewTimer").addEventListener("click", () => showView("timer"));
$("viewHistory").addEventListener("click", () => showView("history"));
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

document.addEventListener("keydown", (e) => {
  if (e.target === taskInput) return;
  if (e.code === "Space") {
    e.preventDefault();
    startBtn.click();
  } else if (e.code === "KeyR") {
    resetTimer();
  }
});

// ---- Init ----
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission();
}

switchMode("pomodoro");
updateStats();
renderHistory();