// DeptDesk v2 - Setup additions (calendar weeks, modules and their teachers, follow-up settings) and the teachers directory (People tab).
(window.DD_FILES = window.DD_FILES || {})["setup2.js"] = "2.2"; // file version, checked by the page

const SETUP2 = {
  async render(box) {
    if (!box || !APP.semester) return;
    box.innerHTML = `<div class="card" id="modCard"><h2>Modules of ${esc(semesterLabel(APP.semester))}</h2><p class="muted">Loading…</p></div>
      <div class="card" id="weekCard"><h2>Calendar</h2><p class="muted">Loading…</p></div>
      <div class="card"><h2>Follow-up settings</h2>
        <label for="autoDays">A session not answered by its teacher counts as confirmed after (days, 0 = never)</label>
        <div class="row"><input id="autoDays" type="number" min="0" max="60" value="${APP.level.auto_confirm_days ?? 7}" style="width:110px"><button id="autoSave" class="small">Save</button></div></div>`;
    $("autoSave").onclick = async () => {
      try { await rpc("api_level_settings", { p_level: APP.level.level_id, p_auto_confirm_days: Number($("autoDays").value) }); APP.level.auto_confirm_days = Number($("autoDays").value); toast("Saved.", "ok"); }
      catch (e) { toast(e.message, "error"); }
    };
    await Promise.all([this.drawModules(), this.drawWeeks()]);
  },

  // ---------------------------------------------------------------- calendar
  async drawWeeks() {
    let weeks;
    try { weeks = await rpc("api_weeks", { p_semester: APP.semester.id }); } catch (e) { $("weekCard").innerHTML = errorBox(e.message); return; }
    const fmt = (d) => new Date(d + "T12:00:00").toLocaleDateString([], { day: "2-digit", month: "short" });
    const plus = (d, n) => new Date(new Date(d + "T12:00:00").getTime() + n * 86400000).toISOString().slice(0, 10);
    $("weekCard").innerHTML = `<h2>Calendar</h2>
      ${weeks.length ? `<p class="muted" style="margin-top:0">Mark the holiday and exam weeks: they are not counted in the planned sessions. Weeks A / B (TP every two weeks) count teaching weeks only.</p>
      <div class="table-scroll"><table class="week-list"><thead><tr><th>Week</th><th>Kind</th><th>No.</th><th>A / B</th></tr></thead><tbody>
      ${weeks.map((w) => `<tr ${w.current ? 'style="background:var(--ice)"' : ""}><td>${fmt(w.week_start)} – ${fmt(plus(w.week_start, 5))}${w.current ? " <strong>(this week)</strong>" : ""}</td>
        <td><select data-week="${w.week_start}" style="width:auto">${["teaching", "holiday", "exams"].map((k) => `<option ${k === w.kind ? "selected" : ""}>${k}</option>`).join("")}</select></td>
        <td>${w.no || ""}</td><td>${w.parity || ""}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">Give the first and the last day of the semester (above) to see its weeks.</p>`}`;
    $("weekCard").querySelectorAll("[data-week]").forEach((s) => s.onchange = async () => {
      try { await rpc("api_week_set", { p_semester: APP.semester.id, p_week_start: s.dataset.week, p_kind: s.value }); await this.drawWeeks(); }
      catch (e) { toast(e.message, "error"); }
    });
  },

  // ---------------------------------------------------------------- modules and teachers per group
  async drawModules() {
    try { await loadRefs(true); } catch (e) { $("modCard").innerHTML = errorBox(e.message); return; }
    const tOpts = (sel) => `<option value="">— teacher —</option>` + APP.teachers.filter((t) => t.active).map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.label)}</option>`).join("");
    const rhythm = (a) => (Number(a.per_week) === 0.5 ? "every 2 weeks" : `${Number(a.per_week)} / week`) + (a.starts ? ` from ${dayText(a.starts)}` : "");
    $("modCard").innerHTML = `<div class="spread"><h2 style="margin:0">Modules of ${esc(semesterLabel(APP.semester))}</h2><button class="small" id="modAdd">+ Module</button></div>
      <p class="muted">Rhythm = sessions per week (0.5 = every two weeks): it gives the planned sessions until the timetable is entered. ${APP.teachers.length ? "" : "Add the teachers first (People tab)."}</p>
      ${APP.modules.length ? APP.modules.map((m) => `<div class="card" style="background:var(--bg);margin-bottom:8px;border-left:6px solid ${esc(m.color)}">
        <div class="spread"><strong>${esc(m.code)} <span class="muted">${esc(m.name)}</span></strong>
          <div class="row"><button class="small secondary" data-medit="${m.id}">Edit</button><button class="small red" data-mdel="${m.id}">Delete</button></div></div>
        ${m.activities.map((a) => `<div style="margin-top:6px"><span class="pill">${KIND_NAME[a.kind]}</span> <span class="muted">${esc(rhythm(a))}</span>
          <div class="row" style="margin-top:4px">${APP.sections.map((x) => targetsFor(x, a.kind).map((tg) => {
            const cur = a.teachings.find((t) => t.section_id === x.id && t.target === tg);
            return `<label class="small-text" style="margin:0">${APP.sections.length > 1 ? esc(x.name) + " " : ""}${esc(tg || "Section")}
              <select data-teach="${a.id}|${x.id}|${tg}" style="width:auto;min-height:34px;padding:4px">${tOpts(cur && cur.teacher_id)}</select></label>`;
          }).join("")).join("")}</div></div>`).join("")}</div>`).join("") : `<p class="muted">No module yet: add them here, or import the timetable (Timetable tab), which creates them.</p>`}`;
    $("modAdd").onclick = () => this.editModule(null);
    $("modCard").querySelectorAll("[data-medit]").forEach((b) => b.onclick = () => this.editModule(APP.modules.find((m) => m.id === b.dataset.medit)));
    $("modCard").querySelectorAll("[data-mdel]").forEach((b) => b.onclick = async () => {
      const m = APP.modules.find((x) => x.id === b.dataset.mdel);
      if (!(await askInPage({ title: `Delete ${m.code}?`, html: "<p>Its timetable slots are deleted too. Refused if sessions are already recorded.</p>", ok: "Delete", danger: true }))) return;
      try { await rpc("api_module_delete", { p_module: m.id }); await this.drawModules(); } catch (e) { toast(e.message, "error"); }
    });
    $("modCard").querySelectorAll("[data-teach]").forEach((s) => s.onchange = async () => {
      const [act, sec, tg] = s.dataset.teach.split("|");
      try { await rpc("api_teaching_set", { p_activity: act, p_section: sec, p_target: tg, p_teacher: s.value || null }); toast("Saved.", "ok"); APP.modules = null; }
      catch (e) { toast(e.message, "error"); }
    });
  },
  async editModule(m) {
    const act = (k) => (m ? m.activities.find((a) => a.kind === k) : null);
    const line = (k, def) => { const a = act(k); return `<div class="row" style="margin-top:8px">
      <label class="tick" style="margin:0;min-width:80px"><input type="checkbox" data-k="${k}" ${a || (!m && k === "course") ? "checked" : ""}> ${KIND_NAME[k]}</label>
      <select data-pw="${k}" style="width:auto">${[["1", "1 / week"], ["2", "2 / week"], ["0.5", "every 2 weeks"], ["3", "3 / week"]].map(([v, l]) => `<option value="${v}" ${Number(a ? a.per_week : def) === Number(v) ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input type="date" data-st="${k}" value="${a && a.starts ? a.starts : ""}" style="width:auto" title="first session (optional)"></div>`; };
    let vals = null;
    const ok = await askInPage({ title: m ? `Edit ${m.code}` : "New module", ok: "Save",
      html: `<div class="row fill"><div><label>Code</label><input id="mdCode" value="${esc(m ? m.code : "")}" placeholder="AWP"></div>
        <div><label>Colour</label><input id="mdColor" type="color" value="${esc(m ? m.color : "#1B7F8C")}"></div></div>
        <label>Full name</label><input id="mdName" value="${esc(m ? m.name : "")}" placeholder="Antennas and Wireless Propagation">
        <label>Activities, rhythm, first session (optional, e.g. the first TP)</label>${line("course", 1)}${line("td", 1)}${line("tp", 0.5)}`,
      validate: (w) => {
        vals = { code: w.querySelector("#mdCode").value, name: w.querySelector("#mdName").value, color: w.querySelector("#mdColor").value,
          acts: ["course", "td", "tp"].filter((k) => w.querySelector(`[data-k=${k}]`).checked).map((k) => ({ kind: k, per_week: Number(w.querySelector(`[data-pw=${k}]`).value), starts: w.querySelector(`[data-st=${k}]`).value || "" })) };
        if (!vals.code.trim()) { toast("Type the code of the module.", "error"); return false; }
        return true;
      } });
    if (!ok) return;
    try { await rpc("api_module_save", { p_semester: APP.semester.id, p_id: m ? m.id : null, p_code: vals.code, p_name: vals.name, p_color: vals.color, p_activities: vals.acts }); toast("Module saved.", "ok"); await this.drawModules(); }
    catch (e) { toast(e.message, "error"); }
  },

  // ---------------------------------------------------------------- teachers directory (People tab)
  async renderTeachers(box) {
    if (!box) return;
    let list;
    try { list = await rpc("api_teachers", { p_level: APP.level.level_id }); APP.teachers = list; } catch (e) { box.innerHTML = errorBox(e.message); return; }
    box.innerHTML = `<div class="spread"><h2 style="margin:0">Teachers directory</h2><button class="small" id="tAdd">+ Teacher</button></div>
      <p class="muted">The phone number is seen by the heads only; delegates see the names only. "Invite" gives the teacher his own access (his sessions, his timetable).</p>
      ${list.length ? `<table class="cards-sm"><thead><tr><th>Name</th><th>E-mail</th><th>Phone</th><th>Access</th><th></th></tr></thead><tbody>
        ${list.map((t) => `<tr ${t.active ? "" : 'style="opacity:.5"'}><td data-l="Name"><strong>${esc(t.label)}</strong>${t.aliases && t.aliases.length ? `<div class="muted small-text">also: ${esc(t.aliases.join(", "))}</div>` : ""}</td>
          <td data-l="E-mail">${esc(t.email || "")}</td><td data-l="Phone">${esc(t.phone || "")}</td>
          <td data-l="Access">${t.account ? '<span class="badge ok">has access</span>' : '<span class="muted">—</span>'}</td>
          <td><div class="row"><button class="small secondary" data-tedit="${t.id}">Edit</button>${t.account ? "" : `<button class="small" data-tinv="${t.id}">Invite</button>`}</div></td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">No teacher yet. Importing the timetable also adds them.</p>`}<div id="tInvOut"></div>`;
    $("tAdd").onclick = () => this.editTeacher(null, box);
    box.querySelectorAll("[data-tedit]").forEach((b) => b.onclick = () => this.editTeacher(list.find((t) => t.id === b.dataset.tedit), box));
    box.querySelectorAll("[data-tinv]").forEach((b) => b.onclick = async () => {
      const t = list.find((x) => x.id === b.dataset.tinv);
      try {
        const r = await rpc("api_invite", { p_level: APP.level.level_id, p_role: "teacher", p_section: "", p_note: t.label, p_teacher: t.id });
        const link = new URL("index.html?code=" + r.code, location.href).href;
        const msg = `DeptDesk (${APP.level.short_name || APP.level.name}): your access as teacher (your sessions, your timetable).\n1. Open ${link}\n2. Create your account (your e-mail and a password).\n3. Confirm the code ${r.code} and type your name.\nThe code is valid 14 days.`;
        $("tInvOut").innerHTML = `<div style="margin-top:10px"><strong>${esc(t.label)}</strong>: <span class="code-pill">${esc(r.code)}</span>
          <textarea rows="5" readonly id="tInvMsg" style="margin-top:6px">${esc(msg)}</textarea>
          <div class="row" style="margin-top:6px"><button class="small secondary" id="tInvCopy">Copy the message</button>
          ${t.email ? `<a href="mailto:${esc(t.email)}?subject=${encodeURIComponent("DeptDesk access")}&body=${encodeURIComponent(msg)}"><button class="small secondary">Send by e-mail</button></a>` : ""}</div></div>`;
        $("tInvCopy").onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("Copied.", "ok"); } catch (e) { $("tInvMsg").select(); } };
      } catch (e) { toast(e.message, "error"); }
    });
  },
  async editTeacher(t, box) {
    let v = null;
    const ok = await askInPage({ title: t ? "Edit the teacher" : "New teacher", ok: "Save",
      html: `<div class="row fill"><div style="flex:0 0 90px"><label>Title</label><select id="teTitle">${["Mme", "M.", "Dr", "Pr", ""].map((x) => `<option ${t && t.title === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label>Last name</label><input id="teLast" value="${esc(t ? t.last_name : "")}"></div><div><label>First name</label><input id="teFirst" value="${esc(t ? t.first_name : "")}"></div></div>
        <div class="row fill"><div><label>E-mail</label><input id="teMail" type="email" value="${esc(t ? t.email || "" : "")}"></div><div><label>Phone (heads only)</label><input id="tePhone" value="${esc(t ? t.phone || "" : "")}"></div></div>
        <label>Other spellings met in files (comma separated)</label><input id="teAlias" value="${esc(t && t.aliases ? t.aliases.join(", ") : "")}" placeholder="Lbandji, Labendji">
        ${t ? `<label class="tick"><input type="checkbox" id="teActive" ${t.active ? "checked" : ""}> still teaching</label>` : ""}`,
      validate: (w) => {
        v = { title: w.querySelector("#teTitle").value, last: w.querySelector("#teLast").value, first: w.querySelector("#teFirst").value, mail: w.querySelector("#teMail").value,
          phone: w.querySelector("#tePhone").value, alias: w.querySelector("#teAlias").value, active: t ? w.querySelector("#teActive").checked : true };
        if (!v.last.trim()) { toast("Type the last name.", "error"); return false; }
        return true;
      } });
    if (!ok) return;
    try {
      await rpc("api_teacher_save", { p_level: APP.level.level_id, p_id: t ? t.id : null, p_title: v.title, p_last_name: v.last, p_first_name: v.first,
        p_email: v.mail, p_phone: v.phone, p_aliases: v.alias, p_active: v.active });
      toast("Saved.", "ok"); APP.teachers = null; await this.renderTeachers(box);
    } catch (e) { toast(e.message, "error"); }
  },
};
