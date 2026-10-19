// DeptDesk - Groups tab: allocation of the students of a section into TD groups and TP sub-groups,
// lab partners (pairs), balance and suggested moves, automatic allocation, validation, import, exports.
(window.DD_FILES = window.DD_FILES || {})["groups.js"] = "2.2"; // file version, checked by the page

const GROUPS = {
  sectionId: null, data: null, rev: null, kind: prefGet("kind", "tp"), filter: "all", q: "", view: "list", poll: null,

  stop() { if (this.poll) { this.poll.stop(); this.poll = null; } },

  sections() {
    const r = role();
    return APP.sections.filter((x) => r !== "delegate" || x.name.toUpperCase() === String(APP.level.section || "").toUpperCase());
  },
  canWrite() { const r = role(); return r === "head" || (r === "delegate" && this.data && !this.data.section.locked); },

  render(m) {
    const secs = this.sections();
    if (!secs.length) {
      m.innerHTML = `<div class="card"><p>${role() === "delegate" ? `Section ${esc(APP.level.section)} does not exist in this semester yet. Ask the head.` : "No section yet: import the official list (Students tab) or add a section (Setup tab)."}</p></div>`;
      return;
    }
    if (!secs.find((x) => x.id === this.sectionId)) this.sectionId = (secs.find((x) => x.id === prefGet("section", "")) || secs[0]).id;
    this.data = null; this.rev = null; this.filter = "all";
    m.innerHTML = `<div class="card">
        ${secs.length > 1 ? `<div class="sec-chips">${secs.map((x) => `<button data-sec="${x.id}" class="${x.id === this.sectionId ? "on" : ""}">Section ${esc(x.name)}${x.locked ? " ✔" : ""}</button>`).join("")}</div>` : ""}
        <div id="gLock"></div>
        <div class="seg"><button data-kind="td">TD groups</button><button data-kind="tp">TP sub-groups</button></div>
        <div id="gBalance"></div>
        <div class="row fill"><input id="gSearch" placeholder="Search a name or a student number" value="${esc(this.q)}">
          <div class="seg" style="margin:0;flex:0 0 auto"><button data-view="list">List</button><button data-view="columns">Columns</button></div></div>
        <div id="gBody" style="margin-top:10px"><p class="muted">Loading…</p></div>
      </div>
      <div class="card" id="gTools"></div>`;
    m.querySelectorAll("[data-sec]").forEach((b) => b.onclick = () => { this.sectionId = b.dataset.sec; prefSet("section", this.sectionId); this.stop(); this.render(m); });
    m.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { this.kind = b.dataset.kind; prefSet("kind", this.kind); this.filter = "all"; this.draw(); });
    m.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => { this.view = b.dataset.view; this.draw(); });
    $("gSearch").oninput = () => { this.q = $("gSearch").value; this.drawBody(); };
    this.stop();
    this.poll = poller(() => this.load(), 20000);
    this.poll.run();
  },

  async load(force) {
    try {
      const r = await rpc("api_alloc_view", { p_section: this.sectionId, p_rev: force ? null : this.rev });
      if (r.unchanged) return;
      this.data = r; this.rev = r.rev;
      this.draw();
    } catch (e) {
      if (has("gBody")) $("gBody").innerHTML = `<p>${esc(e.message)}</p>`;
      if (e.code === "MEMBERSHIP_EXPIRED") this.stop();
    }
  },
  reload() { this.rev = null; return this.poll ? this.poll.run() : this.load(true); },

  count() { return this.kind === "td" ? this.data.section.td_count : this.data.section.tp_count; },
  prefix() { return this.kind === "td" ? "G" : "SG"; },
  byId() { const o = {}; this.data.students.forEach((s) => { o[s.id] = s; }); return o; },

  // Sizes, average and the groups outside the tolerance.
  balance(kind) {
    const k = kind || this.kind, n = k === "td" ? this.data.section.td_count : this.data.section.tp_count, sizes = Array(n).fill(0);
    let unplaced = 0;
    this.data.students.forEach((s) => { if (s[k] >= 1 && s[k] <= n) sizes[s[k] - 1]++; else unplaced++; });
    const placed = sizes.reduce((a, b) => a + b, 0), avg = n ? placed / n : 0, tol = this.data.section.tolerance;
    const bad = sizes.map((x) => n > 1 && Math.abs(x - avg) > tol + 1e-9);
    const solo = k === "tp" ? this.data.students.filter((s) => s.tp && !s.partner).length : 0;
    const pairs = k === "tp" ? this.data.students.filter((s) => s.partner).length / 2 : 0;
    return { n, sizes, unplaced, avg, tol, bad, solo, pairs, ok: !bad.some(Boolean) && !unplaced };
  },

  draw() {
    if (!this.data || !has("gBody")) return;
    const d = this.data, head = role() === "head";
    document.querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("on", b.dataset.kind === this.kind));
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === this.view));
    $("gLock").innerHTML = d.section.locked
      ? `<div class="locked-bar on">✔ Validated by the head${d.section.locked_at ? " on " + esc(whenText(d.section.locked_at)) : ""}${head ? "" : ": only the head can change it now"}.</div>`
      : `<div class="locked-bar off">Draft: ${head ? "the delegate of the section can change it until you validate it." : role() === "delegate" ? "place the students; the head will validate." : "not validated yet."}</div>`;
    this.drawBalance(); this.drawBody(); this.drawTools();
  },

  drawBalance() {
    const b = this.balance(), p = this.prefix();
    if (!b.n) { $("gBalance").innerHTML = `<p class="muted">This section has no ${this.kind === "td" ? "TD group" : "TP sub-group"} (Setup tab).</p>`; return; }
    $("gBalance").innerHTML = `<div class="balance">
        ${b.sizes.map((x, i) => `<button class="gchip ${b.bad[i] ? "bad" : ""} ${this.filter === i + 1 ? "on" : ""}" data-f="${i + 1}">${p}${i + 1} · ${x}</button>`).join("")}
        ${b.unplaced ? `<button class="gchip unplaced ${this.filter === "unplaced" ? "on" : ""}" data-f="unplaced">Not placed · ${b.unplaced}</button>` : ""}
        ${this.kind === "tp" && b.solo ? `<button class="gchip unplaced ${this.filter === "solo" ? "on" : ""}" data-f="solo">Solo · ${b.solo}</button>` : ""}
        ${this.filter !== "all" ? `<button class="gchip" data-f="all" style="background:var(--ice);color:var(--navy)">Show all</button>` : ""}
      </div>
      <div class="spread"><span class="${b.ok ? "badge ok" : "badge warn"}" id="balanceState" style="white-space:normal">${b.ok ? "✓ Balanced" : `⚠ ${b.bad.some(Boolean) ? `Unbalanced: average ${b.avg.toFixed(1)}, tolerance ±${b.tol}` : ""}${b.bad.some(Boolean) && b.unplaced ? " · " : ""}${b.unplaced ? b.unplaced + " not placed" : ""}`}</span>
        ${this.kind === "tp" ? `<span class="muted">${b.pairs} pairs · ${b.solo} solo</span>` : ""}
        ${!b.ok && this.canWrite() ? `<button class="small orange" id="suggestBtn">Suggest moves</button>` : ""}</div>`;
    $("gBalance").querySelectorAll("[data-f]").forEach((x) => x.onclick = () => {
      const f = x.dataset.f; this.filter = /^\d+$/.test(f) ? Number(f) : f; this.drawBalance(); this.drawBody();
    });
    if (has("suggestBtn")) $("suggestBtn").onclick = () => this.suggest();
  },

  visible() {
    const k = this.kind, q = nameKey(this.q), qm = this.q.trim();
    return this.data.students.filter((s) => {
      if (this.filter === "unplaced" && s[k]) return false;
      if (this.filter === "solo" && !(s.tp && !s.partner)) return false;
      if (typeof this.filter === "number" && s[k] !== this.filter) return false;
      return !q || nameKey(s.last_name + s.first_name).includes(q) || nameKey(s.first_name + s.last_name).includes(q) || (qm && s.matricule.includes(qm));
    });
  },

  drawBody() {
    if (!this.data) return;
    const k = this.kind, n = this.count(), p = this.prefix(), w = this.canWrite(), byId = this.byId();
    if (this.view === "columns") {
      const pl = pairLabels(this.data.students);
      const cols = [];
      for (let g = 1; g <= n; g++) cols.push([`${p}${g}`, this.data.students.filter((s) => s[k] === g)]);
      const un = this.data.students.filter((s) => !s[k]);
      if (un.length) cols.push(["Not placed", un]);
      $("gBody").innerHTML = `<div class="columns">${cols.map(([t, l]) => `<div class="col"><h4>${esc(t)} <span class="muted">(${l.length})</span></h4>
        ${l.map((s) => `<div>${esc(fullName(s))}${k === "tp" && s.tp ? ` <span class="muted">${esc(pl[s.id])}</span>` : ""}</div>`).join("")}</div>`).join("")}</div>`;
      return;
    }
    const list = this.visible();
    const gControl = (s) => {
      if (!w) return `<span class="badge info">${s[k] ? p + s[k] : "not placed"}</span>`;
      if (n <= 8) return `<div class="gbtns">${[...Array(n).keys()].map((i) => `<button data-set="${s.id}" data-g="${i + 1}" class="${s[k] === i + 1 ? "on" : ""}" aria-label="${p}${i + 1}">${n <= 4 ? p : ""}${i + 1}</button>`).join("")}</div>`;
      return `<select data-sel="${s.id}" style="width:auto"><option value="">not placed</option>${[...Array(n).keys()].map((i) => `<option value="${i + 1}" ${s[k] === i + 1 ? "selected" : ""}>${p}${i + 1}</option>`).join("")}</select>`;
    };
    const pairBit = (s) => {
      if (k !== "tp") return "";
      const mate = s.partner && byId[s.partner];
      if (mate) return `<span class="pairtag">👥 ${esc(fullName(mate))}</span>${w ? ` <button class="small secondary" data-unpair="${s.id}" aria-label="Break the pair">✕</button>` : ""}`;
      return `<span class="pairtag solo">solo</span>${w ? ` <button class="small secondary" data-pair="${s.id}">Pair…</button>` : ""}`;
    };
    $("gBody").innerHTML = list.length ? `<div class="stu-list">${list.map((s) => `<div class="stu ${s[k] ? "" : "unplaced"}" data-stu="${s.id}">
        <div class="who"><div class="nm">${esc(fullName(s))}</div><div class="mt">${esc(s.matricule)}${k === "tp" ? "" : s.tp ? " · SG" + s.tp : ""}${k === "td" ? "" : s.td ? " · G" + s.td : ""}</div></div>
        ${gControl(s)}<div class="row">${pairBit(s)}</div></div>`).join("")}</div>`
      : `<p class="muted">Nobody here.</p>`;
    $("gBody").querySelectorAll("[data-set]").forEach((b) => b.onclick = () => this.setGroup(Number(b.dataset.set), Number(b.dataset.g)));
    $("gBody").querySelectorAll("[data-sel]").forEach((s) => s.onchange = () => this.setGroup(Number(s.dataset.sel), s.value ? Number(s.value) : null));
    $("gBody").querySelectorAll("[data-pair]").forEach((b) => b.onclick = () => this.pickPartner(Number(b.dataset.pair)));
    $("gBody").querySelectorAll("[data-unpair]").forEach((b) => b.onclick = () => this.unpair(Number(b.dataset.unpair)));
  },

  // Optimistic change: the screen changes at once, the database follows (reload if it refuses).
  async setGroup(id, g) {
    const s = this.byId()[id], k = this.kind;
    if (!s || s[k] === g) return;
    s[k] = g;
    if (k === "tp" && s.partner && this.byId()[s.partner]) this.byId()[s.partner].tp = g;
    this.drawBalance(); this.drawBody();
    try { await rpc("api_alloc_set", { p_section: this.sectionId, p_changes: [{ id, [k]: g }] }); this.rev = null; }
    catch (e) { toast(e.message, "error"); this.reload(); }
  },

  async pickPartner(id) {
    const byId = this.byId(), a = byId[id];
    const free = this.data.students.filter((s) => s.id !== id && !s.partner);
    const same = free.filter((s) => a.tp && s.tp === a.tp), other = free.filter((s) => !(a.tp && s.tp === a.tp));
    let chosen = null;
    const item = (s, note) => `<button data-b="${s.id}">${esc(fullName(s))} <span class="muted">${esc(note)}</span></button>`;
    await askInPage({ title: `Lab partner of ${fullName(a)}`, ok: false, cancel: "Close",
      html: `<input id="ppQ" placeholder="Search">
        <div class="pick-list" id="ppList">
          ${same.length ? `<div class="muted">Solo in SG${a.tp}</div>` + same.map((s) => item(s, "")).join("") : ""}
          ${other.length ? `<div class="muted">${a.tp ? "Other sub-groups (will join SG" + a.tp + ")" : "Solo students"}</div>` + other.map((s) => item(s, s.tp ? (a.tp ? "SG" + s.tp : "→ both in SG" + s.tp) : "not placed")).join("") : ""}
          ${!free.length ? `<p class="muted">No solo student left.</p>` : ""}</div>`,
      onOpen: (w) => {
        w.querySelectorAll("[data-b]").forEach((b) => b.onclick = () => { chosen = Number(b.dataset.b); w.close(true); });
        w.querySelector("#ppQ").oninput = (e) => { const q = nameKey(e.target.value); w.querySelectorAll("[data-b]").forEach((b) => { b.style.display = !q || nameKey(b.textContent).includes(q) ? "" : "none"; }); };
      } });
    if (!chosen) return;
    const b = byId[chosen];
    // the student without sub-group joins the one who has one
    const [x, y] = !a.tp && b.tp ? [b.id, a.id] : [a.id, b.id];
    try { await rpc("api_pair_set", { p_section: this.sectionId, p_a: x, p_b: y, p_move: true }); toast("Pair formed.", "ok"); }
    catch (e) { toast(e.message, "error"); }
    this.reload();
  },
  async unpair(id) {
    try { await rpc("api_pair_set", { p_section: this.sectionId, p_a: id, p_b: null, p_move: false }); } catch (e) { toast(e.message, "error"); }
    this.reload();
  },

  // Moves that bring every group within one student of the others; the students not placed go to the smallest groups.
  // A pair moves as one block (TP); single students are moved first.
  movesToBalance() {
    const k = this.kind, n = this.count(), byId = this.byId(), sizes = Array(n).fill(0), units = [];
    const seen = new Set();
    sortedByName(this.data.students).forEach((s) => {
      if (seen.has(s.id)) return;
      const mate = k === "tp" && s.partner && byId[s.partner] && byId[s.partner].tp === s.tp ? byId[s.partner] : null;
      const u = { ids: mate ? [s.id, mate.id] : [s.id], size: mate ? 2 : 1, g: s[k] || null, name: fullName(s) + (mate ? " + " + fullName(mate) : "") };
      u.ids.forEach((i) => seen.add(i)); units.push(u);
      if (u.g) sizes[u.g - 1] += u.size;
    });
    const moves = [], smallest = () => sizes.indexOf(Math.min(...sizes)), largest = () => sizes.indexOf(Math.max(...sizes));
    units.filter((u) => !u.g).sort((a, b) => b.size - a.size).forEach((u) => {
      const to = smallest() + 1; sizes[to - 1] += u.size; moves.push({ id: u.ids[0], name: u.name, from: null, to }); u.g = to; u.moved = true;
    });
    for (let guard = 0; guard < 500; guard++) {
      const hi = largest(), lo = smallest(), diff = sizes[hi] - sizes[lo];
      if (diff <= 1) break;
      const cand = units.filter((u) => u.g === hi + 1 && !u.moved && (u.size === 1 || diff >= 3));
      if (!cand.length) break;
      const u = cand.find((x) => x.size === 1) ? cand.filter((x) => x.size === 1).pop() : cand.pop();
      sizes[hi] -= u.size; sizes[lo] += u.size; moves.push({ id: u.ids[0], name: u.name, from: hi + 1, to: lo + 1 }); u.g = lo + 1; u.moved = true;
    }
    return { moves, sizes };
  },
  async suggest() {
    const p = this.prefix(), { moves, sizes } = this.movesToBalance();
    if (!moves.length) { toast("No simple move improves the balance (pairs cannot be split).", ""); return; }
    const ok = await askInPage({ title: `Suggested moves (${moves.length})`, ok: "Apply these moves",
      html: `<ul class="moves">${moves.map((m) => `<li><strong>${esc(m.name)}</strong>: ${m.from ? p + m.from : "not placed"} → ${p}${m.to}</li>`).join("")}</ul>
        <p class="muted">Sizes after: ${sizes.map((x, i) => `${p}${i + 1} ${x}`).join(", ")}. You can also move the students yourself.</p>` });
    if (!ok) return;
    try { await rpc("api_alloc_set", { p_section: this.sectionId, p_changes: moves.map((m) => ({ id: m.id, [this.kind]: m.to })) }); toast("Moves applied.", "ok"); }
    catch (e) { toast(e.message, "error"); }
    this.reload();
  },

  drawTools() {
    const head = role() === "head", d = this.data, kindTxt = this.kind === "td" ? "TD groups" : "TP sub-groups";
    $("gTools").innerHTML = `
      ${head ? `<h3>Head</h3>
        <div class="row">${d.section.locked ? `<button class="secondary" id="unlockBtn">Reopen for the delegate</button>` : `<button class="green" id="lockBtn">Validate and lock</button>`}</div>
        <label for="autoMode">Automatic allocation of the ${kindTxt}</label>
        <div class="row fill"><select id="autoMode">
          <option value="fill">Place only the students not placed yet (nobody else moves)</option>
          <option value="alpha">Everybody again, in alphabetical order</option>
          <option value="random">Everybody again, at random${this.kind === "tp" ? " (pairs kept together)" : ""}</option></select>
          <button id="autoBtn" class="orange">Run</button></div>
        <label for="impFile">Import an allocation made outside DeptDesk (Excel: blocks "Groupe 1", "Sous-groupe 1"…)</label>
        <input type="file" id="impFile" accept=".xlsx,.xls,.ods"><div id="impOut"></div><hr style="border:none;border-top:1px solid var(--ice2);margin:14px 0">` : ""}
      <h3>Export (Excel, opens in LibreOffice)</h3>
      <div class="row"><button class="secondary" id="expSide">Section ${esc(d.section.name)}: groups side by side</button>
        <button class="secondary" id="expPer">Section ${esc(d.section.name)}: one sheet per group</button>
        <button class="secondary" id="expFlat">${role() === "delegate" ? "My section" : "Whole semester"}: one line per student</button></div>
      <p class="muted">The one-line-per-student file is also the format ClassPulse imports.</p>`;
    $("expSide").onclick = () => exportSideBySide(ctxNames(), this.data);
    $("expPer").onclick = () => exportPerGroup(ctxNames(), this.data);
    $("expFlat").onclick = async () => { try { exportFlatList(ctxNames(), await rpc("api_students", { p_semester: APP.semester.id })); } catch (e) { toast(e.message, "error"); } };
    if (!head) return;
    if (has("lockBtn")) $("lockBtn").onclick = async () => {
      const td = this.balance("td"), tp = this.balance("tp");
      const warn = [];
      if (td.unplaced) warn.push(`${td.unplaced} students without TD group`);
      if (tp.unplaced) warn.push(`${tp.unplaced} students without TP sub-group`);
      if (td.bad.some(Boolean)) warn.push("TD groups unbalanced");
      if (tp.bad.some(Boolean)) warn.push("TP sub-groups unbalanced");
      if (tp.solo) warn.push(`${tp.solo} solo students in TP`);
      const ok = await askInPage({ title: `Validate section ${d.section.name}?`, ok: "Validate and lock",
        html: `${warn.length ? `<p class="badge warn" style="white-space:normal">⚠ ${esc(warn.join(" · "))}</p>` : `<p class="badge ok">Everything is placed and balanced.</p>`}
          <p>The delegate will no longer be able to change it; you still can. A copy is kept in the history.</p>` });
      if (!ok) return;
      try { await rpc("api_alloc_lock", { p_section: this.sectionId, p_lock: true }); toast("Allocation validated.", "ok"); await reloadSections(); } catch (e) { toast(e.message, "error"); }
      this.reload();
    };
    if (has("unlockBtn")) $("unlockBtn").onclick = async () => {
      try { await rpc("api_alloc_lock", { p_section: this.sectionId, p_lock: false }); toast("Reopened: the delegate can change it again.", "ok"); await reloadSections(); } catch (e) { toast(e.message, "error"); }
      this.reload();
    };
    $("autoBtn").onclick = async () => {
      const mode = $("autoMode").value;
      if (mode !== "fill" && !(await askInPage({ title: "Allocate everybody again?", danger: true, ok: "Allocate again",
        html: `<p>All the ${kindTxt} of section ${esc(d.section.name)} are made again${mode === "alpha" ? " in alphabetical order" : " at random"}. What the delegate did is replaced${this.kind === "tp" ? " (pairs stay together)" : ""}.</p>` }))) return;
      try { const r = await rpc("api_alloc_auto", { p_section: this.sectionId, p_kind: this.kind, p_mode: mode }); toast(`${r.placed} students placed.`, "ok"); }
      catch (e) { toast(e.message, "error"); }
      this.reload();
    };
    $("impFile").onchange = () => { const f = $("impFile").files[0]; if (f) this.importPreview(f); };
  },

  async importPreview(file) {
    const out = $("impOut");
    out.innerHTML = `<p class="muted">Reading…</p>`;
    let parsed;
    try { parsed = parseAllocationWorkbook(await readWorkbookGrid(file)); } catch (e) { out.innerHTML = errorBox("This file cannot be read (" + e.message + ")."); return; }
    if (!parsed.rows.length) { out.innerHTML = errorBox('No block "Groupe N" / "Sous-groupe N" found in this file.'); return; }
    let rep;
    try { rep = await rpc("api_alloc_import", { p_section: this.sectionId, p_rows: parsed.rows, p_apply: false }); } catch (e) { out.innerHTML = errorBox(e.message); return; }
    const P = (a) => (a.kind === "td" ? "G" : "SG") + a.group;
    const TXT = {
      unknown: (a) => `${a.name} (${a.matricule || "no number"}): not found in this section — not in the official list?`,
      twice: (a) => `${a.name}: also in ${P(a)}; the first place (${a.kind === "td" ? "G" : "SG"}${a.kept}) is kept`,
      matricule_differs: (a) => `${a.name}: number ${a.matricule} does not match the list; found by name (${a.student})`,
      name_differs: (a) => `${a.matricule}: name "${a.name}" in the file, "${a.student}" in the list`,
      homonyms: (a) => `${a.name}: several students with this name — not placed`,
      group_out_of_range: (a) => `${a.name}: ${P(a)} does not exist in this section (change the numbers of groups in Setup)`,
    };
    const tdN = parsed.rows.filter((r) => r.kind === "td").length, tpN = parsed.rows.filter((r) => r.kind === "tp").length;
    out.innerHTML = `<div class="card" style="background:var(--bg);margin-top:10px">
      <p>File: ${tdN} lines in TD groups, ${tpN} in TP sub-groups. Recognised: <strong>${rep.assigned_td}</strong> TD places, <strong>${rep.assigned_tp}</strong> TP places.</p>
      ${parsed.notes.length ? `<ul class="report muted">${parsed.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${rep.anomalies.length ? `<p class="badge warn">${rep.anomalies.length} problem(s) in the file</p><ul class="report" id="impAnoms">${rep.anomalies.map((a) => `<li><span class="muted">${esc(a.where || "")} · ${esc(P(a))}</span> ${esc((TXT[a.type] || ((x) => x.type))(a))}</li>`).join("")}</ul>` : `<p class="badge ok">No problem in the file.</p>`}
      ${rep.missing_td.length ? `<p><strong>${rep.missing_td.length}</strong> students of the list are in no TD group of the file: ${esc(rep.missing_td.join(", "))}</p>` : ""}
      ${rep.missing_tp.length ? `<p><strong>${rep.missing_tp.length}</strong> students of the list are in no TP sub-group of the file: ${esc(rep.missing_tp.join(", "))}</p>` : ""}
      <p class="muted">Applying replaces the groups of the students found in the file; the others keep theirs. You correct the rest by hand (or "Suggest moves").</p>
      <button class="green" id="impApply">Apply (${rep.assigned_td + rep.assigned_tp} places)</button></div>`;
    $("impApply").onclick = async () => {
      $("impApply").disabled = true;
      try { await rpc("api_alloc_import", { p_section: this.sectionId, p_rows: parsed.rows, p_apply: true }); toast("Allocation imported.", "ok"); out.innerHTML = ""; await reloadSections(); }
      catch (e) { out.insertAdjacentHTML("beforeend", errorBox(e.message)); $("impApply").disabled = false; }
      this.reload();
    };
  },
};
