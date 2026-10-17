// DeptDesk - reading and writing spreadsheets (SheetJS). Reads .xlsx, .xls, .ods, .csv; writes .xlsx (opens in LibreOffice).
(window.DD_FILES = window.DD_FILES || {})["excel.js"] = "1"; // file version, checked by the page

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
