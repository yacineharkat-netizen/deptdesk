// DeptDesk - application shell: level and semester, tabs by role, Setup, Students, People, Log, Admin.
// The Groups tab is in groups.js.
(window.DD_FILES = window.DD_FILES || {})["app.js"] = "2.1"; // file version, checked by the page

const APP = { me: null, level: null, semesters: [], semester: null, sections: [], tab: null, email: "", modules: null, teachers: null };
const ROLE_LABEL = { head: "Head", delegate: "Delegate", teacher: "Teacher", admin: "Administrator" };
const STATUS_LABEL = { N: "normal", D: "repeating", EXT: "external" };

// ------------------------------------------------------------------ start
async function start() {
  const { data } = await db.auth.getSession();
  if (!data.session) { location.href = "index.html"; return; }
  APP.email = data.session.user.email || "";
  try { APP.me = await rpc("api_me"); }
  catch (e) {
    if (e.code === "ACCOUNT_NOT_ALLOWED" || e.code === "NOT_LOGGED_IN" || /log in again/i.test(e.message)) { location.href = "index.html"; return; }
    $("main").innerHTML = `<div class="card"><p>${esc(e.message)}</p><button onclick="location.reload()">Try again</button></div>`; return;
  }
  $("who").textContent = APP.email;
  const levels = APP.me.levels;
  $("levelSelect").innerHTML = levels.map((l) => `<option value="${l.level_id}">${esc(l.short_name || l.name)} · ${esc(ROLE_LABEL[l.role])}${l.section ? " " + esc(l.section) : ""}</option>`).join("");
  $("levelSelect").classList.toggle("hidden", levels.length < 1);
  const saved = prefGet("level", "");
  APP.level = levels.find((l) => l.level_id === saved) || levels[0] || null;
  if (APP.level) $("levelSelect").value = APP.level.level_id;
  $("levelSelect").onchange = () => { APP.level = levels.find((l) => l.level_id === $("levelSelect").value); prefSet("level", APP.level.level_id); openLevel(); };
  $("semesterSelect").onchange = () => { APP.semester = APP.semesters.find((s) => s.id === $("semesterSelect").value); prefSet("semester", APP.semester.id); openSemester(); };
  await openLevel();
}

async function openLevel() {
  APP.semesters = []; APP.semester = null; APP.sections = [];
  $("semesterSelect").classList.add("hidden");
  if (APP.level) document.documentElement.style.setProperty("--level", APP.level.color || "#1B7F8C");
  if (APP.level && !APP.level.expired) {
    try { APP.semesters = await rpc("api_semesters", { p_level: APP.level.level_id }); } catch (e) { toast(e.message, "error"); }
    const saved = prefGet("semester", "");
    APP.semester = APP.semesters.find((s) => s.id === saved) || APP.semesters.find((s) => s.current) || APP.semesters[0] || null;
    $("semesterSelect").innerHTML = APP.semesters.map((s) => `<option value="${s.id}">${esc(semesterLabel(s))}</option>`).join("");
    if (APP.semester) $("semesterSelect").value = APP.semester.id;
    $("semesterSelect").classList.toggle("hidden", !APP.semesters.length);
  }
  await openSemester();
}

async function openSemester() {
  APP.sections = []; APP.modules = null; APP.teachers = null;
  if (APP.semester) { try { APP.sections = await rpc("api_sections", { p_semester: APP.semester.id }); } catch (e) { toast(e.message, "error"); } }
  renderTabs();
}

function semesterLabel(s) { return `${s.year} · semester ${s.period}${s.code ? " (" + s.code + ")" : ""}`; }
function role() { return APP.level ? APP.level.role : null; }
function isHead() { return role() === "head"; }
function ctxNames() {
  return { levelName: APP.level ? APP.level.name : "", levelShort: APP.level ? (APP.level.short_name || APP.level.name) : "",
    semesterLabel: APP.semester ? semesterLabel(APP.semester) : "" };
}
// v2: modules (with activities and teachers) and the teachers directory, loaded when a tab needs them.
async function loadRefs(force) {
  if (!APP.semester) { APP.modules = []; APP.teachers = []; return; }
  if (force || !APP.modules) APP.modules = await rpc("api_modules", { p_semester: APP.semester.id });
  if (force || !APP.teachers) APP.teachers = await rpc("api_teachers", { p_level: APP.level.level_id });
}
// "AWP · TD" options of the activities of the semester.
function activityOptions(selected, onlyKinds) {
  return (APP.modules || []).map((m) => m.activities.filter((a) => !onlyKinds || onlyKinds.includes(a.kind)).map((a) =>
    `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${esc(m.code)} · ${KIND_NAME[a.kind]}${m.name ? " — " + esc(m.name) : ""}</option>`).join("")).join("");
}
function activityById(id) {
  for (const m of APP.modules || []) for (const a of m.activities) if (a.id === id) return Object.assign({ module: m }, a);
  return null;
}
function targetsFor(section, kind) {
  if (!section) return [""];
  if (kind === "td") return [...Array(section.td_count).keys()].map((i) => "G" + (i + 1));
  if (kind === "tp") return [...Array(section.tp_count).keys()].map((i) => "SG" + (i + 1));
  return [""];
}
function mySections() {
  return role() === "delegate" ? APP.sections.filter((x) => x.name.toUpperCase() === String(APP.level.section || "").toUpperCase()) : APP.sections;
}
async function reloadSections() {
  if (!APP.semester) return;
  APP.sections = await rpc("api_sections", { p_semester: APP.semester.id });
}

