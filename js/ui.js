"use strict";

(function (global) {
  const Planner = global.Planner || (global.Planner = {});
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex || "#58a6ff").replace("#", "");
    const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.padEnd(6, "0");
    const num = parseInt(full.slice(0, 6), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function openModal(title, content, options = {}) {
    const modal = $("plannerModal");
    const titleEl = $("modalTitle");
    const body = $("modalBody");
    const card = modal.querySelector(".modal-card");
    titleEl.textContent = title;
    body.innerHTML = "";
    body.appendChild(content);
    card.classList.toggle("modal-wide", Boolean(options.wide));
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    setTimeout(() => {
      const focusTarget = body.querySelector("input, select, textarea, button");
      if (focusTarget) focusTarget.focus();
    }, 30);
    return body;
  }

  function closeModal() {
    const modal = $("plannerModal");
    if (!modal) return;
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
    $("modalBody").innerHTML = "";
  }

  function setModalContent(content) {
    const body = $("modalBody");
    body.innerHTML = "";
    body.appendChild(content);
  }

  function renderErrors(container, errors) {
    const existing = container.querySelector(".form-errors");
    if (existing) existing.remove();
    if (!errors || !errors.length) return;
    const box = el("div", "form-errors");
    errors.forEach((message) => box.appendChild(el("div", "", message)));
    container.prepend(box);
  }

  function toast(message, kind = "info") {
    const region = $("toastRegion");
    if (!region) return;
    const item = el("div", `toast toast-${kind}`, message);
    region.appendChild(item);
    setTimeout(() => item.classList.add("toast-out"), 2800);
    setTimeout(() => item.remove(), 3200);
  }

  function field(labelText, control, hint) {
    const wrap = el("label", "field");
    wrap.appendChild(el("span", "field-label", labelText));
    wrap.appendChild(control);
    if (hint) wrap.appendChild(el("span", "field-hint", hint));
    return wrap;
  }

  function makeInput(options = {}) {
    const input = document.createElement("input");
    input.type = options.type || "text";
    input.className = options.className || "text-input";
    if (options.name) input.name = options.name;
    if (options.id) input.id = options.id;
    if (options.value !== undefined && options.value !== null) input.value = String(options.value);
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);
    if (options.required) input.required = true;
    if (options.maxLength) input.maxLength = options.maxLength;
    return input;
  }

  function makeSelect(options, value, className = "text-input") {
    const select = document.createElement("select");
    select.className = className;
    (options || []).forEach((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      if (String(option.value) === String(value)) node.selected = true;
      select.appendChild(node);
    });
    return select;
  }

  function makeButton(label, className, onClick, type = "button") {
    const button = el("button", className, label);
    button.type = type;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  }

  function progressBar(percent, color) {
    const track = el("div", "progress-track");
    const fill = el("div", "progress-fill");
    fill.style.width = `${Math.min(100, Math.max(0, percent || 0))}%`;
    if (color) fill.style.background = color;
    track.appendChild(fill);
    return track;
  }

  function statusLabel(status) {
    if (status === "completed") return "Completed";
    if (status === "partial") return "Partial";
    if (status === "missed") return "Missed";
    if (status === "rescheduled") return "Rescheduled";
    if (status === "cancelled") return "Cancelled";
    return "Scheduled";
  }

  function typeLabel(type) {
    if (type === "course") return "Course";
    if (type === "book") return "Book";
    if (type === "task") return "Task";
    return "Study";
  }

  function percent(value) {
    return `${Math.round(Math.min(100, Math.max(0, value || 0)))}%`;
  }

  function formatDateInput(value) {
    return value || "";
  }

  function parseFormNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  const modal = $("plannerModal");
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    const close = $("modalClose");
    if (close) close.addEventListener("click", closeModal);
  }
  document.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && modal && !modal.classList.contains("hidden")) closeModal();
  });

  Planner.UI = {
    $,
    el,
    escapeHtml,
    hexToRgba,
    openModal,
    closeModal,
    setModalContent,
    renderErrors,
    toast,
    field,
    makeInput,
    makeSelect,
    makeButton,
    progressBar,
    statusLabel,
    typeLabel,
    percent,
    formatDateInput,
    parseFormNumber,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
