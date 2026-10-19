// DeptDesk v2.2 - "timetable-exchange v1": a self-contained JSON copy of a timetable for another application
// (first user: ClassPulse). Pure functions, no page access: the same file can be used by the importing application
// to check a file (validateTimetableExchange).
if (typeof window !== "undefined") (window.DD_FILES = window.DD_FILES || {})["exchange.js"] = "2.2"; // file version, checked by the page

const TX_FORMAT = "timetable-exchange";
const TX_VERSION = 1;
const TX_DAYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

// src: { app, appVersion, department, level: {name, short_name}, semester: {year, period, code, starts, ends, week_a_start},
//        sections: [{id, name, td_count, tp_count}], modules (api_modules), slots (api_timetable), weeks (api_weeks),
//        sessions (api_sessions, optional), withTeachers, scope: free text describing the view exported }
function buildTimetableExchange(src) {
  const hm = (t) => (t ? String(t).slice(0, 5) : null);
  const actById = {};
  (src.modules || []).forEach((m) => (m.activities || []).forEach((a) => { actById[a.id] = { module: m.code, kind: a.kind, starts: a.starts }; }));
  const usedSections = new Set(src.slots.map((s) => s.section_id));
  // teachers: label only (never e-mail or phone), short stable keys t1, t2...
  const tKeys = {}, teachers = [];
  if (src.withTeachers) {
    src.slots.filter((s) => s.teacher_id).forEach((s) => {
      if (!tKeys[s.teacher_id]) { tKeys[s.teacher_id] = "t" + (teachers.length + 1); teachers.push({ key: tKeys[s.teacher_id], label: s.teacher || "" }); }
    });
  }
  const usedModules = new Set(src.slots.map((s) => s.module));
  const slots = src.slots.map((s) => {
    const act = actById[s.activity_id] || {};
    const from = act.starts && src.semester.starts && act.starts > src.semester.starts ? act.starts : src.semester.starts || null;
    return { id: "s" + s.id, section: s.section, module: s.module, kind: s.kind, group: s.target || "", day: TX_DAYS[s.day], day_index: s.day,
      start: hm(s.starts), end: hm(s.ends), weeks: s.parity, room: s.room || "", teacher: src.withTeachers && s.teacher_id ? tKeys[s.teacher_id] : null,
      valid_from: from, valid_to: src.semester.ends || null, note: s.note || "" };
  });
  const slotIds = new Set(src.slots.map((s) => s.id));
  const exceptions = [];
  (src.sessions || []).filter((c) => usedSections.has(c.section_id)).forEach((c) => {
    if (c.status === "cancelled" && c.slot_id && slotIds.has(c.slot_id)) {
      exceptions.push({ date: c.day, action: "cancelled", slot: "s" + c.slot_id, reason: c.note || "" });
    } else if (c.status === "makeup" && usedModules.has(c.module)) {
      exceptions.push({ date: c.day, action: "added", section: c.section, module: c.module, kind: c.kind, group: c.target || "",
        start: hm(c.starts), end: null, room: c.room || "", reason: c.note || "" });
    }
  });
  return {
    format: TX_FORMAT, version: TX_VERSION,
    generated_at: new Date().toISOString(), generator: { app: src.app || "DeptDesk", version: src.appVersion || "" },
    scope: src.scope || "",
    context: { department: src.department || "", level: src.level.name || "", level_short: src.level.short_name || "",
      year: src.semester.year, period: src.semester.period, semester_code: src.semester.code || "",
      timezone: "Africa/Algiers", week_starts_on: "saturday", school_days: TX_DAYS.slice(0, 6) },
    semester: { starts: src.semester.starts || null, ends: src.semester.ends || null, week_a_start: src.semester.week_a_start || null },
    weeks: (src.weeks || []).map((w) => ({ week_start: w.week_start, kind: w.kind, teaching_no: w.no == null ? null : w.no, parity: w.parity || null })),
    sections: (src.sections || []).filter((x) => usedSections.has(x.id)).map((x) => ({
      code: x.name, td_groups: Array.from({ length: x.td_count }, (_, i) => "G" + (i + 1)), tp_groups: Array.from({ length: x.tp_count }, (_, i) => "SG" + (i + 1)) })),
    modules: (src.modules || []).filter((m) => usedModules.has(m.code)).map((m) => ({ code: m.code, name: m.name || "", color: m.color || null })),
    teachers,
    slots,
    exceptions,
  };
}

// Returns a list of problems (empty = valid). Kept small on purpose: the importing application can copy it.
function validateTimetableExchange(x) {
  const p = [], time = /^([01]\d|2[0-3]):[0-5]\d$/, date = /^\d{4}-\d{2}-\d{2}$/;
  if (!x || x.format !== TX_FORMAT) return ["not a timetable-exchange file"];
  if (x.version !== TX_VERSION) p.push(`version ${x.version} not supported (expected ${TX_VERSION})`);
  if (!Array.isArray(x.slots)) return p.concat(["slots missing"]);
  const ids = new Set(), byId = {}, sections = new Set((x.sections || []).map((s) => s.code)), modules = new Set((x.modules || []).map((m) => m.code));
  const teachers = new Set((x.teachers || []).map((t) => t.key));
  x.slots.forEach((s, i) => {
    const w = `slot ${i + 1}`;
    if (!s.id || ids.has(s.id)) p.push(`${w}: missing or repeated id`); ids.add(s.id); byId[s.id] = s;
    if (!sections.has(s.section)) p.push(`${w}: unknown section ${s.section}`);
    if (!modules.has(s.module)) p.push(`${w}: unknown module ${s.module}`);
    if (!["course", "td", "tp"].includes(s.kind)) p.push(`${w}: kind must be course, td or tp`);
    if (s.kind === "course" && s.group) p.push(`${w}: a course is for the whole section (group "")`);
    if (s.kind !== "course" && !/^S?G\d+$/.test(s.group || "")) p.push(`${w}: group must be G<n> or SG<n>`);
    if (TX_DAYS.indexOf(s.day) !== s.day_index) p.push(`${w}: day and day_index disagree`);
    if (!time.test(s.start || "") || !time.test(s.end || "") || s.end <= s.start) p.push(`${w}: bad hours`);
    if (!["all", "A", "B"].includes(s.weeks)) p.push(`${w}: weeks must be all, A or B`);
    if (s.teacher && !teachers.has(s.teacher)) p.push(`${w}: unknown teacher key ${s.teacher}`);
    if ((s.valid_from && !date.test(s.valid_from)) || (s.valid_to && !date.test(s.valid_to))) p.push(`${w}: bad validity dates`);
  });
  (x.exceptions || []).forEach((e, i) => {
    const w = `exception ${i + 1}`;
    if (!date.test(e.date || "")) p.push(`${w}: bad date`);
    if (!["cancelled", "moved", "added"].includes(e.action)) p.push(`${w}: action must be cancelled, moved or added`);
    if ((e.action === "cancelled" || e.action === "moved") && !ids.has(e.slot)) p.push(`${w}: unknown slot ${e.slot}`);
    else if (byId[e.slot] && date.test(e.date || "") && (new Date(e.date + "T12:00:00Z").getUTCDay() + 1) % 7 !== byId[e.slot].day_index) p.push(`${w}: ${e.date} is not a ${byId[e.slot].day}`);
    if (e.action === "moved" && !(e.to && date.test(e.to.date || "") && time.test(e.to.start || ""))) p.push(`${w}: a moved session needs to.date and to.start`);
  });
  return p;
}

if (typeof module !== "undefined") module.exports = { buildTimetableExchange, validateTimetableExchange, TX_DAYS };
