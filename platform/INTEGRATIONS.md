# Integrations — what is real, what is demo, and what activation needs

No paid service was purchased or connected during development. Every external dependency sits behind an adapter
with a clearly labelled demo implementation, so the app runs end to end locally and the frontend does not change
when a real provider is switched on. Check `GET /api/integrations/status` (or **Integrations & demo mode** in the
app) for the live state of an environment.

| Integration | Adapter | Local / demo behaviour | Status |
|---|---|---|---|
| Payments | `server/src/adapters/payments.ts` | **Test provider**: orders are created locally; the TEST checkout asks the server to sign a `payment.captured` / `payment.failed` event with `PAYMENT_WEBHOOK_SECRET` and deliver it to `/api/webhooks/payments/test`. Bookings change only after that signed webhook is verified. | Test mode. Razorpay adapter written, **disabled** |
| Maps & markers | `web/src/map/MapView.tsx` (+ `DemoMap`, `GoogleMap`) | Interactive demo map: real coordinates, pan/zoom, pins with price and availability tone, route overlay, click-to-pick. No street tiles. | Demo |
| Geocoding / place search | `server/src/adapters/maps.ts` `geocode()` | Small built-in gazetteer of Andhra Pradesh places. | Demo |
| Directions / routing | `adapters/maps.ts` `route()`; `directionsUrl()` | Straight-line geometry × 1.25 road factor for trip planning, labelled as such. “Directions” opens a Google Maps URL (no key needed, no API call). | Demo |
| Live location | browser Geolocation API | “Near me” uses the device location when the user allows it. | Works (browser) |
| Station availability | `lib/stationData.ts` `confidence()` | Bookings on this platform + host-declared status. Shown as *Simulated (demo)*, *Host-confirmed (not live)* or *Opening hours only* — never as live. | No telemetry source |
| Charger operator / OCPP / OCPI | — | Not connected. Session start/stop and energy (kWh) are entered by the host. | Not connected |
| Email verification / OTP | `adapters/messaging.ts` | Messages are written to `dev_outbox` and shown in the in-app **Demo inbox**. | Demo |
| SMS | `adapters/messaging.ts` | Same demo outbox; nothing is sent. | Demo |
| Push notifications | `adapters/messaging.ts` `notify()` | In-app notifications (bell) only. | In-app only |
| Payouts to partners | `/api/admin/payouts` | Statements recorded as `PENDING_INTEGRATION`; no money moves. | Not connected |
| Ownership / KYC verification | partner application | Document references reviewed manually by an admin. No automated verification. | Manual |
| Photo storage | `modules/partner.ts` | Files on the server disk (`STORAGE_DIR`), type and magic-byte checked. | Local only |

## Activation steps

### Payments (Razorpay adapter provided; any gateway can implement the same `PaymentProvider` interface)
Account: a merchant account with completed business KYC and website/app approval. Cost category: per-transaction
percentage fees set by the provider (check its current pricing); no purchase was made.
1. Create API keys in the provider dashboard; set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` on the server only.
2. Register the webhook URL `https://<APP_ORIGIN>/api/webhooks/payments/razorpay` for `payment.captured`,
   `payment.failed` and refund events; put its secret in `PAYMENT_WEBHOOK_SECRET`.
3. Add the provider's hosted checkout to the client (the order id is already returned by `POST /api/bookings`).
   Card/UPI details must only ever be entered on the provider's page.
4. Set `PAYMENT_PROVIDER=razorpay`, `PAYMENTS_LIVE_ENABLED=true`, `DEMO_MODE=false`.
5. Verify with the provider's test mode first: signature check, duplicate deliveries, failed payment, refund.
6. Decide tax treatment (GST invoices), processing-fee accounting and refund policy; the ledger keeps these as
   separate lines once configured.

### Maps, geocoding and routing (Google Maps Platform adapter provided)
Account: a Google Cloud billing account. Cost category: usage-based per request/map load with a monthly free allowance.
1. Create a **browser key** restricted by HTTP referrer to your domain with only *Maps JavaScript API* → `MAPS_BROWSER_API_KEY`.
2. Create a **server key** restricted by IP with *Geocoding API* (and *Routes API* if turn-by-turn routing is added) → `MAPS_SERVER_API_KEY`.
3. Set `MAPS_PROVIDER=google`. The CSP automatically allows the Maps domains in this mode.
4. Replace `route()` with the Routes API for road-accurate trip distances.

### Email and SMS (OTP)
Accounts: a transactional email service (domain verification, SPF/DKIM) and, for SMS in India, an SMS provider with
DLT sender-ID and template registration. Cost category: per message.
Implement `deliver()` for the chosen provider, set `EMAIL_PROVIDER` / `SMS_PROVIDER`, and turn `DEMO_MODE` off so the demo inbox disappears.

### Push notifications
Firebase Cloud Messaging (no per-message charge) or APNs for a native wrapper. Store device tokens per user and call the
provider from `notify()`.

### Charger telemetry (live availability, metered energy)
Requires OCPP 1.6/2.0.1 access to the chargers or an OCPI roaming agreement with each charge-point operator. Until
then availability stays host-declared and energy host-entered, and the UI says so.

### Payouts
A payouts product from the payment provider (e.g. split settlements / bank payouts) plus partner bank-account
verification. Wire `POST /api/admin/payouts` to it and move statements from `PENDING_INTEGRATION` to `PAID` only on
the provider's confirmation webhook.

### Hosting and database
Any Node 22 host plus managed PostgreSQL 14+ with `btree_gist` and `citext`. Cost category: monthly. Not deployed —
deployment needs your explicit authorization and accounts. Production checklist in [README.md](README.md#production).
