# PlateWatch

**Know before you eat.** A prototype of a food-safety intelligence platform: search a restaurant and see its official regulatory record, restaurant-submitted evidence, platform verification and moderated community reports, each labelled separately.

> **Prototype.** Every business, licence number and statistic is fictional sample data, loaded into the database by `npm run db:seed` in `server/`. The whole site reads the real API: restaurants, the map, search, profiles, homepage numbers, login, accounts, claims, the restaurant dashboard, reports and admin. Only the homepage illustration cards and the How-it-works demo use fixed sample records, and spot checks and escalations are not built on the server yet.

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev      # opens http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the production build
```

Logging in, following places and claiming a restaurant need the API running too (`server/README.md` has the one-time setup):

```bash
cd server && npm run db:up && npm run dev   # API on http://localhost:3000; the site proxies /api to it
```

In development the API has no SMS or WhatsApp account, so each login code is printed in the API's terminal (`OTP for +91…: 123456`). Real delivery starts once WhatsApp and MSG91 keys are set. Without the API, browsing still works and login says it can't reach PlateWatch.

## What's inside

| Area | Where |
|---|---|
| Homepage (hero, stats, ticker, sections) | `src/markup/home.html` |
| Tracker (map-first: search, filters, map, results panel) | `src/markup/tracker.html`, logic in `src/app/map.js` |
| Public restaurant profile | `src/markup/profile.html` |
| Report a problem (WhatsApp entry) | `src/markup/report.html`, chat in `src/markup/bot.html`, logic in `src/app/bot.js` |
| How it works (interactive demo) | `src/markup/how-it-works.html` |
| About | `src/markup/about.html` |
| Phone + OTP login, account | `src/markup/login.html`, `account.html` |
| Restaurant claim, dashboard, QR code | `src/markup/restaurants.html`, `dashboard.html` |
| Admin review queue (staff only: signed-out visitors are sent to login, other accounts to the homepage; links show only for admins) | `src/markup/admin.html` |
| Spot checks, kitchen gallery | `src/app/spotcheck.js`, `src/markup/spotcheck.html` |
| Nav, disclaimer, footer | `src/markup/shell.html`, `footer.html` |
| All behaviour (routing, data, scoring, demo) | `src/app/platewatch.js` |
| Styles, in cascade order | `src/styles/` (imported by `index.css`) |
| Brand food image (single source, CSS `--hero`) | `src/assets/platewatch-food-hero.webp` |
| Logo mark | `src/assets/platewatch-logo-mark.webp` |

## How it's built

React renders the page markup once (`src/App.jsx`), then `initApp()` in `src/app/platewatch.js` wires up all behaviour against that DOM. This keeps the UI and interactions identical to the prototype. Pages switch by showing and hiding sections, so there is no router library.

Notes:
- `StrictMode` is intentionally off, because its dev-only double mount would initialise the app twice.
- External, loaded in `index.html`: Google Fonts (Geist, Geist Mono, Outfit, Caveat) and `qrcodejs` 1.0.0 from cdnjs for the restaurant QR poster. Offline, fonts fall back and the QR preview shows "QR preview unavailable".

### Key logic in `platewatch.js`
- `api.js`: every call to the backend, with plain-sentence errors. `PLACES` / `remember()` cache the restaurants the site has already fetched.
- `SAMPLE`, `PROF[DEMO]`, `SAMPLE_REPORT`: fixed fictional records for the homepage illustrations and How it works only.
- `REQS` / `CATS`: the 27-requirement food-safety checkup, weights, critical flags and evidence expiry.
- `scoreOf(rid)`: weighted requirements met ÷ weighted applicable × 100. Only "yes" answers backed by current, non-rejected evidence count; critical failures are flagged separately.
- `PROF[rid]`: the signed-in owner's checkup, loaded from the API for the dashboard. `REPORTS`: chat reports sent in this visit.
- `go(page, arg)`: page switching.

## Flow changes

User-flow fixes on top of the prototype (logic in `platewatch.js`, styles in `src/styles/flow-fixes.css`):

1. **Profile summary line.** Every profile opens with one plain sentence built from the latest official action (FDA Maharashtra), next to its status pill.
2. **Compliance score paused during an official action.** While a suspension, revocation or improvement notice is open, the public compliance score (profile, homepage previews, QR poster, how-it-works demo) is replaced with "Compliance score paused while an official action is open" and a "Why?" toggle. Owners still see their number, labelled "Paused publicly"; admin live checks add "(paused publicly)".
3. **Instant search.** Home and tracker search suggest up to 6 matches (combobox/listbox, Up/Down/Enter/Esc). No-results state offers "Report a problem" (pre-filled) and "Tell us this place exists". Tracker shows a coverage note.
4. **Report and Copy link.** The profile's "Share on WhatsApp" button was replaced by **Report** (hidden for the restaurant's own owners). It opens the "Write your Remark" form (`src/app/remark.js`): what went wrong, a remark of up to 1000 characters, and two photos taken with the live camera, the **bill** and the **food** (no gallery upload). Signed-out visitors log in first and come back to the open form. If a limit already applies, the form says so before anything is typed. "Copy link" stays.
5. **Reporting.** Replaced by WhatsApp reporting (see below).
6. **Shorter login.** Two screens (number + consent, then OTP). Name and WhatsApp alerts are edited on the account page; login returns the user to where they started (following a place, or the account page).
7. **Navigation.** Every page has a `#hash` (`#home`, `#tracker`, `#profile-3`, `#report`, `#account`, `#about`, `#how-it-works`, `#restaurants`, `#dashboard`, `#admin`, `#login`), so browser back/forward and deep links work. Profile "Back" returns to the page the user came from.
8. **Next best actions.** The dashboard overview and checkup show "Do these next" (critical first, then weight, then expired evidence), overall progress, and a progress bar per checkup category.

