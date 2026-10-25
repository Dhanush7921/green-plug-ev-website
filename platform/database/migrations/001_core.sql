-- GREEN PLUG EV platform: core schema.
-- Money is stored as integer paise (INR minor units). All timestamps are timestamptz (UTC).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 160),
  password_hash     text NOT NULL,
  full_name         text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  phone             text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ]{8,16}$'),
  email_verified_at timestamptz,
  preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
  disabled_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- A user can hold several roles at once; roles are granted by the server, never by the client.
CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('driver', 'partner', 'admin')),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE verification_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('email_verify')),
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Messages "sent" by the demo email/SMS/push adapters. Real providers replace this.
CREATE TABLE dev_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  channel    text NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
  recipient  text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope           text NOT NULL,
  key             text NOT NULL CHECK (length(key) BETWEEN 8 AND 80),
  request_hash    text NOT NULL,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);

-- ---------------------------------------------------------------- vehicle catalog
CREATE TABLE ev_brands (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name    text NOT NULL UNIQUE,
  segment text NOT NULL CHECK (segment IN ('car', 'two_wheeler', 'three_wheeler'))
);
CREATE TABLE ev_models (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES ev_brands(id) ON DELETE CASCADE,
  name     text NOT NULL,
  UNIQUE (brand_id, name)
);
CREATE TABLE ev_variants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       uuid NOT NULL REFERENCES ev_models(id) ON DELETE CASCADE,
  label          text NOT NULL,
  battery_kwh    numeric(6, 2) CHECK (battery_kwh IS NULL OR battery_kwh > 0),
  max_ac_kw      numeric(6, 2) CHECK (max_ac_kw IS NULL OR max_ac_kw > 0),
  max_dc_kw      numeric(6, 2) CHECK (max_dc_kw IS NULL OR max_dc_kw > 0),
  connectors     text[] NOT NULL,
  -- 'unverified' specs must never be presented as confirmed compatibility
  evidence_state text NOT NULL DEFAULT 'unverified' CHECK (evidence_state IN ('verified', 'unverified')),
  source_note    text,
  UNIQUE (model_id, label)
);

CREATE TABLE user_vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id   uuid REFERENCES ev_variants(id),
  nickname     text NOT NULL CHECK (length(nickname) BETWEEN 1 AND 60),
  -- only used when the driver picks "my model is not listed"
  connectors   text[] NOT NULL DEFAULT '{}',
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (variant_id IS NOT NULL OR cardinality(connectors) > 0)
);
CREATE UNIQUE INDEX user_vehicles_one_default ON user_vehicles (user_id) WHERE is_default;

-- ---------------------------------------------------------------- station partners
CREATE TABLE partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  business_name text NOT NULL CHECK (length(business_name) BETWEEN 2 AND 120),
  business_type text NOT NULL CHECK (business_type IN ('individual', 'company', 'society', 'government', 'other')),
  contact_email citext NOT NULL,
  contact_phone text NOT NULL CHECK (contact_phone ~ '^\+?[0-9 ]{8,16}$'),
  gstin         text CHECK (gstin IS NULL OR gstin ~ '^[0-9A-Z]{15}$'),
  address       text NOT NULL CHECK (length(address) BETWEEN 5 AND 300),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  review_note   text,
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Declarations and document references for ownership / operating authority. Files are not stored in this phase.
CREATE TABLE partner_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('ownership_proof', 'operating_authority', 'electrical_safety', 'identity')),
  reference     text NOT NULL CHECK (length(reference) BETWEEN 3 AND 200),
  status        text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED')),
  reviewer_id   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- stations
