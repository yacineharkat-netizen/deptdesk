// DeptDesk - shared helpers for all pages.
(window.DD_FILES = window.DD_FILES || {})["common.js"] = "2"; // file version, checked by the page

const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Error codes raised by the database functions -> message shown to the user.
const ERROR_MESSAGES = {
  NOT_LOGGED_IN: "Please log in again.",
  ACCOUNT_NOT_ALLOWED: "This account has no role yet: type the invitation code you received.",
  NOT_FOUND: "Not found (or not in your levels).",
  NOT_ALLOWED: "Your role does not allow this.",
  NOT_YOUR_SECTION: "You can only work on your own section.",
  MEMBERSHIP_EXPIRED: "Your delegate account has ended with the semester. Ask the head of the level to renew it.",
  LOCKED: "The head has validated this allocation: it can no longer be changed. Ask him if a change is needed.",
  BAD_INVITE: "This invitation code is not valid (wrong, already used, or expired). Ask for a new one.",
  NAME_REQUIRED: "Type your full name (at least 3 letters).",
  BAD_ROLE: "Unknown role.",
  SECTION_REQUIRED: "Choose the section of the delegate.",
  NO_SUCH_ACCOUNT: "No DeptDesk account with this e-mail yet. Send an invitation code instead.",
  NOT_YOURSELF: "You cannot remove yourself.",
  BAD_YEAR: "Academic year: write it like 2026/2027.",
  BAD_PERIOD: "Semester: 1 or 2.",
  BAD_DATES: "The end date is before the start date.",
  BAD_STATUS: "Unknown status.",
  SEMESTER_EXISTS: "This semester already exists.",
  BAD_SECTION: "Section name: 1 to 6 letters or digits (A, B, C1...).",
  BAD_COUNT: "Numbers of groups: 0 to 30 TD groups, 0 to 60 TP sub-groups, tolerance 0 to 20.",
  SECTION_EXISTS: "This section already exists.",
  SECTION_NOT_EMPTY: "This section has students: move them first.",
  EMPTY_FILE: "No usable line in this file.",
  TOO_MANY_ROWS: "Too many lines (3000 at most).",
  BAD_MATRICULE: "Student number: 4 to 20 letters or digits.",
  MATRICULE_EXISTS: "This student number is already in the list.",
  UNKNOWN_STUDENT: "This student is not (or no longer) in this section. Reload the page.",
  BAD_GROUP: "This group does not exist in this section.",
  BAD_CHANGES: "Invalid change.",
  ALREADY_PAIRED: "One of the two students already has a lab partner: break that pair first.",
  PAIR_NOT_SAME_SUBGROUP: "Lab partners must be in the same TP sub-group.",
  BAD_MODE: "Unknown mode.",
  NO_GROUPS: "Set the number of groups of this section first (Setup tab).",
  NETWORK: "Network problem. Check your connection.",
  // version 2
  BAD_TARGET: "This group does not exist in this section (or does not fit: a TD is for a G group, a TP for an SG sub-group).",
  BAD_EMAIL: "This e-mail address is not valid.",
  BAD_CODE: "Module code: 1 to 20 letters or digits.",
  MODULE_EXISTS: "A module with this code already exists in this semester.",
  BAD_KIND: "Unknown kind.",
  ACTIVITY_IN_USE: "This activity already has sessions or timetable slots: it cannot be removed.",
  MODULE_IN_USE: "This module already has sessions recorded: it cannot be deleted.",
  BAD_DATE: "Check the date (inside the semester).",
  FUTURE_DATE: "A session is recorded once it has happened (not a future date).",
  TOO_LATE_TO_CHANGE: "Recorded more than 7 days ago: only the head can change it now.",
  NOT_YOUR_SESSION: "This session is not yours.",
  COMMENT_REQUIRED: "Write what is wrong (a short comment).",
  ALREADY_RECORDED: "This session is already recorded: change it instead.",
  BAD_TIME: "Check the day and the hours (the end after the start).",
  BAD_PARITY: "Week: every week, A or B.",
  BAD_LINK: "This link is not valid any more. Ask your delegate for the new one.",
};

function errorText(err) {
  if (!err) return "";
  const msg = err.message || String(err);
  const code = msg.split(":")[0].trim();
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (/permission denied/i.test(msg)) return "Please log in again.";
  if (/fetch|network|abort/i.test(msg)) return ERROR_MESSAGES.NETWORK;
  return msg;
}

// Call a database function. Returns the data, or throws an Error with a readable message and .code.
// Every call is timed (DD_NET) and given up after 12 s (2 min for big imports), so that a phone never freezes.
const DD_NET = window.DD_NET = { calls: [], inFlight: 0 };
const RPC_TIMEOUT_MS = 12000;
async function rpc(fn, args) {
  const t0 = performance.now();
  DD_NET.inFlight++;
  let result;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const big = JSON.stringify(args || {}).length > 50000 || /import/.test(fn);
  const timer = ctl ? setTimeout(() => ctl.abort(), big ? 120000 : RPC_TIMEOUT_MS) : null;
  try {
    const call = db.rpc(fn, args || {});
    result = await (ctl && call.abortSignal ? call.abortSignal(ctl.signal) : call);
  } catch (err) {
    result = { data: null, error: { message: "Network problem: " + (err && err.message || err) } };
  } finally {
    clearTimeout(timer);
    DD_NET.inFlight--;
    DD_NET.calls.push({ fn, ms: Math.round(performance.now() - t0), at: Date.now() });
    if (DD_NET.calls.length > 300) DD_NET.calls.splice(0, 100);
  }
  const { data, error } = result;
  if (error) {
    const e = new Error(errorText(error));
    e.code = (error.message || "").split(":")[0].trim();
    e.network = !error.code && /fetch|network|abort|timeout|load failed/i.test(error.message || "");
    if (e.network) { DD_NET.lastFail = Date.now(); e.code = "NETWORK"; } else DD_NET.lastOk = Date.now();
    throw e;
  }
  DD_NET.lastOk = Date.now();
  return data;
}
// Median and slowest time of the last calls (to tell "the network is slow" from "the server is slow").
function netSummary(lastMs) {
  const since = Date.now() - (lastMs || 120000);
  const list = DD_NET.calls.filter((c) => c.at >= since).map((c) => c.ms).sort((a, b) => a - b);
  return { count: list.length, median: list.length ? list[Math.floor(list.length / 2)] : 0, max: list.length ? list[list.length - 1] : 0 };
}

