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
    // REST URL of the hosted table or layer that holds the survey results.
    // Can also be set from the Settings button (saved per browser).
    LAYER_URL: "",
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

  /* ================================================================== COLORS (validated: dataviz palette check) */
  const REGIONS = ["East", "Middle", "West", "Unspecified"];
  const REGION_COLOR = { East: "#2a78d6", Middle: "#eb6834", West: "#1baf7a", Unspecified: "#a3a29c" };
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
    ["scope", "In-state and EMAC", (n) => n.includes("emac")],
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

  /* ================================================================== AUTH */
  const btnSignIn = $("btnSignIn");
  const gateMsg = (m) => ($("gateMsg").textContent = m || "");
  let esriIdRef = null, esriRequest = null;

  function startAuth() {
    if (isLocalPreview) return showApp("Local preview (no sign-in)");
    if (typeof window.require !== "function") {
      btnSignIn.textContent = "Sign-in unavailable";
      gateMsg("Could not load the ArcGIS Maps SDK. Check your network connection and reload.");
      return;
    }
    window.require(["esri/identity/OAuthInfo", "esri/identity/IdentityManager", "esri/portal/Portal", "esri/request"],
      (OAuthInfo, esriId, Portal, request) => {
        esriIdRef = esriId; esriRequest = request;
        let inIframe = false;
        try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
        const info = new OAuthInfo({
          appId: CONFIG.CLIENT_ID,
          portalUrl: CONFIG.PORTAL_URL,
          popup: inIframe,                                            // pop-up inside Experience Builder, redirect otherwise
          popupCallbackUrl: new URL("oauth-callback.html", window.location.href).href,
          flowType: "auto"                                            // authorization code + PKCE
        });
        esriId.registerOAuthInfos([info]);
        const sharingUrl = info.portalUrl + "/sharing";

        const onSignedIn = () => {
          const portal = new Portal({ url: CONFIG.PORTAL_URL, authMode: "immediate" });
          return portal.load()
            .then(() => showApp(portal.user ? (portal.user.fullName || portal.user.username) : "Signed in"))
            .catch(() => showApp("Signed in"));
        };
        const resetButton = () => { btnSignIn.disabled = false; btnSignIn.textContent = "Sign in with ArcGIS"; };
        const showNewTabOption = () => {
          if (!inIframe || $("newTabLink")) return;
          $("gateMsg").insertAdjacentHTML("afterend",
            `<p style="font-size:13px">Pop-up didn't open? <a id="newTabLink" href="${esc(window.location.href.split("#")[0])}" target="_blank" rel="noopener">Open in a new tab</a></p>`);
        };
        btnSignIn.onclick = () => {
          gateMsg("");
          btnSignIn.disabled = true;
          btnSignIn.textContent = inIframe ? "Complete sign-in in the pop-up…" : "Redirecting to ArcGIS…";
          const stuck = setTimeout(() => {
            resetButton();
            if (inIframe) { gateMsg("Still waiting on the ArcGIS sign-in window. If it was blocked, allow pop-ups and try again."); showNewTabOption(); }
          }, 20000);
          esriId.getCredential(sharingUrl)
            .then(() => { clearTimeout(stuck); return onSignedIn(); })
            .catch((e) => {
              clearTimeout(stuck);
              console.warn("ArcGIS sign-in error", e);
              resetButton();
              gateMsg(e && e.message ? e.message : "Sign-in was cancelled.");
              showNewTabOption();
            });
        };
        esriId.checkSignInStatus(sharingUrl).then(onSignedIn).catch(resetButton);
      },
      (err) => gateMsg("ArcGIS SDK failed to load: " + (err && err.message)));
  }

  $("btnSignOut").onclick = () => {
    if (esriIdRef) esriIdRef.destroyCredentials();
    window.location.href = window.location.pathname;
  };

  function showApp(userLabel) {
    $("gate").style.display = "none";
    $("gate").hidden = true;
    $("app").hidden = false;
    $("userName").textContent = userLabel;
    wireUi();
    const url = store.get("deploy:layerUrl") || CONFIG.LAYER_URL;
    if (isLocalPreview) return loadDemo();
    if (url) loadLayer(url);
    else showLoadMsg(`<b>No survey table connected yet.</b> Open <a href="#" id="lnkSettings">Settings</a> and paste the REST URL of the ArcGIS table that holds the survey results, or load demo data to try the page.`);
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
      showLoadMsg(`That URL doesn't end in a layer number. It should look like <code>…/FeatureServer/0</code>. Open <a href="#" id="lnkSettings">Settings</a> to fix it.`, true);
      return;
    }
    if (!esriRequest) { showLoadMsg("ArcGIS is not available in local preview. Use demo data instead.", true); return; }
    busy(true, "Loading survey results from ArcGIS…");
    try {
      const meta = (await esriRequest(url, { query: { f: "json" }, responseType: "json" })).data;
      if (meta.error) throw new Error(meta.error.message);
      const fields = (meta.fields || []).map((f) => ({ name: f.name, alias: f.alias || f.name, type: f.type, domain: f.domain }));
      const pageSize = Math.min(meta.maxRecordCount || 1000, 2000);
      let rows = [], offset = 0, more = true;
      while (more) {
        const res = (await esriRequest(url + "/query", {
          query: { f: "json", where: "1=1", outFields: "*", returnGeometry: false, resultOffset: offset, resultRecordCount: pageSize },
          responseType: "json"
        })).data;
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
      store.set("deploy:layerUrl", url);
      $("demoBanner").hidden = true;
      ingest(fields, rows);
      showLoadMsg("");
    } catch (e) {
      console.error(e);
      const m = (e && e.message) || "Unknown error";
      showLoadMsg(`<b>Couldn't load the survey table.</b> ${esc(m)}<br><span class="sub">Check that the URL is right and that the table is shared with you (organization or a group you belong to). <a href="#" id="lnkSettings">Open Settings</a></span>`, true);
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
        scopeRaw: val(r, "scope") || "", scope: classScope(val(r, "scope")),
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
        else if (p.trainee.includes(pos.code) || p.candidates.includes(pos.code)) p.scope === "EMAC" ? r.emTr++ : r.inTr++;
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
    $("btnRefresh").onclick = () => (S.source === "demo" ? loadDemo() : S.source ? loadLayer(S.source) : openSettings());
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
    $("btnOrgPng").onclick = () => downloadSvgPng(orgSvg(S.activeTeam), fileBase() + "_" + slug(S.teams[S.activeTeam].name) + "_org_chart.png");
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
      "“Not stated” = the availability question was left blank. People who answered that they're not available, and entries with no name, are left out. A blank in-state/EMAC answer is counted as in-state only. “Trainees” = people with an open task book or trained in the position who aren't qualified in it; they're not included in the deployable totals.",
      (S.unnamed || []).length ? `${S.unnamed.length} ${S.unnamed.length === 1 ? "entry has" : "entries have"} no name listed and ${S.unnamed.length === 1 ? "is" : "are"} left out of all counts.` : "",
      noQual ? `${noQual} available ${noQual === 1 ? "person has" : "people have"} no qualified position listed; they appear only under “List all available personnel” on the org chart.` : "",
      unm.length ? `Qualified positions not on this org chart: ${esc(unm.slice(0, 6).join("; "))}${unm.length > 6 ? "…" : ""}.` : ""
    ].filter(Boolean).join(" ");
  }

  /* ================================================================== DRAWER (personnel for a position) */
  let openCode = null;
  function personCard(p, asg, role) {
    const a = asg[p.id];
    const tags = [
      `<span class="tag">${esc(p.region === "Unspecified" ? "Affiliation not stated" : p.region)}</span>`,
      p.avail === "Full" ? `<span class="tag full">Full availability</span>` : "",
      p.isPartial ? `<span class="tag partial">Partial availability</span>` : "",
      p.hasRestr ? `<span class="tag partial">Restrictions</span>` : "",
      p.avail === "Blank" ? `<span class="tag">Availability not stated</span>` : "",
      p.scope === "EMAC" ? `<span class="tag emac">In-state & EMAC</span>` : `<span class="tag">In-state only</span>`,
      p.approval !== "Yes" ? `<span class="tag warn">Agency approval: ${esc(p.approvalRaw || "not answered")}</span>` : "",
      p.dupes ? `<span class="tag">Latest of ${p.dupes + 1} submissions</span>` : "",
      a ? `<span class="tag asg">On ${esc(S.teams[a.team].name)} · ${esc(POS[a.code].label)}${a.role === "trainee" ? " trainee" : ""}</span>` : ""
    ].join("");
    const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
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
        ${row("Preferred", p.preferred)}
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
    const sec = (title, list, role) => `<h3 class="dr-sec">${title} (${list.filter((p) => !asg[p.id]).length} available${list.some((p) => asg[p.id]) ? `, ${list.filter((p) => asg[p.id]).length} placed` : ""})</h3>` +
      (list.length ? list.map((p) => personCard(p, asg, role)).join("") : `<p class="empty">No one in this group.</p>`);
    $("drCode").textContent = pos.label + (S.regions.size < REGIONS.length ? " · " + [...S.regions].join(", ") : "");
    $("drTitle").textContent = pos.title;
    $("drBody").innerHTML = sec("Qualified", q, "Qualified") + sec("Trainees with an open task book", tr, "Trainee") + sec("Trained in this position", ca, "Candidate");
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
  const BRAND = { navy: "#1c3b6a", red: "#ef393e", gray: "#6d7276" };
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
    const q = S.people.filter((p) => ok(p) && p.quals.includes(code)).sort(availOrder);
    const used = new Set(q.map((p) => p.id));
    const rest = S.showAll ? S.people.filter((p) => ok(p) && !used.has(p.id)).sort(availOrder) : [];
    // Keep the current pick visible even if the person no longer matches (e.g. "show all" turned off)
    if (current && S.byId[current] && !used.has(current) && !rest.some((p) => p.id === current)) rest.unshift(S.byId[current]);
    return { q, rest };
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
    const list = [...both, ...tb, ...ca];
    const inList = !!current && list.some((p) => p.id === current);
    return { both, tb, ca, total: list.filter((p) => p.id !== current).length, keep: current && !inList && S.byId[current] ? S.byId[current] : null };
  }
  const traineeKind = (p, code) => (p.trainee.includes(code) && p.candidates.includes(code) ? "task book + trained" : p.trainee.includes(code) ? "task book" : p.candidates.includes(code) ? "trained in" : "");

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
      const og = (label, list, sel) => (list.length ? `<optgroup label="${esc(label)}">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(optLabel(x))}</option>`).join("")}</optgroup>` : "");
      const nAvail = c.q.filter((x) => x.id !== cur).length;
      // Trainee select — only once a qualified person is chosen
      const curT = (team.trainees || {})[pos.code];
      const t = traineeCandidates(pos.code, team);
      const traineeSel = p
        ? `<select class="trainee-sel ${curT ? "has" : ""}" data-trainee="${pos.code}" aria-label="Trainee for ${esc(pos.title)}">
             <option value="">${curT ? "— Remove trainee —" : t.total > 0 ? `+ Add trainee (${t.total} available)…` : "No trainees available"}</option>
             ${t.keep ? og("Current trainee", [t.keep], curT) : ""}${og("Task book + trained in", t.both, curT)}${og("Open task book", t.tb, curT)}${og("Trained in position", t.ca, curT)}
           </select>`
        : `<div class="trainee-ph">Trainee: pick qualified first</div>`;
      html += `<div class="ob ${p ? "filled" : ""}" style="left:${b.x}px;top:${b.y}px;width:${BW}px;height:${BH}px">
        <div class="ob-head"><div class="ob-title">${esc(pos.title)}</div><div class="ob-code">${esc(pos.label)}</div></div>
        <select data-code="${pos.code}" aria-label="Select ${esc(pos.title)}">
          <option value="">${p ? "— Remove selection —" : "Select qualified personnel…"}</option>
          ${og("Qualified", c.q, cur)}${og(S.showAll ? "Other available personnel" : "Current selection", c.rest, cur)}
        </select>
        <div class="avail ${nAvail ? "" : "none"}">${nAvail ? `${nAvail} more qualified available` : "No other qualified personnel available"}</div>
        ${traineeSel}
        <div class="ob-foot" title="${p ? esc(p.name + " — " + footText(p)) : ""}">${p ? `<b>${esc(p.name)}</b> · ${esc(footText(p))}` : "Unfilled"}</div>
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
    const pad = 20, head = 140 - DH(), W = ORG_W + pad * 2, H = ORG_H + head + 40;
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
      s += `<rect x="${b.x}" y="${b.y}" width="${BW}" height="${BH}" rx="6" fill="#fff" stroke="${p ? "#1c5cab" : "#1d1d1b"}" stroke-width="1.5"/>`;
      s += T(b.cx, b.y + 20, pos.title, { size: 12.5, anchor: "middle", fill: "#0b0b0b", weight: 650, deco: "underline" });
      s += T(b.cx, b.y + 36, pos.label, { size: 11, anchor: "middle", fill: "#52514e" });
      s += p ? T(b.cx, b.y + 68, clip(p.name, 26), { size: 15, anchor: "middle", fill: "#0b0b0b", weight: 700 })
             : T(b.cx, b.y + 68, "Unfilled", { size: 13, anchor: "middle", fill: "#a12a2a", weight: 600 });
      if (p && p.restrictions) s += T(b.cx, b.y + 86, clip("Restriction: " + p.restrictions, 34), { size: 10.5, anchor: "middle", fill: "#8a1c1c" });
      const tp = (team.trainees || {})[pos.code] && S.byId[team.trainees[pos.code]];
      if (tp) {
        s += `<rect x="${b.x + 10}" y="${b.y + 96}" width="${BW - 20}" height="30" rx="4" fill="#efedfa"/>`;
        s += T(b.cx, b.y + 108, "TRAINEE", { size: 9, anchor: "middle", fill: "#3a2f8f", weight: 700 });
        s += T(b.cx, b.y + 121, clip(tp.name + " · " + availText(tp), 36), { size: 11.5, anchor: "middle", fill: "#1d1d1b", weight: 600 });
      }
      s += `<path d="M${b.x},${b.y + BH - 26}h${BW}v20q0,6 -6,6h${-(BW - 12)}q-6,0 -6,-6z" fill="${p ? "#1c5cab" : "#55534e"}"/>`;
      s += T(b.cx, b.y + BH - 9, p ? clip(footText(p), 34) : "", { size: 11, anchor: "middle", fill: "#fff" });
    });
    s += `</g>` + T(pad, H - 14, "Availability and affiliation as reported in the deployment survey.", { size: 11, fill: "#8a8984" });
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
  function brandWrap(svg, logo) {
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const W = +m[1], H = +m[2], BAND = 78;
    const inner = svg.replace(/^<svg /, `<svg x="0" y="${BAND}" `);
    const lh = 44, lw = logo ? lh * logo.w / logo.h : 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H + BAND}" width="${W}" height="${H + BAND}">` +
      `<rect width="${W}" height="${H + BAND}" fill="#fff"/>` +
      (logo ? `<image x="20" y="13" width="${lw}" height="${lh}" href="${logo.url}" xlink:href="${logo.url}"/>` : T(20, 44, "Tennessee Emergency Management Authority", { size: 16, fill: BRAND.navy, weight: 700 })) +
      T(W - 20, 40, "Deployment Availability", { size: 17, fill: BRAND.navy, weight: 700, anchor: "end" }) +
      `<rect x="20" y="${BAND - 12}" width="${W - 40}" height="3.5" fill="${BRAND.red}"/><rect x="20" y="${BAND - 7}" width="${W - 40}" height="1" fill="${BRAND.navy}"/>` +
      inner + `</svg>`;
  }
  async function downloadSvgPng(svg, name) {
    try { const logo = await getLogo(); const r = await svgToPng(brandWrap(svg, logo)); download(r.url, name); }
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
        pdf.setTextColor(28, 59, 106); pdf.setFont("helvetica", "bold"); pdf.setFontSize(14);
        pdf.text("Deployment Availability Briefing", PW - M, 27, { align: "right" });
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(109, 114, 118);
        pdf.text(subtitle, PW - M, 41, { align: "right" });
        // TEMA red rule with a thin navy line under it
        pdf.setFillColor(239, 57, 62); pdf.rect(M, HEAD - 8, PW - M * 2, 2.5, "F");
        pdf.setFillColor(28, 59, 106); pdf.rect(M, HEAD - 4.5, PW - M * 2, 0.75, "F");
      };
      const footer = (n) => {
        pdf.setDrawColor(201, 211, 230); pdf.setLineWidth(0.5); pdf.line(M, PH - 26, PW - M, PH - 26);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(109, 114, 118);
        pdf.text(`Tennessee Emergency Management Authority · Deployment availability briefing · ${incidentLabel()}`, M, PH - 14);
        pdf.setTextColor(28, 59, 106); pdf.setFont("helvetica", "bold");
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
    const head = ["Team", "Deployment location", "Deployment type", "Position code", "Position", "Role", "Name", "Email", "Phone", "Team affiliation", "Availability", "Dates available", "In-state/EMAC", "Agency approval", "Restrictions", "Response length"];
    const lines = [head.map(q).join(",")];
    const row = (t, pos, p, role) => lines.push([t.name, t.location || "", t.mission === "emac" ? "EMAC" : "In-state", pos.label, pos.title, role,
        p ? p.name : "UNFILLED", p ? p.email : "", p ? p.phone : "", p ? p.regionRaw : "", p ? p.availRaw : "", p ? p.dates : "",
        p ? p.scopeRaw : "", p ? p.approvalRaw : "", p ? p.restrictions : "", p ? p.duration : ""].map(q).join(","));
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
