// DeptDesk v2 - Timetable tab: weekly slots by day, filters (group, teacher, room), students' / teachers' versions,
// entry and changes (head), room changes (delegate), import / export Excel, print / PDF, public page of a section.
(window.DD_FILES = window.DD_FILES || {})["timetable.js"] = "2"; // file version, checked by the page

const TT = {
  sectionId: null, view: "", students: false, slots: [], sub: "week",

  async render(m) {
    const secs = role() === "delegate" ? mySections() : APP.sections;
    if (!secs.find((x) => x.id === this.sectionId)) this.sectionId = secs.length ? secs[0].id : null;
    if (role() === "teacher" && this.view === "" && APP.level.teacher_id) this.view = "teacher:" + APP.level.teacher_id;
    m.innerHTML = `<div class="card no-print-pad">
        ${secs.length > 1 ? `<div class="sec-chips no-print">${secs.map((x) => `<button data-tsec="${x.id}" class="${x.id === this.sectionId ? "on" : ""}">Section ${esc(x.name)}</button>`).join("")}</div>` : ""}
        <div class="row fill no-print"><select id="ttView"></select>
          <label class="tick" style="margin:0"><input type="checkbox" id="ttStudents" ${this.students ? "checked" : ""}> students' version (no teachers)</label></div>
        <h2 id="ttTitle" style="margin:12px 0 6px"></h2><p class="muted" id="ttWeek" style="margin:0 0 10px"></p>
        <div id="ttBody"><p class="muted">Loading…</p></div></div>
      <div class="card no-print" id="ttTools"></div>`;
    m.querySelectorAll("[data-tsec]").forEach((b) => b.onclick = () => { this.sectionId = b.dataset.tsec; this.view = ""; this.render(m); });
    $("ttStudents").onchange = () => { this.students = $("ttStudents").checked; this.draw(); };
    try {
      await loadRefs();
      // a teacher's view covers every section; the others see one section
      this.slots = await rpc("api_timetable", { p_semester: APP.semester.id, p_section: null });
      const weeks = await rpc("api_weeks", { p_semester: APP.semester.id });
      const cur = weeks.find((w) => w.current);
      $("ttWeek").textContent = cur ? (cur.kind === "teaching" ? `This week: teaching week ${cur.no}, week ${cur.parity}.` : `This week: ${cur.kind}.`) : "";
    } catch (e) { $("ttBody").innerHTML = errorBox(e.message); return; }
    this.fillViews(); this.draw(); this.tools();
  },

  section() { return APP.sections.find((x) => x.id === this.sectionId); },
  fillViews() {
    const sec = this.section(), opts = [["", sec ? `Section ${sec.name}: everything` : "Everything"]];
    if (sec) {
      targetsFor(sec, "td").forEach((t) => opts.push([t, `Section ${sec.name} · TD group ${t}`]));
      targetsFor(sec, "tp").forEach((t) => opts.push([t, `Section ${sec.name} · TP sub-group ${t}`]));
    }
    const teachers = [...new Map(this.slots.filter((s) => s.teacher_id).map((s) => [s.teacher_id, s.teacher])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    teachers.forEach(([id, label]) => opts.push(["teacher:" + id, `Teacher: ${label}${APP.level.teacher_id === id ? " (me)" : ""}`]));
    [...new Set(this.slots.map((s) => s.room).filter(Boolean))].sort().forEach((r) => opts.push(["room:" + r, `Room: ${r}`]));
    if (!opts.find((o) => o[0] === this.view)) this.view = "";
    $("ttView").innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === this.view ? "selected" : ""}>${esc(l)}</option>`).join("");
    $("ttView").onchange = () => { this.view = $("ttView").value; this.draw(); };
  },
  visibleSlots() {
    const v = this.view;
    if (v.startsWith("teacher:")) return this.slots.filter((s) => s.teacher_id === v.slice(8));
    if (v.startsWith("room:")) return this.slots.filter((s) => s.room === v.slice(5));
    const inSec = this.slots.filter((s) => s.section_id === this.sectionId);
    if (!v) return inSec;
    return inSec.filter((s) => s.target === "" || s.target === v);
  },
  title() {
    const v = this.view, sec = this.section();
    if (v.startsWith("teacher:")) return "Timetable of " + ((this.slots.find((s) => s.teacher_id === v.slice(8)) || {}).teacher || "");
    if (v.startsWith("room:")) return "Room " + v.slice(5);
    return `Section ${sec ? sec.name : ""}${v ? " · " + v : ""}`;
  },

  draw() {
    const list = this.visibleSlots(), head = role() === "head", del = role() === "delegate";
    const crossSections = this.view.startsWith("teacher:") || this.view.startsWith("room:");
    $("ttTitle").textContent = this.title() + (this.students ? "" : "");
    const days = [0, 1, 2, 3, 4, 5].concat(list.some((s) => s.day === 6) ? [6] : []);
    $("ttBody").innerHTML = list.length || head ? days.map((d) => {
      const items = list.filter((s) => s.day === d).sort((a, b) => a.starts.localeCompare(b.starts) || a.target.localeCompare(b.target));
      return `<div class="day-row"><div class="dname">${DAYS[d]}${head && !crossSections ? ` <button class="small secondary no-print" data-add="${d}" title="Add a slot">+</button>` : ""}</div>
        <div class="slots">${items.map((s) => `<div class="slot" style="--mod:${esc(s.color)}" ${head ? `data-edit="${s.id}"` : ""}>
          <div class="t">${hm(s.starts)}–${hm(s.ends)} · ${esc(s.module)} ${s.kind === "course" ? "" : KIND_NAME[s.kind]}${s.target ? " · " + esc(s.target) : ""}${s.parity !== "all" ? ` <span class="pill">week ${s.parity}</span>` : ""}</div>
          <div class="m">${crossSections ? "Section " + esc(s.section) + " · " : ""}${esc(s.module_name || "")}</div>
          <div class="m">📍 ${esc(s.room || "room?")}${!this.students && s.teacher ? " · " + esc(s.teacher) : ""}
            ${del ? ` <button class="linklike no-print" data-room="${s.id}" style="min-height:0">change room</button>` : ""}</div></div>`).join("") || '<span class="muted small-text">—</span>'}</div></div>`;
    }).join("") : `<p class="muted">No timetable yet.${head ? " Add slots with + (each day), or import the Excel template below." : ""}</p>`;
    $("ttBody").querySelectorAll("[data-add]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); this.editSlot(null, Number(b.dataset.add)); });
    $("ttBody").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => this.editSlot(this.slots.find((s) => s.id === Number(b.dataset.edit))));
    $("ttBody").querySelectorAll("[data-room]").forEach((b) => b.onclick = async () => {
      const s = this.slots.find((x) => x.id === Number(b.dataset.room));
      let v = null;
      const ok = await askInPage({ title: `Room of ${s.module} ${KIND_NAME[s.kind]} ${s.target}`, ok: "Save", html: `<input id="nr" value="${esc(s.room)}">`, validate: (w) => { v = w.querySelector("#nr").value; return true; } });
      if (!ok) return;
      try { await rpc("api_slot_room", { p_slot: s.id, p_room: v }); toast("Room changed.", "ok"); this.render($("main")); } catch (e) { toast(e.message, "error"); }
    });
  },

  async editSlot(s, day) {
    if (!APP.modules.length) { toast("Add the modules first (⚙ Setup), or import the timetable.", "error"); return; }
    const sec = this.section();
    let vals = null;
    const teachers = `<option value="">(the teacher of the module for this group)</option>` + APP.teachers.filter((t) => t.active).map((t) => `<option value="${t.id}" ${s && s.own_teacher && s.teacher_id === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    const ok = await askInPage({ title: s ? "Change the slot" : `New slot, ${DAYS[day]}`, ok: "Save",
      html: `<div class="row fill"><div><label>Day</label><select id="slDay">${DAYS.map((d, i) => `<option value="${i}" ${(s ? s.day : day) === i ? "selected" : ""}>${d}</option>`).join("")}</select></div>
          <div><label>Start</label><input type="time" id="slStart" value="${esc(s ? hm(s.starts) : "08:00")}"></div><div><label>End</label><input type="time" id="slEnd" value="${esc(s ? hm(s.ends) : "09:30")}"></div></div>
        <label>Module and activity</label><select id="slAct">${activityOptions(s ? s.activity_id : null)}</select>
        <div class="row fill"><div><label>Group</label><select id="slTarget"></select></div>
          <div><label>Week</label><select id="slParity">${[["all", "every week"], ["A", "week A"], ["B", "week B"]].map(([v, l]) => `<option value="${v}" ${(s ? s.parity : "all") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
        <div class="row fill"><div><label>Room</label><input id="slRoom" value="${esc(s ? s.room : "")}"></div><div><label>Teacher</label><select id="slTeacher">${teachers}</select></div></div>
        <label>Note</label><input id="slNote" value="${esc(s ? s.note : "")}">
        ${s ? `<button class="small red" id="slDel" style="margin-top:8px">Delete this slot</button>` : ""}`,
      onOpen: (w) => {
        const fill = () => { const a = activityById(w.querySelector("#slAct").value);
          w.querySelector("#slTarget").innerHTML = targetsFor(sec, a ? a.kind : "course").map((t) => `<option value="${t}" ${s && s.target === t ? "selected" : ""}>${t || "Whole section"}</option>`).join(""); };
        w.querySelector("#slAct").onchange = fill; fill();
        if (w.querySelector("#slDel")) w.querySelector("#slDel").onclick = async () => {
          try { await rpc("api_slot_delete", { p_slot: s.id }); w.close(false); toast("Slot deleted.", "ok"); this.render($("main")); } catch (e) { toast(e.message, "error"); }
        };
      },
      validate: (w) => {
        vals = { day: Number(w.querySelector("#slDay").value), starts: w.querySelector("#slStart").value, ends: w.querySelector("#slEnd").value, act: w.querySelector("#slAct").value,
          target: w.querySelector("#slTarget").value, parity: w.querySelector("#slParity").value, room: w.querySelector("#slRoom").value, teacher: w.querySelector("#slTeacher").value || null,
          note: w.querySelector("#slNote").value };
        if (!vals.starts || !vals.ends || vals.ends <= vals.starts) { toast("Check the hours.", "error"); return false; }
        return true;
      } });
    if (!ok) return;
    try {
      const r = await rpc("api_slot_save", { p_semester: APP.semester.id, p_id: s ? s.id : null, p_section: this.sectionId, p_activity: vals.act, p_target: vals.target,
        p_day: vals.day, p_starts: vals.starts, p_ends: vals.ends, p_parity: vals.parity, p_room: vals.room, p_teacher: vals.teacher, p_note: vals.note });
      if (r.conflicts.length) {
        const why = { teacher: "same teacher", room: "same room", students: "same students" };
        await askInPage({ title: "Saved, but check these overlaps", ok: "OK", cancel: false,
          html: `<ul class="report">${r.conflicts.map((c) => `<li><strong>${esc(why[c.why])}</strong>: section ${esc(c.section)} ${esc(c.module)} ${esc(c.target || "")} ${hm(c.starts)}–${hm(c.ends)}</li>`).join("")}</ul>` });
      } else toast("Slot saved.", "ok");
      this.render($("main"));
    } catch (e) { toast(e.message, "error"); }
  },

  tools() {
    const head = role() === "head", sec = this.section();
    $("ttTools").innerHTML = `<h3>Print and export</h3>
      <div class="row"><button class="secondary" id="ttPrint">🖨 Print / PDF</button><button class="secondary" id="ttGrid">Excel grid</button>
        ${head ? `<button class="secondary" id="ttTpl">Excel template (one line per slot)</button>` : ""}</div>
      <p class="muted">Print / PDF: in the print window choose "Save as PDF". The students' version hides the teachers.</p>
      ${head && sec ? `<hr style="border:none;border-top:1px solid var(--ice2);margin:14px 0"><h3>Import the timetable of section ${esc(sec.name)}</h3>
        <p class="muted" style="margin-top:0">The Excel template: Day, Start, End, Module, Module name, Activity, Group, Week, Room, Teacher. Missing modules and teachers are created.</p>
        <input type="file" id="ttFile" accept=".xlsx,.xls,.ods,.csv"><div id="ttImpOut"></div>
        <hr style="border:none;border-top:1px solid var(--ice2);margin:14px 0"><h3>Public page of section ${esc(sec.name)}</h3>
        <p class="muted" style="margin-top:0">For the students, without account: the timetable (no teachers) and, with their student number, their TD group and TP sub-group.</p>
        <button class="secondary" id="ttPub">Show the link</button><div id="ttPubOut"></div>` : ""}`;
    $("ttPrint").onclick = () => window.print();
    $("ttGrid").onclick = () => exportTimetableGrid(ctxNames(), this.visibleSlots(), this.title(), this.students);
    if (!head) return;
    $("ttTpl").onclick = () => exportTimetableTemplate(ctxNames(), this.slots.filter((s) => s.section_id === this.sectionId), sec ? "section_" + sec.name : "");
    if (!sec) return;
    $("ttFile").onchange = () => { const f = $("ttFile").files[0]; if (f) this.importPreview(f); };
    $("ttPub").onclick = () => this.publicLink(false);
  },

  async importPreview(file) {
    const out = $("ttImpOut");
    out.innerHTML = `<p class="muted">Reading…</p>`;
    let parsed;
    try { parsed = parseTimetableWorkbook(await readWorkbookGrid(file)); } catch (e) { out.innerHTML = errorBox("This file cannot be read (" + e.message + ")."); return; }
    if (!parsed.rows.length) { out.innerHTML = errorBox(parsed.problems.join(" ") || "No slot found in this file."); return; }
    let rep;
    try { rep = await rpc("api_timetable_import", { p_semester: APP.semester.id, p_section: this.sectionId, p_rows: parsed.rows, p_replace: false, p_apply: false }); }
    catch (e) { out.innerHTML = errorBox(e.message); return; }
    const problems = parsed.problems.concat(rep.problems.map((p) => `line ${p.line}: ${p.problem}`));
    out.innerHTML = `<div class="card" style="background:var(--bg);margin-top:10px">
      <p><strong>${rep.slots}</strong> slots recognised in "${esc(parsed.sheet)}".</p>
      ${rep.new_modules.length ? `<p>New modules: ${esc(rep.new_modules.join(", "))}</p>` : ""}
      ${rep.new_teachers.length ? `<p>New teachers (added to the directory; complete their e-mail later): ${esc(rep.new_teachers.join(", "))}</p>` : ""}
      ${problems.length ? `<p class="badge warn">${problems.length} line(s) not imported</p><ul class="report">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      ${rep.existing_slots ? `<label class="tick"><input type="checkbox" id="ttReplace" checked> Replace the ${rep.existing_slots} slots already in this section</label>` : ""}
      <button class="green" id="ttApply">Import ${rep.slots} slots</button></div>`;
    $("ttApply").onclick = async () => {
      $("ttApply").disabled = true;
      try {
        await rpc("api_timetable_import", { p_semester: APP.semester.id, p_section: this.sectionId, p_rows: parsed.rows, p_replace: has("ttReplace") ? $("ttReplace").checked : false, p_apply: true });
        toast("Timetable imported.", "ok"); APP.modules = null; APP.teachers = null; this.render($("main"));
      } catch (e) { out.insertAdjacentHTML("beforeend", errorBox(e.message)); $("ttApply").disabled = false; }
    };
  },

  async publicLink(fresh) {
    if (fresh && !(await askInPage({ title: "New link?", html: "<p>The old link and QR code stop working at once.</p>", ok: "New link", danger: true }))) return;
    try {
      const r = await rpc("api_public_link", { p_section: this.sectionId, p_new: fresh });
      const url = new URL("public.html?t=" + r.token, location.href).href;
      let qr = "";
      try { const q = qrcode(0, "M"); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2 }); } catch (e) { qr = ""; }
      $("ttPubOut").innerHTML = `<div class="row" style="margin-top:10px;align-items:flex-start"><div class="qr-box">${qr}</div>
        <div style="flex:1 1 240px"><input readonly value="${esc(url)}" id="pubUrl"><div class="row" style="margin-top:6px">
        <button class="small secondary" id="pubCopy">Copy the link</button><a href="${esc(url)}" target="_blank" rel="noopener"><button class="small secondary">Open</button></a>
        <button class="small red" id="pubNew">New link</button></div></div></div>`;
      $("pubCopy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Copied.", "ok"); } catch (e) { $("pubUrl").select(); } };
      $("pubNew").onclick = () => this.publicLink(true);
    } catch (e) { toast(e.message, "error"); }
  },
};