// A repeated refresh that never piles up: the next call starts when the previous one is over, waits at least
// twice its duration, pauses while the page is hidden or while when() says no. run() refreshes now.
function poller(fn, everyMs, when) {
  const p = { busy: false, timer: null, stopped: false, next: null };
  const schedule = (lastMs) => { clearTimeout(p.timer); if (!p.stopped) p.timer = setTimeout(tick, Math.max(everyMs, 2 * (lastMs || 0))); };
  async function tick() {
    if (document.visibilityState === "hidden" || (when && !when())) { schedule(0); return; }
    await p.run();
  }
  async function exec() {
    p.busy = true; clearTimeout(p.timer);
    const t0 = performance.now();
    try { await fn(); } catch (e) { /* the next round tries again */ }
    p.busy = false;
    if (p.next) { const n = p.next; p.next = null; await exec(); n.resolve(); return; }
    schedule(performance.now() - t0);
  }
  p.run = () => {
    if (!p.busy) return exec();
    if (!p.next) { let resolve; const promise = new Promise((r) => (resolve = r)); p.next = { promise, resolve }; }
    return p.next.promise;
  };
  p.stop = () => { p.stopped = true; clearTimeout(p.timer); };
  p.start = () => { p.stopped = false; schedule(0); return p; };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !p.stopped && !p.busy && (!when || when())) p.run();
  });
  return p.start();
}

// An element of the page. When it is not there any more (the user moved to another tab while a call was running),
// a detached element is returned, so that late answers change nothing instead of failing. has(id) tests presence.
function $(id) { return document.getElementById(id) || document.createElement("div"); }
function has(id) { return document.getElementById(id) !== null; }
function esc(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(message, kind) {
  let box = document.getElementById("toast");
  if (!box) { box = document.createElement("div"); box.id = "toast"; document.body.appendChild(box); }
  box.textContent = message;
  box.className = "show " + (kind || "");
  clearTimeout(box._t);
  box._t = setTimeout(() => { box.className = ""; }, 4500);
}
function whenText(t) { return t ? new Date(t).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; }
function dayText(d) { return d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : ""; }
// Names compared without accents, spaces or dashes (same rule as the database).
function nameKey(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function fullName(s) { return `${String(s.last_name || "").toUpperCase()} ${s.first_name || ""}`.trim(); }

// In-page dialogs (native confirm/prompt leave the full screen on phones).
// askInPage({ title, html, ok, cancel, danger }) -> Promise<boolean>; the box is given to onOpen(box) before showing.
function askInPage(opts) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
      ${opts.title ? `<h3>${esc(opts.title)}</h3>` : ""}<div class="dlg-body">${opts.html || ""}</div>
      <div class="actions">${opts.cancel === false ? "" : `<button class="secondary" data-a="no">${esc(opts.cancel || "Cancel")}</button>`}
      ${opts.ok === false ? "" : `<button class="${opts.danger ? "red" : ""}" data-a="yes">${esc(opts.ok || "OK")}</button>`}</div></div>`;
    document.body.appendChild(wrap);
    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => {
      if (b.dataset.a === "yes" && opts.validate && !opts.validate(wrap)) return;
      close(b.dataset.a === "yes");
    });
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); });
    wrap.close = close;
    if (opts.onOpen) opts.onOpen(wrap);
  });
}

// v2: an error shown in a red frame inside a part of the page (a toast can be missed).
function errorBox(message) { return `<div class="alert-error" role="alert">⚠ ${esc(message)}</div>`; }
const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const KIND_NAME = { course: "Course", td: "TD", tp: "TP" };
// Today in Algiers (yyyy-mm-dd).
function todayAlgiers() { return new Date(Date.now() + 3600000).toISOString().slice(0, 10); }
function dayIndexOf(iso) { return (new Date(iso + "T12:00:00Z").getUTCDay() + 1) % 7; }

// Network banner: shown while the last call failed for network reasons.
function watchNetwork(bannerId) {
  setInterval(() => { const b = $(bannerId); if (b) b.classList.toggle("hidden", !((DD_NET.lastFail || 0) > (DD_NET.lastOk || 0))); }, 1000);
}
// Remember small per-browser choices (level, semester, tab). Never required: private mode may refuse.
function prefGet(k, d) { try { const v = localStorage.getItem("dd_" + k); return v == null ? d : v; } catch (e) { return d; } }
function prefSet(k, v) { try { localStorage.setItem("dd_" + k, v); } catch (e) { /* private mode */ } }
