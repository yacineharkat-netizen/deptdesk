// DeptDesk - reading and writing spreadsheets (SheetJS). Reads .xlsx, .xls, .ods, .csv; writes .xlsx (opens in LibreOffice).
(window.DD_FILES = window.DD_FILES || {})["excel.js"] = "2.1"; // file version, checked by the page

function normaliseHeader(h) {
  return String(h).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
// A cell as text. Whole numbers are written in full: a 12-digit student number stored as a number
// must not become "2.42431E+11"; "242431706311.0" loses its ".0".
function cellText(v) {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/ /g, " ").trim();
}
// Every sheet of a workbook as rows of text cells, starting at A1 (line and column numbers match the spreadsheet).
async function readWorkbookGrid(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) { sheets[name] = []; continue; }
    const range = XLSX.utils.decode_range(ws["!ref"]);
    range.s.r = 0; range.s.c = 0;
    sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: true, range }).map((row) => row.map(cellText));
    // drop the empty lines at the end (a sheet "used" down to line 998)
    while (sheets[name].length && sheets[name][sheets[name].length - 1].every((c) => c === "")) sheets[name].pop();
  }
  return { names: wb.SheetNames, sheets };
}
function colLetter(c) { return XLSX.utils.encode_col(c); }

// ---------------------------------------------------------------- official list
const LIST_HEADER_WORDS = {
  matricule: ["matricule", "mat", "matr", "student_number", "numero_inscription", "n_inscription", "matricule_etudiant"],
  last_name: ["nom", "last_name", "lastname", "surname", "nom_etudiant", "nom_de_famille"],
  first_name: ["prenom", "first_name", "firstname", "prenoms"],
  section: ["section", "sect", "sec"],
  status: ["etat", "statut", "status", "state", "situation"],
};
function listHeaderRole(cell) {
  const h = normaliseHeader(cell);
  if (!h) return null;
  for (const [role, words] of Object.entries(LIST_HEADER_WORDS)) if (words.includes(h)) return role;
  if (h.startsWith("matric")) return "matricule";
  if (h.startsWith("prenom")) return "first_name";
  if (h === "nom" || h.startsWith("nom_") && !h.includes("prenom")) return "last_name";
  return null;
}
function listColumnsOf(row) {
  const cols = {};
  row.forEach((cell, c) => { const role = listHeaderRole(cell); if (role && cols[role] === undefined) cols[role] = c; });
  const exact = row.findIndex((cell) => normaliseHeader(cell).startsWith("matric"));
  if (exact >= 0) cols.matricule = exact;            // "Matricule" wins over "Mat BAC" or "N° inscription" before it
  return cols;
}
// Header line and columns of a student list (best line among the first 30), plus the information written above it.
function detectListLayout(grid) {
  let best = { row: 0, score: -1, cols: {} };
  grid.slice(0, 30).forEach((row, r) => {
    const cols = listColumnsOf(row);
    const score = Object.keys(cols).length + (cols.matricule !== undefined ? 1 : 0);
    if (score > best.score) best = { row: r, score, cols };
  });
  const above = grid.slice(0, best.row).map((r) => r.filter(Boolean).join(" ")).join(" | ");
  const sem = above.match(/semestre\s*:?\s*(S\s*\d{1,2})/i);
  const year = above.match(/(\d{4})\s*[/-]\s*(\d{4})/);
  const program = above.match(/(?:offre de formation|formation|sp[ée]cialit[ée])\s*:\s*([^|]+)/i);
  return { headerRow: best.row, cols: best.cols,
    info: { semester: sem ? sem[1].replace(/\s/g, "").toUpperCase() : "", year: year ? `${year[1]}/${year[2]}` : "", program: program ? program[1].trim() : "" } };
}
function normMatricule(m) { return String(m || "").replace(/\s+/g, "").replace(/\.0+$/, "").toUpperCase(); }
// Rows of the official list from a grid and the chosen columns (-1 = none). Each row keeps its line number.
function listRowsFromGrid(grid, headerRow, cols) {
  const out = [];
  grid.slice(headerRow + 1).forEach((row, i) => {
    const get = (k) => (cols[k] !== undefined && cols[k] >= 0 ? row[cols[k]] || "" : "");
    const matricule = normMatricule(get("matricule"));
    const last = get("last_name"), first = get("first_name");
    if (!matricule && !last) return;
    out.push({ line: String(headerRow + 2 + i), matricule, last_name: last.trim(), first_name: first.trim(),
      section: get("section").trim().toUpperCase(), status: get("status").trim().toUpperCase() });
  });
  return out;
}
// Warnings shown in the preview, before anything is sent.
function listWarnings(rows) {
  const w = [];
  const lens = {};
  rows.forEach((r) => { if (/^\d+$/.test(r.matricule)) lens[r.matricule.length] = (lens[r.matricule.length] || 0) + 1; });
  const usual = Number(Object.entries(lens).sort((a, b) => b[1] - a[1])[0]?.[0] || 0);
  const seen = {};
  rows.forEach((r) => {
    if (/E\+/i.test(r.matricule)) w.push(`line ${r.line}: student number shown as ${r.matricule} (format the column as text in the spreadsheet)`);
    else if (usual && /^\d+$/.test(r.matricule) && r.matricule.length !== usual) w.push(`line ${r.line}: student number ${r.matricule} has ${r.matricule.length} digits (usually ${usual})`);
    if (!r.matricule) w.push(`line ${r.line}: no student number`);
    if (seen[r.matricule]) w.push(`line ${r.line}: student number ${r.matricule} already on line ${seen[r.matricule]}`);
    else seen[r.matricule] = r.line;
  });
  return w;
}