Decisions:
- **"Get started" button:** removed (the default). Search is the starting point, and "Log in" now also shows on phones.
- **WhatsApp links** (share, "Open in WhatsApp"): always a real `<a href="https://wa.me/…" target="_blank" rel="noopener">`, never `window.open()`. Inside a hosted artifact viewer the new tab may be blocked, so "Copy link" and the simulated chat are the fallbacks.

## WhatsApp reporting

Reporting is WhatsApp-first. A real bot needs the WhatsApp Business API and a backend, so the site runs the same script in a **simulated chat** (`src/app/bot.js`, `src/markup/bot.html`, `src/styles/bot.css`). "Open in WhatsApp" on the Report page is a real link to a placeholder number (`wa.me/910000000000?text=REPORT`, live number coming soon). Demo only: nothing is sent.

Entry points: the Report page, every profile, search no-results ("Report a problem", which pre-fills the typed name as an unlisted place) and the homepage community section. The chat is a right-side panel on desktop and full-screen on phones; Esc or × closes it.

**Bot steps**
1. Greeting.
2. Verify the number (first time only) with a real code from the API. A number verified in the chat signs you in on the site, and a site login skips this step.
3. Which place (skipped when opened from a profile): share location (the three closest listed places, from the API), send a bill photo (kept as evidence; the name is then typed), or type a name (the API's typo-tolerant search, top 3, or Not listed → name + area).
4. What did you see: Pests · Stale or spoiled food · Hygiene · Fell ill · Other.
5. Evidence: photo, video or bill, or Skip. "Fell ill" also asks for a doctor's note from the last 72 hours.
6. One optional line (500 characters max).
7. Confirm: an auto-filled summary card, then "Yes, send" or "Keep private".
8. Receipt `PW-xxxx`, with Copy for FSSAI and Done.

**Reporting on the site.** Every "Report" and "Write a report" button (profile, Report page, homepage, My alerts, search with no results) opens the "Write your Remark" form. Without a restaurant it first asks which one: search, or name an unlisted place with its area.

**How a report travels.** A diner sends it → PlateWatch checks it within 24 hours (Admin → Community reports) → if accepted and the diner agreed to share it, it appears in the restaurant's dashboard (Reports tab) and on the public profile for 2 weeks, in full, with "Reported 3 days ago". The bill photo stays private. The owner can **Mark as resolved** with a comment and proof (a live camera photo or a PDF). PlateWatch checks that proof within 24 hours; once approved it shows under the report as "Restaurant took action". Rejected or false reports never appear.

**Two tabs, two logins.** The restaurant dashboard always opens in its own browser tab ("For restaurants", "Restaurant owner login"), marked by a black "Restaurant owner tab" bar. It has its own login, so someone can be signed in as a user in one tab and as an owner in the other. Report buttons in the owner tab open the user site in a new tab.

**Restaurant checkup schedule.** Owners upload new photos every 2 weeks for kitchen hygiene, food storage and cleaning; every week for personal hygiene; every month for operational safety; and a PDF every 6 months for pest control. Late items stop counting, the score drops, and the public profile shows "Evidence overdue" with the date it was due. Each upload has a **Remove** button for wrong files. Reviewers check uploads within 24 hours. Approved photos stay in the public Kitchen gallery for 30 days. Photos are deleted after 4 months and PDFs after 2 years.

Every report, from the chat or the profile form, waits for a moderator, who checks it within 24 hours (Admin → Community reports shows the deadline). A report marked **false report** is removed and counts against the reporter. After 2 false reports in 7 days, the admin is offered a ban; bans are only ever made by an admin, and can be lifted under Admin → Banned accounts. A banned number is signed out, can't log in, and is told to write to grievance@platewatch.in.

Guardrails, per person: one report a day (`REPORTS_PER_DAY`), five in any 7 days (`REPORTS_PER_WEEK`), and one about the same restaurant per 7 days. Owners can't report a restaurant they manage. Reports without a photo, video or bill are saved but never go to the regulator. "Keep private" reports are used only to spot patterns. Each number keeps its own thread, so status updates arrive as new bot messages.

**Report statuses (reporter-facing, in the chat and Account → My reports)**
Awaiting moderation → Accepted → Restaurant notified → Sent to FDA Maharashtra (date) → Official action taken, or Couldn't be used: reason.

Moderators (Admin → Community reports) can Accept, Reject with reason, Ask the reporter for more, or Mark as coordinated. Each report shows its evidence count, how long ago the number was verified, and whether it counts toward escalation. The restaurant owner sees a report only after it is accepted and the reporter chose "Yes, send". When the owner responds, the reporter is told in the chat.

**Default escalation rules** (Admin → Escalation rules, all editable). Only accepted reports with a photo, video or bill, shared with consent, from different numbers count. Weight 1.0, or 0.5 for numbers verified under 7 days ago; private or evidence-free reports count 0.
- **Standard:** weighted count ≥ 4 within 7 days → escalate to FDA Maharashtra.
- **Fast lane:** ≥ 5 reports within 48 hours → "Urgent" in Admin → Escalations. Escalated only after a moderator clicks "Confirm not coordinated"; "Possible coordinated reports" shows when more than half come from new numbers.
- **Illness:** a "Fell ill" report with a bill and a doctor's note escalates on its own; otherwise two independent illness reports within 14 days.
- **Cooldown:** 60 days, unless new qualifying reports arrive after the last escalation.

Admin → Escalations lists each escalation (outlet, licence, report IDs, rule, authority, date) with a preview of the email packet (reporter identities withheld; "Demo — not emailed."). Reporters are told when their report is sent, and again when the tracker shows a new official action on that outlet. A demo button records a sample action so this can be seen.

Escalations run only in the browser for now; the server module is not built, and the admin page marks it "Soon".

## Spot checks and gallery

Logic in `src/app/spotcheck.js`, lightbox markup in `src/markup/spotcheck.html`, styles in `src/styles/spotcheck.css`.

**Refresh schedule.** Evidence expires per category: kitchen, storage, cleaning and operations after 30 days; personal hygiene 60; pest control 90; documents 365. All are editable in Admin → Evidence expiry. The dashboard's "Do these next" card also lists items expiring within 7 days ("Expires in X days"). We don't ask for all 27 items every week: owners would abandon it, and a fixed weekly checklist is easy to stage.

**Weekly spot check.** Each claimed restaurant gets one spot check a week at a random time between 10:00 and 21:00. It is delivered through the WhatsApp bot chat:
- It asks for 2–3 random checkup items. Critical items are twice as likely, and an item is never repeated from the previous check.
- Message: "Spot check: show us your [items]. Write this code on paper and keep it visible in every photo: PW-XXXX. You have 2 hours." The 4-digit code is unique per check.
- The owner answers in the chat or from the dashboard "Spot check due" banner, which has a countdown. Uploads use `accept="image/*" capture="environment"`, so phones open the camera. Each photo gets an AI-assisted observation line, including "Code PW-XXXX visible: needs reviewer confirmation".
- Statuses: Due → Answered (on time) → Approved / Rejected, or Missed (no answer within 2 hours), or Late (answered after the deadline; counts as missed for the badge).
- Approved photos become fresh evidence for those items, which resets their expiry.
- A missed check shows "Missed spot check on [date]" on the public profile. Two misses in a row pause the badge ("Verification paused: missed spot checks") until a spot check is answered on time and approved.
- Admin → Spot checks lists every check (restaurant, items, code, sent, due, status, photos) with Approve / Reject with reason / Flag "code not visible". Demo controls: "Send spot check now" per restaurant, and "Skip 2 hours", which moves the shared demo clock forward.

**Kitchen gallery** (public profile, restaurant-submitted section). Shows only reviewer-approved photos; rejected and pending photos never appear. Photos are grouped by the 7 checkup areas, latest first, each tagged "Spot check" (solid black) or "Checkup" with its date. A per-area "History" toggle shows older photos. Clicking a photo opens a lightbox: arrows or ← → to move, Esc to close, keyboard accessible. With no approved photos it shows "No kitchen photos yet." The owner's dashboard shows the same gallery under "What diners see".

**Faces.** Photos have a `people` flag. In the prototype, flagged photos get a CSS blur over a fixed demo region and a "Faces blurred" note. **Production must run real face detection and blurring on the server before any photo is published.** The CSS blur here is only a visual placeholder and hides nothing in the actual image file.

Spot checks are not built on the server yet: none are sent, and the owner dashboard says they are coming. The public kitchen gallery shows reviewer-approved photos from the API only when `PUBLIC_GALLERY` is on in `server/.env`.

## Map and badges

Logic in `src/app/map.js` (Leaflet in `src/app/leaflet-global.js`), styles in `src/styles/map.css`. Packages: `leaflet`, `leaflet.markercluster`. They are loaded only when the map first opens, so other pages stay light.

**Two signals, never mixed.**
- **Dot colour = official regulatory status only**, from the latest official action: red = suspended or revoked, amber = improvement notice open, green = reinstated after an action, grey (#9D9A92) = no official action on record. Legend: "Red: suspended or revoked · Amber: improvement notice · Green: reinstated after an action · Grey: no official action on record (not a safety rating)". A compliance score or badge never changes a dot. Every dot has a visually hidden "Status: …" label, and status pills keep their text, so colour is never the only signal.
- **Badge = PlateWatch verification level only**:
  - "Not claimed yet": the owner hasn't joined. Neutral grey text, not a warning.
  - "Claimed · self-reported": claimed, but not reviewed or not all passing.
  - "PlateWatch verified": every applicable checkup requirement has current, approved evidence, there's no unreviewed evidence, and there's no run of missed spot checks. Solid black with the diamond mark.
  If a verified restaurant misses two spot checks in a row, adds unreviewed evidence, or lets evidence expire, it shows "Claimed · self-reported" with "PlateWatch verification paused: [reason]" on the profile. An open official action doesn't remove the badge; the compliance score stays paused publicly. The labels never say a bare "Verified", so nothing reads as government-verified.

Dots appear in search suggestions, map cards and pins, and the profile header. Badges appear in suggestions, map cards, the profile header and the table-QR poster.

**Map-first Tracker.** `#tracker` opens the map directly (old `#tracker-map` links redirect to `#tracker`); there is no separate list view.
- **Layout:** the search bar, city and sort dropdowns, and the two filter rows (Official status, PlateWatch verification) sit above the map, followed by the legend and coverage notes.
- **Results panel:** the accessible list. On desktop it's a 380px panel on the left of the map; on phones, a bottom sheet you drag between collapsed ("N results · drag up"), half and full. It lists cards matching the search and filters inside the visible map area (not counting the part the panel covers), sorted by the sort dropdown. "All results" ignores the map bounds, so a search never misses anything. Restaurants without coordinates show "Location pending" there.
- **Cards and pins:** each card is a link. Enter opens the profile; a mouse click flies the map to the pin and opens its popup; "Open profile →" opens the profile. Hovering a card highlights its pin, and clicking a pin highlights and scrolls to its card.
- **Search on the map:** typing filters pins and cards live. Enter or picking a suggestion flies to the best match; an area or city name (e.g. "Andheri") fits the map to every match there.
- **Accessibility:** a visually hidden "Skip map, go to results" link comes before the map.
- **Pins and clusters:** pins are status-coloured dots with a white border, plus a small black diamond for PlateWatch verified. Clusters show a count, coloured by the most serious status inside (red > amber > green > grey).
- **Near me** uses browser geolocation. If it's denied or unavailable it shows "Location unavailable — search an area instead." and nothing else breaks.
- The initial view is Mumbai (19.0760, 72.8777) at zoom 11. Pins come from the API for the area on screen (`GET /api/restaurants?bbox=…`) and reload as the map moves; pins that stay in view keep their open popup.

Tiles come from the public OpenStreetMap tile server, with attribution shown in the map corner. That's fine for a prototype, but production traffic must use a tile provider or self-hosted tiles, per the OpenStreetMap tile usage policy.

Sample data (in the development database): every sample restaurant has plausible coordinates except Temple Road Prasad Stall (Shirdi), left without one to show "Location pending". There are also 20 extra fictional Mumbai places with no official action. A production database starts without them (`npm run db:seed -- --catalog-only`).

## Logins, the checkup and the kitchen gallery

- **Two logins.** "Log in" is for diners: follow places, watch areas, report. "Restaurant owner login" (For restaurants page, or `#owner-login`) goes to the owner's dashboard, or to finding and claiming their restaurant. Both use a one-time code; one phone number can be both.
- **The checkup.** Owners answer 27 food and kitchen hygiene questions and prove each "Yes". Kitchen, storage, personal hygiene, cleaning and operations take a photo from the **live camera** (`src/app/camera.js`: no picking from the gallery). Pest control and documentation take a **PDF** only. The server enforces both, whatever the browser sends. Reviewers approve or reject each file in Admin → Evidence.
- **Kitchen gallery.** Approved photos appear on the restaurant's public page, grouped by checkup area. Photos a reviewer marks as showing people are never shown, until faces can be blurred automatically. Turn the gallery off with `PUBLIC_GALLERY=false`.

## Restaurant data: OpenStreetMap and FSSAI licences

- **OpenStreetMap import** (names, types, locations): `npm run import:osm -- --bbox minLng,minLat,maxLng,maxLat --city Mumbai [--area Fort] [--dry-run]` in `server/`. Re-running updates the same places; a restaurant staff edited is never overwritten. Pages credit "© OpenStreetMap contributors", as the ODbL licence requires.
- **FSSAI licence checks.** OSM has no licence numbers: owners add theirs when they claim, or staff add one in Admin → Official record. FSSAI's FoSCoS search has a captcha, so it isn't scraped: staff open FoSCoS, look the licence up, and record Active, Inactive or Not found in Admin → Licence checks (repeated every 90 days). Profiles show the result with its date, and the tracker filters by it.
- **Improvement notices and closures** are FDA Maharashtra actions, recorded with their source in Admin → Official record. FoSCoS only shows whether a licence is active.

## Backend

The API lives in `server/` (Node.js, TypeScript, PostgreSQL with PostGIS). Setup, endpoints, rules and deployment are in `server/README.md`; the choice of stack is explained in `new-backup.md`. The whole site reads it (restaurants, map, search, profiles, homepage numbers, login, account, claims, dashboard, reports, admin); `npm run dev` proxies `/api` to it on port 3000.

## Next steps toward production
1. Enter real restaurants and FDA actions through Admin → Official record (one area first), then an import script for FDA Maharashtra notices with staff review, after legal review.
2. Real OTP delivery: an approved WhatsApp authentication template and MSG91 SMS (DLT registration required in India). The code is written; it needs the accounts and keys.
3. File storage for evidence uploads, plus a vision model for the AI-assisted observations (currently canned).
4. Stronger staff sign-in for the admin page (password + authenticator app). Today it's an OTP account with the admin role, granted with `npm run admin:grant` in `server/`.
5. Port pages to React components incrementally, one page at a time, keeping this build as the visual reference.
