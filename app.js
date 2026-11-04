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
  const newTeam = (n) => ({ name: "Team " + n, mission: "instate", location: "", slots: {} });

  function loadTeams() {
    const saved = store.get(teamKey());
    S.teams = Array.isArray(saved) && saved.length ? saved : [newTeam(1)];
    S.teams.forEach((t) => { t.slots = t.slots || {}; Object.keys(t.slots).forEach((c) => { if (!S.byId[t.slots[c]] || !POS[c]) delete t.slots[c]; }); });
    S.activeTeam = Math.min(S.activeTeam, S.teams.length - 1);
  }
  const saveTeams = () => store.set(teamKey(), S.teams);

  function assignments() {
    const a = {};
    S.teams.forEach((t, ti) => Object.entries(t.slots).forEach(([code, pid]) => { if (pid) a[pid] = { team: ti, code }; }));
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
      r.filled = Object.values(asg).filter((x) => x.code === pos.code).length;
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
      if (!Object.keys(t.slots).length || confirmAction(`Clear every selection on ${t.name}? Those people go back into the available counts.`)) { t.slots = {}; saveTeams(); renderAll(); }
    };
    $("btnRemoveTeam").onclick = () => {
      const t = S.teams[S.activeTeam];
      if (S.teams.length === 1) { t.slots = {}; t.name = "Team 1"; saveTeams(); renderAll(); return; }
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
          <td class="num">${r.filled ? `<span class="badge-a">${r.filled}</span>` : `<span class="muted">–</span>`}</td>
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
      a ? `<span class="tag asg">On ${esc(S.teams[a.team].name)} · ${esc(POS[a.code].label)}</span>` : ""
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
  function exportHeader(title, sub, W) {
    return `<rect width="${W}" height="64" fill="#14213d"/>` +
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
    const W = 1100, top = forExport ? 110 : 34, H = top + 300, L = 44, R = 16, B = 46;
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
    const W = 1100, top = forExport ? 110 : 34, rowH = 44, L = 110, R = 150, B = 34;
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
  const BW = 240, BH = 124;
  const COLS = [130, 402, 674, 946];
  const ORG_W = 1075, ORG_H = 790;
  const LAYOUT = {
    ICT:  { cx: 538,     y: 10 },
    LOFR: { cx: COLS[0], y: 170 }, PIO: { cx: COLS[1], y: 170 }, SOF: { cx: COLS[2], y: 170 },
    OPS:  { cx: COLS[0], y: 360 }, PSC: { cx: COLS[1], y: 360 }, LSC: { cx: COLS[2], y: 360 }, FSC: { cx: COLS[3], y: 360 },
    DOSC: { cx: COLS[0], y: 510 }, SITL: { cx: COLS[1], y: 510 }, COML: { cx: COLS[2], y: 510 },
    STAM: { cx: COLS[0], y: 660 }, RESL: { cx: COLS[1], y: 660 }, ITSL: { cx: COLS[2], y: 660 },
    DOCL: { cx: COLS[3], y: 510 }
  };
  const box = (c) => ({ x: LAYOUT[c].cx - BW / 2, y: LAYOUT[c].y, w: BW, h: BH, cx: LAYOUT[c].cx });

  function linksSvgInner(stroke = "#1d1d1b") {
    const ic = box("ICT"), pio = box("PIO"), lofr = box("LOFR"), sof = box("SOF");
    const busY = 335;
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

  function teamCandidates(code, team) {
    const asg = assignments();
    const current = team.slots[code];
    const ok = (p) => p.avail !== "Unavailable" && (!asg[p.id] || p.id === current) &&
                      (team.mission !== "emac" || p.scope === "EMAC");
    const order = (a, b) => (["Full", "Partial", "Blank"].indexOf(a.avail) - ["Full", "Partial", "Blank"].indexOf(b.avail)) || a.sortName.localeCompare(b.sortName);
    const q = S.people.filter((p) => ok(p) && p.quals.includes(code)).sort(order);
    const tr = S.people.filter((p) => ok(p) && !p.quals.includes(code) && p.trainee.includes(code)).sort(order);
    const ca = S.people.filter((p) => ok(p) && !p.quals.includes(code) && !p.trainee.includes(code) && p.candidates.includes(code)).sort(order);
    const used = new Set([...q, ...tr, ...ca].map((p) => p.id));
    const rest = S.showAll ? S.people.filter((p) => ok(p) && !used.has(p.id)).sort(order) : [];
    // Keep the current pick visible even if the person no longer matches (e.g. "show all" turned off)
    if (current && S.byId[current] && !used.has(current) && !rest.some((p) => p.id === current)) rest.unshift(S.byId[current]);
    return { q, tr, ca, rest };
  }

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
      const og = (label, list) => (list.length ? `<optgroup label="${esc(label)}">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? "selected" : ""}>${esc(optLabel(x))}</option>`).join("")}</optgroup>` : "");
      const nAvail = c.q.filter((x) => x.id !== cur).length;
      html += `<div class="ob ${p ? "filled" : ""}" style="left:${b.x}px;top:${b.y}px;width:${BW}px;height:${BH}px">
        <div class="ob-head"><div class="ob-title">${esc(pos.title)}</div><div class="ob-code">${esc(pos.label)}</div></div>
        <select data-code="${pos.code}" aria-label="Select ${esc(pos.title)}">
          <option value="">${p ? "— Remove selection —" : "Select personnel…"}</option>
          ${og("Qualified", c.q)}${og("Trainee – open task book", c.tr)}${og("Trained in position", c.ca)}${og(S.showAll ? "Other available personnel" : "Current selection", c.rest)}
        </select>
        <div class="avail ${nAvail ? "" : "none"}">${nAvail ? `${nAvail} more qualified available` : "No other qualified personnel available"}</div>
        <div class="ob-foot" title="${p ? esc(p.name + " — " + footText(p)) : ""}">${p ? `<b>${esc(p.name)}</b> · ${esc(footText(p))}` : "Unfilled"}</div>
      </div>`;
    });
    org.innerHTML = html;
    org.querySelectorAll("select").forEach((sel) => (sel.onchange = () => {
      const code = sel.dataset.code;
      if (sel.value) team.slots[code] = sel.value; else delete team.slots[code];
      saveTeams();
      renderAll();
    }));
  }

  function orgSvg(ti) {
    const team = S.teams[ti];
    const pad = 20, head = 84, W = ORG_W + pad * 2, H = ORG_H + head + 40;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>`;
    const filled = Object.keys(team.slots).length;
    const loc = String(team.location || "").trim();
    s += `<rect width="${W}" height="64" fill="#14213d"/>` + T(24, 30, `${team.name} — Incident Management Team`, { size: 18, fill: "#fff", weight: 650 }) +
         T(W - 24, 24, "DEPLOYMENT LOCATION", { size: 10.5, fill: "#c9d3e6", anchor: "end", weight: 600 }) +
         (loc ? T(W - 24, 46, clip(loc, 40), { size: 16, fill: "#fff", anchor: "end", weight: 650 })
              : T(W - 24, 46, "Not set", { size: 14, fill: "#8fa0bf", anchor: "end" })) +
         T(24, 50, `${incidentLabel()} · ${team.mission === "emac" ? "EMAC deployment" : "In-state deployment"} · ${filled} of ${POSITIONS.length} positions filled · ${stampText()}`, { size: 12, fill: "#c9d3e6" });
    s += `<g transform="translate(${pad},${head})">` + linksSvgInner();
    POSITIONS.forEach((pos) => {
      const b = box(pos.code), p = team.slots[pos.code] && S.byId[team.slots[pos.code]];
      s += `<rect x="${b.x}" y="${b.y}" width="${BW}" height="${BH}" rx="6" fill="#fff" stroke="${p ? "#1c5cab" : "#1d1d1b"}" stroke-width="1.5"/>`;
      s += T(b.cx, b.y + 20, pos.title, { size: 12.5, anchor: "middle", fill: "#0b0b0b", weight: 650, deco: "underline" });
      s += T(b.cx, b.y + 36, pos.label, { size: 11, anchor: "middle", fill: "#52514e" });
      s += p ? T(b.cx, b.y + 68, clip(p.name, 26), { size: 15, anchor: "middle", fill: "#0b0b0b", weight: 700 })
             : T(b.cx, b.y + 68, "Unfilled", { size: 13, anchor: "middle", fill: "#a12a2a", weight: 600 });
      if (p && p.restrictions) s += T(b.cx, b.y + 86, clip("Restriction: " + p.restrictions, 34), { size: 10.5, anchor: "middle", fill: "#8a1c1c" });
      s += `<path d="M${b.x},${b.y + BH - 26}h${BW}v20q0,6 -6,6h${-(BW - 12)}q-6,0 -6,-6z" fill="${p ? "#1c5cab" : "#55534e"}"/>`;
      s += T(b.cx, b.y + BH - 9, p ? clip(footText(p), 34) : "", { size: 11, anchor: "middle", fill: "#fff" });
    });
    s += `</g>` + T(pad, H - 14, "Availability and affiliation as reported in the deployment survey.", { size: 11, fill: "#8a8984" });
    return s + "</svg>";
  }

  function tableSvg(forPdf) {
    const rows = gapRows();
    const W = 1100, rowH = 26, top = 64 + 78, CW = 58;
    const NX = [0, 1, 2, 3, 4, 5.25, 6.25, 7.25, 8.25, 9.25, 10.5].map((i) => 392 + i * CW);   // numeric column x
    const H = top + rowH * (rows.length + 1) + 40;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>`;
    s += exportHeader("Position gap review — qualified personnel still available", `${incidentLabel()} · ${S.regions.size < REGIONS.length ? "Affiliation: " + [...S.regions].join(", ") : "All affiliations"} · people already placed on teams removed · ${stampText()}`, W);
    // group headers
    const hy = 76, gw = CW * 5 - 6;
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
  async function downloadSvgPng(svg, name) {
    try { const r = await svgToPng(svg); download(r.url, name); }
    catch (e) { console.error(e); showLoadMsg("Couldn't create the image in this browser.", true); }
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
      const footer = (n) => { pdf.setFontSize(8); pdf.setTextColor(138); pdf.text(`Deployment availability briefing · ${incidentLabel()} · page ${n}`, M, PH - 14); };
      let page = 1;
      await place(tableSvg(true), M, PH - M * 2 - 10); footer(page);
      pdf.addPage(); page++;
      const yA = await place(chartASvg(true), M, (PH - M * 2) * 0.58);
      await place(chartBSvg(true), yA + 12, PH - yA - M - 24); footer(page);
      for (let i = 0; i < S.teams.length; i++) {
        pdf.addPage(); page++;
        await place(orgSvg(i), M, PH - M * 2 - 10); footer(page);
      }
      pdf.save(fileBase() + "_deployment_briefing.pdf");
    } catch (e) { console.error(e); showLoadMsg("Couldn't build the PDF: " + esc(e.message || e), true); }
    finally { busy(false); }
  }

  function downloadRoster() {
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["Team", "Deployment location", "Deployment type", "Position code", "Position", "Name", "Email", "Phone", "Team affiliation", "Availability", "Dates available", "In-state/EMAC", "Agency approval", "Restrictions", "Response length"];
    const lines = [head.map(q).join(",")];
    S.teams.forEach((t) => POSITIONS.forEach((pos) => {
      const p = t.slots[pos.code] && S.byId[t.slots[pos.code]];
      lines.push([t.name, t.location || "", t.mission === "emac" ? "EMAC" : "In-state", pos.label, pos.title,
        p ? p.name : "UNFILLED", p ? p.email : "", p ? p.phone : "", p ? p.regionRaw : "", p ? p.availRaw : "", p ? p.dates : "",
        p ? p.scopeRaw : "", p ? p.approvalRaw : "", p ? p.restrictions : "", p ? p.duration : ""].map(q).join(","));
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
