/* Deployment Availability — team development
   - ArcGIS OAuth 2.0 sign-in (same pattern and client ID as the county profile site)
   - Survey results read straight from a secured ArcGIS hosted table/layer with the signed-in user's token
   - Position gap table, filterable charts, multi-team org chart with selection
   - PNG / PDF / CSV exports for leadership briefings
*/
(function () {
  "use strict";

  /* ================================================================== CONFIG */
  const CONFIG = {
    CLIENT_ID: "w9VaoRCHch2gIU1d",
    PORTAL_URL: "https://www.arcgis.com",       // or https://<your-org>.maps.arcgis.com / your Enterprise portal
    // REST URL of the hosted table or layer that holds the survey results — everyone loads this one.
    // Admins can point their own browser at a different table from Settings.
    LAYER_URL: "https://services1.arcgis.com/kILp9lqGUeOhnDbI/arcgis/rest/services/tn_form_681_entries_(2)/FeatureServer/0",
    // ArcGIS usernames (or account emails) that see the Settings button. Not case-sensitive.
    ADMINS: ["ali.fontana@tn.gov"],
    // Optional: force a survey question to a specific field name, e.g. { qualified: "qualified_position" }.
    // Leave empty to match automatically on field names and aliases.
    FIELDS: {}
  };

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(location.hostname) &&
                         new URLSearchParams(location.search).has("preview");

  /* ================================================================== POSITIONS
     Order matches the Excel gap review. `re` recognises the position in free text or
     Survey123 choice codes (e.g. "ICT3-AH - Incident Commander", "ICT3_AH"). */
  const POSITIONS = [
    { code: "ICT",  label: "IC/TL",      title: "Incident Commander/Team Leader", re: /incident\s*commander|team\s*leader|\bICT\d?|\bIC\s*\/\s*TL|\bIC\b/i },
    { code: "PIO",  label: "PIO",        title: "Public Information Officer",      re: /\bPIO|public\s*information/i },
    { code: "SOF",  label: "SOFR",       title: "Safety Officer",                  re: /\bSOFR?\d?|safety\s*officer/i },
    { code: "LOFR", label: "LOFR",       title: "Liaison Officer",                 re: /\bLOFR|\bLNO\b|liaison/i },
    { code: "OPS",  label: "OPS",        title: "Operations Section Chief",        re: /\bOSC\d?|\bOPS\b|operations\s*section\s*chief/i },
    { code: "PSC",  label: "PSC",        title: "Planning Section Chief",          re: /\bPSC\d?|planning\s*section/i },
    { code: "LSC",  label: "LSC",        title: "Logistics Section Chief",         re: /\bLSC\d?|logistics\s*section/i },
    { code: "FSC",  label: "FSC",        title: "Finance/Admin Section Chief",     re: /\bFSC\d?|finance/i },
    { code: "DOSC", label: "Deputy OSC", title: "Deputy Operations Section Chief", re: /deputy\s*(OSC|op)|\bDOSC/i },
    { code: "SITL", label: "SITL",       title: "Situation Unit Leader",           re: /\bSITL|situation\s*unit/i },
    { code: "COML", label: "COML",       title: "Communications Unit Leader",      re: /\bCOML|communications?\s*unit/i },
    { code: "STAM", label: "STAM",       title: "Staging Area Manager",            re: /\bSTAM|staging\s*area/i },
    { code: "RESL", label: "RESL",       title: "Resource Unit Leader",            re: /\bRESL|resources?\s*unit/i },
    { code: "ITSL", label: "ITSL",       title: "Info Tech Service Unit Leader",   re: /\bITSL|info(rmation)?\s*tech/i },
    { code: "DOCL", label: "DOCL",       title: "Documentation Unit Leader",       re: /\bDOCL|documentation\s*unit/i }
  ];
  const POS = Object.fromEntries(POSITIONS.map((p) => [p.code, p]));
  // Deputy OSC must be tested before OPS (both mention operations)
  const MATCH_ORDER = ["DOSC", ...POSITIONS.map((p) => p.code).filter((c) => c !== "DOSC")];

  function matchPositions(text) {
    const found = [], unmatched = [];
    if (!text) return { found, unmatched };
    String(text).split(/[,;\n|]+/).map((t) => t.trim()).filter(Boolean).forEach((part) => {
      const code = MATCH_ORDER.find((c) => POS[c].re.test(part));
      if (code) { if (!found.includes(code)) found.push(code); } else unmatched.push(part);
    });
    return { found, unmatched };
  }

  // Trainee for a position = not qualified in it, and has an open task book, is trained in it,
  // or named it as their preferred position
  const isTraineeFor = (p, code) => !p.quals.includes(code) &&
    (p.trainee.includes(code) || p.candidates.includes(code) || (p.prefTrain || []).includes(code));
  const prefersPos = (p, code) => (p.prefCodes || []).includes(code);

  /* ================================================================== COLORS (validated: dataviz palette check) */
  const REGIONS = ["East", "Middle", "West", "Unspecified"];
  const REGION_COLOR = { East: "#2a78d6", Middle: "#eb6834", West: "#1baf7a", Unspecified: "#a3a29c" };
  // Org chart color coding for preferred position
  const PREF_COLOR = { match: "#157a55", other: "#1c5cab", trainee: "#5b4bc4" };
  const AVAIL_COLOR = { Full: "#6250d6", Partial: "#eda100", Blank: "#a3a29c" };
  const AVAIL_LABEL = { Full: "Full", Partial: "Partial / Restrictions", Blank: "Not stated" };
  const AVAIL_SHORT = { Full: "Full", Partial: "Partial/Restr.", Blank: "Not stated" };

  /* ================================================================== FIELD MATCHING */
  const FIELD_DEFS = [
    // key, label, test(normalized name/alias)
    ["first", "First Name", (n) => n === "firstname" || (n.includes("first") && n.includes("name"))],
    ["last", "Last Name", (n) => n === "lastname" || (n.includes("last") && n.includes("name"))],
    ["fullName", "Full Name", (n) => n === "fullname" || n === "name"],
    ["email", "Email", (n) => n.includes("email")],
    ["phone", "Phone Number", (n) => n.includes("phone")],
    ["duration", "Anticipated Response Duration", (n) => n.includes("duration")],
    ["incident", "Incident Description", (n) => n.includes("incident")],
    ["partialDates", "If partially available - what dates…", (n) => n.includes("partial") || n.includes("datesavail") || n.includes("whatdates")],
    ["availability", "Availability", (n) => n === "availability" || (n.includes("availab") && !n.includes("partial") && !n.includes("date"))],
    ["scope", "In-state and EMAC / Deployment type", (n) => n.includes("emac") || n.includes("deploymenttype") || n.includes("deploymentscope")],
    ["approval", "Home agency approved?", (n) => n.includes("approv")],
    ["restrictions", "Restrictions", (n) => n.includes("restrict")],
    ["trainee", "TRAINEE – open task book", (n) => n.includes("trainee") || n.includes("taskbook")],
    ["candidates", "POSITION CANDIDATES – trained in", (n) => n.includes("candidate") || n.includes("trainedin")],
    ["qualified", "QUALIFIED – qualified position", (n) => n.includes("qualified")],
    ["preferred", "Preferred Position", (n) => n.includes("prefer")],
    ["region", "Team Affiliation (East, Middle, West)", (n) => n.includes("affiliation") || n === "region" || n === "team"],
    ["submissionId", "Submission ID", (n) => n === "submissionid" || n === "globalid"],
    ["status", "Status", (n) => n === "status"],
    ["submitterId", "Submitter ID", (n) => n === "submitterid" || n === "creator"],
    ["submitted", "Submitted", (n) => n === "submitted" || n === "creationdate"],
    ["updated", "Updated", (n) => n === "updated" || n === "editdate"]
  ];

  function matchFields(fields) {
    // fields: [{name, alias, type, domain}]
    const map = {}, used = new Set();
    FIELD_DEFS.forEach(([key, , test]) => {
      const forced = CONFIG.FIELDS[key];
      if (forced) { const f = fields.find((x) => x.name === forced); if (f) { map[key] = f; used.add(f.name); return; } }
      const f = fields.find((x) => !used.has(x.name) && (test(norm(x.alias)) || test(norm(x.name))));
      if (f) { map[key] = f; used.add(f.name); }
    });
    return map;
  }

  /* ================================================================== CLASSIFY */
  // Answer to the Availability question on its own: Full / Partial / Unavailable / Blank
  function classAvail(v) {
    const t = String(v || "").replace(/[_]+/g, " ").trim().toLowerCase();   // Survey123 codes use underscores
    if (!t) return "Blank";
    if (/unavail|not\s+(currently\s+)?avail|^\s*(no|not|none)\b|cannot\s+deploy|can't\s+deploy|decline/.test(t)) return "Unavailable";
    if (/partial/.test(t)) return "Partial";
    if (/full|yes|avail/.test(t)) return "Full";
    return "Blank";
  }
  // Does the Availability answer itself mention a stipulation ("available with restrictions", "with limitations")?
  const mentionsStipulation = (v) => /restrict|limit|condition|stipulat|caveat|except/i.test(String(v || ""));
  // Treat "no restrictions", "none", "N/A", "-" etc. as an empty answer
  function cleanNote(v) {
    const t = String(v == null ? "" : v).trim();
    if (!t || !/[a-z0-9]/i.test(t)) return "";
    // Empty if every word is a "nothing to report" word: "No restrictions", "None at this time", "N/A - none", "no_restrictions"
    const NONE_WORDS = /^(no|none|n\/a|na|not|applicable|nothing|nil|negative|restrictions?|limitations?|stipulations?|known|at|this|time|noted|currently|any|other|than|that|i|am|aware|of)$/;
    const words = t.toLowerCase().replace(/[_]+/g, " ").split(/[^a-z\/]+/).filter(Boolean);
    if (words.length && words.every((w) => NONE_WORDS.test(w))) return "";
    return t;
  }
  /* Where a person is counted:
     - Restrictions listed (real text, not "no restrictions")       → Partial / Restrictions
     - Availability says partial                                     → Partial / Restrictions
     - Says "available with restrictions" but marked no restrictions → look for a note in the
       partial-dates answer; if there is one → Partial / Restrictions, otherwise → Full
     - "Not available" stays out of the counts whatever else they wrote */
  function classifyAvailability(availRaw, restrictions, dates) {
    const base = classAvail(availRaw);
    const isPartial = base === "Partial" || (mentionsStipulation(availRaw) && !!dates);
    const hasRestr = !!restrictions;
    if (base === "Unavailable") return { avail: "Unavailable", isPartial: false, hasRestr };
    if (isPartial || hasRestr) return { avail: "Partial", isPartial, hasRestr };
    return { avail: base, isPartial: false, hasRestr: false };
  }
  const classScope = (v) => (/emac/i.test(v || "") ? "EMAC" : "In-state");
  function classApproval(v) {
    const t = String(v || "").trim().toLowerCase();
    if (!t) return "Unknown";
    if (/\bnot\b|^no\b|pending|denied|waiting|tbd/.test(t)) return "No";
    if (/yes|approved/.test(t)) return "Yes";
    return "Unknown";
  }
  function classRegion(v) {
    const t = String(v || "").toLowerCase();
    if (/east/.test(t)) return "East";
    if (/mid/.test(t)) return "Middle";
    if (/west/.test(t)) return "West";
    return "Unspecified";
  }

  /* ================================================================== STATE */
  const S = {
    source: "",            // layer URL or "demo"
    fieldMap: {},
    fields: [],
    rows: [],              // raw attribute objects
    incidents: [],
    incident: null,        // selected incident description ("" = all)
    people: [],            // deduped people for the incident
    byId: {},
    regions: new Set(REGIONS),
    mission: "all",
    avail: "all",
    teams: [],
    activeTeam: 0,
    showAll: false,
    loadedAt: null,
    unmatchedPositions: {}
  };

  /* ================================================================== AUTH
     OAuth 2.0 authorization code + PKCE, done directly (no ArcGIS Maps SDK).
     - Standalone tab: full-page redirect to ArcGIS sign-in and back.
     - Inside Experience Builder (iframe): the sign-in window is opened in the same
       instant as the click, so pop-up blockers allow it. The window returns to this
       site, which hands the code back to the embedded page and closes itself.
     - Stays signed in: the refresh token keeps the session alive for up to 14 days,
       so most visits need no sign-in at all. */
  const AUTH = {
    authorizeUrl: CONFIG.PORTAL_URL + "/sharing/rest/oauth2/authorize",
    tokenUrl: CONFIG.PORTAL_URL + "/sharing/rest/oauth2/token",
    selfUrl: CONFIG.PORTAL_URL + "/sharing/rest/community/self",
    // Must match a Redirect URL on the OAuth credential, e.g. https://amz1940.github.io/deployment_availability/
    redirectUri: new URL("./", window.location.href).href,
    expirationMinutes: 20160,          // refresh-token lifetime (max 14 days)
    refreshBufferMs: 5 * 60 * 1000,    // refresh the access token 5 minutes before it expires
    tokenKey: "deploy:token:" + CONFIG.CLIENT_ID,
    msgType: "deploy_avail_oauth"
  };
  const btnSignIn = $("btnSignIn");
  const gateMsg = (m) => ($("gateMsg").textContent = m || "");
  let TOKEN = null;

  const isInIframe = () => { try { return window.self !== window.top; } catch (e) { return true; } };
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomString = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const sha256 = async (str) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)));

  function loadToken() { const t = store.get(AUTH.tokenKey); return t && t.accessToken ? t : null; }
  function saveToken(t) { TOKEN = t; store.set(AUTH.tokenKey, t); }
  function clearToken() { TOKEN = null; try { localStorage.removeItem(AUTH.tokenKey); } catch (e) {} }
  function tokenFromResponse(d) {
    const now = Date.now();
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token || (TOKEN && TOKEN.refreshToken) || null,
      expiresAt: now + (Number(d.expires_in) || 1800) * 1000,
      refreshExpiresAt: d.refresh_token_expires_in ? now + Number(d.refresh_token_expires_in) * 1000 : (TOKEN && TOKEN.refreshExpiresAt) || null,
      username: d.username || (TOKEN && TOKEN.username) || null
    };
  }
  async function postForm(url, params) {
    const res = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
    return res.json();
  }

  // PKCE values are kept in this page's sessionStorage until the code comes back
  let preparedUrl = null;   // a sign-in URL built ahead of time (its PKCE values are the ones in storage)
  async function buildAuthorizeUrl() {
    const verifier = randomString(48), state = randomString(16);
    sessionStorage.setItem("deploy_oauth_verifier", verifier);
    sessionStorage.setItem("deploy_oauth_state", state);
    const q = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID, response_type: "code", redirect_uri: AUTH.redirectUri,
      code_challenge: await sha256(verifier), code_challenge_method: "S256",
      expiration: String(AUTH.expirationMinutes), state
    });
    return AUTH.authorizeUrl + "?" + q;
  }
  async function exchangeCode(code) {
    const verifier = sessionStorage.getItem("deploy_oauth_verifier");
    if (!verifier) throw new Error("Sign-in expired — please click Sign in again.");
    const d = await postForm(AUTH.tokenUrl, { client_id: CONFIG.CLIENT_ID, grant_type: "authorization_code", code, redirect_uri: AUTH.redirectUri, code_verifier: verifier, f: "json" });
    if (d.error) throw new Error((d.error.details && d.error.details[0]) || d.error.message || d.error_description || "Sign-in failed");
    if (!d.access_token) throw new Error("ArcGIS did not return an access token.");
    sessionStorage.removeItem("deploy_oauth_verifier"); sessionStorage.removeItem("deploy_oauth_state");
    return tokenFromResponse(d);
  }
  async function ensureFreshToken() {
    if (!TOKEN) throw new Error("Not signed in");
    if (TOKEN.expiresAt && Date.now() < TOKEN.expiresAt - AUTH.refreshBufferMs) return;
    if (!TOKEN.refreshToken || (TOKEN.refreshExpiresAt && Date.now() > TOKEN.refreshExpiresAt)) throw new Error("Session expired");
    const d = await postForm(AUTH.tokenUrl, { client_id: CONFIG.CLIENT_ID, grant_type: "refresh_token", refresh_token: TOKEN.refreshToken, f: "json" });
    if (d.error || !d.access_token) throw new Error("Session expired");
    saveToken(tokenFromResponse(d));
  }
  // ArcGIS REST request with the signed-in user's token
  async function agsRequest(url, params = {}) {
    try { await ensureFreshToken(); }
    catch (e) { clearToken(); showGate("Your ArcGIS session has expired. Please sign in again."); throw new Error("Signed out"); }
    const d = await postForm(url, Object.assign({ f: "json", token: TOKEN.accessToken }, params));
    if (d && d.error && (d.error.code === 498 || d.error.code === 499)) {
      clearToken(); showGate("Your ArcGIS session has expired. Please sign in again."); throw new Error("Signed out");
    }
    return d;
  }

  // The page ArcGIS sends the user back to (…/deployment_availability/?code=…)
  // Returns "popup" if this window only relays the code and closes.
  async function handleCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code"), error = url.searchParams.get("error"), state = url.searchParams.get("state");
    if (!code && !error) return "none";
    if (window.opener && window.opener !== window) {
      try { window.opener.postMessage({ type: AUTH.msgType, code, state, error, error_description: url.searchParams.get("error_description") }, window.location.origin); }
      catch (e) { console.error(e); }
      document.body.innerHTML = '<div style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#333">Sign-in complete. You can close this window.</div>';
      setTimeout(() => { try { window.close(); } catch (e) {} }, 60);
      return "popup";
    }
    history.replaceState({}, "", url.pathname);
    if (error) { gateMsg("Sign-in error: " + (url.searchParams.get("error_description") || error)); return "error"; }
    const expected = sessionStorage.getItem("deploy_oauth_state");
    if (expected && state !== expected) { gateMsg("Sign-in failed (state mismatch). Please try again."); return "error"; }
    try { saveToken(await exchangeCode(code)); return "ok"; }
    catch (e) { console.error(e); gateMsg(e.message || "Sign-in failed."); return "error"; }
  }

  function waitForPopup(popup) {
    let settled = false;
    const done = () => { window.removeEventListener("message", onMsg); clearInterval(timer); };
    const onMsg = async (ev) => {
      if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== AUTH.msgType) return;
      settled = true; done();
      if (ev.data.error) { resetSignIn(); gateMsg(ev.data.error_description || ev.data.error); return; }
      const expected = sessionStorage.getItem("deploy_oauth_state");
      if (expected && ev.data.state !== expected) { resetSignIn(); gateMsg("Sign-in failed (state mismatch). Please try again."); return; }
      try { saveToken(await exchangeCode(ev.data.code)); await afterSignIn(); }
      catch (e) { console.error(e); resetSignIn(); gateMsg(e.message || "Sign-in failed."); }
    };
    window.addEventListener("message", onMsg);
    const timer = setInterval(() => { if (popup.closed && !settled) { done(); resetSignIn(); prepareUrl(); } }, 500);
  }

  function resetSignIn() { btnSignIn.disabled = false; btnSignIn.textContent = "Sign in with ArcGIS"; }
  // Build the next sign-in URL in advance so the click only has to open the window
  function prepareUrl() { preparedUrl = buildAuthorizeUrl(); preparedUrl.catch(() => (preparedUrl = null)); }

  // Click handler — must stay synchronous up to window.open so the browser treats it as user-initiated
  function startSignIn() {
    gateMsg("");
    if (isInIframe()) {
      const w = 520, h = 700;
      const popup = window.open("about:blank", "deploy_avail_signin",
        `width=${w},height=${h},left=${Math.max(0, (screen.width - w) / 2)},top=${Math.max(0, (screen.height - h) / 2)},scrollbars=1`);
      if (!popup) { gateMsg("The sign-in window was blocked. Use “Open in a new tab” below."); return; }
      try { popup.document.write('<!doctype html><meta charset="utf-8"><title>Signing in…</title><div style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#333">Connecting to ArcGIS Online…</div>'); } catch (e) {}
      btnSignIn.disabled = true; btnSignIn.textContent = "Complete sign-in in the window…";
      const urlP = preparedUrl || buildAuthorizeUrl();
      preparedUrl = null;
      urlP.then((u) => { popup.location.href = u; })
        .catch((e) => { try { popup.close(); } catch (x) {} resetSignIn(); gateMsg("Could not start sign-in. " + (e.message || "")); });
      waitForPopup(popup);
    } else {
      btnSignIn.disabled = true; btnSignIn.textContent = "Redirecting to ArcGIS…";
      buildAuthorizeUrl().then((u) => (window.location.href = u))
        .catch((e) => { resetSignIn(); gateMsg("Could not start sign-in. " + (e.message || "")); });
    }
  }

  function showGate(msg) {
    $("app").hidden = true;
    $("gate").hidden = false; $("gate").style.display = "";
    resetSignIn();
    gateMsg(msg || "");
    btnSignIn.onclick = startSignIn;
    // Embedded: offer a plain link that opens the whole site in its own tab (links are never pop-up-blocked)
    if (isInIframe() && !$("newTabLink")) {
      const u = new URL(window.location.href); u.search = "?signin=1"; u.hash = "";
      $("gateMsg").insertAdjacentHTML("afterend",
        `<p class="gate-alt">Sign-in window didn't open? <a id="newTabLink" href="${esc(u.href)}" target="_blank" rel="noopener">Open in a new tab</a></p>`);
    }
    if (isInIframe()) prepareUrl();
  }

  // Settings is shown only to the accounts listed in CONFIG.ADMINS
  function isAdminUser(me) {
    const ids = [me && me.username, me && me.email, TOKEN && TOKEN.username].filter(Boolean).map((x) => String(x).toLowerCase());
    return CONFIG.ADMINS.some((a) => ids.includes(String(a).toLowerCase()));
  }
  async function afterSignIn() {
    let label = "Signed in", me = null;
    try {
      me = await agsRequest(AUTH.selfUrl);
      if (me && !me.error) label = me.fullName || me.username || label;
      if (me && me.username) TOKEN.username = me.username;
    } catch (e) { if (e.message === "Signed out") return; }
    S.isAdmin = isAdminUser(me && !me.error ? me : null);
    showApp(label);
  }

  async function startAuth() {
    if (isLocalPreview) { S.isAdmin = true; return showApp("Local preview (no sign-in)"); }
    const cb = await handleCallback();
    if (cb === "popup") return;
    TOKEN = loadToken();
    if (TOKEN) {
      try { await ensureFreshToken(); return afterSignIn(); }
      catch (e) { clearToken(); }
    }
    if (cb === "error") { showGate($("gateMsg").textContent); return; }
    showGate();
    // "Open in a new tab" link lands here with ?signin=1 — go straight to ArcGIS sign-in
    if (!isInIframe() && new URLSearchParams(window.location.search).has("signin")) {
      history.replaceState({}, "", window.location.pathname);
      startSignIn();
    }
  }

  $("btnSignOut").onclick = () => {
    clearToken();
    window.location.href = window.location.pathname;
  };

  function showApp(userLabel) {
    $("gate").style.display = "none";
    $("gate").hidden = true;
    $("app").hidden = false;
    $("userName").textContent = userLabel;
    $("btnSettings").hidden = !S.isAdmin;
    wireUi();
    // Admins may have pointed their own browser at another table; everyone else always uses CONFIG.LAYER_URL
    const url = (S.isAdmin && store.get("deploy:layerUrl")) || CONFIG.LAYER_URL;
    if (isLocalPreview) return loadDemo();
    if (url) loadLayer(url);
    else showLoadMsg(S.isAdmin
      ? `<b>No survey table connected yet.</b> Open <a href="#" id="lnkSettings">Settings</a> and paste the REST URL of the ArcGIS table that holds the survey results, or load demo data to try the page.`
      : `<b>No survey table connected yet.</b> Please contact the site administrator.`);
  }

  /* ================================================================== DATA LOADING */
  function showLoadMsg(html, isErr) {
    const el = $("loadMsg");
    el.innerHTML = html; el.hidden = !html; el.classList.toggle("err", !!isErr);
    const l = $("lnkSettings"); if (l) l.onclick = (e) => { e.preventDefault(); openSettings(); };
  }
  function busy(on, msg) { $("busy").hidden = !on; if (msg) $("busyMsg").textContent = msg; }

  async function loadLayer(url) {
    url = url.trim().replace(/\/+$/, "").replace(/\/query$/i, "");
    if (!/\/(FeatureServer|MapServer)\/\d+$/i.test(url)) {
      showLoadMsg(`That URL doesn't end in a layer number. It should look like <code>…/FeatureServer/0</code>.${S.isAdmin ? ` Open <a href="#" id="lnkSettings">Settings</a> to fix it.` : " Please contact the site administrator."}`, true);
      return;
    }
    if (!TOKEN) { showLoadMsg("Sign in to load the survey table, or use demo data.", true); return; }
    busy(true, "Loading survey results from ArcGIS…");
    try {
      const meta = await agsRequest(url);
      if (meta.error) throw new Error(meta.error.message);
      const fields = (meta.fields || []).map((f) => ({ name: f.name, alias: f.alias || f.name, type: f.type, domain: f.domain }));
      const pageSize = Math.min(meta.maxRecordCount || 1000, 2000);
      let rows = [], offset = 0, more = true;
      while (more) {
        const res = await agsRequest(url + "/query",
          { where: "1=1", outFields: "*", returnGeometry: "false", resultOffset: offset, resultRecordCount: pageSize });
        if (res.error) throw new Error(res.error.message);
        const feats = res.features || [];
        rows = rows.concat(feats.map((f) => f.attributes));
        offset += feats.length;
        more = !!res.exceededTransferLimit && feats.length > 0;
      }
      // Decode coded-value domains to their labels
      const domains = fields.filter((f) => f.domain && f.domain.type === "codedValue");
      if (domains.length) rows.forEach((r) => domains.forEach((f) => {
        const cv = f.domain.codedValues.find((c) => c.code === r[f.name]);
        if (cv) r[f.name] = cv.name;
      }));
      S.source = url;
      if (S.isAdmin) store.set("deploy:layerUrl", url);
      $("demoBanner").hidden = true;
      ingest(fields, rows);
      showLoadMsg("");
    } catch (e) {
      console.error(e);
      if (e && e.message === "Signed out") return;
      const m = (e && e.message) || "Unknown error";
      showLoadMsg(`<b>Couldn't load the survey table.</b> ${esc(m)}<br><span class="sub">${S.isAdmin ? `Check that the URL is right and that the table is shared with you (organization or a group you belong to). <a href="#" id="lnkSettings">Open Settings</a>` : "The survey table may not be shared with your ArcGIS account. Please contact the site administrator."}</span>`, true);
    } finally { busy(false); }
  }

  function loadDemo() {
    const rows = (window.SAMPLE_SURVEY || []).map((r) => Object.assign({}, r));
    const fields = Object.keys(rows[0] || {}).map((k) => ({ name: k, alias: k, type: (k === "Submitted" || k === "Updated") ? "esriFieldTypeDate" : "esriFieldTypeString" }));
    S.source = "demo";
    $("demoBanner").hidden = false;
    showLoadMsg("");
    ingest(fields, rows);
  }

  function ingest(fields, rows) {
    S.fields = fields;
    S.fieldMap = matchFields(fields);
    S.rows = rows;
    S.loadedAt = new Date();
    const fm = S.fieldMap;
    const val = (r, k) => (fm[k] ? r[fm[k].name] : undefined);
    const toDate = (v) => (v == null || v === "" ? null : new Date(typeof v === "number" ? v : Date.parse(v)));

    // Incident list, newest first
    const inc = {};
    rows.forEach((r) => {
      const name = String(val(r, "incident") || "").trim() || "(No incident description)";
      const d = toDate(val(r, "submitted")) || toDate(val(r, "updated")) || new Date(0);
      if (!inc[name]) inc[name] = { name, count: 0, latest: d };
      inc[name].count++;
      if (d > inc[name].latest) inc[name].latest = d;
    });
    S.incidents = Object.values(inc).sort((a, b) => b.latest - a.latest);
    const remembered = store.get("deploy:incident:" + S.source);
    S.incident = S.incidents.some((i) => i.name === remembered) ? remembered : (S.incidents[0] ? S.incidents[0].name : "");
    S._val = val; S._toDate = toDate;
    buildIncidentSelect();
    selectIncident(S.incident);
  }

  function buildPeople() {
    const val = S._val, toDate = S._toDate;
    const rows = S.rows.filter((r) => S.incident === "*" ||
      (String(val(r, "incident") || "").trim() || "(No incident description)") === S.incident);
    const byKey = {};
    S.unmatchedPositions = {};
    S.unnamed = [];          // entries with no first or last name — left out of every count
    rows.forEach((r) => {
      const status = String(val(r, "status") || "");
      if (/draft|deleted|cancel/i.test(status)) return;
      let first = String(val(r, "first") || "").trim(), last = String(val(r, "last") || "").trim();
      if (!first && !last && val(r, "fullName")) {
        const parts = String(val(r, "fullName")).trim().split(/\s+/); first = parts.shift() || ""; last = parts.join(" ");
      }
      // No name listed (both name fields blank, or only punctuation) → not counted, like "not available"
      if (!norm(first) && !norm(last)) { S.unnamed.push({ region: classRegion(val(r, "region")) }); return; }
      const email = String(val(r, "email") || "").trim().toLowerCase();
      // Duplicates are matched on first + last name (ignoring case, spaces and punctuation).
      // Only if both names are blank do we fall back to email, then submitter ID.
      const nameKey = norm(first) + "|" + norm(last);
      const key = nameKey !== "|" ? "name:" + nameKey
                : email ? "email:" + email
                : String(val(r, "submitterId") || "") ? "sub:" + val(r, "submitterId")
                : "row:" + String(val(r, "submissionId") || Math.random());
      // "Most recent" = latest Submitted date (falls back to Updated if Submitted is blank)
      const when = toDate(val(r, "submitted")) || toDate(val(r, "updated")) || new Date(0);
      const subNum = Number(val(r, "submissionId")) || 0;
      const q = matchPositions(val(r, "qualified"));
      q.unmatched.forEach((u) => (S.unmatchedPositions[u] = (S.unmatchedPositions[u] || 0) + 1));
      const p = {
        id: key, first, last,
        name: [first, last].filter(Boolean).join(" ") || "(No name)",
        sortName: (last + " " + first).toLowerCase(),
        email, phone: val(r, "phone") || "", duration: val(r, "duration") || "",
        availRaw: val(r, "availability") || "", avail: "Blank",
        // No deployment-type question in this survey version → everyone is in-state only
        scopeRaw: val(r, "scope") || "", scope: S.fieldMap.scope ? classScope(val(r, "scope")) : "In-state",
        approvalRaw: val(r, "approval") || "", approval: classApproval(val(r, "approval")),
        dates: cleanNote(val(r, "partialDates")), restrictions: cleanNote(val(r, "restrictions")),
        qualifiedRaw: val(r, "qualified") || "", quals: q.found,
        preferred: val(r, "preferred") || "",
        traineeRaw: val(r, "trainee") || "", trainee: matchPositions(val(r, "trainee")).found,
        candidatesRaw: val(r, "candidates") || "", candidates: matchPositions(val(r, "candidates")).found,
        regionRaw: val(r, "region") || "", region: classRegion(val(r, "region")),
        when, subNum, submissionId: val(r, "submissionId") || ""
      };
      Object.assign(p, classifyAvailability(p.availRaw, p.restrictions, p.dates));
      // Preferred position: matches a qualified position, or (if not qualified) counts as a training position
      p.prefCodes = matchPositions(p.preferred).found;
      p.prefTrain = p.prefCodes.filter((c) => !p.quals.includes(c));
      // Keep the most recently submitted entry; same timestamp → higher submission ID wins
      const prev = byKey[key];
      const newer = !prev || when > prev.when || (+when === +prev.when && subNum >= prev.subNum);
      if (newer) { p.dupes = prev ? (prev.dupes || 0) + 1 : 0; byKey[key] = p; }
      else prev.dupes = (prev.dupes || 0) + 1;
    });
    S.people = Object.values(byKey).sort((a, b) => a.sortName.localeCompare(b.sortName));
    S.byId = Object.fromEntries(S.people.map((p) => [p.id, p]));
  }

  /* ================================================================== TEAMS (assignments) */
  const teamKey = () => "deploy:teams:" + S.source + ":" + S.incident;
  const newTeam = (n) => ({ name: "Team " + n, mission: "instate", location: "", slots: {}, trainees: {} });

  function loadTeams() {
    const saved = store.get(teamKey());
    S.teams = Array.isArray(saved) && saved.length ? saved : [newTeam(1)];
    S.teams.forEach((t) => {
      t.slots = t.slots || {}; t.trainees = t.trainees || {};
      Object.keys(t.slots).forEach((c) => { if (!S.byId[t.slots[c]] || !POS[c]) delete t.slots[c]; });
      // A trainee only stays if the position still has a qualified person selected
      Object.keys(t.trainees).forEach((c) => { if (!S.byId[t.trainees[c]] || !POS[c] || !t.slots[c]) delete t.trainees[c]; });
    });
    S.activeTeam = Math.min(S.activeTeam, S.teams.length - 1);
  }
  const saveTeams = () => store.set(teamKey(), S.teams);

  function assignments() {
    const a = {};
    S.teams.forEach((t, ti) => {
      Object.entries(t.slots).forEach(([code, pid]) => { if (pid) a[pid] = { team: ti, code, role: "primary" }; });
      Object.entries(t.trainees || {}).forEach(([code, pid]) => { if (pid) a[pid] = { team: ti, code, role: "trainee" }; });
    });
    return a;
  }

  /* ================================================================== COUNTS */
  function remainingPool() {
    const asg = assignments();
    return S.people.filter((p) => p.avail !== "Unavailable" && !asg[p.id] && S.regions.has(p.region));
  }

  function gapRows() {
    const pool = remainingPool();
    const asg = assignments();
    return POSITIONS.map((pos) => {
      const r = { pos, in: { Full: 0, Partial: 0, Blank: 0 }, em: { Full: 0, Partial: 0, Blank: 0 }, filled: 0 };
      r.inTr = 0; r.emTr = 0;
      pool.forEach((p) => {
        if (p.quals.includes(pos.code)) (p.scope === "EMAC" ? r.em : r.in)[p.avail]++;
        // Trainee = open task book OR trained in this position, and not already qualified in it.
        // Listed in both fields still counts once.
        else if (isTraineeFor(p, pos.code)) p.scope === "EMAC" ? r.emTr++ : r.inTr++;
      });
      r.inT = r.in.Full + r.in.Partial + r.in.Blank;
      r.emT = r.em.Full + r.em.Partial + r.em.Blank;
      r.all = r.inT + r.emT;
      r.filled = Object.values(asg).filter((x) => x.code === pos.code && x.role === "primary").length;
      r.trFilled = Object.values(asg).filter((x) => x.code === pos.code && x.role === "trainee").length;
      return r;
    });
  }

  /* ================================================================== UI WIRING */
  let wired = false;
  function wireUi() {
    if (wired) return; wired = true;
    document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
    $("selIncident").onchange = (e) => selectIncident(e.target.value);
    $("selMission").onchange = (e) => { S.mission = e.target.value; renderCharts(); };
    $("selAvail").onchange = (e) => { S.avail = e.target.value; renderCharts(); };
    $("btnRefresh").onclick = () => (S.source === "demo" ? loadDemo() : S.source ? loadLayer(S.source) : CONFIG.LAYER_URL ? loadLayer(CONFIG.LAYER_URL) : openSettings());
    $("btnSettings").onclick = openSettings;
    $("btnSaveLayer").onclick = (e) => { e.preventDefault(); const u = $("inpLayerUrl").value; $("dlgSettings").close(); if (u) loadLayer(u); };
    $("btnDemo").onclick = (e) => { e.preventDefault(); $("dlgSettings").close(); loadDemo(); };
    $("drClose").onclick = closeDrawer; $("drawerBack").onclick = closeDrawer;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
    $("btnAddTeam").onclick = () => { S.teams.push(newTeam(S.teams.length + 1)); S.activeTeam = S.teams.length - 1; saveTeams(); renderOrg(); };
    $("inpTeamName").oninput = (e) => { S.teams[S.activeTeam].name = e.target.value || ("Team " + (S.activeTeam + 1)); saveTeams(); renderTeamTabs(); };
    $("inpTeamLocation").oninput = (e) => { S.teams[S.activeTeam].location = e.target.value; saveTeams(); renderTeamTabs(); };
    $("selTeamMission").onchange = (e) => { S.teams[S.activeTeam].mission = e.target.value; saveTeams(); renderOrg(); };
    $("chkShowAll").onchange = (e) => { S.showAll = e.target.checked; renderOrg(); };
    $("btnClearTeam").onclick = () => {
      const t = S.teams[S.activeTeam];
      if (!Object.keys(t.slots).length || confirmAction(`Clear every selection on ${t.name}? Those people go back into the available counts.`)) { t.slots = {}; t.trainees = {}; saveTeams(); renderAll(); }
    };
    $("btnRemoveTeam").onclick = () => {
      const t = S.teams[S.activeTeam];
      if (S.teams.length === 1) { t.slots = {}; t.trainees = {}; t.name = "Team 1"; saveTeams(); renderAll(); return; }
      if (!Object.keys(t.slots).length || confirmAction(`Remove ${t.name}? Its people go back into the available counts.`)) {
        S.teams.splice(S.activeTeam, 1); S.activeTeam = Math.max(0, S.activeTeam - 1); saveTeams(); renderAll();
      }
    };
    $("btnOrgPng").onclick = () => downloadSvgPng(orgSvg(S.activeTeam), fileBase() + "_" + slug(S.teams[S.activeTeam].name) + "_org_chart.png", false);
    $("btnRoster").onclick = downloadRoster;
    $("btnTablePng").onclick = () => downloadSvgPng(tableSvg(), fileBase() + "_position_summary.png");
    document.querySelectorAll("[data-png]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.png;
      downloadSvgPng(k === "A" ? chartASvg(true) : chartBSvg(true), fileBase() + (k === "A" ? "_by_position.png" : "_by_affiliation.png"));
    }));
    $("btnPdf").onclick = downloadBriefingPdf;
    wireTooltips();
    renderRegionChips();
  }
  // confirm() is a blocking browser dialog; keep it only for destructive actions
  const confirmAction = (m) => window.confirm(m);

  function showTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    ["summary", "charts", "org"].forEach((n) => ($("panel-" + n).hidden = n !== name));
    if (name === "charts") renderCharts();
    if (name === "org") renderOrg();
  }

  function buildIncidentSelect() {
    const sel = $("selIncident");
    sel.innerHTML = S.incidents.map((i) => `<option value="${esc(i.name)}">${esc(i.name)} (${i.count})</option>`).join("") +
      (S.incidents.length > 1 ? `<option value="*">All incidents combined</option>` : "");
    sel.value = S.incident;
  }

  function selectIncident(name) {
    S.incident = name;
    store.set("deploy:incident:" + S.source, name);
    buildPeople();
    loadTeams();
    renderAll();
  }

  function renderRegionChips() {
    $("regionChips").innerHTML = REGIONS.map((r) =>
      `<button class="chip ${S.regions.has(r) ? "on" : ""}" data-r="${r}" aria-pressed="${S.regions.has(r)}"><span class="sw" style="background:${REGION_COLOR[r]}"></span>${r === "Unspecified" ? "Not stated" : r}</button>`).join("");
    $("regionChips").querySelectorAll(".chip").forEach((c) => (c.onclick = () => {
      const r = c.dataset.r;
      if (S.regions.has(r)) { if (S.regions.size > 1) S.regions.delete(r); } else S.regions.add(r);
      renderRegionChips(); renderAll();
    }));
  }

  function renderAll() {
    if (!S.rows) return;
    const t = S.loadedAt;
    $("dataStamp").innerHTML = t ? `${S.people.length} people · ${S.source === "demo" ? "demo data" : "loaded"} ${t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
    renderKpis();
    renderGap();
    if (!$("panel-charts").hidden) renderCharts();
    if (!$("panel-org").hidden) renderOrg();
    if (!$("drawer").hidden && openCode) openDrawer(openCode);
  }

  /* ================================================================== KPIs */
  function renderKpis() {
    const inRegion = S.people.filter((p) => S.regions.has(p.region));
    const unnamed = (S.unnamed || []).filter((u) => S.regions.has(u.region)).length;
    const available = inRegion.filter((p) => p.avail !== "Unavailable");
    const asg = assignments();
    const assigned = available.filter((p) => asg[p.id]).length;
    const remaining = available.length - assigned;
    const rows = gapRows();
    const gaps = rows.filter((r) => r.all === 0);
    const pending = available.filter((p) => p.approval !== "Yes" && !asg[p.id]).length;
    const restr = available.filter((p) => p.hasRestr && !asg[p.id]).length;
    const regionNote = S.regions.size < REGIONS.length ? "selected affiliations" : "all affiliations";
    const k = (label, val, cmp, cls = "") => `<div class="kpi ${cls}"><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-cmp">${cmp}</div></div>`;
    $("kpis").innerHTML = [
      k("Responses", inRegion.length, unnamed ? `${regionNote} · ${unnamed} without a name not counted` : regionNote),
      k("Available", available.length, `${inRegion.length - available.length} not available`),
      k("Placed on teams", assigned, `${S.teams.length} team${S.teams.length > 1 ? "s" : ""}`),
      k("Still available", remaining, "unique people"),
      k("Positions with no one left", `${gaps.length}<span style="font-size:15px;color:var(--ink-3);font-weight:600"> / ${POSITIONS.length}</span>`,
        gaps.length ? esc(gaps.slice(0, 4).map((g) => g.pos.label).join(", ") + (gaps.length > 4 ? "…" : "")) : "every position has coverage", gaps.length ? "alert" : ""),
      k("Need follow-up", pending, `agency approval not confirmed${restr ? ` · ${restr} with restrictions` : ""}`)
    ].join("");
  }

  /* ================================================================== GAP TABLE */
  function renderGap() {
    const rows = gapRows();
    const cell = (v, total) => `<td class="num ${total ? "tot " : ""}${v > 0 ? "pos-g" : total ? "zero-t" : "muted"}">${v}</td>`;
    const tot = (f) => rows.reduce((a, r) => a + f(r), 0);
    const trn = (v) => `<td class="num trn ${v > 0 ? "trn-on" : "muted"}">${v}</td>`;
    $("tblGap").innerHTML = `
      <thead>
        <tr><th class="grp-pos" rowspan="2">Code</th><th class="grp-pos" rowspan="2">Position — select to view personnel</th>
            <th class="grp-in" colspan="5">In-state only</th><th class="grp-em" colspan="5">EMAC / in-state</th>
            <th class="grp-all" rowspan="2">All<br>available</th><th class="grp-all" rowspan="2">Placed on<br>teams</th></tr>
        <tr><th class="grp-in">Full</th><th class="grp-in">Partial /<br>Restrictions</th><th class="grp-in">Not<br>stated</th><th class="grp-in">Deployable<br>total</th><th class="grp-in trn-h">Trainees</th>
            <th class="grp-em">Full</th><th class="grp-em">Partial /<br>Restrictions</th><th class="grp-em">Not<br>stated</th><th class="grp-em">Deployable<br>total</th><th class="grp-em trn-h">Trainees</th></tr>
      </thead>
      <tbody>${rows.map((r) => `
        <tr data-code="${r.pos.code}" tabindex="0">
          <td class="code">${esc(r.pos.label)}</td>
          <td class="pos"><a href="#" onclick="return false" title="View personnel">${esc(r.pos.title)} ›</a></td>
          ${cell(r.in.Full)}${cell(r.in.Partial)}${cell(r.in.Blank)}${cell(r.inT, true)}${trn(r.inTr)}
          ${cell(r.em.Full)}${cell(r.em.Partial)}${cell(r.em.Blank)}${cell(r.emT, true)}${trn(r.emTr)}
          ${cell(r.all, true)}
          <td class="num">${r.filled ? `<span class="badge-a">${r.filled}</span>` : `<span class="muted">–</span>`}${r.trFilled ? `<span class="badge-t" title="Trainees placed">+${r.trFilled} T</span>` : ""}</td>
        </tr>`).join("")}
      </tbody>
      <tfoot><tr><td></td><td>Total (a person is counted once for each position they're qualified in)</td>
        <td class="num">${tot((r) => r.in.Full)}</td><td class="num">${tot((r) => r.in.Partial)}</td><td class="num">${tot((r) => r.in.Blank)}</td><td class="num tot">${tot((r) => r.inT)}</td><td class="num trn">${tot((r) => r.inTr)}</td>
        <td class="num">${tot((r) => r.em.Full)}</td><td class="num">${tot((r) => r.em.Partial)}</td><td class="num">${tot((r) => r.em.Blank)}</td><td class="num tot">${tot((r) => r.emT)}</td><td class="num trn">${tot((r) => r.emTr)}</td>
        <td class="num tot">${tot((r) => r.all)}</td><td class="num">${tot((r) => r.filled)}</td></tr></tfoot>`;
    $("tblGap").querySelectorAll("tbody tr").forEach((tr) => {
      tr.onclick = () => openDrawer(tr.dataset.code);
      tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(tr.dataset.code); } };
    });
    const noQual = S.people.filter((p) => p.avail !== "Unavailable" && !p.quals.length && S.regions.has(p.region)).length;
    const unm = Object.keys(S.unmatchedPositions);
    $("gapNote").innerHTML = [
      `“Not stated” = the availability question was left blank. People who answered that they're not available, and entries with no name, are left out. A blank in-state/EMAC answer is counted as in-state only.${S.fieldMap.scope ? "" : " <b>This survey version has no deployment-type (in-state/EMAC) question, so everyone is counted as in-state only.</b>"} “Trainees” = people who aren't qualified in the position but have an open task book, are trained in it, or listed it as their preferred position; they're not included in the deployable totals.`,
      (S.unnamed || []).length ? `${S.unnamed.length} ${S.unnamed.length === 1 ? "entry has" : "entries have"} no name listed and ${S.unnamed.length === 1 ? "is" : "are"} left out of all counts.` : "",
      noQual ? `${noQual} available ${noQual === 1 ? "person has" : "people have"} no qualified position listed; they appear only under “List all available personnel” on the org chart.` : "",
      unm.length ? `Qualified positions not on this org chart: ${esc(unm.slice(0, 6).join("; "))}${unm.length > 6 ? "…" : ""}.` : ""
    ].filter(Boolean).join(" ");
  }

  /* ================================================================== DRAWER (personnel for a position) */
  let openCode = null;
  // Preferred position vs. qualified position, for the personnel cards
  function prefSummary(p) {
    if (!String(p.preferred || "").trim()) return { html: "", tags: [] };
    if (!p.prefCodes.length) return { html: `${esc(p.preferred)} <span class="pref-note">(not one of the org chart positions)</span>`, tags: [] };
    const parts = p.prefCodes.map((c) => p.quals.includes(c)
      ? `<span class="pref-chip match">${esc(POS[c].label)} ✓ matches qualified position</span>`
      : `<span class="pref-chip train">${esc(POS[c].label)} · not qualified — counted as training</span>`);
    const tags = p.prefCodes.map((c) => p.quals.includes(c)
      ? `<span class="tag pref-match">Preferred ${esc(POS[c].label)} ✓ qualified</span>`
      : `<span class="tag pref-train">Preferred ${esc(POS[c].label)} · training</span>`);
    return { html: parts.join(" "), tags };
  }
  function personCard(p, asg, role) {
    const a = asg[p.id];
    const pref = prefSummary(p);
    const tags = [
      `<span class="tag">${esc(p.region === "Unspecified" ? "Affiliation not stated" : p.region)}</span>`,
      p.avail === "Full" ? `<span class="tag full">Full availability</span>` : "",
      p.isPartial ? `<span class="tag partial">Partial availability</span>` : "",
      p.hasRestr ? `<span class="tag partial">Restrictions</span>` : "",
      p.avail === "Blank" ? `<span class="tag">Availability not stated</span>` : "",
      p.scope === "EMAC" ? `<span class="tag emac">In-state & EMAC</span>` : `<span class="tag">In-state only</span>`,
      p.approval !== "Yes" ? `<span class="tag warn">Agency approval: ${esc(p.approvalRaw || "not answered")}</span>` : "",
      ...pref.tags,
      p.dupes ? `<span class="tag">Latest of ${p.dupes + 1} submissions</span>` : "",
      a ? `<span class="tag asg">On ${esc(S.teams[a.team].name)} · ${esc(POS[a.code].label)}${a.role === "trainee" ? " trainee" : ""}</span>` : ""
    ].join("");
    const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
    const rowHtml = (k, html) => (html ? `<dt>${k}</dt><dd>${html}</dd>` : "");
    return `<div class="pcard ${a ? "assigned" : ""}">
      <div class="p-top"><span class="p-name">${esc(p.name)}</span><span class="sub">${esc(role)}</span></div>
      <div class="p-tags">${tags}</div>
      <dl>
        ${row("Availability answer", p.availRaw)}
        ${row("Restrictions", p.restrictions)}
        ${row("Dates available", p.dates)}
        ${row("Response length", p.duration)}
        ${row("Submitted", p.when && +p.when ? p.when.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "")}
        ${row("Qualified", p.qualifiedRaw)}
        ${rowHtml("Preferred position", pref.html)}
        ${row("Trainee task book", p.traineeRaw)}
        ${row("Trained in", p.candidatesRaw)}
        ${row("Phone", p.phone)}
        ${row("Email", p.email)}
      </dl></div>`;
  }

  function openDrawer(code) {
    openCode = code;
    const pos = POS[code];
    const asg = assignments();
    const base = S.people.filter((p) => p.avail !== "Unavailable" && S.regions.has(p.region));
    const order = (a, b) => (!!asg[a.id] - !!asg[b.id]) || (["Full", "Partial", "Blank"].indexOf(a.avail) - ["Full", "Partial", "Blank"].indexOf(b.avail)) || a.sortName.localeCompare(b.sortName);
    const q = base.filter((p) => p.quals.includes(code)).sort(order);
    const tr = base.filter((p) => !p.quals.includes(code) && p.trainee.includes(code)).sort(order);
    const ca = base.filter((p) => !p.quals.includes(code) && !p.trainee.includes(code) && p.candidates.includes(code)).sort(order);
    const pf = base.filter((p) => !p.quals.includes(code) && !p.trainee.includes(code) && !p.candidates.includes(code) && p.prefTrain.includes(code)).sort(order);
    const sec = (title, list, role) => `<h3 class="dr-sec">${title} (${list.filter((p) => !asg[p.id]).length} available${list.some((p) => asg[p.id]) ? `, ${list.filter((p) => asg[p.id]).length} placed` : ""})</h3>` +
      (list.length ? list.map((p) => personCard(p, asg, typeof role === "function" ? role(p) : role)).join("") : `<p class="empty">No one in this group.</p>`);
    $("drCode").textContent = pos.label + (S.regions.size < REGIONS.length ? " · " + [...S.regions].join(", ") : "");
    $("drTitle").textContent = pos.title;
    $("drBody").innerHTML = sec("Qualified", q, (p) => (prefersPos(p, code) ? "★ Qualified · preferred position" : "Qualified")) +
      sec("Trainees with an open task book", tr, "Trainee") + sec("Trained in this position", ca, "Candidate") +
      sec("Preferred position — not yet qualified (training)", pf, "Training · preferred position");
    $("drawer").hidden = false; $("drawerBack").hidden = false;
  }
  function closeDrawer() { $("drawer").hidden = true; $("drawerBack").hidden = true; openCode = null; }

  /* ================================================================== SVG HELPERS */
  const FONT = "Segoe UI, Inter, Arial, sans-serif";
  const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${o.size || 12}" fill="${o.fill || "#52514e"}"${o.weight ? ` font-weight="${o.weight}"` : ""}${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.deco ? ` text-decoration="${o.deco}"` : ""}>${esc(s)}</text>`;
  const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
  function niceMax(v) { if (v <= 4) return Math.max(v, 1); const step = Math.pow(10, Math.floor(Math.log10(v))); const m = Math.ceil(v / step * 2) / 2 * step; return Math.ceil(m); }
  function ticks(max) { const n = max <= 5 ? max : 5; const step = Math.max(1, Math.ceil(max / n)); const out = []; for (let v = 0; v <= max; v += step) out.push(v); if (out[out.length - 1] < max) out.push(out[out.length - 1] + step); return out; }
  // Bar with 4px rounded data end, square at the baseline
  function barPath(x, y, w, h, rTop) {
    const r = Math.min(rTop, w / 2, h);
    if (h <= 0) return "";
    if (!r) return `M${x},${y}h${w}v${h}h${-w}z`;
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function hbarPath(x, y, w, h, rEnd) {
    const r = Math.min(rEnd, h / 2, w);
    if (w <= 0) return "";
    if (!r) return `M${x},${y}h${w}v${h}h${-w}z`;
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  function legend(items, x, y) {
    let cx = x, out = "";
    items.forEach(([label, color]) => {
      out += `<rect x="${cx}" y="${y - 9}" width="10" height="10" rx="2" fill="${color}"/>` + T(cx + 15, y, label, { size: 12, fill: "#52514e" });
      cx += 15 + label.length * 6.6 + 18;
    });
    return out;
  }
  // In the PDF the page header (top right) already carries the description, so the blue bar shows the title only
  let PDF_MODE = false;
  // TEMA brand colors (from the TEMA color logo) used on PDF pages
  const BRAND = { navy: "#002d72", red: "#d22730", gray: "#76777a" };
  const HB = () => (PDF_MODE ? 44 : 64);          // blue header bar height
  const DH = () => 64 - HB();                     // how much shorter than the PNG version
  function exportHeader(title, sub, W) {
    if (PDF_MODE) return `<rect width="${W}" height="${HB()}" fill="${BRAND.navy}"/><rect width="8" height="${HB()}" fill="${BRAND.red}"/>` + T(24, 28, title, { size: 18, fill: "#fff", weight: 650 });
    return `<rect width="${W}" height="64" fill="${BRAND.navy}"/><rect width="8" height="64" fill="${BRAND.red}"/>` +
      T(24, 30, title, { size: 18, fill: "#fff", weight: 650 }) + T(24, 50, sub, { size: 12, fill: "#c9d3e6" });
  }
  const filterSummary = () => {
    const parts = [];
    parts.push({ all: "All available (in-state or EMAC)", instate: "In-state only responders", emac: "EMAC-willing" }[S.mission]);
    if (S.avail !== "all") parts.push(S.avail === "Full" ? "Full availability only" : "Partial availability / restrictions only");
    parts.push(S.regions.size < REGIONS.length ? "Affiliation: " + [...S.regions].map((r) => (r === "Unspecified" ? "Not stated" : r)).join(", ") : "All affiliations");
    return parts.join(" · ");
  };
  const incidentLabel = () => (S.incident === "*" ? "All incidents" : S.incident);
  const stampText = () => new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  /* ================================================================== CHARTS */
  function chartPool() {
    return remainingPool().filter((p) =>
      (S.mission === "all" || (S.mission === "emac" ? p.scope === "EMAC" : p.scope === "In-state")) &&
      (S.avail === "all" || p.avail === S.avail));
  }

  function chartASvg(forExport) {
    const pool = chartPool();
    const regions = REGIONS.filter((r) => S.regions.has(r));
    const data = POSITIONS.map((pos) => {
      const by = {}; regions.forEach((r) => (by[r] = 0));
      pool.forEach((p) => { if (p.quals.includes(pos.code) && by[p.region] != null) by[p.region]++; });
      return { pos, by, total: regions.reduce((a, r) => a + by[r], 0) };
    });
    const W = 1100, top = forExport ? 110 - DH() : 34, H = top + 300, L = 44, R = 16, B = 46;
    const plotH = H - top - B, plotW = W - L - R;
    const max = niceMax(Math.max(1, ...data.map((d) => d.total)));
    const tk = ticks(max); const ymax = tk[tk.length - 1];
    const y = (v) => top + plotH - (v / ymax) * plotH;
    const band = plotW / data.length, bw = Math.min(46, band * 0.62);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fcfcfb"/>`;
    if (forExport) s += exportHeader("Qualified personnel available by position", `${incidentLabel()} · ${filterSummary()} · ${stampText()}`, W);
    s += legend(regions.map((r) => [r === "Unspecified" ? "Not stated" : r, REGION_COLOR[r]]), L, top - 14);
    tk.forEach((v) => { s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? "#ecebe6" : "#b9b7b0"}" stroke-width="1"/>` + T(L - 8, y(v) + 4, v, { size: 11, anchor: "end", fill: "#8a8984" }); });
    data.forEach((d, i) => {
      const x = L + band * i + (band - bw) / 2;
      let acc = 0;
      const segs = regions.filter((r) => d.by[r] > 0);
      segs.forEach((r, k) => {
        const v = d.by[r], y0 = y(acc + v), h = y(acc) - y(acc + v);
        const isTop = k === segs.length - 1;
        // 2px surface gap between stacked segments
        const gap = k > 0 ? 2 : 0;
        s += `<path class="seg" d="${barPath(x, y0, bw, Math.max(0, h - gap), isTop ? 4 : 0)}" fill="${REGION_COLOR[r]}" data-tip="${esc(`${d.pos.label} – ${d.pos.title}\n${r === "Unspecified" ? "Affiliation not stated" : r}: ${v}\nTotal: ${d.total}`)}"/>`;
        acc += v;
      });
      s += d.total ? T(x + bw / 2, y(d.total) - 6, d.total, { size: 12, anchor: "middle", fill: "#0b0b0b", weight: 650 })
                   : T(x + bw / 2, y(0) - 6, "0", { size: 12, anchor: "middle", fill: "#a12a2a", weight: 700 });
      s += T(x + bw / 2, H - B + 18, d.pos.label, { size: 11.5, anchor: "middle", fill: d.total ? "#52514e" : "#a12a2a", weight: d.total ? 400 : 700 });
    });
    s += T(L, H - 8, "Count of qualified people not yet placed on a team. A person qualified in two positions is counted in both. Red 0 = no one available.", { size: 11, fill: "#8a8984" });
    return s + "</svg>";
  }

  function chartBSvg(forExport) {
    const pool = chartPool();
    const regions = REGIONS.filter((r) => S.regions.has(r));
    const levels = ["Full", "Partial", "Blank"].filter((a) => S.avail === "all" || a === S.avail);
    const data = regions.map((r) => {
      const by = {}; levels.forEach((a) => (by[a] = pool.filter((p) => p.region === r && p.avail === a).length));
      const ql = pool.filter((p) => p.region === r && p.quals.length).length;
      return { r, by, total: levels.reduce((a, l) => a + by[l], 0), ql };
    });
    const W = 1100, top = forExport ? 110 - DH() : 34, rowH = 44, L = 110, R = 150, B = 34;
    const H = top + data.length * rowH + B;
    const plotW = W - L - R;
    const max = niceMax(Math.max(1, ...data.map((d) => d.total)));
    const tk = ticks(max); const xmax = tk[tk.length - 1];
    const x = (v) => L + (v / xmax) * plotW;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fcfcfb"/>`;
    if (forExport) s += exportHeader("Available personnel by team affiliation", `${incidentLabel()} · ${filterSummary()} · ${stampText()}`, W);
    const LEG = { Full: "Full availability", Partial: "Partial availability / restrictions", Blank: "Availability not stated" };
    s += legend(levels.map((a) => [LEG[a], AVAIL_COLOR[a]]), L, top - 14);
    const plotBottom = top + data.length * rowH;
    tk.forEach((v) => { s += `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${plotBottom}" stroke="${v ? "#ecebe6" : "#b9b7b0"}"/>` + T(x(v), plotBottom + 16, v, { size: 11, anchor: "middle", fill: "#8a8984" }); });
    data.forEach((d, i) => {
      const yy = top + i * rowH + 10, h = rowH - 20;
      s += T(L - 12, yy + h / 2 + 4, d.r === "Unspecified" ? "Not stated" : d.r, { size: 13, anchor: "end", fill: "#0b0b0b", weight: 600 });
      let acc = 0;
      const segs = levels.filter((a) => d.by[a] > 0);
      segs.forEach((a, k) => {
        const v = d.by[a], x0 = x(acc) + (k > 0 ? 2 : 0), w = x(acc + v) - x(acc) - (k > 0 ? 2 : 0);
        s += `<path class="seg" d="${hbarPath(x0, yy, Math.max(0, w), h, k === segs.length - 1 ? 4 : 0)}" fill="${AVAIL_COLOR[a]}" data-tip="${esc(`${d.r === "Unspecified" ? "Affiliation not stated" : d.r}\n${LEG[a]}: ${v}\nTotal: ${d.total}`)}"/>`;
        acc += v;
      });
      s += T(x(d.total) + 8, yy + h / 2 + 4, `${d.total} people`, { size: 12, fill: "#0b0b0b", weight: 650 }) +
           T(x(d.total) + 8 + (String(d.total).length + 7) * 7, yy + h / 2 + 4, `· ${d.ql} qualified`, { size: 11.5, fill: "#8a8984" });
    });
    s += T(L, H - 6, "Unique people not yet placed on a team. “Qualified” = listed at least one qualified position.", { size: 11, fill: "#8a8984" });
    return s + "</svg>";
  }

  function renderCharts() {
    if (!S.people) return;
    $("chartA").innerHTML = chartASvg(false);
    $("chartB").innerHTML = chartBSvg(false);
    $("chA_sub").textContent = filterSummary();
    $("chB_sub").textContent = filterSummary();
  }

  function wireTooltips() {
    const tip = $("tip");
    document.addEventListener("mousemove", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t) { tip.hidden = true; return; }
      tip.textContent = t.getAttribute("data-tip");
      tip.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + "px"; tip.style.top = (e.clientY + 14) + "px";
    });
  }

  /* ================================================================== ORG CHART */
  const BW = 240, BH = 158;
  const COLS = [130, 402, 674, 946];
  // Row tops: IC, command staff, sections, unit row 1, unit row 2
  const R0 = 10, R1 = R0 + BH + 36, BUS_Y = R1 + BH + 24, R2 = BUS_Y + 24, R3 = R2 + BH + 30, R4 = R3 + BH + 30;
  const ORG_W = 1075, ORG_H = R4 + BH + 10;
  const LAYOUT = {
    ICT:  { cx: 538,     y: R0 },
    LOFR: { cx: COLS[0], y: R1 }, PIO: { cx: COLS[1], y: R1 }, SOF: { cx: COLS[2], y: R1 },
    OPS:  { cx: COLS[0], y: R2 }, PSC: { cx: COLS[1], y: R2 }, LSC: { cx: COLS[2], y: R2 }, FSC: { cx: COLS[3], y: R2 },
    DOSC: { cx: COLS[0], y: R3 }, SITL: { cx: COLS[1], y: R3 }, COML: { cx: COLS[2], y: R3 }, DOCL: { cx: COLS[3], y: R3 },
    STAM: { cx: COLS[0], y: R4 }, RESL: { cx: COLS[1], y: R4 }, ITSL: { cx: COLS[2], y: R4 }
  };
  const box = (c) => ({ x: LAYOUT[c].cx - BW / 2, y: LAYOUT[c].y, w: BW, h: BH, cx: LAYOUT[c].cx });

  function linksSvgInner(stroke = "#1d1d1b") {
    const ic = box("ICT"), pio = box("PIO"), lofr = box("LOFR"), sof = box("SOF");
    const busY = BUS_Y;
    const L = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.5"/>`;
    let s = "";
    const midC = pio.y + BH / 2;
    s += L(ic.cx, ic.y + BH, ic.cx, busY);                       // trunk
    s += L(pio.x + BW, midC, sof.x, midC);                         // command staff line (PIO – trunk – SOFR)
    s += L(lofr.x + BW, midC, pio.x, midC);                        // LOFR
    s += L(COLS[0], busY, COLS[3], busY);                          // section bus
    ["OPS", "PSC", "LSC", "FSC"].forEach((c) => (s += L(LAYOUT[c].cx, busY, LAYOUT[c].cx, LAYOUT[c].y)));
    [["OPS", "DOSC"], ["DOSC", "STAM"], ["PSC", "SITL"], ["SITL", "RESL"], ["LSC", "COML"], ["COML", "ITSL"], ["FSC", "DOCL"]].forEach(([a, b]) =>
      (s += L(LAYOUT[a].cx, LAYOUT[a].y + BH, LAYOUT[b].cx, LAYOUT[b].y)));
    return s;
  }

  const availOrder = (a, b) => (["Full", "Partial", "Blank"].indexOf(a.avail) - ["Full", "Partial", "Blank"].indexOf(b.avail)) || a.sortName.localeCompare(b.sortName);

  // Main pick: qualified personnel (plus everyone else available when "List all" is ticked)
  function teamCandidates(code, team) {
    const asg = assignments();
    const current = team.slots[code];
    const ok = (p) => p.avail !== "Unavailable" && (!asg[p.id] || p.id === current) &&
                      (team.mission !== "emac" || p.scope === "EMAC");
    const qPref = S.people.filter((p) => ok(p) && p.quals.includes(code) && prefersPos(p, code)).sort(availOrder);
    const qOther = S.people.filter((p) => ok(p) && p.quals.includes(code) && !prefersPos(p, code)).sort(availOrder);
    const q = [...qPref, ...qOther];
    const used = new Set(q.map((p) => p.id));
    const rest = S.showAll ? S.people.filter((p) => ok(p) && !used.has(p.id)).sort(availOrder) : [];
    // Keep the current pick visible even if the person no longer matches (e.g. "show all" turned off)
    if (current && S.byId[current] && !used.has(current) && !rest.some((p) => p.id === current)) rest.unshift(S.byId[current]);
    return { q, qPref, qOther, rest };
  }

  // Trainee pick: open task book and/or trained in this position, not already qualified in it
  function traineeCandidates(code, team) {
    const asg = assignments();
    const current = (team.trainees || {})[code];
    const ok = (p) => p.avail !== "Unavailable" && (!asg[p.id] || p.id === current) &&
                      (team.mission !== "emac" || p.scope === "EMAC") && !p.quals.includes(code);
    const both = S.people.filter((p) => ok(p) && p.trainee.includes(code) && p.candidates.includes(code)).sort(availOrder);
    const tb = S.people.filter((p) => ok(p) && p.trainee.includes(code) && !p.candidates.includes(code)).sort(availOrder);
    const ca = S.people.filter((p) => ok(p) && !p.trainee.includes(code) && p.candidates.includes(code)).sort(availOrder);
    const pf = S.people.filter((p) => ok(p) && !p.trainee.includes(code) && !p.candidates.includes(code) && p.prefTrain.includes(code)).sort(availOrder);
    const list = [...both, ...tb, ...ca, ...pf];
    const inList = !!current && list.some((p) => p.id === current);
    return { both, tb, ca, pf, total: list.filter((p) => p.id !== current).length, keep: current && !inList && S.byId[current] ? S.byId[current] : null };
  }
  const traineeKind = (p, code) => {
    const k = p.trainee.includes(code) && p.candidates.includes(code) ? "task book + trained" : p.trainee.includes(code) ? "task book" : p.candidates.includes(code) ? "trained in" : "";
    return [k, prefersPos(p, code) ? "preferred position" : ""].filter(Boolean).join(", ");
  };

  const optLabel = (p) => {
    const flags = p.approval !== "Yes" ? " ⚠ approval" : "";
    return `${p.last || p.name}${p.last ? ", " + p.first : ""} — ${p.region === "Unspecified" ? "?" : p.region} · ${availText(p)}${p.scope === "EMAC" ? " · EMAC" : ""}${flags}`;
  };
  // Full / Partial / Restrictions — both shown when both apply
  function availText(p, withDates) {
    if (p.avail !== "Partial") return AVAIL_SHORT[p.avail];
    const parts = [];
    if (p.isPartial) parts.push("Partial" + (withDates && p.dates ? ": " + p.dates : ""));
    if (p.hasRestr) parts.push("Restrictions");
    return parts.join(" + ");
  }
  const footText = (p) => [p.region === "Unspecified" ? "Affiliation n/s" : p.region, availText(p, true), p.scope === "EMAC" ? "EMAC" : ""].filter(Boolean).join(" · ");

  const prefFoot = (p, code) => prefersPos(p, code) ? "preferred position"
    : p.prefCodes.length ? "prefers " + p.prefCodes.map((c) => POS[c].label).join(", ") : "no preference stated";

  function renderTeamTabs() {
    $("teamTabs").innerHTML = S.teams.map((t, i) =>
      `<button class="team-tab ${i === S.activeTeam ? "active" : ""}" data-i="${i}" title="${esc(t.location ? "Location: " + t.location : "No deployment location set")}">${esc(t.name)}<span class="cnt">${Object.keys(t.slots).length}/${POSITIONS.length}</span></button>`).join("");
    $("teamTabs").querySelectorAll(".team-tab").forEach((b) => (b.onclick = () => { S.activeTeam = +b.dataset.i; renderOrg(); }));
  }

  function renderOrg() {
    if (!S.teams.length) return;
    const team = S.teams[S.activeTeam];
    renderTeamTabs();
    $("inpTeamName").value = team.name;
    $("selTeamMission").value = team.mission || "instate";
    $("inpTeamLocation").value = team.location || "";
    $("chkShowAll").checked = S.showAll;
    const org = $("org");
    org.style.width = ORG_W + "px"; org.style.height = ORG_H + "px";
    let html = `<svg class="links" viewBox="0 0 ${ORG_W} ${ORG_H}" width="${ORG_W}" height="${ORG_H}">${linksSvgInner()}</svg>`;
    POSITIONS.forEach((pos) => {
      const b = box(pos.code);
      const c = teamCandidates(pos.code, team);
      const cur = team.slots[pos.code];
      const p = cur && S.byId[cur];
      const og = (label, list, sel) => (list.length ? `<optgroup label="${esc(label)}">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${prefersPos(x, pos.code) ? "★ " : ""}${esc(optLabel(x))}</option>`).join("")}</optgroup>` : "");
      const nAvail = c.q.filter((x) => x.id !== cur).length;
      // Trainee select — only once a qualified person is chosen
      const curT = (team.trainees || {})[pos.code];
      const t = traineeCandidates(pos.code, team);
      const traineeSel = p
        ? `<select class="trainee-sel ${curT ? "has" : ""}" data-trainee="${pos.code}" aria-label="Trainee for ${esc(pos.title)}">
             <option value="">${curT ? "— Remove trainee —" : t.total > 0 ? `+ Add trainee (${t.total} available)…` : "No trainees available"}</option>
             ${t.keep ? og("Current trainee", [t.keep], curT) : ""}${og("Task book + trained in", t.both, curT)}${og("Open task book", t.tb, curT)}${og("Trained in position", t.ca, curT)}${og("Preferred position (not yet qualified)", t.pf, curT)}
           </select>`
        : `<div class="trainee-ph">Trainee: pick qualified first</div>`;
      const prefCls = p ? (prefersPos(p, pos.code) ? "pref-match" : "pref-other") : "";
      html += `<div class="ob ${p ? "filled" : ""} ${prefCls}" style="left:${b.x}px;top:${b.y}px;width:${BW}px;height:${BH}px">
        <div class="ob-head"><div class="ob-title">${esc(pos.title)}</div><div class="ob-code">${esc(pos.label)}</div></div>
        <select data-code="${pos.code}" aria-label="Select ${esc(pos.title)}">
          <option value="">${p ? "— Remove selection —" : "Select qualified personnel…"}</option>
          ${og("Qualified · preferred position", c.qPref, cur)}${og(c.qPref.length ? "Qualified · other preference" : "Qualified", c.qOther, cur)}${og(S.showAll ? "Other available personnel" : "Current selection", c.rest, cur)}
        </select>
        <div class="avail ${nAvail ? "" : "none"}">${nAvail ? `${nAvail} more qualified available` : "No other qualified personnel available"}</div>
        ${traineeSel}
        <div class="ob-foot" title="${p ? esc(p.name + " — " + footText(p) + " — " + prefFoot(p, pos.code)) : ""}">${p ? `${prefersPos(p, pos.code) ? "★ " : ""}<b>${esc(p.name)}</b> · ${esc(footText(p))}` : "Unfilled"}</div>
      </div>`;
    });
    org.innerHTML = html;
    team.trainees = team.trainees || {};
    org.querySelectorAll("select[data-code]").forEach((sel) => (sel.onchange = () => {
      const code = sel.dataset.code;
      if (sel.value) team.slots[code] = sel.value;
      else { delete team.slots[code]; delete team.trainees[code]; }   // no qualified person → trainee comes off too
      saveTeams();
      renderAll();
    }));
    org.querySelectorAll("select[data-trainee]").forEach((sel) => (sel.onchange = () => {
      const code = sel.dataset.trainee;
      if (sel.value) team.trainees[code] = sel.value; else delete team.trainees[code];
      saveTeams();
      renderAll();
    }));
  }

  function orgSvg(ti) {
    const team = S.teams[ti];
    const pad = 20, head = 140 - DH(), W = ORG_W + pad * 2, H = ORG_H + head + 44;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>`;
    const filled = Object.keys(team.slots).length, nTr = Object.keys(team.trainees || {}).length;
    const loc = String(team.location || "").trim();
    const hb = HB();
    s += `<rect width="${W}" height="${hb}" fill="${BRAND.navy}"/><rect width="8" height="${hb}" fill="${BRAND.red}"/>` + T(24, PDF_MODE ? 28 : 30, `${team.name} — Incident Management Team`, { size: 18, fill: "#fff", weight: 650 }) +
         (PDF_MODE ? "" : T(24, 50, `${filled} of ${POSITIONS.length} positions filled${nTr ? ` · ${nTr} trainee${nTr > 1 ? "s" : ""}` : ""} · ${stampText()}`, { size: 12, fill: "#c9d3e6" }));
    // Team information band: incident, deployment location, deployment type
    const band = (x, label, value, empty) =>
      T(x, hb + 22, label, { size: 10.5, fill: "#52514e", weight: 700 }) +
      (value ? T(x, hb + 44, clip(value, 46), { size: 16, fill: "#0b0b0b", weight: 700 }) : T(x, hb + 44, empty, { size: 15, fill: "#a12a2a", weight: 600 }));
    s += `<rect y="${hb}" width="${W}" height="58" fill="#eef2f8"/><line x1="0" x2="${W}" y1="${hb + 58}" y2="${hb + 58}" stroke="#c9d3e6"/>` +
         band(24, "DEPLOYMENT LOCATION", loc, "Not set") +
         band(470, "DEPLOYMENT TYPE", team.mission === "emac" ? "EMAC" : "In-state", "") +
         band(680, "INCIDENT", incidentLabel(), "");
    s += `<g transform="translate(${pad},${head})">` + linksSvgInner();
    POSITIONS.forEach((pos) => {
      const b = box(pos.code), p = team.slots[pos.code] && S.byId[team.slots[pos.code]];
      const pc = p ? (prefersPos(p, pos.code) ? PREF_COLOR.match : PREF_COLOR.other) : "#55534e";
      s += `<rect x="${b.x}" y="${b.y}" width="${BW}" height="${BH}" rx="6" fill="#fff" stroke="${p ? pc : "#1d1d1b"}" stroke-width="${p ? 2 : 1.5}"/>`;
      s += T(b.cx, b.y + 20, pos.title, { size: 12.5, anchor: "middle", fill: "#0b0b0b", weight: 650, deco: "underline" });
      s += T(b.cx, b.y + 36, pos.label, { size: 11, anchor: "middle", fill: "#52514e" });
      s += p ? T(b.cx, b.y + 68, (prefersPos(p, pos.code) ? "★ " : "") + clip(p.name, 26), { size: 15, anchor: "middle", fill: "#0b0b0b", weight: 700 })
             : T(b.cx, b.y + 68, "Unfilled", { size: 13, anchor: "middle", fill: "#a12a2a", weight: 600 });
      if (p && p.restrictions) s += T(b.cx, b.y + 86, clip("Restriction: " + p.restrictions, 34), { size: 10.5, anchor: "middle", fill: "#8a1c1c" });
      const tp = (team.trainees || {})[pos.code] && S.byId[team.trainees[pos.code]];
      if (tp) {
        s += `<rect x="${b.x + 10}" y="${b.y + 96}" width="${BW - 20}" height="30" rx="4" fill="#efedfa" stroke="${PREF_COLOR.trainee}" stroke-width="1"/>`;
        s += T(b.cx, b.y + 108, prefersPos(tp, pos.code) ? "TRAINEE · ★ PREFERRED POSITION" : "TRAINEE", { size: 9, anchor: "middle", fill: "#3a2f8f", weight: 700 });
        s += T(b.cx, b.y + 121, clip(tp.name + " · " + availText(tp), 36), { size: 11.5, anchor: "middle", fill: "#1d1d1b", weight: 600 });
      }
      s += `<path d="M${b.x},${b.y + BH - 26}h${BW}v20q0,6 -6,6h${-(BW - 12)}q-6,0 -6,-6z" fill="${pc}"/>`;
      s += T(b.cx, b.y + BH - 9, p ? clip(footText(p), 34) : "", { size: 11, anchor: "middle", fill: "#fff" });
    });
    // Legend
    const ly = H - 18;
    const key = (x, color, label) => `<rect x="${x}" y="${ly - 10}" width="14" height="12" rx="2" fill="${color}"/>` + T(x + 20, ly, label, { size: 11.5, fill: "#3d3d3a" });
    s += `</g>` + key(pad, PREF_COLOR.match, "★ Qualified · preferred position") + key(pad + 230, PREF_COLOR.other, "Qualified · other or no preference") +
         key(pad + 475, PREF_COLOR.trainee, "Trainee") +
         T(W - pad, ly, "Availability, affiliation and preferences as reported in the deployment survey.", { size: 11, fill: "#8a8984", anchor: "end" });
    return s + "</svg>";
  }

  function tableSvg(forPdf) {
    const rows = gapRows();
    const W = 1100, rowH = 26, top = 64 + 78 - DH(), CW = 58;
    const NX = [0, 1, 2, 3, 4, 5.25, 6.25, 7.25, 8.25, 9.25, 10.5].map((i) => 392 + i * CW);   // numeric column x
    const H = top + rowH * (rows.length + 1) + 40;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>`;
    s += exportHeader("Position gap review — qualified personnel still available", `${incidentLabel()} · ${S.regions.size < REGIONS.length ? "Affiliation: " + [...S.regions].join(", ") : "All affiliations"} · people already placed on teams removed · ${stampText()}`, W);
    // group headers
    const hy = 76 - DH(), gw = CW * 5 - 6;
    s += `<rect x="${NX[0]}" y="${hy}" width="${gw}" height="22" fill="#2a6bb8"/>` + T(NX[0] + gw / 2, hy + 15, "In-state only", { size: 12, anchor: "middle", fill: "#fff", weight: 650 });
    s += `<rect x="${NX[5]}" y="${hy}" width="${gw}" height="22" fill="#14213d"/>` + T(NX[5] + gw / 2, hy + 15, "EMAC / in-state", { size: 12, anchor: "middle", fill: "#fff", weight: 650 });
    s += T(24, top - 10, "Code", { size: 11.5, fill: "#52514e", weight: 650 }) + T(110, top - 10, "Position", { size: 11.5, fill: "#52514e", weight: 650 });
    const HDR = [["Full"], ["Partial /", "Restr."], ["Not", "stated"], ["Deploy.", "total"], ["Trainees"]];
    const sub = [...HDR, ...HDR, ["All", "avail."]];
    sub.forEach((lines, i) => lines.forEach((t, j) =>
      (s += T(NX[i] + 26, top - 10 - (lines.length - 1 - j) * 13, t, { size: 11, anchor: "middle", fill: i === 4 || i === 9 ? "#3a2f8f" : "#52514e", weight: 650 }))));
    s += `<line x1="20" x2="${W - 20}" y1="${top}" y2="${top}" stroke="#8a8984"/>`;
    const TOT_COLS = [3, 8, 10], TRN_COLS = [4, 9];
    const getters = [(r) => r.in.Full, (r) => r.in.Partial, (r) => r.in.Blank, (r) => r.inT, (r) => r.inTr,
                     (r) => r.em.Full, (r) => r.em.Partial, (r) => r.em.Blank, (r) => r.emT, (r) => r.emTr, (r) => r.all];
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      if (i % 2) s += `<rect x="20" y="${y}" width="${W - 40}" height="${rowH}" fill="#f7f6f2"/>`;
      s += T(24, y + 17, r.pos.label, { size: 12, fill: "#0b0b0b", weight: 700 }) + T(110, y + 17, r.pos.title, { size: 12, fill: "#0b0b0b" });
      getters.forEach((g, k) => {
        const v = g(r), x = NX[k], isT = TOT_COLS.includes(k), isTr = TRN_COLS.includes(k);
        if (isTr) { if (v > 0) s += `<rect x="${x + 4}" y="${y + 3}" width="44" height="${rowH - 6}" rx="3" fill="#e6e3f8"/>`; }
        else if (v > 0) s += `<rect x="${x + 4}" y="${y + 3}" width="44" height="${rowH - 6}" rx="3" fill="#dcf2e6"/>`;
        else if (isT) s += `<rect x="${x + 4}" y="${y + 3}" width="44" height="${rowH - 6}" rx="3" fill="#fbdcdc"/>`;
        const fill = isTr ? (v > 0 ? "#3a2f8f" : "#8a8984") : v > 0 ? "#14532d" : isT ? "#8a1c1c" : "#8a8984";
        s += T(x + 26, y + 17, v, { size: 12, anchor: "middle", fill, weight: isT ? 700 : 400 });
      });
    });
    const yb = top + rows.length * rowH;
    s += `<line x1="20" x2="${W - 20}" y1="${yb}" y2="${yb}" stroke="#8a8984"/>`;
    const tot = (f) => rows.reduce((a, r) => a + f(r), 0);
    s += T(110, yb + 17, "Total (counted once per position)", { size: 12, fill: "#0b0b0b", weight: 650 });
    getters.forEach((g, k) => (s += T(NX[k] + 26, yb + 17, tot(g), { size: 12, anchor: "middle", fill: "#0b0b0b", weight: 700 })));
    s += T(24, H - 12, "Green = at least one qualified person available; red = no one available. Trainees (task book or trained in, not yet qualified) are not in the deployable totals.", { size: 11, fill: "#8a8984" });
    return s + "</svg>";
  }

  /* ================================================================== EXPORTS */
  const slug = (s) => String(s || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 50);
  const fileBase = () => slug(incidentLabel()) || "deployment";

  function svgToPng(svg, scale = 2) {
    return new Promise((resolve, reject) => {
      const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const w = +m[1], h = +m[2];
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = w * scale; c.height = h * scale;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve({ url: c.toDataURL("image/png"), w, h });
      };
      img.onerror = reject;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  function download(url, name) {
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  // PNG downloads: add a white TEMA banner (color logo + red/navy rule) above the image, like the PDF pages
  function brandWrap(svg, logo, showTitle = true) {
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const W = +m[1], H = +m[2], BAND = 78;
    const inner = svg.replace(/^<svg /, `<svg x="0" y="${BAND}" `);
    const lh = 44, lw = logo ? lh * logo.w / logo.h : 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H + BAND}" width="${W}" height="${H + BAND}">` +
      `<rect width="${W}" height="${H + BAND}" fill="#fff"/>` +
      (logo ? `<image x="20" y="13" width="${lw}" height="${lh}" href="${logo.url}" xlink:href="${logo.url}"/>` : T(20, 44, "Tennessee Emergency Management Authority", { size: 16, fill: BRAND.navy, weight: 700 })) +
      (showTitle ? T(W - 20, 40, "Deployment Availability", { size: 17, fill: BRAND.navy, weight: 700, anchor: "end" }) : "") +
      `<rect x="20" y="${BAND - 12}" width="${W - 40}" height="3.5" fill="${BRAND.red}"/><rect x="20" y="${BAND - 7}" width="${W - 40}" height="1" fill="${BRAND.navy}"/>` +
      inner + `</svg>`;
  }
  async function downloadSvgPng(svg, name, showTitle = true) {
    try { const logo = await getLogo(); const r = await svgToPng(brandWrap(svg, logo, showTitle)); download(r.url, name); }
    catch (e) { console.error(e); showLoadMsg("Couldn't create the image in this browser.", true); }
  }

  // TEMA logo for PDF and PNG headers.
  // 1) tries tema-logo-color.png from the site folder (always checks the server, so a newly uploaded file is picked up)
  // 2) if that can't be loaded, uses the copy built into this file, so the logo always appears
  const TEMA_LOGO_BUILTIN = "data:image/png;base64,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";
  let logoCache = null;
  async function getLogo() {
    if (logoCache) return logoCache;
    const toImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const encode = (img) => {
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      return { url: c.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight };
    };
    for (const f of ["tema-logo-color.png", "tema-logo.png"]) {
      try {
        const r = await fetch(f, { cache: "no-cache" });
        if (!r.ok) continue;
        const b = await r.blob();
        if (!/^image\//.test(b.type)) continue;
        const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
        logoCache = encode(await toImage(url));
        return logoCache;
      } catch (e) { /* try the next option */ }
    }
    try { logoCache = encode(await toImage(TEMA_LOGO_BUILTIN)); }
    catch (e) { console.warn("TEMA logo could not be loaded — exported without it.", e); return null; }
    return logoCache;
  }

  async function downloadBriefingPdf() {
    if (!window.jspdf) { showLoadMsg("The PDF library didn't load. Check your connection and reload, or use the PNG downloads.", true); return; }
    busy(true, "Building briefing PDF…");
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
      const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight(), M = 28;
      const place = async (svg, yTop, maxH) => {
        const r = await svgToPng(svg, 2);
        let w = PW - M * 2, h = w * r.h / r.w;
        if (h > maxH) { h = maxH; w = h * r.w / r.h; }
        pdf.addImage(r.url, "PNG", (PW - w) / 2, yTop, w, h);
        return yTop + h;
      };
      const logo = await getLogo();
      const HEAD = 60;                                  // page header height (pt)
      const header = (subtitle) => {
        if (logo) pdf.addImage(logo.url, "PNG", M, 12, 36 * logo.w / logo.h, 36);
        pdf.setTextColor(0, 45, 114); pdf.setFont("helvetica", "bold"); pdf.setFontSize(14);
        pdf.text("Deployment Availability Briefing", PW - M, 27, { align: "right" });
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(118, 119, 122);
        pdf.text(subtitle, PW - M, 41, { align: "right" });
        // TEMA red rule with a thin navy line under it
        pdf.setFillColor(210, 39, 48); pdf.rect(M, HEAD - 8, PW - M * 2, 2.5, "F");
        pdf.setFillColor(0, 45, 114); pdf.rect(M, HEAD - 4.5, PW - M * 2, 0.75, "F");
      };
      const footer = (n) => {
        pdf.setDrawColor(201, 211, 230); pdf.setLineWidth(0.5); pdf.line(M, PH - 26, PW - M, PH - 26);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(118, 119, 122);
        pdf.text(`Tennessee Emergency Management Authority · Deployment availability briefing · ${incidentLabel()}`, M, PH - 14);
        pdf.setTextColor(0, 45, 114); pdf.setFont("helvetica", "bold");
        pdf.text(`Page ${n}`, PW - M, PH - 14, { align: "right" });
      };
      const top = HEAD + 4, avail = PH - top - 34;
      const affil = S.regions.size < REGIONS.length ? "Affiliation: " + [...S.regions].map((r) => (r === "Unspecified" ? "Not stated" : r)).join(", ") : "All affiliations";
      PDF_MODE = true;
      let page = 1;
      header(`${incidentLabel()} · ${affil} · people placed on teams removed · ${stampText()}`);
      await place(tableSvg(true), top, avail); footer(page);
      pdf.addPage(); page++; header(`${incidentLabel()} · ${filterSummary()} · ${stampText()}`);
      const yA = await place(chartASvg(true), top, avail * 0.56);
      await place(chartBSvg(true), yA + 10, PH - yA - 40); footer(page);
      for (let i = 0; i < S.teams.length; i++) {
        const t = S.teams[i];
        pdf.addPage(); page++;
        const nF = Object.keys(t.slots).length, nT = Object.keys(t.trainees || {}).length;
        header(`${t.name} · ${t.mission === "emac" ? "EMAC" : "In-state"} deployment · ${String(t.location || "").trim() || "Location not set"} · ${nF} of ${POSITIONS.length} positions filled${nT ? ` · ${nT} trainee${nT > 1 ? "s" : ""}` : ""} · ${stampText()}`);
        await place(orgSvg(i), top, avail); footer(page);
      }
      pdf.save(fileBase() + "_deployment_briefing.pdf");
    } catch (e) { console.error(e); showLoadMsg("Couldn't build the PDF: " + esc(e.message || e), true); }
    finally { PDF_MODE = false; busy(false); }
  }

  function downloadRoster() {
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["Team", "Deployment location", "Deployment type", "Position code", "Position", "Role", "Name", "Email", "Phone", "Team affiliation", "Availability", "Dates available", "In-state/EMAC", "Agency approval", "Restrictions", "Response length", "Preferred position", "Preferred matches qualified"];
    const lines = [head.map(q).join(",")];
    const row = (t, pos, p, role) => lines.push([t.name, t.location || "", t.mission === "emac" ? "EMAC" : "In-state", pos.label, pos.title, role,
        p ? p.name : "UNFILLED", p ? p.email : "", p ? p.phone : "", p ? p.regionRaw : "", p ? p.availRaw : "", p ? p.dates : "",
        p ? (p.scopeRaw || (p.scope === "EMAC" ? "In-state and EMAC" : "In-state only")) : "", p ? p.approvalRaw : "", p ? p.restrictions : "", p ? p.duration : "",
        p ? p.preferred : "", p && p.prefCodes.length ? p.prefCodes.map((c) => POS[c].label + (p.quals.includes(c) ? ": yes" : ": no (training)")).join("; ") : ""].map(q).join(","));
    S.teams.forEach((t) => POSITIONS.forEach((pos) => {
      row(t, pos, t.slots[pos.code] && S.byId[t.slots[pos.code]], "Qualified");
      const tp = (t.trainees || {})[pos.code] && S.byId[t.trainees[pos.code]];
      if (tp) row(t, pos, tp, "Trainee (" + traineeKind(tp, pos.code) + ")");
    }));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    download(url, fileBase() + "_team_rosters.csv");
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ================================================================== SETTINGS */
  function openSettings() {
    if (!S.isAdmin) return;
    $("inpLayerUrl").value = (S.source && S.source !== "demo") ? S.source : (store.get("deploy:layerUrl") || CONFIG.LAYER_URL || "");
    const fm = S.fieldMap || {};
    $("tblFields").innerHTML = `<tr><th>Survey question</th><th>Matched field</th></tr>` +
      FIELD_DEFS.filter(([k]) => k !== "fullName" || fm.fullName).map(([k, label]) =>
        `<tr><td>${esc(label)}</td>${fm[k] ? `<td>${esc(fm[k].alias)}${fm[k].alias !== fm[k].name ? ` <span class="sub">(${esc(fm[k].name)})</span>` : ""}</td>` : `<td class="miss">${S.fields.length ? "not found" : "—"}</td>`}</tr>`).join("");
    const unm = Object.entries(S.unmatchedPositions || {});
    $("unmatchedNote").textContent = unm.length ? "Qualified-position answers that didn't match an org chart position: " + unm.map(([k, n]) => `${k} (${n})`).join("; ") : "";
    $("dlgSettings").showModal();
  }

  /* ================================================================== START */
  startAuth();
})();
