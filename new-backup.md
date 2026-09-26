# PlateWatch backend plan

As of 25 September 2026. Replaces the AWS/DynamoDB draft (version 5, 24 September 2026).

**Decision:** PostgreSQL for the database, TypeScript on Node.js for the backend, hosted on DigitalOcean in Bangalore. Cloudflare handles file storage and protection. Login codes go out on WhatsApp, with SMS as a backup. Running cost is about $20–25 a month (roughly ₹1,800–2,200) before messaging, inside the ₹2,000 target.

## What PlateWatch is

A two-sided food-safety platform for Maharashtra. Today it is a frontend-only prototype: all data is sample data held in memory in `src/app/platewatch.js`, `src/app/bot.js` and `src/app/spotcheck.js`.

- **Diners:** search a map of restaurants and their FDA Maharashtra actions, follow places for alerts, and report problems through a WhatsApp chat bot.
- **Restaurants:** claim their listing, complete the 27-item checkup with photo evidence that expires, answer random weekly spot checks, and show a kitchen gallery and a QR poster.
- **Admins:** review evidence, moderate reports, set the rules for escalating to FDA, and review spot checks.

## Problems with the AWS plan

Its security ideas are good and carry over: presigned photo uploads with a file-signature check, a limit of 5 writes per user per day, hashed reporter IDs, and an append-only audit log. It has three problems.

1. **DynamoDB is a poor fit for this data.** The plan's own workarounds show it:
   - Search only matches the start of a name, so "bao" won't find "Bandra Bao Co.", and you can't search by area or licence number.
   - The map works at only one zoom level.
   - The escalation rules (weighted reports from different numbers within 7 days, editable by admins) are one SQL query but hard to do in DynamoDB.
2. **It leaves out what makes PlateWatch different.** WhatsApp reporting, escalations, spot checks and the checkup are all marked "out of scope".
3. **Too many moving parts for a small team.** Lambda, Cognito, SAM, CloudFront and WAF across two AWS regions.

## Stack

| Part | Choice | Cost per month |
|---|---|---|
| Database | PostgreSQL, DigitalOcean managed database, Bangalore (BLR1) | $15.15 |
| Backend and scheduled jobs | Node.js + TypeScript in one container on DigitalOcean App Platform, Bangalore | $5–10 |
| Frontend | Same App Platform app; website at `/`, backend at `/api`, so one domain and no CORS | $0 |
| Photos and documents | Cloudflare R2 (S3-compatible) | $0 up to 10 GB, no download fees |
| Attack protection and rate limiting | Cloudflare free plan in front of the domain (replaces CloudFront + WAF) | $0 |
| Login codes | WhatsApp authentication messages, with SMS backup via MSG91 | ₹0.136 per WhatsApp code, ₹0.16–0.25 per SMS |

Development costs nothing: Postgres runs locally in Docker.

### Database: why PostgreSQL

SQL is the query language. MySQL, SQLite and PostgreSQL are databases that all use it. The backend language is a separate choice.

- **PostgreSQL** is the right choice here.
  - Its PostGIS extension handles "restaurants in this map view" at any zoom level, plus "near me".
  - Its `pg_trgm` extension gives typo-tolerant search across name, area, city and licence, which is what the tracker and the bot's "type a name" step need.
  - Every managed host supports it. DigitalOcean supports PostGIS, `pg_trgm`, `pgcrypto`, `citext` and `pg_cron`.
- **SQLite** is not suitable. It is a single file on one server, and App Platform containers lose their disk on every redeploy. The website, the WhatsApp bot and scheduled jobs would also all write at the same time.
- **MySQL** would work but is weaker for this app. Its map support is less capable, it has no typo-tolerant trigram search, it has no partial indexes, and a failed schema change can't be rolled back.

### Backend language: why TypeScript

The frontend is already JavaScript, so the team works in one language, and the browser and server can share the same input-checking code.

- **Fastify** for the web server.
- **Drizzle** for database access and migrations.
- **zod** for checking input.
- **pg-boss** for scheduled jobs (spot checks, evidence expiry, escalation checks, WhatsApp sends). It stores jobs in Postgres, so no Redis is needed.
- **sharp** to resize photos and strip GPS location before storing them.

