# PlateWatch

**Know before you eat.** A prototype of a food-safety intelligence platform: search a restaurant and see its official regulatory record, restaurant-submitted evidence, platform verification and moderated community reports, each labelled separately.

> **Prototype.** Every business, licence number, report and statistic is fictional sample data held in memory. It resets on reload. OTP codes are simulated and shown on screen.

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev      # opens http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the production build
```

## What's inside

| Area | Where |
|---|---|
| Homepage (hero, stats, ticker, sections) | `src/markup/home.html` |
| Tracker search and results | `src/markup/tracker.html` |
| Public restaurant profile | `src/markup/profile.html` |
| Report a problem (WhatsApp entry) | `src/markup/report.html`, chat in `src/markup/bot.html`, logic in `src/app/bot.js` |
| How it works (interactive demo) | `src/markup/how-it-works.html` |
| About | `src/markup/about.html` |
| Phone + OTP login, account | `src/markup/login.html`, `account.html` |
| Restaurant claim, dashboard, QR code | `src/markup/restaurants.html`, `dashboard.html` |
| Admin review queue | `src/markup/admin.html` |
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
- `D`: sample restaurants and their FDA action history.
- `REQS` / `CATS`: the 27-requirement food-safety checkup, weights, critical flags and evidence expiry.
- `scoreOf(rid)`: weighted requirements met ÷ weighted applicable × 100. Only "yes" answers backed by current, non-rejected evidence count; critical failures are flagged separately.
- `PROF`, `REPORTS`: restaurant profiles, evidence and community reports.
- `go(page, arg)`: page switching.

## Flow changes

User-flow fixes on top of the prototype (logic in `platewatch.js`, styles in `src/styles/flow-fixes.css`):

1. **Profile summary line.** Every profile opens with one plain sentence built from the latest official action (FDA Maharashtra), next to its status pill.
2. **Score paused during an official action.** While a suspension, revocation or improvement notice is open, the public score (profile, homepage previews, QR poster, how-it-works demo) is replaced with "Score paused while an official action is open" and a "Why?" toggle. Owners still see their number, labelled "Paused publicly"; admin live checks add "(paused publicly)".
3. **Instant search.** Home and tracker search suggest up to 6 matches (combobox/listbox, Up/Down/Enter/Esc). No-results state offers "Report a problem" (pre-filled) and "Tell us this place exists". Tracker shows a coverage note.
4. **Share on WhatsApp.** A real `wa.me` link (new tab) with the summary sentence and profile URL, plus a "Copy link" fallback.
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
2. Verify the number (first time only) with a demo code. A number verified in the chat signs you in on the site, and a site login skips this step. Sample number 98765 43210 is "verified in June" so its reports count in full.
3. Which place (skipped when opened from a profile): share location (3 nearby sample outlets), send a bill photo (matched to a sample outlet), or type a name (fuzzy match, top 3, or Not listed → name + area).
4. What did you see: Pests · Stale or spoiled food · Hygiene · Fell ill · Other.
5. Evidence: photo, video or bill, or Skip. "Fell ill" also asks for a doctor's note from the last 72 hours.
6. One optional line (500 characters max).
7. Confirm: an auto-filled summary card, then "Yes, send" or "Keep private".
8. Receipt `PW-xxxx`, with Copy for FSSAI and Done.

Guardrails: one report per number per outlet per 7 days, 5 reports per number per day. Reports without a photo, video or bill are saved but never go to the regulator. "Keep private" reports are used only to spot patterns. Each number keeps its own thread, so status updates arrive as new bot messages.

**Report statuses (reporter-facing, in the chat and Account → My reports)**
Awaiting moderation → Accepted → Restaurant notified → Sent to FDA Maharashtra (date) → Official action taken, or Couldn't be used: reason.

Moderators (Admin → Community reports) can Accept, Reject with reason, Ask the reporter for more, or Mark as coordinated. Each report shows its evidence count, how long ago the number was verified, and whether it counts toward escalation. The restaurant owner sees a report only after it is accepted and the reporter chose "Yes, send". When the owner responds, the reporter is told in the chat.

**Default escalation rules** (Admin → Escalation rules, all editable). Only accepted reports with a photo, video or bill, shared with consent, from different numbers count. Weight 1.0, or 0.5 for numbers verified under 7 days ago; private or evidence-free reports count 0.
- **Standard:** weighted count ≥ 4 within 7 days → escalate to FDA Maharashtra.
- **Fast lane:** ≥ 5 reports within 48 hours → "Urgent" in Admin → Escalations. Escalated only after a moderator clicks "Confirm not coordinated"; "Possible coordinated reports" shows when more than half come from new numbers.
- **Illness:** a "Fell ill" report with a bill and a doctor's note escalates on its own; otherwise two independent illness reports within 14 days.
- **Cooldown:** 60 days, unless new qualifying reports arrive after the last escalation.

Admin → Escalations lists each escalation (outlet, licence, report IDs, rule, authority, date) with a preview of the email packet (reporter identities withheld; "Demo — not emailed."). Reporters are told when their report is sent, and again when the tracker shows a new official action on that outlet. A demo button records a sample action so this can be seen.

Seeds: Coastal Tiffin Centre is one accepted report short of the standard rule; Spice Route Kitchen is one report short of the fast lane, with mostly new numbers.

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

Seeds: Green Leaf Dhaba has 8 approved sample photos (generated SVG placeholders labelled "Sample photo") across 4 areas, 2 of them from a spot check 10 days ago, plus a missed spot check 3 weeks ago. Its storage evidence is 25 days old, so "Do these next" shows items expiring in 5 days.

## Next steps toward production
1. Replace in-memory data with a backend (restaurants, regulatory_records, requirements, assessment_responses, evidence, verification_requests, community_reports, restaurant_responses, notifications, audit_log).
2. Real OTP via an SMS provider (DLT registration required in India).
3. File storage for evidence uploads, plus a vision model for the AI-assisted observations (currently canned).
4. Staff authentication for the admin panel.
5. Port pages to React components incrementally, one page at a time, keeping this build as the visual reference.