// ------------------------------------------------------------------ tabs
function tabsFor() {
  const t = [];
  if (APP.level && !APP.level.expired) {
    t.push(["followup", "📋 Follow-up"], ["timetable", "🗓 Timetable"], ["groups", "👥 Groups"]);
    if (isHead()) t.push(["students", "🎓 Students"], ["setup", "⚙ Setup"], ["people", "🔑 People"], ["log", "📜 Log"]);
  }
  if (APP.me.is_admin) t.push(["admin", "🏛 Admin"]);
  return t;
}
function renderTabs() {
  const tabs = tabsFor();
  if (!tabs.find((t) => t[0] === APP.tab)) APP.tab = prefGet("tab", "") && tabs.find((t) => t[0] === prefGet("tab", "")) ? prefGet("tab", "") : (tabs[0] || [null])[0];
  $("tabs").innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${APP.tab === k ? "active" : ""}">${l}</button>`).join("");
  $("tabs").querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { APP.tab = b.dataset.tab; prefSet("tab", APP.tab); renderTabs(); });
  $("tabs").classList.toggle("hidden", tabs.length < 2);
  if (typeof GROUPS !== "undefined") GROUPS.stop();
  window.scrollTo(0, 0);
  renderTab();
}
function renderTab() {
  const m = $("main");
  if (APP.level && APP.level.expired) {
    m.innerHTML = `<div class="card"><h2>Your delegate account has ended</h2><p>It was valid until ${esc(dayText(APP.level.valid_until))} (end of the semester).
      Ask the head of ${esc(APP.level.name)} to renew it: you will then find everything again.</p></div>` + (APP.me.is_admin ? "" : "");
    if (APP.tab !== "admin") return;
  }
  if (!APP.tab) {
    m.innerHTML = `<div class="card"><p>No level yet.</p></div>`; return;
  }
  if (APP.tab === "admin") return renderAdmin();
  if (!APP.semester && APP.tab !== "setup" && APP.tab !== "people" && APP.tab !== "log") {
    m.innerHTML = `<div class="card"><h2>No semester yet</h2>${isHead() ? `<p>Create the semester first.</p><button id="goSetup">⚙ Setup</button>` : `<p class="muted">The head has not created the semester yet.</p>`}</div>`;
    if (has("goSetup")) $("goSetup").onclick = () => { APP.tab = "setup"; renderTabs(); };
    return;
  }
  ({ groups: () => GROUPS.render(m), followup: () => FOLLOW.render(m), timetable: () => TT.render(m),
     students: renderStudents, setup: renderSetup, people: renderPeople, log: renderLog })[APP.tab]();
}

