// DeptDesk - public page of a section (no account): the timetable for students (no teacher names) and,
// with a student number, the TD group and the TP sub-group of the student.
(window.DD_FILES = window.DD_FILES || {})["public.js"] = "2.2"; // file version, checked by the page

const token = new URLSearchParams(location.search).get("t") || "";
let PUB = null, view = "", week = null, day = null, auto = null;

async function loadPublic() {
  try { PUB = await rpc("api_public_timetable", { p_token: token }); }
  catch (e) { $("pBody").innerHTML = errorBox(e.message); $("pTitle").textContent = "Timetable"; return; }
  document.documentElement.style.setProperty("--level", PUB.color || "#1B7F8C");
  $("pTitle").textContent = `${PUB.level_short || PUB.level} · section ${PUB.section}`;
  $("pSub").textContent = `${PUB.year} · semester ${PUB.period}${PUB.code ? " (" + PUB.code + ")" : ""}`;
  auto = TTV.weekChoice(PUB.weeks || [], PUB.today || todayAlgiers());
  week = auto.parity;
  $("pWeek").textContent = auto.parity ? `Week ${auto.parity} = ${auto.label}${auto.no ? " (teaching week " + auto.no + ")" : ""}.` : "";
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
  const list = PUB.slots.filter((x) => !groups.length || x.target === "" || groups.includes(x.target));
  if (!list.length) { $("pBody").innerHTML = `<p class="muted">No timetable published yet.</p>`; return; }
  const now = new Date(Date.now() + 3600000);
  TTV.render($("pBody"), { slots: list, week, day, mode: groups.length ? "group" : "section", students: true,
    phone: window.matchMedia("(max-width: 640px)").matches, today: PUB.today || todayAlgiers(), nowMin: now.getUTCHours() * 60 + now.getUTCMinutes(),
    weekLabel: auto && week === auto.parity ? auto.label : "", canEdit: false,
    onChange: (c) => { week = c.week; day = c.day; draw(); } });
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
