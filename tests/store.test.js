"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planner = require("../js/store.js");
const Store = Planner.Store;

function baseState(overrides = {}) {
  return {
    ...Store.defaultState(),
    ...overrides,
  };
}

test("date helpers use local calendar dates", () => {
  assert.equal(Store.toDateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(Store.addDays("2026-01-05", 30), "2026-02-04");
  assert.equal(Store.weekdayIndex("2026-01-05"), 1);
  assert.deepEqual(Store.weekKeys("2026-01-07"), [
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
    "2026-01-08",
    "2026-01-09",
    "2026-01-10",
    "2026-01-11",
  ]);
  assert.equal(Store.monthGridKeys("2026-01-15").length, 42);
  assert.equal(Store.parseTimeToMin("18:30"), 1110);
  assert.equal(Store.parseTimeToMin("25:00"), null);
});

test("course validation catches invalid titles, durations, and chapters", () => {
  assert.ok(Store.validateCourse({ title: "", totalMinutes: 0, chapters: [] }).length >= 2);
  const errors = Store.validateCourse({
    title: "Course",
    totalMinutes: 60,
    chapters: [
      { title: "One", durationMin: 40 },
      { title: "Two", durationMin: 40 },
    ],
  });
  assert.ok(errors.some((error) => error.includes("cannot exceed")));
  assert.deepEqual(
    Store.validateCourse({
      title: "Course",
      totalMinutes: 90,
      deadline: "2026-12-01",
      chapters: [{ title: "One", durationMin: 40 }],
    }),
    []
  );
});

test("book and task validation enforce bounds", () => {
  assert.ok(Store.validateBook({ title: "Book", totalPages: 100, currentPage: 101, minutesPerPage: 2 }).length >= 1);
  assert.ok(Store.validateBook({ title: "Book", totalPages: 100, currentPage: 10, minutesPerPage: 0 }).length >= 1);
  assert.deepEqual(Store.validateBook({ title: "Book", totalPages: 100, currentPage: 10, minutesPerPage: 2 }), []);
  assert.ok(Store.validateTask({ title: "", estimateMin: 0 }).length >= 1);
  assert.deepEqual(Store.validateTask({ title: "Practice", estimateMin: 45, dueDate: "2026-03-01" }), []);
});

test("course progress combines chapter and general focus minutes", () => {
  const course = {
    id: "course_1",
    title: "Math",
    color: "#58a6ff",
    deadline: null,
    totalMinutes: 100,
    chapters: [
      { id: "ch_1", title: "Limits", durationMin: 40 },
      { id: "ch_2", title: "Derivatives", durationMin: 60 },
    ],
    createdAt: 0,
  };
  const sessions = [
    { courseId: "course_1", chapterId: "ch_1", durationMin: 20, endTime: 10 },
    { courseId: "course_1", chapterId: null, durationMin: 10, endTime: 20 },
  ];
  const progress = Store.computeCourseProgress(baseState(), course, sessions);
  assert.equal(progress.doneMin, 30);
  assert.equal(progress.remainingMin, 70);
  assert.equal(progress.chapters[0].doneMin, 20);
  assert.equal(progress.chapters[1].doneMin, 0);
  assert.ok(Math.abs(progress.percent - 30) < 0.001);
});

test("book progress converts focus minutes after the baseline into pages", () => {
  const book = {
    id: "book_1",
    title: "Deep Work",
    color: "#3fb950",
    deadline: null,
    totalPages: 200,
    basePage: 10,
    baseAt: 1000,
    minutesPerPage: 2,
    createdAt: 0,
  };
  const sessions = [
    { bookId: "book_1", durationMin: 20, endTime: 500 },
    { bookId: "book_1", durationMin: 20, endTime: 2000 },
  ];
  const progress = Store.computeBookProgress(baseState(), book, sessions);
  assert.equal(progress.currentPage, 20);
  assert.equal(progress.remainingPages, 180);
  assert.equal(progress.remainingMin, 360);
});

test("task progress is capped at the estimate", () => {
  const task = { id: "task_1", title: "Practice", estimateMin: 30, dueDate: null, color: "#d29922", createdAt: 0 };
  const sessions = [{ taskId: "task_1", durationMin: 45, endTime: 1 }];
  const progress = Store.computeTaskProgress(baseState(), task, sessions);
  assert.equal(progress.doneMin, 30);
  assert.equal(progress.remainingMin, 0);
  assert.equal(progress.percent, 100);
});

test("conflict detection ignores flexible, cancelled, and missed events", () => {
  const state = baseState({
    events: Store.normalizeState({
      ...Store.defaultState(),
      events: [
        {
          id: "e1",
          title: "Fixed",
          type: "course",
          date: "2026-01-05",
          flexible: false,
          startMin: 600,
          endMin: 660,
          status: "scheduled",
        },
        {
          id: "e2",
          title: "Flexible",
          type: "book",
          date: "2026-01-05",
          flexible: true,
          plannedMin: 30,
          status: "scheduled",
        },
      ],
    }).events,
  });
  const conflicts = Store.findConflicts(state, {
    id: "candidate",
    date: "2026-01-05",
    flexible: false,
    startMin: 630,
    endMin: 690,
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, "e1");
  assert.equal(
    Store.findConflicts(state, {
      id: "candidate",
      date: "2026-01-05",
      flexible: false,
      startMin: 700,
      endMin: 760,
    }).length,
    0
  );
});

test("refreshStatuses marks overdue events without deleting them", () => {
  const state = baseState({
    events: [
      Store.normalizeState({
        ...Store.defaultState(),
        events: [
          {
            id: "late",
            title: "Missed",
            type: "task",
            date: "2020-01-01",
            startMin: 600,
            endMin: 660,
            status: "scheduled",
          },
        ],
      }).events[0],
    ],
  });
  const changed = Store.refreshStatuses(state, []);
  assert.equal(changed, true);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].status, "missed");
});
