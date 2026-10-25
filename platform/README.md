# GREEN PLUG EV — charging platform

EV charging discovery, slot booking and station-partner management, in one app with three workspaces:

- **EV Driver** — search and filter stations (connector, AC/DC, power, price, access, open now, compatibility), interactive map,
  station details and directions, slot booking with a transparent estimate, TEST-mode payment, booking history,
  cancellation and receipts, favourites, trip planning with charging stops, vehicles, notifications, support and safety.
- **Station Partner** — registration with ownership/operating-authority references, station registration (coordinates, photos,
  amenities, connectors, AC/DC, kW, ₹/kWh, hours, slot length, public/private/home access, operating status), submission →
  admin approval → publication, booking calendar with code check-in, session start/complete with energy records,
  revenue/commission/payout breakdown, CSV statements and support.
- **Admin** — partner and station approvals, bookings and refunds, commission settings, ledger and webhook log,
  payout statements, support cases and audit log.

A persistent **SWITCH MODE** control (top bar on desktop, under the header on mobile) moves between workspaces. The client
asks `POST /api/me/workspace`; the server answers from the account's real roles and partner status, and every partner and
admin endpoint re-checks role and ownership independently. Unsaved forms are kept as drafts (sessionStorage), and an active
booking stays visible in every mode.

The marketing website in the repository root is unchanged; the app reuses its design tokens, logo, theme switch, pointer
effects and GSAP, served at `/app/`.

## Stack

| Part | Choice |
|---|---|
| API | Node 22 + TypeScript on `node:http` (small router, no framework), bundled with esbuild |
| Database | PostgreSQL 14+ via `postgres` (parameterised tagged templates only), SQL migrations in `database/migrations` |
| Web | React 19 + TypeScript, bundled with esbuild; the site's CSS tokens/components + `web/src/styles/app.css` |
| Tests | `node:test` API suites; Playwright end-to-end workflow through the real UI |

Key safety properties: scrypt password hashes; opaque HttpOnly session cookie (only its hash is stored); CSRF header +
same-origin check; per-IP rate limits; strict CSP; integer-paise money with a balanced double-entry ledger (enforced by a
deferred constraint trigger); a GiST **exclusion constraint** plus a connector row lock against double booking;
`Idempotency-Key` on booking creation; signature-verified, de-duplicated payment webhooks; audit log of denials.

## Run locally

Requirements: Node 22+, PostgreSQL 14+ (`btree_gist` and `citext` extensions, included in standard packages).

```bash
cd platform
npm install                       # react, react-dom, gsap, postgres; esbuild, typescript, playwright (dev)
cp .env.example .env              # optional: defaults already point at a local database
export DATABASE_URL=postgres://postgres:<password>@127.0.0.1:5432/gpev_dev
npm run db:setup                  # creates the database, runs migrations, loads demo seed data
npm run build                     # API + web app into dist/
npm start                         # http://localhost:8080/app/   (or: node --env-file=.env dist/server.mjs)
npm run dev                       # rebuild-on-change for web and API
```

`npm run db:reset` drops and recreates the schema with fresh seed data.

### Demo accounts (seeded, local only)

| Role | Email | Password |
|---|---|---|
| EV Driver (with a saved vehicle) | asha@greenplug.test | DriverDemo2026 |
| EV Driver | ravi@greenplug.test | DriverDemo2026 |
| Station Partner, approved (VizagVolt, 8 stations) | partner@greenplug.test | PartnerDemo2026 |
| Second approved partner (Coastal Charge, incl. home + private chargers) | coastal@greenplug.test | PartnerDemo2026 |
| Partner applicant, pending | applicant@greenplug.test | DriverDemo2026 |
| Administrator | admin@greenplug.test | AdminDemo2026 |

Override with `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD`. The 11 seeded stations are marked **demo** with simulated
availability. Verification codes appear in the in-app **Demo inbox** (sign-up / Profile).

## Tests

```bash
npm run typecheck                 # server + web, strict TypeScript
npm test                          # 33 API tests against a fresh gpev_test database
npm run test:e2e                  # production build + 31-step browser workflow against a fresh gpev_e2e database
NODE_ENV=production node scripts/build.mjs   # production bundle
```

The e2e run writes screenshots and `results.json` to `tests/e2e/artifacts/`. It covers the specification's acceptance list:
registration and email verification; switch mode; partner access denied before approval (UI + 403 from the API);
partner registration → admin approval; station registration → admin approval → publication; search and filters;
estimate at the configured rate (10 kWh × ₹18 → ₹180 + ₹27 fee = ₹207); reservation and a second customer blocked from the same
slot (UI + simultaneous API race → one 201, one 409); payment failure; duplicate webhooks ignored; cancellation with refund and
slot release; check-in → start → complete; commission accuracy (partner ₹153, platform ₹54, ledger balanced, failed and refunded
bookings excluded); cross-partner and cross-driver isolation; home-charger privacy; active booking unaffected by mode
switching; admin restriction; light/dark persistence; cinematic intro + skip; reduced motion; mobile 390×844; persistence
across a server restart; no browser console errors.

## What is real, what is demo, what production still needs

**Working locally (verified by the test suites):** accounts and sessions, roles and ownership on the server, partner
onboarding and approval, station/connector/pricing/hours/photo management, publication workflow, search/filters,
availability, estimates, concurrency-safe bookings with holds and expiry, cancellation rules, check-in/session/energy
records, refunds (full, partial, unused energy), configurable fee/commission with per-booking snapshots, double-entry ledger,
revenue and statements, trip planning, favourites, vehicles, notifications, support, audit log, themes, intro, responsive UI.

**Demo-only (clearly labelled in the UI):** TEST payment checkout; demo map without street tiles; gazetteer geocoding and
straight-line routing; email/SMS via the demo inbox; in-app notifications instead of push; simulated availability on seeded
stations; host-entered energy (no charger telemetry); payout statements without transfers; manual document review.
See [INTEGRATIONS.md](INTEGRATIONS.md).

**Outstanding for production:** merchant account + live payment credentials and webhook registration; maps keys;
email/SMS providers (DLT registration for India); push; OCPP/OCPI charger integration for live status and metering;
payout provider and partner bank verification; GST invoicing and processing-fee accounting; object storage + moderation for
photos; hosting, managed PostgreSQL, backups, monitoring; legal terms, privacy policy and security review.

## Production

The server refuses to start with `NODE_ENV=production` unless: `DEMO_MODE=false`, a non-test `PAYMENT_PROVIDER`, a strong
`PAYMENT_WEBHOOK_SECRET`, `COOKIE_SECURE=true` and an `https://` `APP_ORIGIN`. Demo seed data is refused in production.
Run behind HTTPS, set `HOST=0.0.0.0` if a proxy forwards to it, and run `node dist/cli.mjs migrate` on deploy.
Nothing has been deployed; deployment needs your authorization and accounts.

## Layout

```
platform/
  database/migrations/   SQL schema (constraints, exclusion constraint, ledger trigger)
  server/src/            index (HTTP, static, CSP), cli (migrate/seed), config, db
    lib/                 http router, auth, validation, money, booking state machine, ledger, geo, time, compat
    adapters/            payments (test + Razorpay), maps (demo + Google), messaging (demo outbox)
    modules/             auth, stations, bookings, driver, partner, admin
  web/src/               React app: Shell (SWITCH MODE), Intro, map adapters, pages/{auth,driver,partner,admin}
  scripts/               build, dev, test runner, icon generator
  tests/api/             API suites          tests/e2e/workflow.mjs   browser workflow
  docs/API.md            endpoint reference   INTEGRATIONS.md   .env.example
```
