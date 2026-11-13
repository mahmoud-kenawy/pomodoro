"use strict";

(function (global) {
  const Planner = global.Planner || (global.Planner = {});
  const Store = Planner.Store;
  const UI = Planner.UI;
  const { el, makeInput, makeButton, field, progressBar, percent } = UI;

  let activeType = "course";

  function currentSessions() {
    return Store.loadSessions();
  }

  function deadlineMeta(item, dateField) {
    if (!item[dateField]) return null;
    const today = Store.toDateKey(new Date());
    const overdue = item[dateField] < today;
    return { label: `Due ${Store.fmtDateShort(item[dateField])}`, overdue };
  }

  function cardMeta(parts) {
    const row = el("div", "learning-meta");
    parts.filter(Boolean).forEach((part) => {
      if (!part) return;
      const node = el("span", part.overdue ? "meta-pill meta-overdue" : "meta-pill", part.label);
      row.appendChild(node);
    });
    return row;
  }

  function totalDurationLabel(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    const pretty = Store.fmtDuration(value);
    return value >= 60 ? `${pretty} (${value} min)` : pretty;
  }

  function actionRow(item, type) {
    const actions = el("div", "learning-actions");
    const plan = makeButton("Plan session", "btn btn-ghost btn-sm", () => {
      if (Planner.Calendar && Planner.Calendar.openEventModal) {
        Planner.Calendar.openEventModal({ type, refId: item.id });
      } else {
        UI.toast("Calendar is not available yet.", "error");
      }
    });
    const edit = makeButton("Edit", "btn btn-ghost btn-sm", () => openEditModal(type, item));
    const del = makeButton("Delete", "btn btn-danger btn-sm", () => deleteItem(type, item));
    actions.append(plan, edit, del);
    return actions;
  }

  function renderCourseCard(course, sessions, state) {
    const progress = Store.computeCourseProgress(state, course, sessions);
    const card = el("article", "learning-card");
    card.style.setProperty("--item-color", course.color);
    const top = el("div", "learning-card-head");
    const titleWrap = el("div", "learning-title-wrap");
    const dot = el("span", "item-dot");
    dot.style.background = course.color;
    const title = el("h3", "learning-title", course.title);
    titleWrap.append(dot, title);
    const badge = el("span", "type-badge type-course", "Course");
    top.append(titleWrap, badge);

    const meta = cardMeta([
      { label: `${Store.fmtDuration(progress.doneMin)} of ${totalDurationLabel(progress.totalMin)}` },
      deadlineMeta(course, "deadline"),
    ]);

    const barRow = el("div", "progress-row");
    barRow.append(progressBar(progress.percent, course.color), el("span", "progress-value", percent(progress.percent)));

    const summary = el("div", "learning-summary");
    summary.append(
      el("span", "", `${progress.remainingMin > 0 ? `${Store.fmtDuration(progress.remainingMin)} remaining` : "Course complete"}`),
      el("span", "", `${course.chapters.length} chapter${course.chapters.length === 1 ? "" : "s"}`)
    );

    card.append(top, meta, barRow, summary);

    if (course.chapters.length) {
      const chapters = el("div", "chapter-list");
      progress.chapters.forEach((chapter) => {
        const row = el("div", `chapter-row${chapter.remainingMin <= 0 ? " chapter-complete" : ""}`);
        const header = el("div", "chapter-row-head");
        header.append(
          el("span", "chapter-title", chapter.title),
          el("span", "chapter-meta", `${Store.fmtDuration(chapter.doneMin)} / ${Store.fmtDuration(chapter.durationMin)}`)
        );
        row.append(header, progressBar(chapter.percent, course.color));
        chapters.appendChild(row);
      });
      card.appendChild(chapters);
    }

    card.appendChild(actionRow(course, "course"));
    return card;
  }

  function renderBookCard(book, sessions, state) {
    const progress = Store.computeBookProgress(state, book, sessions);
    const card = el("article", "learning-card");
    card.style.setProperty("--item-color", book.color);
    const top = el("div", "learning-card-head");
    const titleWrap = el("div", "learning-title-wrap");
    const dot = el("span", "item-dot");
    dot.style.background = book.color;
    titleWrap.append(dot, el("h3", "learning-title", book.title));
    top.append(titleWrap, el("span", "type-badge type-book", "Book"));

    const meta = cardMeta([
      { label: `Page ${progress.currentPage} of ${book.totalPages}` },
      { label: `${Store.roundMinutes(book.minutesPerPage)} min/page` },
      deadlineMeta(book, "deadline"),
    ]);

    const barRow = el("div", "progress-row");
    barRow.append(progressBar(progress.percent, book.color), el("span", "progress-value", percent(progress.percent)));

    const summary = el("div", "learning-summary");
    summary.append(
      el("span", "", progress.remainingPages > 0 ? `${progress.remainingPages} pages left` : "Book complete"),
      el("span", "", progress.remainingMin > 0 ? `~${Store.fmtDuration(progress.remainingMin)} left` : "")
    );

    card.append(top, meta, barRow, summary, actionRow(book, "book"));
    return card;
  }

  function renderTaskCard(task, sessions, state) {
    const progress = Store.computeTaskProgress(state, task, sessions);
    const card = el("article", "learning-card");
    card.style.setProperty("--item-color", task.color);
    const top = el("div", "learning-card-head");
    const titleWrap = el("div", "learning-title-wrap");
    const dot = el("span", "item-dot");
    dot.style.background = task.color;
    titleWrap.append(dot, el("h3", "learning-title", task.title));
    top.append(titleWrap, el("span", "type-badge type-task", "Task"));

    const meta = cardMeta([
      { label: `${Store.fmtDuration(progress.doneMin)} of ${Store.fmtDuration(progress.totalMin)}` },
      deadlineMeta(task, "dueDate"),
    ]);

    const barRow = el("div", "progress-row");
    barRow.append(progressBar(progress.percent, task.color), el("span", "progress-value", percent(progress.percent)));
    const summary = el("div", "learning-summary");
    summary.append(el("span", "", progress.remainingMin > 0 ? `${Store.fmtDuration(progress.remainingMin)} remaining` : "Task complete"));

    card.append(top, meta, barRow, summary, actionRow(task, "task"));
    return card;
  }

  function renderTabs(state) {
    const tabs = [
      { type: "course", label: "Courses", count: state.courses.length },
      { type: "book", label: "Books", count: state.books.length },
      { type: "task", label: "Tasks", count: state.tasks.length },
    ];
    const wrap = el("div", "learning-tabs");
    tabs.forEach((tab) => {
      const button = makeButton(`${tab.label}`, `learning-tab${activeType === tab.type ? " active" : ""}`, () => {
        activeType = tab.type;
        render();
      });
      button.appendChild(el("span", "tab-count", tab.count));
      wrap.appendChild(button);
    });
    return wrap;
  }

  function render() {
    const state = Store.loadState();
    const sessions = currentSessions();
    const root = UI.$("libraryContent");
    const tabsRoot = UI.$("learningTabs");
    if (!root || !tabsRoot) return;
    tabsRoot.innerHTML = "";
    tabsRoot.appendChild(renderTabs(state));
    root.innerHTML = "";

    const addBtn = UI.$("addLearningBtn");
    if (addBtn) {
      addBtn.textContent = activeType === "course" ? "+ New course" : activeType === "book" ? "+ New book" : "+ New task";
    }

    const items =
      activeType === "course" ? state.courses : activeType === "book" ? state.books : state.tasks;
    if (!items.length) {
      const empty = el("div", "empty-panel");
      empty.appendChild(el("h3", "", activeType === "course" ? "No courses yet" : activeType === "book" ? "No books yet" : "No tasks yet"));
      empty.appendChild(
        el(
          "p",
          "",
          activeType === "course"
            ? "Create a course with chapters to start planning focused study sessions."
            : activeType === "book"
            ? "Add a book, set your reading pace, and track pages automatically as you focus."
            : "Add flexible learning tasks and schedule them around your day."
        )
      );
      root.appendChild(empty);
    } else {
      const grid = el("div", "learning-grid");
      items.forEach((item) => {
        if (activeType === "course") grid.appendChild(renderCourseCard(item, sessions, state));
        if (activeType === "book") grid.appendChild(renderBookCard(item, sessions, state));
        if (activeType === "task") grid.appendChild(renderTaskCard(item, sessions, state));
      });
      root.appendChild(grid);
    }

    const subtitle = UI.$("librarySubtitle");
    if (subtitle) {
      const remaining = Store.listItems(state).reduce((sum, entry) => {
        return sum + Store.itemRemaining(state, entry.type, entry.item, sessions);
      }, 0);
      const count = (value, label) => `${value} ${label}${value === 1 ? "" : "s"}`;
      subtitle.textContent = `${count(state.courses.length, "course")} · ${count(state.books.length, "book")} · ${count(state.tasks.length, "task")} · ${Store.fmtDuration(remaining)} remaining`;
    }
  }

  function chapterRow(chapter) {
    const row = el("div", "chapter-edit-row");
    row.dataset.chapterId = chapter && chapter.id ? chapter.id : "";
    const title = makeInput({ value: chapter ? chapter.title : "", placeholder: "Chapter title", maxLength: 120 });
    title.classList.add("chapter-title-input");
    const duration = makeInput({
      type: "number",
      value: chapter ? chapter.durationMin : 30,
      min: 1,
      max: 100000,
      step: 1,
    });
    duration.classList.add("chapter-duration-input");
    const remove = makeButton("Remove", "chapter-remove", () => row.remove());
    const titleField = field("Title", title);
    titleField.classList.add("chapter-field");
    const durationField = field("Minutes", duration);
    durationField.classList.add("chapter-duration-field");
    row.append(titleField, durationField, remove);
    return row;
  }

  function openCourseModal(course) {
    const isEdit = Boolean(course);
    const form = document.createElement("form");
    form.className = "stack-form";
    const title = makeInput({ value: course ? course.title : "", placeholder: "e.g. Linear Algebra", maxLength: 120, required: true });
    const color = makeInput({ type: "color", value: course ? course.color : Store.COLORS.course });
    color.classList.add("color-input");
    const deadline = makeInput({ type: "date", value: course && course.deadline ? course.deadline : "" });
    const initialTotal = course ? course.totalMinutes : 600;
    const totalHours = makeInput({
      type: "number",
      value: Math.floor(initialTotal / 60),
      min: 0,
      max: 1666,
      step: 1,
    });
    totalHours.classList.add("course-hours-input");
    const totalMins = makeInput({
      type: "number",
      value: initialTotal % 60,
      min: 0,
      max: 59,
      step: 1,
    });
    totalMins.classList.add("course-minutes-input");
    const durationFields = el("div", "duration-input-group");
    durationFields.append(field("Hours", totalHours), field("Minutes", totalMins));
    const durationHint = el("span", "field-hint", "");
    const durationField = el("div", "field");
    durationField.append(el("span", "field-label", "Total duration"), durationFields, durationHint);
    const updateDurationHint = () => {
      const total = UI.parseFormNumber(totalHours.value) * 60 + UI.parseFormNumber(totalMins.value);
      durationHint.textContent =
        total > 0 ? `${total} min${total >= 60 ? ` = ${Store.fmtDuration(total)}` : ""}` : "Enter the total course time.";
    };
    totalHours.addEventListener("input", updateDurationHint);
    totalMins.addEventListener("input", updateDurationHint);
    updateDurationHint();
    const topGrid = el("div", "form-grid two");
    topGrid.append(field("Course title", title), durationField);
    const metaGrid = el("div", "form-grid two");
    metaGrid.append(field("Color", color), field("Deadline (optional)", deadline));
    const chapterSection = el("div", "chapter-edit-section");
    const chapterHead = el("div", "chapter-edit-head");
    chapterHead.append(el("span", "field-label", "Chapters (optional)"), makeButton("+ Add chapter", "btn btn-ghost btn-sm", () => {
      chapterSection.appendChild(chapterRow(null));
    }));
    const chapterList = el("div", "chapter-edit-list");
    (course ? course.chapters : []).forEach((chapter) => chapterList.appendChild(chapterRow(chapter)));
    chapterSection.append(chapterHead, chapterList);
    const errors = el("div", "form-errors hidden");
    const actions = el("div", "form-actions");
    const cancel = makeButton("Cancel", "btn btn-ghost", () => UI.closeModal());
    const save = makeButton(isEdit ? "Save course" : "Create course", "btn btn-primary", null, "submit");
    actions.append(cancel, save);
    form.append(topGrid, metaGrid, chapterSection, errors, actions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const chapters = [...chapterList.querySelectorAll(".chapter-edit-row")].map((row) => ({
        id: row.dataset.chapterId || Store.createId("chapter"),
        title: row.querySelector(".chapter-title-input").value.trim(),
        durationMin: UI.parseFormNumber(row.querySelector(".chapter-duration-input").value),
      }));
      const payload = {
        title: title.value.trim(),
        color: color.value,
        deadline: deadline.value || null,
        totalMinutes: UI.parseFormNumber(totalHours.value) * 60 + UI.parseFormNumber(totalMins.value),
        chapters,
      };
      const problems = Store.validateCourse(payload);
      if (problems.length) {
        UI.renderErrors(form, problems);
        return;
      }
      Store.updateState((state) => {
        if (isEdit) {
          const target = state.courses.find((c) => c.id === course.id);
          if (target) Object.assign(target, payload, { updatedAt: Date.now() });
        } else {
          state.courses.push(
            Store.normalizeState({
              ...Store.defaultState(),
              courses: [{ ...payload, createdAt: Date.now() }],
            }).courses[0]
          );
        }
      });
      UI.closeModal();
      UI.toast(isEdit ? "Course updated." : "Course created.", "success");
    });

    UI.openModal(isEdit ? "Edit course" : "New course", form);
  }

  function openBookModal(book) {
    const isEdit = Boolean(book);
    const state = Store.loadState();
    const sessions = Store.loadSessions();
    const progress = book ? Store.computeBookProgress(state, book, sessions) : null;
    const form = document.createElement("form");
    form.className = "stack-form";
    const title = makeInput({ value: book ? book.title : "", placeholder: "e.g. Deep Work", maxLength: 120, required: true });
    const totalPages = makeInput({
      type: "number",
      value: book ? book.totalPages : 300,
      min: 1,
      max: 100000,
      step: 1,
      required: true,
    });
    const currentPage = makeInput({
      type: "number",
      value: book ? progress.currentPage : 0,
      min: 0,
      max: 100000,
      step: 1,
      required: true,
    });
    const minutesPerPage = makeInput({
      type: "number",
      value: book ? book.minutesPerPage : 2,
      min: 0.1,
      max: 60,
      step: 0.1,
      required: true,
    });
    const color = makeInput({ type: "color", value: book ? book.color : Store.COLORS.book });
    color.classList.add("color-input");
    const deadline = makeInput({ type: "date", value: book && book.deadline ? book.deadline : "" });
    const topGrid = el("div", "form-grid two");
    topGrid.append(field("Book title", title), field("Total pages", totalPages));
    const progressGrid = el("div", "form-grid two");
    progressGrid.append(
      field("Current page", currentPage, "Editing this snapshots progress from today."),
      field("Reading speed (minutes per page)", minutesPerPage)
    );
    const metaGrid = el("div", "form-grid two");
    metaGrid.append(field("Color", color), field("Deadline (optional)", deadline));
    const actions = el("div", "form-actions");
    actions.append(makeButton("Cancel", "btn btn-ghost", () => UI.closeModal()), makeButton(isEdit ? "Save book" : "Create book", "btn btn-primary", null, "submit"));
    form.append(topGrid, progressGrid, metaGrid, actions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const payload = {
        title: title.value.trim(),
        totalPages: UI.parseFormNumber(totalPages.value),
        currentPage: UI.parseFormNumber(currentPage.value),
        minutesPerPage: UI.parseFormNumber(minutesPerPage.value),
        color: color.value,
        deadline: deadline.value || null,
      };
      const problems = Store.validateBook(payload);
      if (problems.length) {
        UI.renderErrors(form, problems);
        return;
      }
      Store.updateState((next) => {
        if (isEdit) {
          const target = next.books.find((b) => b.id === book.id);
          if (target) {
            Object.assign(target, {
              title: payload.title,
              totalPages: payload.totalPages,
              basePage: payload.currentPage,
              baseAt: Date.now(),
              minutesPerPage: payload.minutesPerPage,
              color: payload.color,
              deadline: payload.deadline,
              updatedAt: Date.now(),
            });
          }
        } else {
          const created = Store.normalizeState({
            ...Store.defaultState(),
            books: [
              {
                title: payload.title,
                totalPages: payload.totalPages,
                basePage: payload.currentPage,
                baseAt: Date.now(),
                minutesPerPage: payload.minutesPerPage,
                color: payload.color,
                deadline: payload.deadline,
                createdAt: Date.now(),
              },
            ],
          }).books[0];
          next.books.push(created);
        }
      });
      UI.closeModal();
      UI.toast(isEdit ? "Book updated." : "Book created.", "success");
    });

    UI.openModal(isEdit ? "Edit book" : "New book", form);
  }

  function openTaskModal(task) {
    const isEdit = Boolean(task);
    const form = document.createElement("form");
    form.className = "stack-form";
    const title = makeInput({ value: task ? task.title : "", placeholder: "e.g. Practice 20 integrals", maxLength: 120, required: true });
    const estimateMin = makeInput({
      type: "number",
      value: task ? task.estimateMin : 60,
      min: 1,
      max: 100000,
      step: 1,
      required: true,
    });
    const dueDate = makeInput({ type: "date", value: task && task.dueDate ? task.dueDate : "" });
    const color = makeInput({ type: "color", value: task ? task.color : Store.COLORS.task });
    color.classList.add("color-input");
    const topGrid = el("div", "form-grid two");
    topGrid.append(field("Task title", title), field("Estimated minutes", estimateMin));
    const metaGrid = el("div", "form-grid two");
    metaGrid.append(field("Color", color), field("Due date (optional)", dueDate));
    const actions = el("div", "form-actions");
    actions.append(makeButton("Cancel", "btn btn-ghost", () => UI.closeModal()), makeButton(isEdit ? "Save task" : "Create task", "btn btn-primary", null, "submit"));
    form.append(topGrid, metaGrid, actions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const payload = {
        title: title.value.trim(),
        estimateMin: UI.parseFormNumber(estimateMin.value),
        dueDate: dueDate.value || null,
        color: color.value,
      };
      const problems = Store.validateTask(payload);
      if (problems.length) {
        UI.renderErrors(form, problems);
        return;
      }
      Store.updateState((state) => {
        if (isEdit) {
          const target = state.tasks.find((t) => t.id === task.id);
          if (target) Object.assign(target, payload, { updatedAt: Date.now() });
        } else {
          const created = Store.normalizeState({
            ...Store.defaultState(),
            tasks: [{ ...payload, createdAt: Date.now() }],
          }).tasks[0];
          state.tasks.push(created);
        }
      });
      UI.closeModal();
      UI.toast(isEdit ? "Task updated." : "Task created.", "success");
    });

    UI.openModal(isEdit ? "Edit task" : "New task", form);
  }

  function openEditModal(type, item) {
    if (type === "course") openCourseModal(item);
    if (type === "book") openBookModal(item);
    if (type === "task") openTaskModal(item);
  }

  function deleteItem(type, item) {
    const label = type === "course" ? "course" : type === "book" ? "book" : "task";
    if (!window.confirm(`Delete "${item.title}"? Upcoming planned sessions for it will also be removed. Focus history is preserved.`)) {
      return;
    }
    Store.updateState((state) => {
      if (type === "course") state.courses = state.courses.filter((c) => c.id !== item.id);
      if (type === "book") state.books = state.books.filter((b) => b.id !== item.id);
      if (type === "task") state.tasks = state.tasks.filter((t) => t.id !== item.id);
      state.events = state.events.filter(
        (event) => !(event.type === type && event.refId === item.id && event.status === "scheduled")
      );
    });
    UI.toast(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted.`, "success");
  }

  function init() {
    const addBtn = UI.$("addLearningBtn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        if (activeType === "course") openCourseModal(null);
        if (activeType === "book") openBookModal(null);
        if (activeType === "task") openTaskModal(null);
      });
    }
    document.addEventListener("planner:data-changed", render);
  }

  Planner.Learning = {
    render,
    openCourseModal,
    openBookModal,
    openTaskModal,
    init,
  };

  init();
})(typeof globalThis !== "undefined" ? globalThis : this);
