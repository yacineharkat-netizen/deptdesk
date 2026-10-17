// DeptDesk - public page of a section (no account): the timetable for students (no teacher names) and,
// with a student number, the TD group and the TP sub-group of the student.
(window.DD_FILES = window.DD_FILES || {})["public.js"] = "2"; // file version, checked by the page

const token = new URLSearchParams(location.search).get("t") || "";
let PUB = null, view = "";
const hhmm = (t) => String(t || "").slice(0, 5);

async function loadPublic() {
  try { PUB = await rpc("api_public_timetable", { p_token: token }); }
  catch (e) { $("pBody").innerHTML = errorBox(e.message); $("pTitle").textContent = "Timetable"; return; }
  document.documentElement.style.setProperty("--level", PUB.color || "#1B7F8C");
  $("pTitle").textContent = `${PUB.level_short || PUB.level} · section ${PUB.section}`;
  $("pSub").textContent = `${PUB.year} · semester ${PUB.period}${PUB.code ? " (" + PUB.code + ")" : ""}`;
  $("pWeek").textContent = PUB.week_kind === "teaching" ? `This week is a week ${PUB.parity}: the TP marked "week ${PUB.parity}" take place.` : PUB.week_kind ? `This week: ${PUB.week_kind}.` : "";
  const targets = [...new Set(PUB.slots.map((s) => s.target).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  try { view = localStorage.getItem("dd_pub_" + token) || ""; } catch (e) { view = ""; }
  $("pView").innerHTML = `<option value="">Everything</option>` + targets.map((t) => `<option value="${esc(t)}">${t.startsWith("SG") ? "TP sub-group" : "TD group"} ${esc(t)}</option>`).join("")
    + (targets.some((t) => t.startsWith("G")) && targets.some((t) => t.startsWith("SG")) ? "" : "");
  if (view && !$("pView").querySelector(`option[value="${view}"]`)) $("pView").insertAdjacentHTML("beforeend", `<option value="${esc(view)}">My groups (${esc(view.replace("+", " + "))})</option>`);
  if (view) $("pView").value = view;
  draw();
}
function draw() {
  const groups = view ? view.split("+") : [];
  const list = PUB.slots.filter((s) => !groups.length || s.target === "" || groups.includes(s.target));
  const days = [0, 1, 2, 3, 4, 5].concat(list.some((s) => s.day === 6) ? [6] : []);
  $("pBody").innerHTML = list.length ? days.map((d) => {
    const items = list.filter((s) => s.day === d);
    return `<div class="day-row"><div class="dname">${DAYS[d]}</div><div class="slots">${items.map((s) => `<div class="slot" style="--mod:${esc(s.color)}">
      <div class="t">${hhmm(s.starts)}–${hhmm(s.ends)} · ${esc(s.module)} ${s.kind === "course" ? "" : KIND_NAME[s.kind]}${s.target ? " · " + esc(s.target) : ""}${s.parity !== "all" ? ` <span class="pill">week ${s.parity}</span>` : ""}</div>
      <div class="m">${esc(s.module_name || "")}</div><div class="m">📍 ${esc(s.room || "room?")}</div></div>`).join("") || '<span class="muted small-text">—</span>'}</div></div>`;
  }).join("") : `<p class="muted">No timetable published yet.</p>`;
}
$("pView").onchange = () => { view = $("pView").value; try { localStorage.setItem("dd_pub_" + token, view); } catch (e) { /* private mode */ } draw(); };
$("pFind").onclick = async () => {
  $("pMine").innerHTML = "";
  try {
    const r = await rpc("api_public_lookup", { p_token: token, p_matricule: $("pMat").value });
    const parts = [r.td ? "TD group G" + r.td : "no TD group yet", r.tp ? "TP sub-group SG" + r.tp : "no TP sub-group yet"];
    $("pMine").innerHTML = `<p class="badge ok" style="font-size:15px;margin-top:8px">${esc(parts.join(" · "))}</p>`;
    view = [r.td ? "G" + r.td : "", r.tp ? "SG" + r.tp : ""].filter(Boolean).join("+");
    try { localStorage.setItem("dd_pub_" + token, view); } catch (e) { /* private mode */ }
    if (!$("pView").querySelector(`option[value="${view}"]`)) $("pView").insertAdjacentHTML("beforeend", `<option value="${esc(view)}">My groups (${esc(view.replace("+", " + "))})</option>`);
    $("pView").value = view; draw();
  } catch (e) { $("pMine").innerHTML = errorBox(e.code === "UNKNOWN_STUDENT" ? "This student number is not in this section. Check it, or ask your delegate." : e.message); }
};
$("pMat").addEventListener("keydown", (e) => { if (e.key === "Enter") $("pFind").click(); });
$("pFoot").textContent = (typeof CONFIG !== "undefined" && CONFIG.homeLine) || "";
watchNetwork("netBanner");
if (!token) $("pBody").innerHTML = errorBox("This link is incomplete: ask your delegate for the link of your section.");
else loadPublic();