// ------------------------------------------------------------------ Setup: semesters and sections
function defaultYear() { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}`; }
function renderSetup() {
  const sem = APP.semester;
  $("main").innerHTML = `
    <div class="card"><h2>Semesters of ${esc(APP.level.name)}</h2>
      ${APP.semesters.length ? `<table class="cards-sm"><thead><tr><th>Year</th><th>Semester</th><th>Code</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>
        ${APP.semesters.map((s) => `<tr><td data-l="Year">${esc(s.year)}</td><td data-l="Semester">${s.period}${s.current ? ' <span class="badge ok">current</span>' : ""}</td>
          <td data-l="Code">${esc(s.code)}</td><td data-l="Dates">${s.starts ? esc(dayText(s.starts)) : "?"} → ${s.ends ? esc(dayText(s.ends)) : "?"}</td>
          <td data-l="Status">${esc(s.status)}</td><td><button class="small secondary" data-editsem="${s.id}">Edit</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">No semester yet.</p>`}
      <details id="semForm" style="margin-top:10px" ${APP.semesters.length ? "" : "open"}><summary><strong id="semFormTitle">New semester</strong></summary>
        <div class="row fill">
          <div><label for="semYear">Academic year</label><input id="semYear" value="${defaultYear()}" placeholder="2026/2027"></div>
          <div><label for="semPeriod">Semester of the year</label><select id="semPeriod"><option value="1">1 (autumn)</option><option value="2">2 (spring)</option></select></div>
          <div><label for="semCode">Official code</label><input id="semCode" placeholder="S5"></div>
        </div>
        <div class="row fill">
          <div><label for="semStarts">First day</label><input id="semStarts" type="date"></div>
          <div><label for="semEnds">Last day (exams included)</label><input id="semEnds" type="date"></div>
          <div><label for="semStatus">Status</label><select id="semStatus"><option value="running">running</option><option value="preparing">preparing</option><option value="closed">closed</option></select></div>
        </div>
        <div class="row fill"><div><label for="semWeekA">A day of the first "week A" (TP every two weeks) — optional</label><input id="semWeekA" type="date"></div></div>
        <p class="muted">A delegate's account is valid until the last day of the current semester; you renew it in one click (People tab).</p>
        <button id="semSave">Save the semester</button> <button id="semNew" class="secondary hidden">New semester instead</button>
      </details>
    </div>
    ${sem ? `<div class="card"><h2>Sections of ${esc(semesterLabel(sem))}</h2>
      <p class="muted" style="margin-top:0">The numbers of TD groups and TP sub-groups are your choice. TP sub-groups do not depend on TD groups.
        Tolerance: accepted gap between a group and the average size before it is shown in red.</p>
      <div id="secList"></div>
      <div class="row fill" style="margin-top:8px;align-items:flex-end">
        <div><label for="newSecName">New section</label><input id="newSecName" placeholder="A" maxlength="6"></div>
        <div><label for="newSecTd">TD groups</label><input id="newSecTd" type="number" min="0" max="30" value="2"></div>
        <div><label for="newSecTp">TP sub-groups</label><input id="newSecTp" type="number" min="0" max="60" value="6"></div>
        <div><label for="newSecTol">Tolerance</label><input id="newSecTol" type="number" min="0" max="20" value="1"></div>
        <div><button id="newSecBtn" style="width:100%">Add the section</button></div>
      </div></div><div id="setup2"></div>` : ""}`;
  let editing = null;
  const fill = (s) => {
    editing = s ? s.id : null;
    $("semFormTitle").textContent = s ? "Edit " + semesterLabel(s) : "New semester";
    $("semYear").value = s ? s.year : defaultYear(); $("semPeriod").value = s ? s.period : 1; $("semCode").value = s ? s.code : "";
    $("semStarts").value = s && s.starts ? s.starts : ""; $("semEnds").value = s && s.ends ? s.ends : ""; $("semStatus").value = s ? s.status : "running";
    $("semWeekA").value = s && s.week_a_start ? s.week_a_start : "";
    $("semNew").classList.toggle("hidden", !s); $("semForm").open = true;
  };
  document.querySelectorAll("[data-editsem]").forEach((b) => b.onclick = () => fill(APP.semesters.find((s) => s.id === b.dataset.editsem)));
  $("semNew").onclick = () => fill(null);
  $("semSave").onclick = async () => {
    try {
      const id = await rpc("api_semester_save", { p_level: APP.level.level_id, p_id: editing, p_year: $("semYear").value.trim(), p_period: Number($("semPeriod").value),
        p_code: $("semCode").value, p_starts: $("semStarts").value || null, p_ends: $("semEnds").value || null, p_status: $("semStatus").value,
        p_week_a_start: $("semWeekA").value || null });
      toast("Semester saved.", "ok"); prefSet("semester", id); APP.tab = "setup"; await openLevel();
    } catch (e) { toast(e.message, "error"); }
  };
  if (!sem) return;
  const secList = () => {
    $("secList").innerHTML = APP.sections.length ? APP.sections.map((x) => `<div class="card" style="background:var(--bg);margin-bottom:8px" data-sec="${x.id}">
        <div class="spread"><strong>Section ${esc(x.name)}</strong><span class="muted">${x.students} students${x.locked ? ' · <span class="badge ok">allocation validated</span>' : ""}</span></div>
        <div class="row fill" style="align-items:flex-end">
          <div><label>TD groups</label><input type="number" min="0" max="30" value="${x.td_count}" data-f="td"></div>
          <div><label>TP sub-groups</label><input type="number" min="0" max="60" value="${x.tp_count}" data-f="tp"></div>
          <div><label>Tolerance</label><input type="number" min="0" max="20" value="${x.tolerance}" data-f="tol"></div>
          <div><button class="small" data-save="${x.id}" style="width:100%">Save</button></div>
          ${x.students ? "" : `<div><button class="small red" data-del="${x.id}" style="width:100%">Delete</button></div>`}
        </div></div>`).join("") : `<p class="muted">No section yet. Importing the official list creates them (Students tab), or add one here.</p>`;
    $("secList").querySelectorAll("[data-save]").forEach((b) => b.onclick = async () => {
      const box = b.closest("[data-sec]"), x = APP.sections.find((s) => s.id === b.dataset.save), v = (f) => Number(box.querySelector(`[data-f=${f}]`).value);
      const lower = v("td") < x.td_count || v("tp") < x.tp_count;
      if (lower && !(await askInPage({ title: "Fewer groups", html: "<p>The students of the removed groups will no longer be placed (and lose their lab partner if needed). Continue?</p>", ok: "Continue" }))) return;
      try {
        const r = await rpc("api_section_save", { p_semester: sem.id, p_id: x.id, p_name: x.name, p_td_count: v("td"), p_tp_count: v("tp"), p_tolerance: v("tol"), p_color: "" });
        toast("Section saved." + (r.unplaced ? ` ${r.unplaced} places freed.` : ""), "ok"); await reloadSections(); secList();
      } catch (e) { toast(e.message, "error"); }
    });
    $("secList").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!(await askInPage({ title: "Delete the section?", html: "<p>It has no student.</p>", ok: "Delete", danger: true }))) return;
      try { await rpc("api_section_delete", { p_section: b.dataset.del }); await reloadSections(); secList(); } catch (e) { toast(e.message, "error"); }
    });
  };
  secList();
  SETUP2.render($("setup2"));
  $("newSecBtn").onclick = async () => {
    try {
      await rpc("api_section_save", { p_semester: sem.id, p_id: null, p_name: $("newSecName").value, p_td_count: Number($("newSecTd").value),
        p_tp_count: Number($("newSecTp").value), p_tolerance: Number($("newSecTol").value), p_color: "" });
      $("newSecName").value = ""; toast("Section added.", "ok"); await reloadSections(); secList();
    } catch (e) { toast(e.message, "error"); }
  };
}

// ------------------------------------------------------------------ Students: official list import and corrections
let STU = { list: [], q: "", section: "", inactive: false, book: null };
async function renderStudents() {
  const sem = APP.semester;
  $("main").innerHTML = `
    <div class="card"><h2>Import the official list</h2>
      <p class="muted" style="margin-top:0">Any workbook (.xlsx, .xls, .ods, .csv). The header line and the columns are found automatically: check them in the preview.
        Students already in the list are updated (never duplicated); groups already made are kept.</p>
      <input type="file" id="listFile" accept=".xlsx,.xls,.ods,.csv">
      <div id="listPreview"></div>
    </div>
    <div class="card"><div class="spread"><h2 style="margin:0">Students of ${esc(semesterLabel(sem))}</h2><button class="small" id="addStu">+ Add a student</button></div>
      <div class="row fill" style="margin-top:8px">
        <input id="stuSearch" placeholder="Search a name or a student number" value="${esc(STU.q)}">
        <select id="stuSection"><option value="">All sections</option>${APP.sections.map((x) => `<option value="${esc(x.name)}" ${STU.section === x.name ? "selected" : ""}>Section ${esc(x.name)}</option>`).join("")}</select>
        <label class="tick" style="margin:0"><input type="checkbox" id="stuInactive" ${STU.inactive ? "checked" : ""}> also those no longer in the list</label>
      </div>
      <div id="stuTable" style="margin-top:8px"><p class="muted">Loading…</p></div></div>`;
  $("listFile").onchange = () => { const f = $("listFile").files[0]; if (f) previewList(f); };
  $("stuSearch").oninput = () => { STU.q = $("stuSearch").value; drawStudents(); };
  $("stuSection").onchange = () => { STU.section = $("stuSection").value; drawStudents(); };
  $("stuInactive").onchange = () => { STU.inactive = $("stuInactive").checked; drawStudents(); };
  $("addStu").onclick = () => editStudent(null);
  await loadStudents();
}
async function loadStudents() {
  try { STU.list = await rpc("api_students", { p_semester: APP.semester.id }); drawStudents(); } catch (e) { $("stuTable").innerHTML = `<p>${esc(e.message)}</p>`; }
}
function drawStudents() {
  const q = nameKey(STU.q);
  const list = STU.list.filter((s) => (STU.inactive || s.active) && (!STU.section || s.section === STU.section)
    && (!q || nameKey(s.last_name + s.first_name).includes(q) || nameKey(s.first_name + s.last_name).includes(q) || s.matricule.includes(STU.q.trim())));
  const active = STU.list.filter((s) => s.active).length, inactive = STU.list.length - active;
  const byId = {}; STU.list.forEach((s) => { byId[s.id] = s; });
  $("stuTable").innerHTML = `<p class="muted">${active} students in the list${inactive ? `, ${inactive} no longer in the list` : ""} · ${list.length} shown</p>` +
    (list.length ? `<div class="table-scroll"><table class="cards-sm"><thead><tr><th>Matricule</th><th>Name</th><th>Section</th><th>Status</th><th>TD</th><th>TP</th><th>Partner</th><th></th></tr></thead><tbody>
    ${list.slice(0, 400).map((s) => `<tr ${s.active ? "" : 'style="opacity:.55"'}><td data-l="Matricule"><code>${esc(s.matricule)}</code></td><td data-l="Name"><strong>${esc(fullName(s))}</strong>${s.active ? "" : ' <span class="badge no">not in the list</span>'}</td>
      <td data-l="Section">${esc(s.section)}</td><td data-l="Status">${esc(s.status || "")}${STATUS_LABEL[s.status] ? ` <span class="muted small-text">${STATUS_LABEL[s.status]}</span>` : ""}</td>
      <td data-l="TD">${s.td ? "G" + s.td : "–"}</td><td data-l="TP">${s.tp ? "SG" + s.tp : "–"}</td><td data-l="Partner">${s.partner && byId[s.partner] ? esc(fullName(byId[s.partner])) : ""}</td>
      <td><button class="small secondary" data-edit="${s.id}">Edit</button></td></tr>`).join("")}</tbody></table></div>${list.length > 400 ? `<p class="muted">First 400 shown: search to narrow.</p>` : ""}` : "");
  $("stuTable").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => editStudent(STU.list.find((s) => s.id === Number(b.dataset.edit))));
}
async function editStudent(s) {
  if (!APP.sections.length) { toast("Create a section first (Setup tab).", "error"); return; }
  const ok = await askInPage({ title: s ? "Edit the student" : "Add a student", ok: "Save",
    html: `<label>Student number</label><input id="esMat" value="${esc(s ? s.matricule : "")}">
      <label>Last name</label><input id="esLast" value="${esc(s ? s.last_name : "")}">
      <label>First name</label><input id="esFirst" value="${esc(s ? s.first_name : "")}">
      <div class="row fill"><div><label>Section</label><select id="esSec">${APP.sections.map((x) => `<option value="${x.id}" ${s && s.section_id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
      <div><label>Status</label><select id="esStatus">${["N", "D", "EXT", ""].map((k) => `<option value="${k}" ${(s ? s.status || "" : "N") === k ? "selected" : ""}>${k ? k + " (" + STATUS_LABEL[k] + ")" : "none"}</option>`).join("")}</select></div></div>
      <label class="tick"><input type="checkbox" id="esActive" ${!s || s.active ? "checked" : ""}> in the official list</label>`,
    validate: (w) => {
      const mat = w.querySelector("#esMat").value, last = w.querySelector("#esLast").value;
      if (!/^[A-Za-z0-9 ]{4,24}$/.test(mat) || !last.trim()) { toast("Student number and last name are needed.", "error"); return false; }
      editStudent._v = { mat, last, first: w.querySelector("#esFirst").value, sec: w.querySelector("#esSec").value, status: w.querySelector("#esStatus").value, active: w.querySelector("#esActive").checked };
      return true;
    } });
  if (!ok) return;
  const v = editStudent._v;
  try {
    await rpc("api_student_save", { p_semester: APP.semester.id, p_id: s ? s.id : null, p_matricule: v.mat, p_last_name: v.last, p_first_name: v.first,
      p_section: v.sec, p_status: v.status, p_active: v.active });
    toast("Saved.", "ok"); await reloadSections(); await loadStudents();
  } catch (e) { toast(e.message, "error"); }
}