// ---------------------------------------------------------------- an allocation made outside DeptDesk
// The usual file: blocks side by side, each under a title "Groupe 1", "Sous-groupe 3", "SG 2", "G1"...,
// with columns N°, Matricule, Nom, Prénom (in any order, some missing, header line sometimes absent).
const TP_TITLE = /^(?:sous[\s-]*groupe|sub[\s-]*group|s\.?\s*g\.?)\s*(?:de\s*)?(?:tp)?\s*(?:n\s*°?|no\.?)?\s*(\d{1,2})$/i;
const TD_TITLE = /^(?:groupe|group|grp|gr|g)\s*(?:de\s*)?(?:td)?\s*(?:n\s*°?|no\.?)?\s*(\d{1,2})$/i;
function blockTitle(cell) {
  const t = String(cell || "").replace(/\s+/g, " ").trim();
  let m = t.match(TP_TITLE); if (m) return { kind: "tp", group: Number(m[1]) };
  m = t.match(TD_TITLE); if (m) return { kind: "td", group: Number(m[1]) };
  return null;
}
function parseAllocationWorkbook(book) {
  const rows = [], notes = [];
  for (const name of book.names) {
    const grid = book.sheets[name] || [];
    const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
    // titles, line by line
    const titles = [];
    grid.forEach((row, r) => row.forEach((cell, c) => { const t = blockTitle(cell); if (t) titles.push(Object.assign({ row: r, col: c }, t)); }));
    if (!titles.length) continue;
    // a sheet named "TP" / "SG" makes its "Groupe N" blocks TP sub-groups
    if (/(^|[^a-z])(tp|sg)([^a-z]|$)/i.test(name) && !titles.some((t) => t.kind === "tp")) titles.forEach((t) => { t.kind = "tp"; });
    const layouts = [];
    titles.forEach((t) => {
      const sameLine = titles.filter((u) => u.row === t.row && u.col > t.col).sort((a, b) => a.col - b.col);
      t.end = sameLine.length ? sameLine[0].col - 1 : Math.min(width - 1, t.col + 5);
      const below = titles.filter((u) => u.col >= t.col && u.col <= t.end && u.row > t.row).sort((a, b) => a.row - b.row);
      t.last = below.length ? below[0].row - 1 : grid.length - 1;
      // header line inside the block (just under the title)
      for (let r = t.row + 1; r <= Math.min(t.row + 3, t.last); r++) {
        const slice = (grid[r] || []).slice(t.col, t.end + 1);
        const cols = listColumnsOf(slice);
        if (cols.last_name !== undefined) { t.layout = cols; layouts.push(cols); break; }
      }
    });
    titles.forEach((t) => {
      let lay = t.layout || layouts[0];
      if (!lay) {                                   // no header anywhere: guess from the content
        const sample = grid.slice(t.row + 1, t.last + 1).map((r) => r.slice(t.col, t.end + 1));
        const digits = (c) => sample.filter((r) => /^\d{6,}$/.test(normMatricule(r[c]))).length;
        const texty = (c) => sample.filter((r) => /[A-Za-z]/.test(r[c] || "")).length;
        const n = t.end - t.col + 1, mat = [...Array(n).keys()].sort((a, b) => digits(b) - digits(a))[0];
        const textCols = [...Array(n).keys()].filter((c) => c !== mat && texty(c) > sample.length / 3);
        lay = { matricule: digits(mat) ? mat : undefined, last_name: textCols[0], first_name: textCols[1] };
        notes.push(`${name}: block "${grid[t.row][t.col]}" has no header line: columns guessed.`);
      }
      if (!t.layout && t.layout !== lay && layouts.length) notes.push(`${name}: block "${grid[t.row][t.col]}" has no header line: columns of the other blocks used.`);
      const at = (row, k) => (lay[k] !== undefined ? String(row[t.col + lay[k]] || "") : "");
      for (let r = t.row + 1; r <= t.last; r++) {
        const row = grid[r] || [];
        const last = at(row, "last_name").trim(), first = at(row, "first_name").trim(), mat = normMatricule(at(row, "matricule"));
        if (!last && !mat) continue;
        if (listHeaderRole(last) === "last_name" || listHeaderRole(mat) === "matricule") continue;   // a header line
        rows.push({ kind: t.kind, group: t.group, matricule: /^[A-Z0-9]{3,}$/.test(mat) ? mat : "", last_name: last, first_name: first,
          where: `${name}!${colLetter(t.col + (lay.last_name ?? 0))}${r + 1}` });
      }
    });
  }
  return { rows, notes };
}