Build it as one codebase (a modular monolith), not dozens of separate Lambda functions.

### Hosting: why not the alternatives

- **Railway and Render:** no India region. The closest is Singapore, which adds delay for every user and stores phone numbers outside India.
- **Fly.io:** has a Mumbai region but charges 3× there, about $18 a month for a 1 GB machine.
- **Supabase:** good Postgres in Mumbai ($25 a month on Pro), but there is no cheap place to run the backend next to it.
- **AWS:** fine if you get startup credits (AWS Activate). This stack moves there unchanged (RDS Postgres + App Runner or ECS + S3 in Mumbai) because it is only Docker + Postgres + the S3 API. What matters is Postgres instead of DynamoDB, not leaving AWS.
- **DigitalOcean Spaces** (their file storage) is not offered in Bangalore, which is why files go to Cloudflare R2.

Phone numbers and reports stay in India because the database is in Bangalore. Photos on R2 are not guaranteed to be stored in India. If legal review requires that, switch to Amazon S3 in Mumbai with a configuration change; the code uses the same S3 API.

## Login and OTP

Build login in-house instead of using Cognito or Firebase. The website and the WhatsApp bot share one users table, because a number verified in the chat also signs the user in on the site.

- **WhatsApp first.** An authentication message costs ₹0.115 + 18% GST in India (Meta rate card effective 1 July 2026). It needs no DLT registration, and the bot needs a WhatsApp Business account anyway. The reporting chat itself is free, because the user messages first.
- **SMS backup through MSG91.** ₹0.25 per SMS, falling to ₹0.16 at volume. Needs DLT registration.
- **Rules:** 6 digits, 3 wrong tries, resend after 30 seconds (as the UI already shows), plus:
  - a 10-minute expiry;
  - only a hash of the code is stored;
  - limits on codes sent per phone number and per IP address;
  - a record of when the user accepted the consent text, for the DPDP Act 2023.
- **Sessions:** an opaque token in an httpOnly, Secure cookie, backed by a `sessions` table, so "sign out" and "delete my data" end the session.
- **Admins:** separate staff accounts with a password plus an authenticator-app code, and a role check on every admin route.

## What the backend must cover

| Module | Phase |
|---|---|
| Login, sessions, consent, account deletion | 1 |
| Restaurants, FDA actions, search, map | 1 |
| Follows and watched areas | 1 |
| Claims, the 27-item checkup, evidence with expiry, scores | 1 |
| Admin evidence review, report moderation, audit log | 1 |
| Blurring faces in photos (required by the README) | Before any photo is shown publicly |
| WhatsApp bot, reports, limits (1 per outlet per 7 days, 5 per day) | 2 |
| Alerts: report status updates, updates on followed places | 2 |
| Spot checks and pausing the verified badge | 2 |
| Escalation rules and the report packs sent to FDA | 2 |

## Start now (each takes weeks)

- [ ] DLT registration for SMS: entity, sender ID and OTP template.
- [ ] Meta business verification, a dedicated WhatsApp number and an approved authentication template.
- [ ] Legal review of publishing enforcement records about named businesses (defamation; DPDP Act 2023 for reporter data).

## Sources

- [DigitalOcean managed database pricing](https://www.digitalocean.com/pricing/managed-databases)
- [DigitalOcean App Platform pricing](https://www.digitalocean.com/pricing/app-platform)
- [DigitalOcean regional availability](https://docs.digitalocean.com/platform/regional-availability/)
- [DigitalOcean PostgreSQL extensions](https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase regions](https://supabase.com/docs/guides/platform/regions)
- [Fly.io regions](https://docs.fly.io/reference/regions/)
- [Fly.io pricing](https://docs.fly.io/about/pricing/)
- [Railway regions](https://docs.railway.com/reference/deployment-regions)
- [Render regions](https://render.com/docs/regions)
- [WhatsApp Business Platform pricing (Meta)](https://developers.facebook.com/docs/whatsapp/pricing)
- [WhatsApp API pricing in India, INR rate card](https://whautomate.com/whatsapp-business-api-pricing-india)
- [MSG91 SMS pricing](https://msg91.com/in/pricing)