CREATE TABLE stations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id              uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  name                    text NOT NULL CHECK (length(name) BETWEEN 3 AND 90),
  description             text NOT NULL DEFAULT '' CHECK (length(description) <= 600),
  address                 text NOT NULL CHECK (length(address) BETWEEN 5 AND 200),
  area                    text NOT NULL CHECK (length(area) BETWEEN 2 AND 80),
  city                    text NOT NULL CHECK (length(city) BETWEEN 2 AND 60),
  latitude                numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude               numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  access_type             text NOT NULL CHECK (access_type IN ('PUBLIC', 'PRIVATE', 'HOME')),
  disclose_exact_location boolean NOT NULL DEFAULT false,
  access_notes            text NOT NULL DEFAULT '' CHECK (length(access_notes) <= 300),
  amenities               text[] NOT NULL DEFAULT '{}',
  photo_paths             text[] NOT NULL DEFAULT '{}',
  listing_status          text NOT NULL DEFAULT 'DRAFT' CHECK (listing_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  operational_status      text NOT NULL DEFAULT 'AVAILABLE' CHECK (operational_status IN ('AVAILABLE', 'UNAVAILABLE', 'TEMPORARILY_CLOSED')),
  slot_minutes            int NOT NULL DEFAULT 60 CHECK (slot_minutes IN (15, 30, 45, 60, 90, 120)),
  timezone                text NOT NULL DEFAULT 'Asia/Kolkata',
  is_demo                 boolean NOT NULL DEFAULT false,
  review_note             text,
  submitted_at            timestamptz,
  approved_at             timestamptz,
  approved_by             uuid REFERENCES users(id),
  status_confirmed_at     timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stations_listing_idx ON stations (listing_status);
CREATE INDEX stations_geo_idx ON stations (latitude, longitude);
CREATE INDEX stations_partner_idx ON stations (partner_id);

CREATE TABLE station_hours (
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  opens_at   time NOT NULL,
  closes_at  time NOT NULL,
  CHECK (closes_at > opens_at OR closes_at = '00:00'::time),
  PRIMARY KEY (station_id, weekday)
);

CREATE TABLE connectors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id          uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  label               text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  standard            text NOT NULL CHECK (standard IN ('CCS2', 'TYPE2', 'CHADEMO', 'BHARAT_AC001', 'BHARAT_DC001', 'TYPE7_LECCS', 'TYPE6_LEVDC', 'SOCKET_15A')),
  current_type        text NOT NULL CHECK (current_type IN ('AC', 'DC')),
  max_power_kw        numeric(6, 2) NOT NULL CHECK (max_power_kw > 0 AND max_power_kw <= 400),
  price_per_kwh_paise int NOT NULL CHECK (price_per_kwh_paise > 0 AND price_per_kwh_paise <= 10000),
  status              text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OUT_OF_SERVICE')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connectors_station_idx ON connectors (station_id);

-- Pricing schedule: every price change is kept (bookings also snapshot the price they were quoted).
CREATE TABLE pricing_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id        uuid NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  price_per_kwh_paise int NOT NULL CHECK (price_per_kwh_paise > 0),
  effective_from      timestamptz NOT NULL DEFAULT now(),
  changed_by          uuid REFERENCES users(id)
);

-- Partner-declared blackout windows (maintenance, private use)
CREATE TABLE availability_blocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id   uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  connector_id uuid REFERENCES connectors(id) ON DELETE CASCADE,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  reason       text NOT NULL DEFAULT '',
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- ---------------------------------------------------------------- commercial settings
CREATE TABLE platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (key, value) VALUES
  ('customer_fee_bps', '1500'),          -- 15.00 % customer service fee on the eligible base
  ('provider_commission_bps', '1500'),   -- 15.00 % station-provider commission on the eligible base
  ('hold_minutes', '10'),                -- unpaid reservations expire after this
  ('cancellation_cutoff_minutes', '30'); -- drivers can cancel with a full refund until this long before start

-- ---------------------------------------------------------------- bookings
-- Lifecycle: RESERVED -> CONFIRMED -> CHECKED_IN -> IN_PROGRESS -> COMPLETED
-- Exits: EXPIRED (unpaid hold timed out), PAYMENT_FAILED, CANCELLED_DRIVER, CANCELLED_PARTNER, NO_SHOW
CREATE TABLE bookings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,
  driver_id                 uuid NOT NULL REFERENCES users(id),
  station_id                uuid NOT NULL REFERENCES stations(id),
  connector_id              uuid NOT NULL REFERENCES connectors(id),
  vehicle_id                uuid REFERENCES user_vehicles(id) ON DELETE SET NULL,
  starts_at                 timestamptz NOT NULL,
  ends_at                   timestamptz NOT NULL,
  status                    text NOT NULL CHECK (status IN ('RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED_DRIVER', 'CANCELLED_PARTNER', 'EXPIRED', 'PAYMENT_FAILED', 'NO_SHOW')),
  hold_expires_at           timestamptz,
  planned_kwh               numeric(7, 2) NOT NULL CHECK (planned_kwh > 0 AND planned_kwh <= 500),
  rate_paise                int NOT NULL CHECK (rate_paise > 0),
  fee_bps                   int NOT NULL CHECK (fee_bps BETWEEN 0 AND 5000),
  commission_bps            int NOT NULL CHECK (commission_bps BETWEEN 0 AND 5000),
  base_paise                int NOT NULL CHECK (base_paise > 0),
  customer_fee_paise        int NOT NULL CHECK (customer_fee_paise >= 0),
  customer_total_paise      int NOT NULL CHECK (customer_total_paise > 0),
  provider_commission_paise int NOT NULL CHECK (provider_commission_paise >= 0),
  partner_amount_paise      int NOT NULL CHECK (partner_amount_paise >= 0),
  quote                     jsonb NOT NULL,
  payment_state             text NOT NULL DEFAULT 'UNPAID' CHECK (payment_state IN ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  cancellation_reason       text,
  cancelled_at              timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (customer_total_paise = base_paise + customer_fee_paise),
  CHECK (partner_amount_paise = base_paise - provider_commission_paise),
  -- Concurrency guarantee: no two active bookings may overlap on the same connector.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    connector_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('RESERVED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'))
);
CREATE INDEX bookings_driver_idx ON bookings (driver_id, starts_at DESC);
CREATE INDEX bookings_station_idx ON bookings (station_id, starts_at);
CREATE INDEX bookings_hold_idx ON bookings (hold_expires_at) WHERE status = 'RESERVED';

