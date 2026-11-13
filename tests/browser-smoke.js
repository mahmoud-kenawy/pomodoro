"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const smokePath = path.join(root, "smoke.html");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pomodoro-smoke-"));

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.log("No Chrome or Edge installation found; skipping browser smoke test.");
  process.exit(0);
}

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace(
  "<head>",
  '<head><script>window.__smokeErrors=[];window.addEventListener("error",function(event){window.__smokeErrors.push(event.message);});</script>'
);
const smokeScript = `
<script>
setTimeout(function () {
  var results = [];
  function check(name, fn) {
    try {
      fn();
      results.push("PASS " + name);
    } catch (error) {
      results.push("FAIL " + name + ": " + (error && error.message ? error.message : error));
    }
  }
  var P = window.Planner;
  var today = P.Store.toDateKey(new Date());
  var tomorrow = P.Store.addDays(today, 1);
  var eventId = "event_smoke";
  var courseId = "course_smoke";
  var chapterId = "chapter_smoke";

  check("modules loaded", function () {
    if (!P || !P.Store || !P.UI || !P.Learning || !P.Calendar || !P.Scheduler || !P.Dashboard || !P.Analytics) throw new Error("missing module");
    if (typeof P.startFocus !== "function") throw new Error("timer integration missing");
  });

  var state = P.Store.defaultState();
  state.courses = [{
    id: courseId,
    title: "Smoke Course",
    color: "#58a6ff",
    deadline: P.Store.addDays(today, 10),
    totalMinutes: 120,
    chapters: [{ id: chapterId, title: "Smoke Chapter", durationMin: 120 }],
    createdAt: Date.now()
  }];
  state.books = [{
    id: "book_smoke",
    title: "Smoke Book",
    color: "#3fb950",
    deadline: null,
    totalPages: 100,
    basePage: 10,
    baseAt: Date.now() - 1000,
    minutesPerPage: 2,
    createdAt: Date.now()
  }];
  state.tasks = [{
    id: "task_smoke",
    title: "Smoke Task",
    color: "#d29922",
    dueDate: tomorrow,
    estimateMin: 45,
    createdAt: Date.now()
  }];
  state.events = [{
    id: eventId,
    title: "Smoke Course · Smoke Chapter",
    type: "course",
    refId: courseId,
    chapterId: chapterId,
    date: tomorrow,
    flexible: false,
    startMin: 600,
    endMin: 660,
    plannedMin: 60,
    status: "scheduled",
    source: "manual",
    notes: "",
    createdAt: Date.now(),
    updatedAt: Date.now()
  }];
  P.Store.saveState(state);
  P.Store.saveSessions([{
    id: "session_smoke",
    task: "Smoke focus",
    startTime: Date.now() - 600000,
    endTime: Date.now(),
    durationMin: 10,
    mode: "pomodoro",
    partial: false,
    contextType: "course",
    courseId: courseId,
    chapterId: chapterId,
    eventId: eventId
  }]);

  check("localStorage persistence", function () {
    var loaded = P.Store.loadState();
    if (loaded.courses.length !== 1 || loaded.courses[0].id !== courseId) throw new Error("state did not persist");
    if (P.Store.loadSessions().length !== 1) throw new Error("sessions did not persist");
  });

  check("course progress uses linked sessions", function () {
    var loaded = P.Store.loadState();
    var progress = P.Store.computeCourseProgress(loaded, loaded.courses[0], P.Store.loadSessions());
    if (progress.doneMin !== 10) throw new Error("expected 10 done, got " + progress.doneMin);
  });

  check("library renders cards", function () {
    document.getElementById("viewLibrary").click();
    if (document.getElementById("libraryView").classList.contains("hidden")) throw new Error("library hidden");
    if (document.querySelectorAll(".learning-card").length !== 1) throw new Error("expected one course card");
    if (!document.getElementById("librarySubtitle").textContent.includes("course")) throw new Error("subtitle not rendered");
  });

  check("library tabs render books and tasks", function () {
    var tabs = [...document.querySelectorAll(".learning-tab")];
    var books = tabs.find(function (tab) { return tab.textContent.includes("Books"); });
    books.click();
    if (document.querySelectorAll(".learning-card").length !== 1) throw new Error("book card missing");
    var tasks = [...document.querySelectorAll(".learning-tab")].find(function (tab) { return tab.textContent.includes("Tasks"); });
    tasks.click();
    if (!document.querySelector(".learning-card").textContent.includes("Smoke Task")) throw new Error("task card missing");
  });

  check("calendar week renders events", function () {
    document.getElementById("viewCalendar").click();
    if (!document.querySelector(".cal-time-grid")) throw new Error("week grid missing");
    if (!document.querySelector(".cal-event")) throw new Error("event chip missing");
    if (document.querySelectorAll(".unscheduled-row").length < 2) throw new Error("unscheduled items missing");
  });

  check("calendar switches month and day views", function () {
    var month = [...document.querySelectorAll(".cal-tab")].find(function (tab) { return tab.textContent === "Month"; });
    month.click();
    if (!document.querySelector(".cal-month-grid")) throw new Error("month grid missing");
    var day = [...document.querySelectorAll(".cal-tab")].find(function (tab) { return tab.textContent === "Day"; });
    day.click();
    if (!document.querySelector(".cal-time-grid")) throw new Error("day grid missing");
  });

  check("scheduler produces conflict-free preview", function () {
    var loaded = P.Store.loadState();
    var preview = P.Scheduler.generateSchedule(loaded, P.Store.loadSessions(), {
      startDate: tomorrow,
      deadline: P.Store.addDays(today, 5),
      dailyGoalMin: 120,
      sessionMin: 50,
      studyStartMin: 9 * 60,
      studyEndMin: 12 * 60,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
      selectedItems: [{ type: "course", item: loaded.courses[0] }]
    });
    if (!preview.events.length) throw new Error("no preview events");
    var total = preview.events.reduce(function (sum, event) { return sum + event.plannedMin; }, 0);
    if (total !== 110) throw new Error("expected 110 minutes, got " + total);
    for (var i = 0; i < preview.events.length; i += 1) {
      var event = preview.events[i];
      if (event.startMin < 540 || event.endMin > 720) throw new Error("outside study window");
      if (event.date === tomorrow && event.startMin < 660 && event.endMin > 600) throw new Error("conflicts with existing event");
    }
  });

  check("dashboard renders goal and upcoming data", function () {
    document.getElementById("viewDashboard").click();
    var content = document.getElementById("dashboardContent").textContent;
    if (!content.includes("Today")) throw new Error("goal missing");
    if (!content.includes("Upcoming sessions")) throw new Error("upcoming missing");
    if (!content.includes("Smoke Course")) throw new Error("active course missing");
  });

  check("analytics renders charts and progress", function () {
    document.getElementById("viewAnalytics").click();
    if (!document.querySelector(".analytics-chart")) throw new Error("analytics chart missing");
    if (!document.querySelector(".weekly-table")) throw new Error("weekly table missing");
    if (!document.getElementById("analyticsContent").textContent.includes("Smoke Course")) throw new Error("learning progress missing");
  });

  check("history renders linked sessions", function () {
    document.getElementById("viewHistory").click();
    if (!document.getElementById("sessionList").textContent.includes("Smoke focus")) throw new Error("session missing");
    if (!document.getElementById("sumCount").textContent.includes("1")) throw new Error("summary count missing");
  });

  check("calendar start-focus links event to timer", function () {
    P.startFocus(eventId);
    if (document.getElementById("timerView").classList.contains("hidden")) throw new Error("timer view not shown");
    if (!document.getElementById("focusContextBadge").textContent.includes("Smoke Course")) throw new Error("context badge missing");
    if (document.getElementById("startBtn").textContent !== "Pause") throw new Error("timer did not start");
    document.getElementById("resetBtn").click();
    if (document.getElementById("startBtn").textContent !== "Start") throw new Error("timer did not reset");
  });

  check("plan-session modal preloads the learning item", function () {
    P.Calendar.openEventModal({ type: "course", refId: courseId });
    var form = document.querySelector(".event-form");
    if (!form) throw new Error("event form missing");
    var selects = form.querySelectorAll("select");
    if (selects[1].value !== courseId) throw new Error("learning item was not selected");
    var title = form.querySelector("input[type=text]");
    if (!title.value.includes("Smoke Course")) throw new Error("title was not preloaded");
    P.UI.closeModal();
  });

  check("auto-scheduler UI preview and confirmation add events", function () {
    var before = P.Store.loadState().events.length;
    P.Scheduler.open({ startDate: tomorrow });
    var buttons = [...document.querySelectorAll("#modalBody button")];
    var generate = buttons.find(function (button) { return button.textContent === "Generate preview"; });
    if (!generate) throw new Error("generate button missing");
    generate.click();
    var previewBox = document.querySelector(".schedule-preview");
    if (!previewBox || previewBox.classList.contains("hidden")) throw new Error("preview not shown");
    var confirm = [...document.querySelectorAll("#modalBody button")].find(function (button) {
      return button.textContent.indexOf("Add ") === 0 && !button.classList.contains("hidden");
    });
    if (!confirm) throw new Error("confirm button missing");
    confirm.click();
    var after = P.Store.loadState().events.length;
    if (after <= before) throw new Error("scheduler did not add events");
  });

  check("rescheduling keeps the original event and adds replacements", function () {
    var missedId = "event_missed_smoke";
    var yesterday = P.Store.addDays(today, -1);
    P.Store.updateState(function (state) {
      var normalized = P.Store.normalizeState({
        ...P.Store.defaultState(),
        events: [{
          id: missedId,
          title: "Smoke Task counting",
          type: "task",
          refId: "task_smoke",
          date: yesterday,
          flexible: false,
          startMin: 600,
          endMin: 660,
          plannedMin: 60,
          status: "scheduled",
          source: "manual"
        }]
      }).events[0];
      state.events.push(normalized);
    });
    P.Scheduler.openReschedule(missedId);
    var generate = [...document.querySelectorAll("#modalBody button")].find(function (button) {
      return button.textContent === "Generate preview";
    });
    generate.click();
    var confirm = [...document.querySelectorAll("#modalBody button")].find(function (button) {
      return button.textContent.indexOf("Add ") === 0 && !button.classList.contains("hidden");
    });
    if (!confirm) throw new Error("reschedule confirm missing");
    confirm.click();
    var state = P.Store.loadState();
    var original = state.events.find(function (event) { return event.id === missedId; });
    if (!original) throw new Error("original event was deleted");
    if (original.status !== "rescheduled") throw new Error("expected rescheduled status, got " + original.status);
    var replacements = state.events.filter(function (event) { return event.rescheduledFrom === missedId; });
    if (!replacements.length) throw new Error("no replacement events created");
  });

  check("partial focus is recorded and updates event progress", function () {
    var realNow = Date.now;
    var offset = 0;
    Date.now = function () { return realNow() + offset; };
    try {
      var beforeSessions = P.Store.loadSessions().length;
      P.startFocus(eventId);
      offset = 120000;
      document.getElementById("skipBtn").click();
      var sessions = P.Store.loadSessions();
      if (sessions.length !== beforeSessions + 1) throw new Error("partial session was not saved");
      var last = sessions[sessions.length - 1];
      if (Math.abs(last.durationMin - 2) > 0.01) throw new Error("expected 2 focused minutes, got " + last.durationMin);
      var event = P.Store.loadState().events.find(function (item) { return item.id === eventId; });
      if (!event || event.status !== "partial") throw new Error("event status was not updated to partial");
      document.getElementById("resetBtn").click();
    } finally {
      Date.now = realNow;
    }
  });

  check("course total duration uses hours and minutes", function () {
    var course = P.Store.loadState().courses[0];
    P.Learning.openCourseModal(course);
    var form = document.querySelector(".stack-form");
    var hours = form.querySelector(".course-hours-input");
    var minutes = form.querySelector(".course-minutes-input");
    if (!hours || !minutes) throw new Error("hours/minutes fields missing");
    if (hours.value !== "2" || minutes.value !== "0") throw new Error("existing duration was not split correctly");
    P.UI.closeModal();

    P.Learning.openCourseModal(null);
    form = document.querySelector(".stack-form");
    form.querySelector("input[type=text]").value = "Duration Smoke";
    form.querySelector(".course-hours-input").value = "1";
    form.querySelector(".course-minutes-input").value = "30";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    var created = P.Store.loadState().courses.find(function (item) { return item.title === "Duration Smoke"; });
    if (!created || created.totalMinutes !== 90) throw new Error("expected 90 total minutes");
    P.Store.updateState(function (state) {
      state.courses = state.courses.filter(function (item) { return item.id !== created.id; });
    });
  });

  check("no runtime errors", function () {
    if (window.__smokeErrors.length) throw new Error(window.__smokeErrors.join(" | "));
  });

  var result = document.createElement("pre");
  result.id = "smokeResults";
  result.textContent = results.join("\\n");
  document.body.appendChild(result);
}, 400);
</script>`;
html = html.replace("</body>", smokeScript + "</body>");
fs.writeFileSync(smokePath, html);

try {
  const output = execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      `--user-data-dir=${profile}`,
      "--virtual-time-budget=6000",
      "--dump-dom",
      pathToFileURL(smokePath).href,
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 30000 }
  );
  const match = output.match(/<pre id="smokeResults">([\s\S]*?)<\/pre>/);
  if (!match) {
    console.error("Smoke results were not found in the page output.");
    console.error(output.slice(-4000));
    process.exitCode = 1;
  } else {
    const text = match[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    console.log(text);
    if (text.includes("FAIL ")) process.exitCode = 1;
  }
} finally {
  fs.rmSync(smokePath, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
