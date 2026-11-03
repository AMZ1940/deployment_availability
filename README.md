# Deployment Availability: Team Development

This page loads deployment-survey results from a secured ArcGIS table and helps team development decide who can deploy, and in which position. It uses the same ArcGIS sign-in as the county profile site, with the same OAuth client ID.

**Suggested repo:** `deployment_availability`, published at `https://amz1940.github.io/deployment_availability/`

## What it does
| Tab | Purpose |
|---|---|
| **Position summary** | The Excel "position gap review" for all 14 positions. Each row shows how many qualified people are available, split into in-state only and EMAC/in-state, then into full, partial, or not stated. Totals with no one available show in red. Click a position to see each person's affiliation, availability, dates, restrictions, agency approval, response length and contact information. Trainees and trained-in candidates are listed separately. |
| **Charts** | Qualified personnel by position, broken out by team affiliation, plus available personnel by affiliation. You can filter by deployment type (in-state or EMAC) and by availability. The East / Middle / West / Not stated chips at the top filter every tab. |
| **Team org chart** | Each box has a drop-down of people who are available for that position. Once you pick someone, they drop out of the counts, the charts, and every other team's drop-downs. Use **+ Add team** to build a second or third team. Set a team to **EMAC** and its drop-downs show only people willing to deploy through EMAC. |

**Exports for leadership briefings:**
- **Download PNG** on the summary table, on each chart, and on the org chart.
- **Briefing PDF** (top bar): one PDF with the summary table, both charts, and one org-chart page per team.
- **Roster (CSV)**: every team with its positions, names and contact details.

## Files
| File | What it does |
|---|---|
| `index.html` | Page layout |
| `styles.css` | Styling |
| `app.js` | Sign-in, data loading, counts, charts, org chart and exports. `CLIENT_ID`, `PORTAL_URL` and `LAYER_URL` are at the top. |
| `oauth-callback.html` | Finishes sign-in when the page is embedded in Experience Builder |
| `sample-data.js` | Fictional demo responses, used only by **Settings → Load demo data** |

## One-time setup

### 1. Put the survey results in ArcGIS
- **Survey123:** the survey already has a hosted feature layer, so use it as is.
- **Other form tools:** export the results to CSV or Excel. In ArcGIS Online, go to **Content → New item**, upload the file, and choose **Create a hosted table**. Keep the column headers exactly as they are in the export.
- **Sharing:** share the layer or table with your organization or a group. **Don't make it public.** It contains names, phone numbers and email addresses. The page reads it with the signed-in user's own token, so nothing personal is stored on GitHub.
- **Get the URL:** open the item, copy its **URL** (it ends in `/FeatureServer`), and add the layer number, usually `/FeatureServer/0`.

To refresh the data for a new survey round, either append the new rows or overwrite the hosted table. Then click **Refresh data** on the page.

### 2. Add the redirect URLs
Open the OAuth 2.0 credentials item with client ID `w9VaoRCHch2gIU1d`, go to **Settings → Redirect URLs**, and add these three URLs (the county profile URLs stay as they are):
- `https://amz1940.github.io/deployment_availability/`
- `https://amz1940.github.io/deployment_availability/index.html`
- `https://amz1940.github.io/deployment_availability/oauth-callback.html`

### 3. Connect the table
Choose one of these:
- Paste the layer URL into `LAYER_URL` at the top of `app.js`. Everyone then gets it automatically.
- Or, after signing in, click **Settings**, paste the URL and choose **Save and load**. This is saved only in that browser.

**Settings** also shows how each survey question was matched to a field. Matching uses the field aliases, which keep the original column headers. If a question shows "not found", set it under `FIELDS` in `app.js`, for example `FIELDS: { qualified: "QUALIFIED_PERSONNEL_ONLY" }`.

### 4. Publish to GitHub Pages
1. Upload all the files to the root of the repo.
2. Go to **Settings → Pages**, choose **Deploy from a branch**, and select `main` / root.

To embed the page in Experience Builder, use the Embed widget, as with the county profiles. Inside the widget, sign-in opens in a pop-up window.

## How responses are read
- **Availability.** Answers containing "full" count as **Full**, answers containing "partial" count as **Partial**, and blank answers count as **Not stated**. Answers such as "not available" or "no" are left out of the counts. The **Available** tile shows how many were left out.
- **In-state and EMAC.** Any answer that mentions EMAC counts as **EMAC / in-state**. Everything else counts as **in-state only**, and that includes blank answers.
- **Qualified position.** Matched by code or by name, so `ICT3-AH - Incident Commander`, `ICT3_AH` and `Incident Commander` all count as IC/TL. You can list several positions separated by commas. Any answers that don't match a position are listed under Settings and below the summary table.
- **Duplicate submissions.** If someone submits more than once for the same incident, only their latest response counts. People are matched by email first, then by submitter ID, then by name.
- **Incident.** The **Incident** drop-down separates survey rounds by the *Incident Description* answer. It opens on the most recent incident.
- **Not on the page:** submitter IP, browser (user agent), and the `Custom` field.

## Notes
- **Saved team selections.** Team selections are saved in the browser of the person building the teams. They're stored separately for each incident and survive a page reload or a data refresh. Other people don't see them. To share the result, use **Briefing PDF** or **Roster (CSV)**. If several people need to build teams together at the same time, the selections would need to be written to an editable ArcGIS table instead.
- **Totals row.** As in the Excel version, the totals row counts a person once for each position they're qualified in. The **Still available** tile counts unique people.
- **Local preview:** run `python3 -m http.server` in this folder and open `http://localhost:8000/?preview`. This loads demo data and skips sign-in. It works only on localhost.