// ---------------------------------------------------------------- exports
// Every student number is written as text (LibreOffice keeps all its digits).
function sheetFromRows(rows, widths, merges) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  if (merges && merges.length) ws["!merges"] = merges;
  return ws;
}
function safeFileName(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_|_$/g, ""); }
function todayIso() { return new Date().toISOString().slice(0, 10); }

// Pair labels inside each sub-group: P1, P2... (alphabetical), "solo" for a student without partner.
function pairLabels(students) {
  const byId = {}, label = {};
  students.forEach((s) => { byId[s.id] = s; });
  const groups = {};
  students.forEach((s) => { if (s.tp) (groups[s.tp] = groups[s.tp] || []).push(s); });
  Object.values(groups).forEach((list) => {
    let n = 0;
    list.slice().sort((a, b) => nameKey(fullName(a)).localeCompare(nameKey(fullName(b)))).forEach((s) => {
      if (label[s.id]) return;
      const p = s.partner && byId[s.partner];
      if (p && p.tp === s.tp) { n++; label[s.id] = label[p.id] = "P" + n; } else label[s.id] = "solo";
    });
  });
  return label;
}
function sortedByName(list) { return list.slice().sort((a, b) => nameKey(a.last_name + " " + a.first_name).localeCompare(nameKey(b.last_name + " " + b.first_name))); }

// 1. The usual layout: groups side by side (one sheet for TD, one for TP), title merged above each block.
function exportSideBySide(ctx, data) {
  const wb = XLSX.utils.book_new();
  const pl = pairLabels(data.students);
  const one = (kind, count, title, cols) => {
    const blocks = [];
    for (let g = 1; g <= count; g++) blocks.push(sortedByName(data.students.filter((s) => s[kind] === g)));
    const unplaced = sortedByName(data.students.filter((s) => !s[kind]));
    const width = cols.length + 1, rows = [[`${ctx.levelName} - ${ctx.semesterLabel} - section ${data.section.name}`], [], [], []];
    const merges = [];
    const all = blocks.concat(unplaced.length ? [unplaced] : []);
    all.forEach((list, b) => {
      const c0 = b * width;
      rows[2][c0] = b < count ? `${title} ${b + 1}` : "Not placed";
      merges.push({ s: { r: 2, c: c0 }, e: { r: 2, c: c0 + cols.length - 1 } });
      cols.forEach((h, i) => { rows[3][c0 + i] = h; });
      list.forEach((s, i) => {
        const r = 4 + i; rows[r] = rows[r] || [];
        const vals = [i + 1, s.matricule, String(s.last_name).toUpperCase(), s.first_name];
        if (kind === "tp") vals.push(pl[s.id] || "");
        vals.forEach((v, k) => { rows[r][c0 + k] = v; });
      });
    });
    rows[rows.length] = [];
    rows[rows.length] = ["Sizes: " + blocks.map((l, i) => `${title} ${i + 1}: ${l.length}`).join(", ") + (unplaced.length ? `, not placed: ${unplaced.length}` : "")];
    for (const r of rows) for (let i = 0; i < r.length; i++) if (r[i] === undefined) r[i] = "";
    const widths = []; all.forEach(() => { widths.push(...(kind === "tp" ? [4, 15, 20, 20, 6] : [4, 15, 20, 20]), 3); });
    return sheetFromRows(rows, widths, merges);
  };
  if (data.section.td_count) XLSX.utils.book_append_sheet(wb, one("td", data.section.td_count, "Group", ["N°", "Matricule", "Last name", "First name"]), "TD groups");
  if (data.section.tp_count) XLSX.utils.book_append_sheet(wb, one("tp", data.section.tp_count, "Sub-group", ["N°", "Matricule", "Last name", "First name", "Pair"]), "TP sub-groups");
  XLSX.writeFile(wb, `Groups_${safeFileName(ctx.levelShort)}_${data.section.name}_side_by_side_${todayIso()}.xlsx`);
}

