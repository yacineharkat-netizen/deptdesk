// DeptDesk - sign-in page: log in, create an account, type an invitation code.
(window.DD_FILES = window.DD_FILES || {})["index.js"] = "1"; // file version, checked by the page

const params = new URLSearchParams(location.search);
const linkCode = (params.get("code") || "").toUpperCase();

function show(view) {
  ["viewAuth", "viewCode", "viewWait"].forEach((v) => $(v).classList.toggle("hidden", v !== view));
}
function mode(signup) {
  $("segLogin").classList.toggle("on", !signup); $("segSignup").classList.toggle("on", signup);
  $("formLogin").classList.toggle("hidden", signup); $("formSignup").classList.toggle("hidden", !signup);
}
const AUTH_ERRORS = {
  invalid_credentials: "Wrong e-mail or password.",
  user_already_exists: "An account already exists with this e-mail: log in instead.",
  weak_password: "Password too weak: 8 characters or more.",
  email_address_invalid: "This e-mail address is not valid.",
  over_email_send_rate_limit: "Too many attempts: wait a few minutes.",
};
function authError(error) {
  return AUTH_ERRORS[error.code] || (/invalid login/i.test(error.message) ? AUTH_ERRORS.invalid_credentials : error.message);
}

// After any sign-in: an account with a role goes to the application; a new account types its code.
async function route() {
  const { data } = await db.auth.getSession();
  if (!data.session) { show("viewAuth"); mode(!!linkCode); return; }
  try {
    await rpc("api_me");
    location.href = "app.html";
  } catch (e) {
    if (e.code === "ACCOUNT_NOT_ALLOWED") {
      $("codeWho").textContent = data.session.user.email || "";
      if (linkCode) $("code").value = linkCode;
      show("viewCode");
    } else if (e.code === "NOT_LOGGED_IN" || /log in again/i.test(e.message)) { await db.auth.signOut(); show("viewAuth"); }
    else { show("viewAuth"); toast(e.message, "error"); }
  }
}

$("segLogin").onclick = () => mode(false);
$("segSignup").onclick = () => mode(true);
$("homeLine").textContent = (typeof CONFIG !== "undefined" && CONFIG.homeLine) || "";

$("loginBtn").onclick = async () => {
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || !password) { toast("Type your e-mail and your password.", "error"); return; }
  $("loginBtn").disabled = true;
  const { error } = await db.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false;
  if (error) { toast(authError(error), "error"); return; }
  route();
};
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });

$("signupBtn").onclick = async () => {
  const email = $("suEmail").value.trim(), p1 = $("suPassword").value, p2 = $("suPassword2").value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast(AUTH_ERRORS.email_address_invalid, "error"); return; }
  if (p1.length < 8) { toast(AUTH_ERRORS.weak_password, "error"); return; }
  if (p1 !== p2) { toast("The two passwords are different.", "error"); return; }
  $("signupBtn").disabled = true;
  const { data, error } = await db.auth.signUp({ email, password: p1 });
  $("signupBtn").disabled = false;
  if (error) { toast(authError(error), "error"); return; }
  if (!data.session) { toast("Account created. Log in now.", "ok"); mode(false); $("email").value = email; return; }
  route();
};

$("claimBtn").onclick = async () => {
  $("claimBtn").disabled = true;
  try {
    await rpc("api_claim_invite", { p_code: $("code").value, p_name: $("fullName").value });
    toast("Welcome!", "ok");
    location.href = "app.html";
  } catch (e) { toast(e.message, "error"); $("claimBtn").disabled = false; }
};
$("codeLogout").onclick = async () => { await db.auth.signOut(); show("viewAuth"); };

watchNetwork("netBanner");
route();
