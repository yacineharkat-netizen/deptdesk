// DeptDesk v2 - Follow-up tab: sessions of the day from the timetable (delegate), records, board (planned / done / gap),
// starting point (head), the teacher's answers.
(window.DD_FILES = window.DD_FILES || {})["followup.js"] = "2.2"; // file version, checked by the page

const STATUS_NAME = { done: "done", cancelled: "cancelled", makeup: "make-up" };
const TSTATE_NAME = { pending: "waiting for the teacher", confirmed: "confirmed by the teacher", auto_confirmed: "confirmed (no answer in time)", disputed: "the teacher disagrees" };

const FOLLOW = {
  sub: null, day: null, sectionId: null, asOf: null,

  subsFor() {
    const r = role();
    if (r === "teacher") return [["mine", "My sessions"], ["board", "Board"]];
    if (r === "delegate") return [["today", "Today"], ["records", "Records"], ["board", "Board"]];
    return [["board", "Board"], ["today", "Day"], ["records", "Records"], ["start", "Starting point"]];
  },

  async render(m) {
    const subs = this.subsFor();
    if (!subs.find((s) => s[0] === this.sub)) this.sub = subs[0][0];
    if (!this.day) this.day = todayAlgiers();
    if (!this.asOf) this.asOf = todayAlgiers();
    const secs = mySections();
    if (!secs.find((x) => x.id === this.sectionId)) this.sectionId = secs.length ? secs[0].id : null;
    m.innerHTML = `<div class="sub-tabs">${subs.map(([k, l]) => `<button data-fsub="${k}" class="${k === this.sub ? "on" : ""}">${l}</button>`).join("")}</div><div id="fBody"><p class="muted">Loading…</p></div>`;
    m.querySelectorAll("[data-fsub]").forEach((b) => b.onclick = () => { this.sub = b.dataset.fsub; this.render(m); });
    try { await loadRefs(); } catch (e) { $("fBody").innerHTML = errorBox(e.message); return; }
    if (!APP.modules.length && this.sub !== "mine") {
      $("fBody").innerHTML = `<div class="card"><p>No module yet for this semester.</p>${isHead() ? `<p class="muted">Add the modules in ⚙ Setup, or import the timetable (🗓 Timetable tab).</p>` : `<p class="muted">The head has not entered the modules yet.</p>`}</div>`;
      return;
    }
    ({ today: () => this.today(), records: () => this.records(), board: () => this.board(), start: () => this.start(), mine: () => this.mine() })[this.sub]();
  },

  sectionChips() {
    const secs = mySections();
    if (secs.length < 2) return "";
    return `<div class="sec-chips">${secs.map((x) => `<button data-fsec="${x.id}" class="${x.id === this.sectionId ? "on" : ""}">Section ${esc(x.name)}</button>`).join("")}</div>`;
  },
  bindChips(again) { document.querySelectorAll("[data-fsec]").forEach((b) => b.onclick = () => { this.sectionId = b.dataset.fsec; again(); }); },

  // ---------------------------------------------------------------- the day (from the timetable)
  async today() {
    const box = $("fBody");
    if (!this.sectionId) { box.innerHTML = `<div class="card"><p>No section.</p></div>`; return; }
    box.innerHTML = `<div class="card">${this.sectionChips()}
      <div class="row"><label for="fDay" style="margin:0">Day</label><input type="date" id="fDay" value="${this.day}" max="${todayAlgiers()}" style="width:auto">
        <button class="small secondary" id="fPrev">◀</button><button class="small secondary" id="fNext">▶</button></div>
      <div id="fPlan" style="margin-top:10px"><p class="muted">Loading…</p></div>
      <button id="fOther" class="secondary" style="width:100%;margin-top:10px">+ Another session (make-up, extra, not in the timetable)</button></div>`;
    this.bindChips(() => this.today());
    const shift = (n) => { const d = new Date(this.day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); const v = d.toISOString().slice(0, 10); if (v <= todayAlgiers()) { this.day = v; this.today(); } };
    $("fDay").onchange = () => { if ($("fDay").value) { this.day = $("fDay").value; this.today(); } };
    $("fPrev").onclick = () => shift(-1); $("fNext").onclick = () => shift(1);
    $("fOther").onclick = () => this.editSession(null, { day: this.day, section_id: this.sectionId });
    let plan;
    try { plan = await rpc("api_day_plan", { p_section: this.sectionId, p_day: this.day }); } catch (e) { $("fPlan").innerHTML = errorBox(e.message); return; }
    const head = `<p class="muted" style="margin:0 0 8px"><strong>${esc(dayText(this.day))}</strong>${plan.week_no ? ` · teaching week ${plan.week_no}${plan.parity ? " (week " + plan.parity + ")" : ""}` : ""}</p>`;
    if (plan.week_kind !== "teaching") {
      $("fPlan").innerHTML = head + `<p class="muted">${plan.week_kind === "outside" ? "This day is outside the semester (or the semester dates are not set)." : `This week is marked "${esc(plan.week_kind)}".`} You can still record a session below.</p>`;
      return;
    }
    if (!plan.slots.length) {
      $("fPlan").innerHTML = head + `<p class="muted">Nothing planned on this day${APP.modules.length ? " in the timetable" : ""}. Use the button below to record a session.</p>`;
      return;
    }
    $("fPlan").innerHTML = head + `<div class="stu-list">${plan.slots.map((s) => {
      const c = s.session;
      return `<div class="slot ${c ? (c.status === "cancelled" ? "cancelled" : "done") : ""}" data-slot="${s.slot_id}">
        <div class="t">${hm(s.starts)}–${hm(s.ends)} · ${esc(s.module)} ${KIND_NAME[s.kind]}${s.target ? " · " + esc(s.target) : ""}</div>
        <div class="m">${esc(s.module_name || "")}${s.teacher ? " · " + esc(s.teacher) : ""} · room <strong>${esc((c && c.room) || s.room || "?")}</strong>
          ${!c ? `<button class="linklike" data-room="${s.slot_id}" style="min-height:0">change</button>` : ""}</div>
        ${c ? `<div class="row" style="margin-top:6px"><span class="pill ${c.status === "done" ? "" : c.status}">${STATUS_NAME[c.status]}</span>${c.mode === "online" ? '<span class="pill online">online</span>' : ""}
            ${c.note ? `<span class="muted">${esc(c.note)}</span>` : ""}${c.editable ? `<button class="small secondary" data-cedit="${c.id}">Change</button>` : ""}</div>`
          : `<input placeholder="remark (optional)" data-note="${s.slot_id}" style="margin-top:6px">
            <div class="row" style="margin-top:6px"><button class="small green" data-mark="${s.slot_id}|done|in_person">✔ Done</button>
              <button class="small" data-mark="${s.slot_id}|done|online">💻 Online</button><button class="small red" data-mark="${s.slot_id}|cancelled|in_person">✕ Not held</button></div>`}
      </div>`;
    }).join("")}</div>`;
    $("fPlan").querySelectorAll("[data-mark]").forEach((b) => b.onclick = async () => {
      const [slotId, status, mode] = b.dataset.mark.split("|"), s = plan.slots.find((x) => String(x.slot_id) === slotId);
      const note = ($("fPlan").querySelector(`[data-note="${slotId}"]`) || {}).value || "";
      if (status === "cancelled" && !note.trim()) { toast("Write the reason in the remark (teacher absent, strike, room…).", "error"); return; }
      b.disabled = true;
      try {
        await rpc("api_session_save", { p_semester: APP.semester.id, p_id: null, p_section: this.sectionId, p_activity: s.activity_id, p_target: s.target, p_day: this.day,
          p_starts: s.starts, p_mode: mode, p_status: status, p_room: s.room, p_teacher: null, p_note: note, p_slot: s.slot_id });
        toast("Recorded.", "ok"); this.today();
      } catch (e) { toast(e.message, "error"); b.disabled = false; }
    });
    $("fPlan").querySelectorAll("[data-room]").forEach((b) => b.onclick = async () => {
      const s = plan.slots.find((x) => String(x.slot_id) === b.dataset.room);
      let v = null;
      const ok = await askInPage({ title: `Room of ${s.module} ${KIND_NAME[s.kind]} ${s.target}`, ok: "Save",
        html: `<p class="muted">Changes the room of this slot in the timetable (every week).</p><input id="newRoom" value="${esc(s.room)}">`,
        validate: (w) => { v = w.querySelector("#newRoom").value; return true; } });
      if (!ok) return;
      try { await rpc("api_slot_room", { p_slot: s.slot_id, p_room: v }); toast("Room changed.", "ok"); this.today(); } catch (e) { toast(e.message, "error"); }
    });
    $("fPlan").querySelectorAll("[data-cedit]").forEach((b) => b.onclick = async () => {
      const list = await rpc("api_sessions", { p_semester: APP.semester.id, p_section: this.sectionId, p_from: this.day, p_to: this.day });
      this.editSession(list.find((x) => x.id === Number(b.dataset.cedit)), {});
    });
  },

  // ---------------------------------------------------------------- one session (form)
  async editSession(c, def) {
    const secs = mySections();
    let vals = null;
    const secId = c ? c.section_id : def.section_id || this.sectionId;
    const teachers = `<option value="">(the teacher of the module)</option>` + (APP.teachers || []).filter((t) => t.active).map((t) => `<option value="${t.id}" ${c && c.teacher_id === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    const ok = await askInPage({ title: c ? "Change the session" : "Record a session", ok: "Save",
      html: `${secs.length > 1 ? `<label>Section</label><select id="esSecF">${secs.map((x) => `<option value="${x.id}" ${x.id === secId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
        <label>Module and activity</label><select id="esAct">${activityOptions(c ? c.activity_id : null)}</select>
        <label>Group</label><select id="esTarget"></select>
        <div class="row fill"><div><label>Date</label><input type="date" id="esDay" value="${esc(c ? c.day : def.day || todayAlgiers())}" max="${todayAlgiers()}"></div>
          <div><label>Start (optional)</label><input type="time" id="esStart" value="${esc(c && c.starts ? hm(c.starts) : "")}"></div></div>
        <div class="row fill"><div><label>Held</label><select id="esStatus">${["done", "makeup", "cancelled"].map((k) => `<option value="${k}" ${(c ? c.status : "done") === k ? "selected" : ""}>${k === "done" ? "yes" : k === "makeup" ? "yes, a make-up" : "no (cancelled)"}</option>`).join("")}</select></div>
          <div><label>How</label><select id="esMode"><option value="in_person">in person</option><option value="online" ${c && c.mode === "online" ? "selected" : ""}>online</option></select></div></div>
        <div class="row fill"><div><label>Room</label><input id="esRoom" value="${esc(c ? c.room : "")}"></div><div><label>Teacher</label><select id="esTeacher">${teachers}</select></div></div>
        <label>Remark (anomaly, reason of a cancellation…)</label><textarea id="esNote" rows="2">${esc(c ? c.note : "")}</textarea>
        ${c && c.editable ? `<button class="small red" id="esDel" style="margin-top:8px">Delete this record</button>` : ""}`,
      onOpen: (w) => {
        const fillTargets = () => {
          const a = activityById(w.querySelector("#esAct").value), sec = APP.sections.find((x) => x.id === (w.querySelector("#esSecF") ? w.querySelector("#esSecF").value : secId));
          const list = a ? targetsFor(sec, a.kind) : [""];
          w.querySelector("#esTarget").innerHTML = list.map((t) => `<option value="${t}" ${c && c.target === t ? "selected" : ""}>${t || "Whole section"}</option>`).join("");
        };
        w.querySelector("#esAct").onchange = fillTargets;
        if (w.querySelector("#esSecF")) w.querySelector("#esSecF").onchange = fillTargets;
        fillTargets();
        if (w.querySelector("#esDel")) w.querySelector("#esDel").onclick = async () => {
          try { await rpc("api_session_delete", { p_id: c.id }); w.close(false); toast("Deleted.", "ok"); this.render($("main")); } catch (e) { toast(e.message, "error"); }
        };
      },
      validate: (w) => {
        vals = { sec: w.querySelector("#esSecF") ? w.querySelector("#esSecF").value : secId, act: w.querySelector("#esAct").value, target: w.querySelector("#esTarget").value,
          day: w.querySelector("#esDay").value, start: w.querySelector("#esStart").value || null, status: w.querySelector("#esStatus").value, mode: w.querySelector("#esMode").value,
          room: w.querySelector("#esRoom").value, teacher: w.querySelector("#esTeacher").value || null, note: w.querySelector("#esNote").value };
        if (!vals.day) { toast("Choose the date.", "error"); return false; }
        if (vals.status === "cancelled" && !vals.note.trim()) { toast("Write the reason of the cancellation in the remark.", "error"); return false; }
        return true;
      } });
    if (!ok) return;
    try {
      await rpc("api_session_save", { p_semester: APP.semester.id, p_id: c ? c.id : null, p_section: vals.sec, p_activity: vals.act, p_target: vals.target, p_day: vals.day,
        p_starts: vals.start, p_mode: vals.mode, p_status: vals.status, p_room: vals.room, p_teacher: vals.teacher, p_note: vals.note, p_slot: c ? c.slot_id : null });
      toast("Saved.", "ok"); this.render($("main"));
    } catch (e) { toast(e.message, "error"); }
  },

  sessionCard(c, opts) {
    return `<div class="slot ${c.status === "cancelled" ? "cancelled" : ""}">
      <div class="spread"><span class="t">${esc(dayText(c.day))}${c.starts ? " " + hm(c.starts) : ""} · ${esc(c.module)} ${KIND_NAME[c.kind]}${c.target ? " · " + esc(c.target) : ""}</span>
        <span class="row"><span class="pill ${c.status === "done" ? "" : c.status}">${STATUS_NAME[c.status]}</span>${c.mode === "online" ? '<span class="pill online">online</span>' : ""}</span></div>
      <div class="m">${mySections().length > 1 || opts.showSection ? "Section " + esc(c.section) + " · " : ""}${esc(c.teacher || "teacher?")}${c.room ? " · " + esc(c.room) : ""}
        · <span class="pill ${c.teacher_state}">${esc(TSTATE_NAME[c.teacher_state] || c.teacher_state)}</span></div>
      ${c.note ? `<div style="margin-top:4px">📝 ${esc(c.note)}</div>` : ""}
      ${c.teacher_comment ? `<div style="margin-top:4px">💬 <em>${esc(c.teacher_comment)}</em></div>` : ""}
      ${opts.actions ? `<div class="row" style="margin-top:6px">${opts.actions(c)}</div>` : ""}</div>`;
  },

  // ---------------------------------------------------------------- records
  async records() {
    const box = $("fBody");
    box.innerHTML = `<div class="card">${this.sectionChips()}<div class="spread"><h2 style="margin:0">Recorded sessions</h2><button class="small" id="fAdd">+ Record a session</button></div>
      <div id="fList" style="margin-top:10px"><p class="muted">Loading…</p></div></div>`;
    this.bindChips(() => this.records());
    $("fAdd").onclick = () => this.editSession(null, { section_id: this.sectionId });
    let list;
    try { list = await rpc("api_sessions", { p_semester: APP.semester.id, p_section: this.sectionId }); } catch (e) { $("fList").innerHTML = errorBox(e.message); return; }
    $("fList").innerHTML = list.length ? `<div class="stu-list">${list.slice(0, 300).map((c) => this.sessionCard(c, {
      actions: (x) => (x.editable ? `<button class="small secondary" data-cedit="${x.id}">Change</button>` : `<span class="muted small-text">${role() === "delegate" ? "more than 7 days: only the head can change it" : ""}</span>`) })).join("")}</div>`
      : `<p class="muted">Nothing recorded yet.</p>`;
    $("fList").querySelectorAll("[data-cedit]").forEach((b) => b.onclick = () => this.editSession(list.find((c) => c.id === Number(b.dataset.cedit)), {}));
  },

  // ---------------------------------------------------------------- board
  async board() {
    const box = $("fBody");
    box.innerHTML = `<div class="card"><div class="spread"><h2 style="margin:0">Follow-up on</h2>
        <div class="row"><input type="date" id="fAsOf" value="${this.asOf}" style="width:auto"><button class="small secondary" id="fExport">Export (Excel)</button></div></div>
      <p class="muted">Planned = from the timetable (or the rhythm of the module), holiday weeks excluded. TD and TP: the smallest number among the groups (detail below each line).</p>
      <div id="fBoard"><p class="muted">Loading…</p></div></div>`;
    $("fAsOf").onchange = () => { if ($("fAsOf").value) { this.asOf = $("fAsOf").value; this.board(); } };
    let b;
    try { b = await rpc("api_followup_board", { p_semester: APP.semester.id, p_as_of: this.asOf }); } catch (e) { $("fBoard").innerHTML = errorBox(e.message); return; }
    $("fExport").onclick = () => exportFollowup(ctxNames(), b);
    const sections = [...new Set(b.rows.map((r) => r.section))];
    const gapCls = (g) => (g >= 2 ? "gap-bad" : g === 1 ? "gap-mid" : "gap-ok");
    $("fBoard").innerHTML = b.rows.length ? sections.map((sec) => {
      const rows = b.rows.filter((r) => r.section === sec);
      const late = rows.filter((r) => r.planned - r.done >= 2).length;
      return `<h3 style="margin-top:12px">Section ${esc(sec)} ${late ? `<span class="badge no">${late} late</span>` : '<span class="badge ok">on time</span>'}</h3>
      <div class="table-scroll"><table class="cards-sm"><thead><tr><th>Module</th><th>Activity</th><th>Planned</th><th>Done</th><th>Gap</th><th>Detail</th><th>Remarks</th></tr></thead><tbody>
      ${rows.map((r) => { const g = r.planned - r.done; return `<tr><td data-l="Module"><strong>${esc(r.module)}</strong> <span class="muted small-text">${esc(r.module_name || "")}</span></td>
        <td data-l="Activity">${KIND_NAME[r.kind]}${r.pending ? ` <span class="badge warn" title="waiting for the teacher">${r.pending} to confirm</span>` : ""}</td>
        <td data-l="Planned">${r.planned}</td><td data-l="Done">${r.done}${r.online ? ` <span class="muted small-text">(${r.online} online)</span>` : ""}</td>
        <td data-l="Gap" class="${gapCls(g)}">${g > 0 ? "−" + g : g < 0 ? "+" + -g : "0"}</td>
        <td data-l="Detail" class="small-text">${r.kind === "course" ? esc(r.targets[0] && r.targets[0].teacher || "") : r.targets.map((t) => `${t.target} ${t.in_person + t.online}/${t.planned}`).join(" · ")}</td>
        <td data-l="Remarks" class="small-text">${r.remarks.map((x) => `${esc(x.day.slice(5))} ${esc(x.note)}`).join("<br>")}${r.teacher_answers.map((x) => `<br>💬 ${esc(x.comment)}`).join("")}</td></tr>`; }).join("")}
      </tbody></table></div>`;
    }).join("") : `<p class="muted">Nothing to show yet.</p>`;
  },

  // ---------------------------------------------------------------- starting point (head)
  async start() {
    const box = $("fBody");
    box.innerHTML = `<div class="card"><h2>Starting point</h2>
      <p class="muted" style="margin-top:0">If the follow-up starts in the middle of the semester: the number of sessions already done, up to a date. The sessions recorded after this date are added.</p>
      <div class="row"><label for="bsDate" style="margin:0">Done up to (included)</label><input type="date" id="bsDate" style="width:auto" value="${todayAlgiers()}"></div>
      <div id="bsBody" style="margin-top:8px"><p class="muted">Loading…</p></div><button class="green" id="bsSave" style="margin-top:10px">Save the starting point</button></div>`;
    let b;
    try { b = await rpc("api_followup_board", { p_semester: APP.semester.id, p_as_of: todayAlgiers() }); } catch (e) { $("bsBody").innerHTML = errorBox(e.message); return; }
    const first = b.rows.flatMap((r) => r.targets).find((t) => t.baseline);
    if (first) $("bsDate").value = first.baseline.as_of;
    $("bsBody").innerHTML = `<div class="table-scroll"><table><thead><tr><th>Section</th><th>Module</th><th>Group</th><th>In person</th><th>Online</th></tr></thead><tbody>
      ${b.rows.flatMap((r) => r.targets.map((t) => `<tr><td>${esc(r.section)}</td><td>${esc(r.module)} ${KIND_NAME[r.kind]}</td><td>${esc(t.target || "Section")}</td>
        <td><input type="number" min="0" style="width:80px" data-bs="${r.activity_id}|${r.section_id}|${t.target}|p" value="${t.baseline ? t.baseline.in_person : ""}"></td>
        <td><input type="number" min="0" style="width:80px" data-bs="${r.activity_id}|${r.section_id}|${t.target}|o" value="${t.baseline ? t.baseline.online : ""}"></td></tr>`)).join("")}
      </tbody></table></div>`;
    $("bsSave").onclick = async () => {
      const asOf = $("bsDate").value, map = {}, changed = new Set(), dateChanged = asOf !== (first ? first.baseline.as_of : "");
      document.querySelectorAll("[data-bs]").forEach((i) => {
        const [a, s, t, k] = i.dataset.bs.split("|"); const key = a + "|" + s + "|" + t; (map[key] = map[key] || {})[k] = Number(i.value || 0);
        if (i.value !== i.defaultValue || (dateChanged && i.value !== "")) changed.add(key);
      });
      for (const k of Object.keys(map)) if (!changed.has(k)) delete map[k];
      $("bsSave").disabled = true;
      try {
        for (const [key, v] of Object.entries(map)) {
          const [a, s, t] = key.split("|");
          await rpc("api_baseline_set", { p_activity: a, p_section: s, p_target: t, p_as_of: asOf, p_in_person: v.p || 0, p_online: v.o || 0 });
        }
        toast(`Starting point saved (${Object.keys(map).length} line(s)).`, "ok");
      } catch (e) { toast(e.message, "error"); }
      $("bsSave").disabled = false;
    };
  },

  // ---------------------------------------------------------------- teacher: my sessions
  async mine() {
    const box = $("fBody");
    box.innerHTML = `<div class="card"><h2>My sessions</h2><p class="muted" style="margin-top:0">Recorded by the delegates. Confirm, or say what is wrong.
      ${APP.level.auto_confirm_days ? `Without an answer, a session counts as confirmed after ${APP.level.auto_confirm_days} days.` : ""}</p><div id="mList"><p class="muted">Loading…</p></div></div>`;
    if (!APP.level.teacher_id) { $("mList").innerHTML = `<p>Your account is not linked to the teachers directory yet: ask the head to invite you from the directory.</p>`; return; }
    let list;
    try { list = await rpc("api_sessions", { p_semester: APP.semester.id }); } catch (e) { $("mList").innerHTML = errorBox(e.message); return; }
    list.sort((a, b) => (a.teacher_state === "pending" ? 0 : 1) - (b.teacher_state === "pending" ? 0 : 1));
    $("mList").innerHTML = list.length ? `<div class="stu-list">${list.map((c) => this.sessionCard(c, { showSection: true,
      actions: (x) => `${x.teacher_state !== "confirmed" ? `<button class="small green" data-ok="${x.id}">✔ Confirm</button>` : ""}<button class="small secondary" data-ko="${x.id}">✎ Something is wrong</button>` })).join("")}</div>`
      : `<p class="muted">No session recorded for you yet.</p>`;
    $("mList").querySelectorAll("[data-ok]").forEach((b) => b.onclick = async () => {
      try { await rpc("api_session_answer", { p_id: Number(b.dataset.ok), p_state: "confirmed", p_comment: "" }); this.mine(); } catch (e) { toast(e.message, "error"); }
    });
    $("mList").querySelectorAll("[data-ko]").forEach((b) => b.onclick = async () => {
      let v = "";
      const ok = await askInPage({ title: "What is wrong?", ok: "Send", html: `<textarea id="koTxt" rows="3" placeholder="e.g. it was in person; the date is the 12th; the session was a make-up"></textarea>`,
        validate: (w) => { v = w.querySelector("#koTxt").value; if (!v.trim()) { toast("Write a short comment.", "error"); return false; } return true; } });
      if (!ok) return;
      try { await rpc("api_session_answer", { p_id: Number(b.dataset.ko), p_state: "disputed", p_comment: v }); toast("Sent to the head and the delegate.", "ok"); this.mine(); } catch (e) { toast(e.message, "error"); }
    });
  },
};