// Preview of the official list before import.
async function previewList(file) {
  const box = $("listPreview");
  box.innerHTML = `<p class="muted">Reading…</p>`;
  let book;
  try { book = await readWorkbookGrid(file); } catch (e) { box.innerHTML = errorBox("This file cannot be read (" + e.message + ")."); return; }
  const counts = book.names.map((n) => book.sheets[n].filter((r) => r.some(Boolean)).length);
  let sheet = book.names[counts.indexOf(Math.max(...counts))];
  const draw = (layout) => {
    const grid = book.sheets[sheet];
    const header = grid[layout.headerRow] || [];
    const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const opt = (sel) => `<option value="-1">— none —</option>` + [...Array(width).keys()].map((c) => `<option value="${c}" ${sel === c ? "selected" : ""}>${colLetter(c)}: ${esc((header[c] || "").slice(0, 24))}</option>`).join("");
    const rows = listRowsFromGrid(grid, layout.headerRow, layout.cols);
    const warns = listWarnings(rows);
    const info = layout.info, sem = APP.semester;
    const mism = [];
    if (info.semester && sem.code && info.semester !== sem.code) mism.push(`the file says ${info.semester}, the semester chosen is ${sem.code}`);
    if (info.year && info.year !== sem.year) mism.push(`the file says ${info.year}, the semester chosen is ${sem.year}`);
    const secs = [...new Set(rows.map((r) => r.section || "A"))].sort();
    const unknown = secs.filter((n) => !APP.sections.some((x) => x.name === n));
    box.innerHTML = `
      ${book.names.length > 1 ? `<label>Sheet</label><select id="lpSheet">${book.names.map((n) => `<option ${n === sheet ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
      ${info.program || info.semester || info.year ? `<p class="muted">Found above the table: ${esc([info.program, info.semester, info.year].filter(Boolean).join(" · "))}</p>` : ""}
      ${mism.length ? `<p class="badge warn" style="white-space:normal">⚠ ${esc(mism.join("; "))}: is it the right file / the right semester?</p>` : ""}
      <div class="row fill">
        <div><label>Header line</label><input type="number" id="lpHeader" min="1" value="${layout.headerRow + 1}"></div>
        ${[["matricule", "Student number"], ["last_name", "Last name"], ["first_name", "First name"], ["section", "Section"], ["status", "Status (N/D/EXT)"]]
          .map(([k, l]) => `<div><label>${l}</label><select data-col="${k}">${opt(layout.cols[k])}</select></div>`).join("")}
      </div>
      <p><strong>${rows.length}</strong> students · sections ${esc(secs.join(", "))}${unknown.length ? ` <span class="muted">(${esc(unknown.join(", "))} will be created with 2 TD groups and 6 TP sub-groups: adjust in Setup)</span>` : ""}</p>
      ${warns.length ? `<details ${warns.length < 6 ? "open" : ""}><summary class="badge warn">${warns.length} point(s) to check</summary><ul class="report">${warns.slice(0, 30).map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : `<p class="badge ok">No problem found.</p>`}
      <div class="table-scroll"><table><thead><tr><th>Line</th><th>Matricule</th><th>Last name</th><th>First name</th><th>Section</th><th>Status</th></tr></thead><tbody>
        ${rows.slice(0, 6).map((r) => `<tr><td>${r.line}</td><td><code>${esc(r.matricule)}</code></td><td>${esc(r.last_name)}</td><td>${esc(r.first_name)}</td><td>${esc(r.section)}</td><td>${esc(r.status)}</td></tr>`).join("")}
      </tbody></table></div>
      <label class="tick"><input type="checkbox" id="lpDeactivate"> Students of this semester missing from the file are no longer in the list (they lose their groups; nothing is deleted)</label>
      <button id="lpImport" class="green" style="width:100%;margin-top:8px" ${rows.length ? "" : "disabled"}>Import ${rows.length} students into ${esc(semesterLabel(sem))}</button>
      <div id="lpReport"></div>`;
    if (has("lpSheet")) $("lpSheet").onchange = () => { sheet = $("lpSheet").value; draw(detectListLayout(book.sheets[sheet])); };
    $("lpHeader").onchange = () => { const r = Math.max(0, Number($("lpHeader").value) - 1); draw({ headerRow: r, cols: listColumnsOf(grid[r] || []), info: layout.info }); };
    box.querySelectorAll("[data-col]").forEach((s) => s.onchange = () => { layout.cols[s.dataset.col] = Number(s.value); draw(layout); });
    $("lpImport").onclick = async () => {
      $("lpImport").disabled = true;
      try {
        const r = await rpc("api_import_students", { p_semester: sem.id, p_rows: rows, p_deactivate_missing: $("lpDeactivate").checked });
        $("lpReport").innerHTML = `<div class="card" style="background:#F1F8F3;margin-top:10px"><h3>Import done</h3><div class="kv">
          <span>Added</span><strong>${r.added}</strong><span>Changed (section or status)</span><strong>${r.updated}</strong><span>Back in the list</span><strong>${r.reactivated}</strong>
          <span>Unchanged</span><strong>${r.unchanged}</strong><span>No longer in the list</span><strong>${r.deactivated}</strong><span>Refused</span><strong>${r.rejected.length}</strong></div>
          ${r.rejected.length ? `<ul class="report">${r.rejected.map((x) => `<li>line ${esc(x.line)}: ${esc(x.reason)} (${esc(x.value)})</li>`).join("")}</ul>` : ""}
          ${r.new_sections.length ? `<p>New section(s): ${esc(r.new_sections.join(", "))} — check their numbers of groups in ⚙ Setup.</p>` : ""}</div>`;
        toast("List imported.", "ok"); await reloadSections(); await loadStudents();
      } catch (e) { $("lpReport").innerHTML = errorBox(e.message); toast(e.message, "error"); $("lpImport").disabled = false; }
    };
  };
  draw(detectListLayout(book.sheets[sheet]));
}

// ------------------------------------------------------------------ People: invitations, members
async function renderPeople() {
  const lvl = APP.level;
  $("main").innerHTML = `<div class="card"><h2>Invite someone</h2>
      <div class="row fill">
        <div><label for="invRole">Role</label><select id="invRole"><option value="delegate">Delegate of a section</option><option value="teacher">Teacher</option><option value="head">Head (co-head of this level)</option></select></div>
        <div id="invSecBox"><label for="invSec">Section</label><select id="invSec">${APP.sections.map((x) => `<option>${esc(x.name)}</option>`).join("") || "<option>A</option>"}</select></div>
        <div><label for="invNote">For whom (only you see it)</label><input id="invNote" placeholder="e.g. first delegate"></div>
      </div>
      <button id="invBtn" style="margin-top:10px">Create an invitation code</button>
      <div id="invOut"></div></div>
    <div class="card" id="teachersCard"></div>
    <div class="card"><h2>Members of ${esc(lvl.name)}</h2><div id="members"><p class="muted">Loading…</p></div></div>
    <div class="card"><h2>Codes not used yet</h2><div id="invites"></div></div>`;
  $("invRole").onchange = () => $("invSecBox").classList.toggle("hidden", $("invRole").value !== "delegate");
  $("invBtn").onclick = async () => {
    try {
      const r = await rpc("api_invite", { p_level: lvl.level_id, p_role: $("invRole").value, p_section: $("invSec").value, p_note: $("invNote").value });
      const link = new URL("index.html?code=" + r.code, location.href).href;
      const roleTxt = $("invRole").value === "delegate" ? `delegate of section ${$("invSec").value}` : $("invRole").value;
      const msg = `DeptDesk (${lvl.short_name || lvl.name}): you are invited as ${roleTxt}.\n1. Open ${link}\n2. Create your account (your e-mail and a password).\n3. Confirm the code ${r.code} and type your full name.\nThe code is valid 14 days, for one person.`;
      $("invOut").innerHTML = `<div style="margin-top:12px"><span class="code-pill" id="invCode">${esc(r.code)}</span>
        <p class="muted">Valid 14 days, one use. Send this message (WhatsApp, e-mail):</p><textarea id="invMsg" rows="5" readonly>${esc(msg)}</textarea>
        <button class="small secondary" id="invCopy" style="margin-top:6px">Copy the message</button></div>`;
      $("invCopy").onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("Copied.", "ok"); } catch (e) { $("invMsg").select(); toast("Select the text and copy it.", ""); } };
      $("invNote").value = ""; loadPeople();
    } catch (e) { toast(e.message, "error"); }
  };
  SETUP2.renderTeachers($("teachersCard"));
  await loadPeople();
}
async function loadPeople() {
  const lvl = APP.level;
  let p;
  try { p = await rpc("api_people", { p_level: lvl.level_id }); } catch (e) { $("members").innerHTML = esc(e.message); return; }
  $("members").innerHTML = `<table class="cards-sm"><thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Valid until</th><th></th></tr></thead><tbody>
    ${p.members.map((m) => `<tr><td data-l="Name"><strong>${esc(m.name || "—")}</strong>${m.me ? " (you)" : ""}</td><td data-l="E-mail">${esc(m.email)}</td>
      <td data-l="Role">${esc(ROLE_LABEL[m.role])}${m.section ? " " + esc(m.section) : ""}${m.role === "teacher" && !m.teacher_id ? ' <span class="badge warn">not linked to the directory</span>' : ""}</td>
      <td data-l="Valid until">${m.role === "delegate" ? (m.valid_until ? esc(dayText(m.valid_until)) : "no end") + (m.expired ? ' <span class="badge no">ended</span>' : "") : ""}</td>
      <td><div class="row">${m.role === "delegate" ? `<button class="small secondary" data-renew="${m.user_id}">Renew</button>` : ""}${m.me ? "" : `<button class="small red" data-remove="${m.user_id}">Remove</button>`}</div></td></tr>`).join("")}
    </tbody></table><p class="muted">Renew = valid until ${p.renew_until ? esc(dayText(p.renew_until)) : "the end of the current semester (set its last day in Setup)"}.</p>`;
  $("invites").innerHTML = p.invites.length ? `<table class="cards-sm"><thead><tr><th>Code</th><th>Role</th><th>For</th><th>Expires</th><th></th></tr></thead><tbody>
    ${p.invites.map((i) => `<tr><td data-l="Code"><code>${esc(i.code)}</code></td><td data-l="Role">${esc(ROLE_LABEL[i.role])} ${esc(i.section)}</td><td data-l="For">${esc(i.note)}</td>
      <td data-l="Expires">${esc(dayText(i.expires_at))}</td><td><button class="small secondary" data-revoke="${esc(i.code)}">Cancel</button></td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">None.</p>`;
  $("members").querySelectorAll("[data-renew]").forEach((b) => b.onclick = async () => {
    try { const r = await rpc("api_member_renew", { p_level: lvl.level_id, p_user: b.dataset.renew }); toast("Renewed until " + (r.valid_until ? dayText(r.valid_until) : "no end") + ".", "ok"); loadPeople(); } catch (e) { toast(e.message, "error"); }
  });
  $("members").querySelectorAll("[data-remove]").forEach((b) => b.onclick = async () => {
    const m = p.members.find((x) => x.user_id === b.dataset.remove);
    if (!(await askInPage({ title: "Remove this member?", html: `<p>${esc(m.name || m.email)} (${esc(ROLE_LABEL[m.role])}) loses access to ${esc(lvl.name)}. The account itself stays: a new code can bring him back.</p>`, ok: "Remove", danger: true }))) return;
    try { await rpc("api_member_remove", { p_level: lvl.level_id, p_user: m.user_id }); loadPeople(); } catch (e) { toast(e.message, "error"); }
  });
  $("invites").querySelectorAll("[data-revoke]").forEach((b) => b.onclick = async () => {
    try { await rpc("api_invite_revoke", { p_level: lvl.level_id, p_code: b.dataset.revoke }); loadPeople(); } catch (e) { toast(e.message, "error"); }
  });
}

// ------------------------------------------------------------------ Log
async function renderLog() {
  $("main").innerHTML = `<div class="card"><div class="spread"><h2 style="margin:0">Who did what</h2><input id="logQ" placeholder="Filter" style="max-width:240px"></div><div id="logBox"><p class="muted">Loading…</p></div></div>`;
  let rows = [];
  try { rows = await rpc("api_log", { p_level: APP.level.level_id, p_limit: 500 }); } catch (e) { $("logBox").textContent = e.message; return; }
  const draw = () => {
    const q = $("logQ").value.toLowerCase();
    const list = rows.filter((r) => !q || [r.who, r.role, r.action, r.detail].join(" ").toLowerCase().includes(q));
    $("logBox").innerHTML = `<table class="cards-sm"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td data-l="When">${esc(whenText(r.at))}</td><td data-l="Who">${esc(r.who)} <span class="muted">${esc(ROLE_LABEL[r.role] || r.role || "")}</span></td>
        <td data-l="What">${esc(r.action)}</td><td data-l="Detail" class="small-text">${esc(r.detail || "")}</td></tr>`).join("")}</tbody></table>`;
  };
  $("logQ").oninput = draw; draw();
}

// ------------------------------------------------------------------ Admin: levels and heads
async function renderAdmin() {
  $("main").innerHTML = `<div class="card"><h2>Levels of the department</h2><div id="lvlList"><p class="muted">Loading…</p></div></div>
    <div class="card"><h2 id="lvlFormTitle">New level</h2>
      <div class="row fill">
        <div><label for="lvName">Name</label><input id="lvName" placeholder="3rd year engineering ATT"></div>
        <div><label for="lvShort">Short name</label><input id="lvShort" placeholder="ING3 ATT"></div>
      </div>
      <div class="row fill">
        <div><label for="lvCycle">Cycle</label><select id="lvCycle"><option value="licence">Licence</option><option value="master">Master</option><option value="engineer" selected>Engineer</option><option value="other">Other</option></select></div>
        <div><label for="lvProgram">Program</label><input id="lvProgram" placeholder="ATT"></div>
        <div><label for="lvColor">Colour</label><input id="lvColor" type="color" value="#1B7F8C"></div>
      </div>
      <button id="lvSave" style="margin-top:10px">Save the level</button> <button id="lvNew" class="secondary hidden">New level instead</button></div>
    <div class="card"><h2>Name a head</h2>
      <div class="row fill"><div><label for="hdLevel">Level</label><select id="hdLevel"></select></div><div><label for="hdEmail">E-mail of his DeptDesk account</label><input id="hdEmail" type="email" value="${esc(APP.email)}"></div></div>
      <div class="row" style="margin-top:10px"><button id="hdAdd">Name this account head</button><button class="secondary" id="hdCode">No account yet: invitation code</button></div>
      <div id="hdOut"></div></div>`;
  let levels = [], editing = null;
  const load = async () => {
    try { levels = await rpc("api_admin_levels"); } catch (e) { $("lvlList").textContent = e.message; return; }
    $("lvlList").innerHTML = levels.length ? `<table class="cards-sm"><thead><tr><th>Level</th><th>Cycle</th><th>Heads</th><th>Members</th><th></th></tr></thead><tbody>
      ${levels.map((l) => `<tr><td data-l="Level"><span style="color:${esc(l.color)}">●</span> <strong>${esc(l.name)}</strong> <span class="muted">${esc(l.short_name)}</span></td>
        <td data-l="Cycle">${esc(l.cycle)} ${esc(l.program)}</td><td data-l="Heads">${esc(l.heads.join(", ") || "—")}</td><td data-l="Members">${l.members}</td>
        <td><button class="small secondary" data-editlv="${l.id}">Edit</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted">No level yet: create the first one below.</p>`;
    $("hdLevel").innerHTML = levels.map((l) => `<option value="${l.id}">${esc(l.short_name || l.name)}</option>`).join("");
    $("lvlList").querySelectorAll("[data-editlv]").forEach((b) => b.onclick = () => {
      const l = levels.find((x) => x.id === b.dataset.editlv); editing = l.id;
      $("lvlFormTitle").textContent = "Edit " + l.name; $("lvName").value = l.name; $("lvShort").value = l.short_name; $("lvCycle").value = l.cycle || "other";
      $("lvProgram").value = l.program; $("lvColor").value = l.color || "#1B7F8C"; $("lvNew").classList.remove("hidden");
    });
  };
  $("lvNew").onclick = () => { editing = null; $("lvlFormTitle").textContent = "New level"; ["lvName", "lvShort", "lvProgram"].forEach((i) => { $(i).value = ""; }); $("lvNew").classList.add("hidden"); };
  $("lvSave").onclick = async () => {
    try {
      await rpc("api_level_save", { p_id: editing, p_name: $("lvName").value, p_short_name: $("lvShort").value, p_cycle: $("lvCycle").value, p_program: $("lvProgram").value, p_color: $("lvColor").value });
      toast("Level saved.", "ok"); $("lvNew").click(); load();
    } catch (e) { toast(e.message, "error"); }
  };
  $("hdAdd").onclick = async () => {
    try {
      await rpc("api_level_add_head", { p_level: $("hdLevel").value, p_email: $("hdEmail").value });
      toast("Head named.", "ok"); await load();
      if ($("hdEmail").value.trim().toLowerCase() === APP.email.toLowerCase()) { APP.tab = null; await start(); }
    } catch (e) { toast(e.message, "error"); }
  };
  $("hdCode").onclick = async () => {
    try {
      const r = await rpc("api_invite", { p_level: $("hdLevel").value, p_role: "head", p_section: "", p_note: $("hdEmail").value });
      $("hdOut").innerHTML = `<p style="margin-top:10px"><span class="code-pill">${esc(r.code)}</span></p><p class="muted">Send it with the address of DeptDesk: the colleague creates his account, then types this code. Valid 14 days.</p>`;
    } catch (e) { toast(e.message, "error"); }
  };
  await load();
}

$("logoutBtn").onclick = async () => { if (typeof GROUPS !== "undefined") GROUPS.stop(); await db.auth.signOut(); location.href = "index.html"; };
watchNetwork("netBanner");
start();
