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
| Report a problem | `src/markup/report.html` |
| How it works (interactive demo) | `src/markup/how-it-works.html` |
| About | `src/markup/about.html` |
| Phone + OTP login, account | `src/markup/login.html`, `account.html` |
| Restaurant claim, dashboard, QR code | `src/markup/restaurants.html`, `dashboard.html` |
| Admin review queue | `src/markup/admin.html` |
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

## Next steps toward production
1. Replace in-memory data with a backend (restaurants, regulatory_records, requirements, assessment_responses, evidence, verification_requests, community_reports, restaurant_responses, notifications, audit_log).
2. Real OTP via an SMS provider (DLT registration required in India).
3. File storage for evidence uploads, plus a vision model for the AI-assisted observations (currently canned).
4. Staff authentication for the admin panel.
5. Port pages to React components incrementally, one page at a time, keeping this build as the visual reference.