// 2. One sheet per group, ready to print (attendance sheet).
function exportPerGroup(ctx, data) {
  const wb = XLSX.utils.book_new();
  const pl = pairLabels(data.students);
  const add = (kind, g, label) => {
    const list = sortedByName(data.students.filter((s) => s[kind] === g));
    const head = ["N°", "Matricule", "Last name", "First name"].concat(kind === "tp" ? ["Pair"] : []);
    const rows = [[`${ctx.levelName} - ${ctx.semesterLabel}`], [`Section ${data.section.name} - ${label} (${list.length} students)`], [], head];
    list.forEach((s, i) => rows.push([i + 1, s.matricule, String(s.last_name).toUpperCase(), s.first_name].concat(kind === "tp" ? [pl[s.id] || ""] : [])));
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rows, [5, 15, 22, 22, 7], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } }]), label.replace(/\s+/g, ""));
  };
  for (let g = 1; g <= data.section.td_count; g++) add("td", g, `G${g}`);
  for (let g = 1; g <= data.section.tp_count; g++) add("tp", g, `SG${g}`);
  XLSX.writeFile(wb, `Groups_${safeFileName(ctx.levelShort)}_${data.section.name}_per_group_${todayIso()}.xlsx`);
}

// 3. One line per student for the whole semester (also the import format of ClassPulse: matricule, last_name,
//    first_name, td_group, tp_group).
function exportFlatList(ctx, students) {
  const byId = {};
  students.forEach((s) => { byId[s.id] = s; });
  const withStatus = students.some((s) => s.status != null);
  const head = ["Matricule", "Last name", "First name", "Section", "TD group", "TP group", "Partner"].concat(withStatus ? ["Status", "In official list"] : []);
  const rows = [head];
  students.slice().sort((a, b) => (a.section || "").localeCompare(b.section || "") || nameKey(fullName(a)).localeCompare(nameKey(fullName(b))))
    .forEach((s) => rows.push([s.matricule, String(s.last_name).toUpperCase(), s.first_name, s.section || "", s.td ? String(s.td) : "", s.tp ? String(s.tp) : "",
      s.partner && byId[s.partner] ? byId[s.partner].matricule : ""].concat(withStatus ? [s.status || "", s.active === false ? "no" : "yes"] : [])));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows, [15, 22, 22, 8, 9, 9, 15, 7, 14]), "Students");
  XLSX.writeFile(wb, `Students_${safeFileName(ctx.levelShort)}_${safeFileName(ctx.semesterLabel)}_${todayIso()}.xlsx`);
}

// ================================================================ version 2: timetable and follow-up
const DAY_NAMES = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_WORDS = [["sat", "sam", "samedi", "saturday"], ["sun", "dim", "dimanche", "sunday"], ["mon", "lun", "lundi", "monday"],
  ["tue", "mar", "mardi", "tuesday"], ["wed", "mer", "mercredi", "wednesday"], ["thu", "jeu", "jeudi", "thursday"], ["fri", "ven", "vendredi", "friday"]];
