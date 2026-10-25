# GREEN PLUG EV — API reference

Base path `/api`. JSON in and out. Amounts are integer **paise**; rates are **basis points** (1500 = 15%).

**Authentication.** `POST /api/auth/login` sets an HttpOnly `gpev_sid` cookie (opaque token; only its SHA-256 is stored).
Every non-GET request must send `x-gpev-csrf: 1`; cross-origin requests are rejected.

**Authorization.** Roles (`driver`, `partner`, `admin`) and partner status are loaded from the database on every request.
Partner routes require an **APPROVED** partner organisation *and* ownership of the station or booking; admin routes require the
`admin` role. Denials return `403` and are written to the audit log.

**Errors.** `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "…", "details": {…}, "requestId": "…" } }` with
400 (validation), 401, 403, 404, 409 (conflict / state), 422 (idempotency mismatch), 429 (rate limit), 500.

## Booking lifecycle

```
RESERVED ──payment verified──▶ CONFIRMED ──code check-in──▶ CHECKED_IN ──start──▶ IN_PROGRESS ──energy recorded──▶ COMPLETED
   │  ├─ hold expired ─────────▶ EXPIRED (slot released; a late payment is refunded automatically)
   │  ├─ payment failed ───────▶ PAYMENT_FAILED (slot released)
   │  └─ cancelled ────────────▶ CANCELLED_DRIVER / CANCELLED_PARTNER
CONFIRMED ─▶ CANCELLED_DRIVER (until the cutoff, full refund) · CANCELLED_PARTNER (full refund) · NO_SHOW (≥30 min after start)
CHECKED_IN ─▶ CANCELLED_PARTNER (full refund)
```
Overlaps are prevented by the `bookings_no_overlap` exclusion constraint plus a row lock on the connector.

## Public / account
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB status |
| GET | `/auth/me` | current user (or null) + public config flags |
| POST | `/auth/register` | `{fullName,email,password,phone?}` → driver role, sends a verification code |
| POST | `/auth/login` · `/auth/logout` | |
| POST | `/auth/verify-email` · `/auth/resend-code` | 6-digit code, 5 attempts, 15 min expiry |
| PATCH | `/me` | name, phone, preferences (theme, notifications, preferred payment method type) |
| POST | `/me/workspace` | SWITCH MODE: `{mode}` → `granted: driver \| partner-dashboard \| partner-onboarding \| admin \| denied` |
| GET/POST | `/me/notifications` · `/me/notifications/read-all` | |
| GET | `/demo/inbox` | demo mode only: what the email/SMS adapters would have sent to you |
| GET | `/integrations/status` | which integrations are demo / disabled / configured |

## EV Driver
| Method | Path | Notes |
|---|---|---|
| GET | `/stations` | `q, connector (csv), current AC\|DC, minKw, maxPricePaise, access (csv), lat, lng, radiusKm, openNow, availableOnly, saved, compatibleOnly, vehicleId` |
| GET | `/stations/:id` | details; private/home listings expose only an approximate location |
| GET | `/stations/:id/availability` | `date=YYYY-MM-DD&durationMinutes=` slot grid per connector |
| POST | `/stations/:id/estimate` | `{connectorId, plannedKwh, durationMinutes?, vehicleId?}` → quote, compatibility, time range |
| POST | `/bookings` | **`Idempotency-Key` header required**; `{stationId, connectorId, startsAt, durationMinutes, plannedKwh, vehicleId?, paymentMethod?}` → `201 {booking, paymentOrder, checkout}`; `409 SLOT_UNAVAILABLE` |
| GET | `/bookings?scope=upcoming\|past` · `/bookings/:id` | own bookings only |
| POST | `/bookings/:id/cancel` | before the cutoff; refunds a paid booking in full |
| GET | `/bookings/:id/receipt` | after payment |
| GET | `/payments/transactions` | orders + refunds |
| POST | `/payments/test-checkout/:orderId` | demo only: `{outcome: success\|failure, deliveries 1–3}` — signs a provider event and delivers it to the webhook |
| POST | `/webhooks/payments/:provider` | signature-verified, stored once per provider event id, processed idempotently |
| GET | `/catalog/vehicles` · CRUD `/me/vehicles` | |
| GET/PUT/DELETE | `/me/saved-stations[/:stationId]` | favourites |
| GET | `/geo/search?q=` | geocoding adapter |
| POST | `/trips/plan` | `{origin, destination, rangeKm, corridorKm?}` → stops with a 20 % reserve |
| GET/POST/DELETE | `/trips[/:id]` | saved trips |
| GET/POST | `/support/tickets[/:id[/messages]]` | driver and partner support |

## Station Partner (approved partner + ownership)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/partner/application` | any verified user may apply; documents are reviewed by an admin |
| GET | `/partner/overview` | counts, upcoming bookings, revenue summary |
| GET/POST | `/partner/stations` · GET/PATCH `/partner/stations/:id` | details, coordinates, access/disclosure, amenities, hours, slot length, operational status; material edits re-enter review |
| POST | `/partner/stations/:id/submit` | DRAFT/REJECTED → SUBMITTED |
| POST/DELETE | `/partner/stations/:id/photos` | PNG/JPEG/WebP ≤ 2 MB, magic-byte checked |
| POST | `/partner/stations/:id/connectors` · PATCH/DELETE `/partner/connectors/:id` | type, AC/DC, kW, ₹/kWh (price history kept) |
| POST | `/partner/stations/:id/blocks` | unavailable windows |
| GET | `/partner/bookings` · `/partner/bookings/:id` | own stations only |
| POST | `/partner/bookings/:id/check-in\|start\|complete\|cancel\|no-show` | `check-in {code}`, `complete {energyKwh}` (unused energy refunded), `cancel {reason}` |
| GET | `/partner/revenue` · `/partner/statement` | ledger-based; payouts are records only |

## Admin (`admin` role)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | counts, platform revenue, ledger balance |
| GET/POST | `/admin/partners` · `/admin/partners/:id/decision` | APPROVE (grants partner role) / REJECT / SUSPEND (note required) |
| GET/POST | `/admin/stations` · `/admin/stations/:id/decision` | publish / request changes / suspend |
| GET/POST | `/admin/bookings` · `/admin/bookings/:id/refund` | full or partial refund with proportional commission reversal |
| GET/PATCH | `/admin/settings` | `customerFeeBps`, `providerCommissionBps` (0–5000), `holdMinutes`, `cancellationCutoffMinutes` |
| GET | `/admin/ledger` · `/admin/partners/:id/revenue` | accounts, recent entries, webhook events |
| POST | `/admin/payouts` | payout statement (PENDING_INTEGRATION; no transfer) |
| GET/POST | `/admin/support` · `/admin/support/:id/reply` | |
| GET | `/admin/audit` | |