CREATE TABLE booking_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id),
  actor_role    text NOT NULL CHECK (actor_role IN ('driver', 'partner', 'admin', 'system', 'payment_provider')),
  from_status   text,
  to_status     text NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, created_at);

CREATE TABLE charging_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  energy_kwh  numeric(7, 2) CHECK (energy_kwh IS NULL OR (energy_kwh >= 0 AND energy_kwh <= 500)),
  -- HOST_ENTERED: typed by the station partner. METERED would require a connected (OCPP) charger.
  source      text NOT NULL DEFAULT 'HOST_ENTERED' CHECK (source IN ('HOST_ENTERED', 'METERED')),
  recorded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- payments and money
CREATE TABLE payment_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  provider           text NOT NULL CHECK (provider IN ('test', 'razorpay')),
  provider_order_ref text NOT NULL UNIQUE,
  amount_paise       int NOT NULL CHECK (amount_paise > 0),
  refunded_paise     int NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  currency           text NOT NULL DEFAULT 'INR',
  method_hint        text CHECK (method_hint IS NULL OR method_hint IN ('upi', 'card', 'netbanking', 'wallet')),
  status             text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  provider_payment_ref text,
  failure_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz,
  CHECK (refunded_paise <= amount_paise)
);
CREATE INDEX payment_orders_booking_idx ON payment_orders (booking_id);
CREATE INDEX payment_orders_user_idx ON payment_orders (user_id, created_at DESC);

CREATE TABLE payment_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  event_type        text NOT NULL,
  signature_verified boolean NOT NULL,
  payload           jsonb NOT NULL,
  processing_status text NOT NULL CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'ERROR')),
  processing_note   text,
  duplicate_count   int NOT NULL DEFAULT 0,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id    uuid NOT NULL REFERENCES payment_orders(id),
  booking_id          uuid NOT NULL REFERENCES bookings(id),
  amount_paise        int NOT NULL CHECK (amount_paise > 0),
  base_part_paise     int NOT NULL CHECK (base_part_paise >= 0),
  fee_part_paise      int NOT NULL CHECK (fee_part_paise >= 0),
  reason              text NOT NULL,
  status              text NOT NULL CHECK (status IN ('REQUESTED', 'PROCESSED', 'FAILED')),
  provider_refund_ref text,
  requested_by        uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  CHECK (amount_paise = base_part_paise + fee_part_paise)
);

-- Double-entry ledger. Every txn_id must balance (enforced at commit by a constraint trigger).
CREATE TABLE ledger_entries (
  id               bigserial PRIMARY KEY,
  txn_id           uuid NOT NULL,
  booking_id       uuid REFERENCES bookings(id),
  payment_order_id uuid REFERENCES payment_orders(id),
  partner_id       uuid REFERENCES partners(id),
  account          text NOT NULL CHECK (account IN ('provider_clearing', 'platform_service_fee', 'platform_commission', 'partner_payable')),
  debit_paise      bigint NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise     bigint NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  kind             text NOT NULL CHECK (kind IN ('PAYMENT_CAPTURED', 'REFUND', 'PAYOUT')),
  memo             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_paise = 0) <> (credit_paise = 0))
);
CREATE INDEX ledger_txn_idx ON ledger_entries (txn_id);
CREATE INDEX ledger_partner_idx ON ledger_entries (partner_id, account);

CREATE FUNCTION ledger_txn_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint;
BEGIN
  SELECT coalesce(sum(debit_paise), 0), coalesce(sum(credit_paise), 0) INTO d, c FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF d <> c THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (debit %, credit %)', NEW.txn_id, d, c;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_txn_balanced();

-- Payout records. Real transfers need a payout provider; until then statements stay PENDING_INTEGRATION.
CREATE TABLE payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  booking_count int NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING_INTEGRATION' CHECK (status IN ('PENDING_INTEGRATION', 'SCHEDULED', 'PAID')),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

-- ---------------------------------------------------------------- driver extras
CREATE TABLE saved_stations (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, station_id)
);

CREATE TABLE trip_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  origin      jsonb NOT NULL,
  destination jsonb NOT NULL,
  vehicle_id  uuid REFERENCES user_vehicles(id) ON DELETE SET NULL,
  range_km    int NOT NULL CHECK (range_km BETWEEN 20 AND 1000),
  distance_km numeric(8, 1) NOT NULL,
  stops       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- notifications, support, audit
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE support_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace  text NOT NULL CHECK (workspace IN ('driver', 'partner')),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  category   text NOT NULL CHECK (category IN ('booking', 'payment', 'station', 'safety', 'account', 'other')),
  subject    text NOT NULL CHECK (length(subject) BETWEEN 3 AND 120),
  status     text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  author_role text NOT NULL CHECK (author_role IN ('driver', 'partner', 'admin')),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  actor_role  text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id  text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