const KIND_LABEL = { course: "Course", td: "TD", tp: "TP" };
function dayFromText(t) {
  const h = normaliseHeader(t);
  if (/^[0-6]$/.test(h)) return Number(h);
  const i = DAY_WORDS.findIndex((w) => w.includes(h) || w.some((x) => h.startsWith(x) && x.length >= 3));
  return i >= 0 ? i : null;
}
// "8h", "8h00", "08:00", "8.30", or a spreadsheet time (fraction of a day) -> "08:00"
function timeFromText(t) {
  const s = String(t || "").trim().toLowerCase().replace(/\s/g, "");
  if (!s) return "";
  if (/^0?\.\d+$/.test(s) || (/^\d*\.\d+$/.test(s) && Number(s) < 1)) {
    const mins = Math.round(Number(s) * 1440); return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  }
  const m = s.match(/^(\d{1,2})(?:[h:.](\d{0,2}))?$/);
  if (!m) return "";
  const hh = Number(m[1]), mm = Number(m[2] || 0);
  if (hh > 23 || mm > 59) return "";
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
function targetLabel(t) { return t ? t : "Section"; }
function hm(t) { return String(t || "").slice(0, 5); }

const TT_HEADER_WORDS = {
  day: ["day", "jour"], starts: ["start", "starts", "debut", "heure_debut", "from", "de"], ends: ["end", "ends", "fin", "heure_fin", "to", "a"],
  module: ["module", "code", "matiere", "module_code"], module_name: ["module_name", "intitule", "title", "name", "nom_du_module"],
  kind: ["activity", "type", "kind", "nature", "activite"], target: ["group", "groupe", "public", "target", "groups"],
  parity: ["week", "semaine", "parity", "parite"], room: ["room", "salle", "lieu"], teacher: ["teacher", "enseignant", "prof", "teachers"],
};
// The DeptDesk timetable template (one line per weekly slot), read from the first sheet that has Day / Start columns.
function parseTimetableWorkbook(book) {
  for (const name of book.names) {
    const grid = book.sheets[name] || [];
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const cols = {};
      grid[r].forEach((cell, c) => {
        const h = normaliseHeader(cell);
        for (const [k, words] of Object.entries(TT_HEADER_WORDS)) if (cols[k] === undefined && words.includes(h)) cols[k] = c;
      });
      if (cols.day === undefined || cols.starts === undefined || cols.module === undefined) continue;
      const rows = [], problems = [];
      grid.slice(r + 1).forEach((row, i) => {
        const get = (k) => (cols[k] === undefined ? "" : String(row[cols[k]] || "").trim());
        if (!get("day") && !get("module")) return;
        const line = String(r + 2 + i), day = dayFromText(get("day")), starts = timeFromText(get("starts")), ends = timeFromText(get("ends"));
        if (day === null) { problems.push(`line ${line}: unknown day "${get("day")}"`); return; }
        if (!starts || !ends) { problems.push(`line ${line}: start / end time not understood`); return; }
        const p = get("parity").toUpperCase();
        rows.push({ line, day, starts, ends, module: get("module"), module_name: get("module_name"), kind: get("kind"),
          target: /^(section|all|tous|toute|whole)/i.test(get("target")) ? "" : get("target").toUpperCase().replace(/\s/g, ""),
          parity: /(^|\s)(A|1|S1)$/.test(p) || /WEEK ?A|SEMAINE ?1/.test(p) ? "A" : /(^|\s)(B|2|S2)$/.test(p) || /WEEK ?B|SEMAINE ?2/.test(p) ? "B" : "all",
          room: get("room"), teacher: get("teacher") });
      });
      return { sheet: name, rows, problems };
    }
  }
  return { sheet: null, rows: [], problems: ["No sheet with the columns Day, Start, End, Module."] };
}
function exportTimetableTemplate(ctx, slots, sectionName) {
  const rows = [["Day", "Start", "End", "Module", "Module name", "Activity", "Group", "Week", "Room", "Teacher"]];
  (slots.length ? slots : [{ day: 0, starts: "08:00", ends: "09:30", module: "CODE", module_name: "Full name of the module", kind: "course", target: "", parity: "all", room: "103D", teacher: "Mme Name" }])
    .forEach((s) => rows.push([DAY_NAMES[s.day], hm(s.starts), hm(s.ends), s.module, s.module_name || "", KIND_LABEL[s.kind] || s.kind, targetLabel(s.target),
      s.parity === "all" ? "every week" : s.parity, s.room || "", s.teacher || ""]));
  const help = [["How to fill the timetable template"], [],
    ["Day", "Saturday ... Thursday (or Samedi ... Jeudi)"], ["Start / End", "08:00, 9h40, 11h20..."],
    ["Module", "short code (AWP, DSP...): the same code on every line of the module"], ["Module name", "full name (once is enough)"],
    ["Activity", "Course, TD or TP"], ["Group", "Section (whole section), G1, G2 (TD groups), SG1 ... SG6 (TP sub-groups)"],
    ["Week", "every week, A or B (TP every two weeks)"], ["Room", "free text, can be changed later"], ["Teacher", "name as in the directory (Mme Raaf, M. Labandji)"]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows, [11, 7, 7, 10, 36, 9, 9, 11, 12, 20]), "Timetable");
  XLSX.utils.book_append_sheet(wb, sheetFromRows(help, [14, 80]), "Help");
  XLSX.writeFile(wb, `Timetable_${safeFileName(ctx.levelShort)}_${safeFileName(sectionName || "")}_${todayIso()}.xlsx`);
}

