/* Demo survey results — FICTIONAL people, generated from a fixed seed.
   Used only when you click "Load demo data" in Settings, or for local preview (?preview on localhost).
   Rows use the same column headers as the deployment survey export. */
(function () {
  "use strict";
  let s = 20261103;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const FIRST = ["Avery","Jordan","Casey","Morgan","Riley","Taylor","Quinn","Reese","Drew","Parker","Hayden","Rowan","Emerson","Sawyer","Blake","Cameron","Dana","Elliot","Finley","Harper","Jamie","Kendall","Logan","Marlow","Noel","Peyton","Sage","Tatum","Wren","Skyler","Alexis","Brooke","Corey","Devon","Frankie","Gray","Jesse","Kai","Lane","Micah"];
  const LAST  = ["Ashford","Bellamy","Calloway","Draper","Ellery","Fairbanks","Galloway","Hargrove","Ingram","Jessup","Kimball","Lockhart","Merriweather","Northcutt","Overstreet","Prescott","Quarles","Radford","Stanfield","Thornbury","Underwood","Vance","Whitlock","Yardley","Ambrose","Brantley","Crenshaw","Dunmore","Easley","Fennimore"];
  const QUAL = [
    "ICT3-AH - Incident Commander", "PIO-AH - Public Information Officer", "SOF3-AH - Safety Officer",
    "LOFR-AH - Liaison Officer", "OSC3-AH - Operations Section Chief", "PSC3-AH - Planning Section Chief",
    "LSC3-AH - Logistics Section Chief", "FSC3-AH - Finance/Admin Section Chief", "SITL-AH - Situation Unit Leader",
    "COML-AH - Communications Unit Leader", "STAM-AH - Staging Area Manager", "RESL-AH - Resource Unit Leader",
    "ITSL-AH - Info Tech Service Unit Leader"
  ];
  const AGENCY = ["Yes", "Yes", "Yes", "Pending", "No"];
  const RESTR = ["", "", "", "", "No overnight travel", "Cannot lift over 25 lbs", "Must return by Friday for family obligation", "Day shifts only"];
  const DUR = ["7 days", "14 days", "Up to 14 days", "5 days", "21 days"];
  const INC = ["Middle TN Flooding — Nov 2026", "Hurricane EMAC Request — Oct 2026"];

  const rows = [];
  let id = 4100;
  for (let i = 0; i < 64; i++) {
    const first = FIRST[i % FIRST.length], last = LAST[(i * 7) % LAST.length];
    const inc = i < 50 ? INC[0] : INC[1];
    const r = rnd();
    const avail = r < 0.5 ? "Fully available" : r < 0.82 ? "Partially available" : r < 0.92 ? "Not available" : "";
    const nQ = rnd() < 0.62 ? 1 : rnd() < 0.8 ? 2 : 0;
    const quals = [];
    for (let k = 0; k < nQ; k++) { const q = pick(QUAL); if (!quals.includes(q)) quals.push(q); }
    if (i % 11 === 3) quals.push("Deputy OSC - Deputy Operations Section Chief");
    const day = 1 + Math.floor(rnd() * 2);
    const submitted = new Date(Date.UTC(2026, inc === INC[0] ? 10 : 9, day, 14 + Math.floor(rnd() * 8), Math.floor(rnd() * 60)));
    id++;
    rows.push({
      "First Name": first, "Last Name": last,
      "Email": `${first}.${last}@example.gov`.toLowerCase(),
      "Phone Number": `(615) 555-${String(1000 + i * 37).slice(-4)}`,
      "Anticipated Response Duration": pick(DUR),
      "Incident Description": inc,
      "Availability": avail,
      "In-state and EMAC": rnd() < 0.55 ? "In-state and EMAC" : "In-state only",
      "Has your home agency approved your participation?": pick(AGENCY),
      "If partially available - what dates are you available?": avail === "Partially available" ? pick(["Nov 4–8", "Nov 6–12", "Weekends only", "After Nov 9"]) : "",
      "If restrictions - please note all restrictions:": pick(RESTR),
      "QUALIFIED PERSONNEL ONLY - Note your qualified position": quals.join(", "),
      "Preferred Position - Please Note Preference": quals[0] ? quals[0].split(" - ")[1] : "",
      "TRAINEE PERSONNEL ONLY - Note your open position task book": rnd() < 0.25 ? pick(QUAL) : "",
      "Team Affiliation (East, Middle, West)": rnd() < 0.08 ? "" : pick(["East", "Middle", "Middle", "West"]),
      "POSITION CANDIDATES - Note Position Trained In": rnd() < 0.2 ? pick(QUAL) : "",
      "Submission ID": String(id), "Status": "Complete", "Submitter ID": "", "Submitted By": "",
      "Submitted": submitted.getTime(), "Updated": submitted.getTime(),
      "Submitter IP": "", "Submitter UA": "", "Custom": ""
    });
  }
  // One person re-submitted with an update — the newer answer should win
  const again = Object.assign({}, rows[2], {
    "Availability": "Fully available", "If partially available - what dates are you available?": "",
    "Submission ID": String(++id), "Updated": rows[2]["Updated"] + 6 * 3600e3, "Submitted": rows[2]["Submitted"] + 6 * 3600e3
  });
  rows.push(again);

  window.SAMPLE_SURVEY = rows;
})();