// The usual grid: one line per day, the six periods of 1 h 30 in columns; a 3-hour slot spans two columns (merged cells).
const PERIODS = [["08:00", "09:30"], ["09:40", "11:10"], ["11:20", "12:50"], ["13:00", "14:30"], ["14:40", "16:10"], ["16:20", "17:50"]];
const toMin = (t) => { const [h, m] = hm(t).split(":").map(Number); return h * 60 + m; };
function periodRange(slot) {
  const s = toMin(slot.starts), e = toMin(slot.ends), cols = [];
  PERIODS.forEach(([a, b], i) => { if (Math.min(e, toMin(b)) - Math.max(s, toMin(a)) >= 40) cols.push(i); });
  if (!cols.length) { let best = 0, bd = 1e9; PERIODS.forEach(([a], i) => { const d = Math.abs(toMin(a) - s); if (d < bd) { bd = d; best = i; } }); cols.push(best); }
  return [cols[0], cols[cols.length - 1]];
}
function slotText(s, students) {
  const head = `${s.module}${s.kind === "course" || s.kind === "rotation" ? "" : " " + KIND_LABEL[s.kind]}${s.target ? " " + s.target : ""}${s.parity !== "all" ? " (week " + s.parity + ")" : ""}`;
  const time = (s.kind === "tp" || hm(s.starts) !== PERIODS[periodRange(s)[0]][0]) ? ` ${hm(s.starts)}-${hm(s.ends)}` : "";
  return [head + time, s.room || "", students || !s.teacher ? "" : "(" + s.teacher + ")"].filter(Boolean).join(" · ");
}
function timetableGridRows(slots, students) {
  const days = [0, 1, 2, 3, 4, 5].concat(slots.some((s) => s.day === 6) ? [6] : []);
  const rows = [["", ...PERIODS.map(([a, b]) => `${a}-${b}`)]], merges = [];
  days.forEach((d, di) => {
    const r = di + 1, row = [DAY_NAMES[d], "", "", "", "", "", ""];
    // blocks: slots grouped by period range; overlapping ranges are joined
    const blocks = [];
    slots.filter((s) => s.day === d).sort((a, b) => toMin(a.starts) - toMin(b.starts)).forEach((s) => {
      const [c0, c1] = periodRange(s);
      const b = blocks.find((x) => !(c1 < x.c0 || c0 > x.c1));
      if (b) { b.c0 = Math.min(b.c0, c0); b.c1 = Math.max(b.c1, c1); b.items.push(s); } else blocks.push({ c0, c1, items: [s] });
    });
    blocks.forEach((b) => {
      row[b.c0 + 1] = b.items.map((s) => slotText(s, students)).join("\n");
      if (b.c1 > b.c0) merges.push({ s: { r: r + 2, c: b.c0 + 1 }, e: { r: r + 2, c: b.c1 + 1 } });
    });
    rows.push(row);
  });
  return { rows, merges };
}
// v2.1: TP days of a whole section (several sub-groups in turn) become one line in the grid and a "TP rotation" sheet:
// one line per sub-group, one column per time window, week A and week B side by side.
function tpRotationDays(slots) {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => new Set(slots.filter((s) => s.day === d && s.kind === "tp").map((s) => s.target)).size >= 2);
}
function tpRotationRows(slots, students) {
  const rows = [];
  tpRotationDays(slots).forEach((d) => {
    const tp = slots.filter((s) => s.day === d && s.kind === "tp");
    const wins = [...new Set(tp.map((s) => `${hm(s.starts)}-${hm(s.ends)}`))].sort();
    const targets = [...new Set(tp.map((s) => s.target))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    rows.push([`${DAY_NAMES[d]} - TP rotation`], ["Sub-group", "Week", ...wins]);
    targets.forEach((t) => {
      const parities = [...new Set(tp.filter((s) => s.target === t).map((s) => s.parity))].sort();
      parities.forEach((p) => rows.push([t, p === "all" ? "every week" : p, ...wins.map((w) => {
        const s = tp.find((x) => x.target === t && x.parity === p && `${hm(x.starts)}-${hm(x.ends)}` === w);
        return s ? [s.module, s.room || "", students || !s.teacher ? "" : "(" + s.teacher + ")"].filter(Boolean).join(" · ") : "";
      })]));
    });
    rows.push([]);
  });
  return rows;
}
function exportTimetableGrid(ctx, slots, title, students, collapseTp) {
  const tpDays = collapseTp ? tpRotationDays(slots) : [];
  const gridSlots = slots.filter((s) => !(s.kind === "tp" && tpDays.includes(s.day)));
  tpDays.forEach((d) => {
    const tp = slots.filter((s) => s.day === d && s.kind === "tp");
    const s0 = tp.reduce((m, s) => (s.starts < m ? s.starts : m), "99"), e0 = tp.reduce((m, s) => (s.ends > m ? s.ends : m), "");
    gridSlots.push({ day: d, starts: s0, ends: e0, kind: "rotation", module: "TP in turn: see the sheet TP rotation", target: "", parity: "all", room: "" });
  });
  const g = timetableGridRows(gridSlots, students);
  const rows = [[`${ctx.levelName} - ${ctx.semesterLabel} - ${title}${students ? "" : " (with teachers)"}`], [], ...g.rows];
  const ws = sheetFromRows(rows, [11, 28, 28, 28, 28, 28, 28], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, ...g.merges]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timetable");
  const rot = tpRotationRows(slots, students);
  if (rot.length) XLSX.utils.book_append_sheet(wb, sheetFromRows(rot, [12, 12, 30, 30, 30, 30]), "TP rotation");
  XLSX.writeFile(wb, `Timetable_${safeFileName(ctx.levelShort)}_${safeFileName(title)}${students ? "_students" : ""}_${todayIso()}.xlsx`);
}

// Follow-up: the usual sheet per section (one line per module, Course / TD / TP columns) and a detailed sheet.
function doneText(row) {
  const n = row.in_person + row.online;
  return row.online ? `${n} (${row.in_person} in person + ${row.online} online)` : n;
}
function exportFollowup(ctx, board) {
  const wb = XLSX.utils.book_new();
  const sections = [...new Set(board.rows.map((r) => r.section))];
  const dateTxt = new Date(board.as_of + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  sections.forEach((sec) => {
    const list = board.rows.filter((r) => r.section === sec);
    const mods = [...new Set(list.map((r) => r.module))];
    const rows = [[`${ctx.levelShort} - section ${sec}`, `Number of sessions done until ${dateTxt}`], ["", "Course", "TD", "TP"]];
    mods.forEach((code) => {
      const by = (k) => list.find((r) => r.module === code && r.kind === k);
      const name = (list.find((r) => r.module === code) || {}).module_name || code;
      rows.push([name, ...["course", "td", "tp"].map((k) => (by(k) ? doneText(by(k)) : ""))]);
    });
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rows, [40, 26, 22, 22], [{ s: { r: 0, c: 1 }, e: { r: 0, c: 3 } }]), `Section ${sec}`.slice(0, 31));
  });
  const det = [["Section", "Module", "Activity", "Planned", "Done", "of which online", "Gap", "Detail by group", "Delegate remarks", "Teacher answers"]];
  board.rows.forEach((r) => det.push([r.section, `${r.module} ${r.module_name || ""}`.trim(), KIND_LABEL[r.kind], r.planned, r.done, r.online, r.planned - r.done,
    r.kind === "course" ? "" : r.targets.map((t) => `${t.target}: ${t.in_person + t.online}/${t.planned}`).join(", "),
    r.remarks.map((x) => `${x.day}: ${x.note}`).join(" | "), r.teacher_answers.map((x) => `${x.day}: ${x.comment}`).join(" | ")]));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(det, [8, 34, 9, 9, 7, 9, 6, 40, 50, 40]), "Detail");
  XLSX.writeFile(wb, `Follow-up_${safeFileName(ctx.levelShort)}_${board.as_of}.xlsx`);
}
