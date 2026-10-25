// Admin workspace: requires the 'admin' role granted in user_roles (checked on every request).
import { sql } from '../db';
import { notify } from '../adapters/messaging';
import { audit } from '../lib/auth';
import { lockBooking, refundBooking, refundRemaining } from '../lib/bookingFlow';
import { badRequest, conflict, notFound } from '../lib/errors';
import type { Router } from '../lib/http';
import { getSettings } from '../lib/settings';
import { DATE, num, obj, oneOf, str, uuid } from '../lib/validate';
import { revenue } from './partner';

const A = { role: 'admin' } as const;

export function adminRoutes(r: Router) {
  r.get('/api/admin/overview', async () => {
    const [c] = await sql`
      SELECT (SELECT count(*)::int FROM users) AS users,
             (SELECT count(*)::int FROM partners WHERE status = 'PENDING') AS partners_pending,
             (SELECT count(*)::int FROM partners WHERE status = 'APPROVED') AS partners_approved,
             (SELECT count(*)::int FROM stations WHERE listing_status = 'SUBMITTED') AS stations_pending,
             (SELECT count(*)::int FROM stations WHERE listing_status = 'APPROVED') AS stations_live,
             (SELECT count(*)::int FROM bookings WHERE status IN ('CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS')) AS bookings_active,
             (SELECT count(*)::int FROM bookings WHERE status = 'COMPLETED') AS bookings_completed,
             (SELECT count(*)::int FROM support_tickets WHERE status IN ('OPEN', 'IN_PROGRESS')) AS tickets_open`;
    const [m] = await sql`
      SELECT coalesce(sum(credit_paise - debit_paise) FILTER (WHERE account = 'platform_service_fee'), 0)::int AS service_fees,
             coalesce(sum(credit_paise - debit_paise) FILTER (WHERE account = 'platform_commission'), 0)::int AS commissions,
             coalesce(sum(credit_paise - debit_paise) FILTER (WHERE account = 'partner_payable'), 0)::int AS partner_payable,
             coalesce(sum(debit_paise - credit_paise) FILTER (WHERE account = 'provider_clearing'), 0)::int AS net_collected,
             coalesce(sum(debit_paise), 0)::int AS total_debits, coalesce(sum(credit_paise), 0)::int AS total_credits
      FROM ledger_entries`;
    return { counts: c, money: { ...m, platformRevenuePaise: (m.serviceFees as number) + (m.commissions as number), ledgerBalanced: m.totalDebits === m.totalCredits }, settings: await getSettings(sql) };
  }, A);

  // ---- partners
  r.get('/api/admin/partners', async (ctx) => {
    const status = ctx.query.get('status');
    const rows = await sql`
      SELECT p.id, p.business_name, p.business_type, p.contact_email, p.contact_phone, p.gstin, p.address, p.status, p.review_note, p.created_at, p.reviewed_at,
             u.full_name AS owner_name, u.email AS owner_email,
             coalesce(json_agg(json_build_object('documentType', v.document_type, 'reference', v.reference, 'status', v.status)) FILTER (WHERE v.id IS NOT NULL), '[]') AS verifications,
             (SELECT count(*)::int FROM stations s WHERE s.partner_id = p.id) AS station_count
      FROM partners p JOIN users u ON u.id = p.owner_user_id LEFT JOIN partner_verifications v ON v.partner_id = p.id
      ${status ? sql`WHERE p.status = ${oneOf({ s: status }, 's', ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const)}` : sql``}
      GROUP BY p.id, u.id ORDER BY (p.status = 'PENDING') DESC, p.created_at DESC`;
    return { partners: rows };
  }, A);

  r.post('/api/admin/partners/:id/decision', async (ctx) => {
    const id = uuid(ctx.params.id);
    const b = obj(ctx.body);
    const decision = oneOf(b, 'decision', ['APPROVE', 'REJECT', 'SUSPEND'] as const);
    const note = str(b, 'note', { optional: true, max: 300 });
    if (decision !== 'APPROVE' && !note) throw badRequest('Add a note explaining the decision.', { field: 'note' });
    await sql.begin(async (tx) => {
      const [p] = await tx`SELECT id, owner_user_id, status, business_name FROM partners WHERE id = ${id} FOR UPDATE`;
      if (!p) throw notFound('Partner');
      const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
      if (decision === 'APPROVE' && p.status === 'APPROVED') throw conflict('Partner is already approved.', 'NO_CHANGE');
      await tx`UPDATE partners SET status = ${status}, review_note = ${note || null}, reviewed_by = ${ctx.user!.id}, reviewed_at = now(), updated_at = now() WHERE id = ${id}`;
      await tx`UPDATE partner_verifications SET status = ${decision === 'APPROVE' ? 'ACCEPTED' : decision === 'REJECT' ? 'REJECTED' : 'ACCEPTED'}, reviewer_id = ${ctx.user!.id}, reviewed_at = now() WHERE partner_id = ${id} AND status = 'SUBMITTED'`;
      if (decision === 'APPROVE') await tx`INSERT INTO user_roles (user_id, role, granted_by) VALUES (${p.ownerUserId as string}, 'partner', ${ctx.user!.id}) ON CONFLICT DO NOTHING`;
      else await tx`DELETE FROM user_roles WHERE user_id = ${p.ownerUserId as string} AND role = 'partner'`;
      await audit(tx, ctx, 'admin', `partner.${decision.toLowerCase()}`, 'partner', id, { note });
      await notify(
        tx,
        p.ownerUserId as string,
        'partner_decision',
        decision === 'APPROVE' ? 'Station partner account approved' : decision === 'REJECT' ? 'Partner application not approved' : 'Partner account suspended',
        decision === 'APPROVE' ? `${p.businessName} can now list and manage charging stations.` : note,
        '/partner',
      );
    });
    return { ok: true };
  }, A);

  // ---- station listings
  r.get('/api/admin/stations', async (ctx) => {
    const status = ctx.query.get('status');
    const rows = await sql`
      SELECT s.id, s.name, s.area, s.city, s.address, s.latitude::float8 AS latitude, s.longitude::float8 AS longitude, s.access_type, s.disclose_exact_location,
             s.listing_status, s.operational_status, s.is_demo, s.submitted_at, s.approved_at, s.review_note, p.business_name, p.status AS partner_status,
             (SELECT json_agg(json_build_object('label', c.label, 'standard', c.standard, 'currentType', c.current_type, 'maxPowerKw', c.max_power_kw, 'pricePerKwhPaise', c.price_per_kwh_paise)) FROM connectors c WHERE c.station_id = s.id) AS connectors,
             (SELECT count(*)::int FROM station_hours h WHERE h.station_id = s.id) AS days_open
      FROM stations s JOIN partners p ON p.id = s.partner_id
      ${status ? sql`WHERE s.listing_status = ${oneOf({ s: status }, 's', ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const)}` : sql``}
      ORDER BY (s.listing_status = 'SUBMITTED') DESC, s.updated_at DESC LIMIT 200`;
    return { stations: rows };
  }, A);

  r.post('/api/admin/stations/:id/decision', async (ctx) => {
    const id = uuid(ctx.params.id);
    const b = obj(ctx.body);
    const decision = oneOf(b, 'decision', ['APPROVE', 'REJECT', 'SUSPEND'] as const);
    const note = str(b, 'note', { optional: true, max: 300 });
    if (decision !== 'APPROVE' && !note) throw badRequest('Add a note explaining the decision.', { field: 'note' });
    await sql.begin(async (tx) => {
      const [s] = await tx`SELECT s.id, s.listing_status, s.name, p.status AS partner_status, p.owner_user_id FROM stations s JOIN partners p ON p.id = s.partner_id WHERE s.id = ${id} FOR UPDATE OF s`;
      if (!s) throw notFound('Station');
      if (decision === 'APPROVE') {
        if (s.partnerStatus !== 'APPROVED') throw conflict('Approve the station partner before publishing their stations.', 'PARTNER_NOT_APPROVED');
        if (!['SUBMITTED', 'SUSPENDED'].includes(s.listingStatus as string)) throw conflict(`A ${String(s.listingStatus).toLowerCase()} listing cannot be approved.`, 'INVALID_STATE');
      }
      if (decision === 'REJECT' && s.listingStatus !== 'SUBMITTED') throw conflict('Only submitted listings can be rejected.', 'INVALID_STATE');
      const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
      await tx`UPDATE stations SET listing_status = ${status}, review_note = ${note || null}, approved_at = CASE WHEN ${status} = 'APPROVED' THEN now() ELSE approved_at END,
                 approved_by = CASE WHEN ${status} = 'APPROVED' THEN ${ctx.user!.id}::uuid ELSE approved_by END, updated_at = now() WHERE id = ${id}`;
      await audit(tx, ctx, 'admin', `station.${decision.toLowerCase()}`, 'station', id, { note });
      await notify(tx, s.ownerUserId as string, 'station_decision', decision === 'APPROVE' ? 'Station published' : decision === 'REJECT' ? 'Station listing needs changes' : 'Station suspended',
        decision === 'APPROVE' ? `${s.name} is now visible to drivers.` : `${s.name}: ${note}`, '/partner/stations');
    });
    return { ok: true };
  }, A);

  // ---- bookings, refunds
  r.get('/api/admin/bookings', async (ctx) => {
    const status = ctx.query.get('status');
    const rows = await sql`
      SELECT b.id, b.code, b.status, b.payment_state, b.starts_at, b.customer_total_paise, b.customer_fee_paise, b.provider_commission_paise, b.partner_amount_paise,
             s.name AS station_name, p.business_name, u.full_name AS driver_name
      FROM bookings b JOIN stations s ON s.id = b.station_id JOIN partners p ON p.id = s.partner_id JOIN users u ON u.id = b.driver_id
      ${status ? sql`WHERE b.status = ${status.slice(0, 20)}` : sql``}
      ORDER BY b.created_at DESC LIMIT 200`;
    return { bookings: rows };
  }, A);

  r.post('/api/admin/bookings/:id/refund', async (ctx) => {
    const id = uuid(ctx.params.id);
    const b = obj(ctx.body);
    const reason = str(b, 'reason', { min: 3, max: 200 });
    const amount = b.amountPaise === undefined ? null : num(b, 'amountPaise', { min: 1, int: true });
    const res = await sql.begin(async (tx) => {
      const bk = await lockBooking(tx, id);
      if (!bk) throw notFound('Booking');
      let r;
      if (amount === null) r = await refundRemaining(tx, bk, reason, ctx.user!.id);
      else {
        // split a goodwill/partial refund proportionally between base and service fee
        const base = Math.round((amount * bk.basePaise) / bk.customerTotalPaise);
        r = await refundBooking(tx, bk, base, amount - base, reason, ctx.user!.id);
      }
      if (!r) throw conflict('Nothing to refund for this booking.', 'NOTHING_TO_REFUND');
      await audit(tx, ctx, 'admin', 'booking.refund', 'booking', id, { amount: r.amountPaise, reason });
      return r;
    });
    return { ok: true, refund: res };
  }, A);

  // ---- commercial settings (configurable by admins only)
  r.get('/api/admin/settings', async () => ({ settings: await getSettings(sql) }), A);
  r.patch('/api/admin/settings', async (ctx) => {
    const b = obj(ctx.body);
    const map: [string, string, number, number][] = [
      ['customerFeeBps', 'customer_fee_bps', 0, 5000],
      ['providerCommissionBps', 'provider_commission_bps', 0, 5000],
      ['holdMinutes', 'hold_minutes', 2, 60],
      ['cancellationCutoffMinutes', 'cancellation_cutoff_minutes', 0, 1440],
    ];
    const before = await getSettings(sql);
    await sql.begin(async (tx) => {
      for (const [k, key, min, max] of map) {
        if (b[k] === undefined) continue;
        const v = num(b, k, { min, max, int: true });
        await tx`UPDATE platform_settings SET value = ${tx.json(v)}, updated_by = ${ctx.user!.id}, updated_at = now() WHERE key = ${key}`;
      }
      await audit(tx, ctx, 'admin', 'settings.updated', 'platform_settings', null, { before, change: b });
    });
    return { ok: true, settings: await getSettings(sql) };
  }, A);

  // ---- money
  r.get('/api/admin/ledger', async () => {
    const accounts = await sql`SELECT account, sum(debit_paise)::int AS debit, sum(credit_paise)::int AS credit FROM ledger_entries GROUP BY account ORDER BY account`;
    const unbalanced = await sql`SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING sum(debit_paise) <> sum(credit_paise)`;
    const recent = await sql`SELECT le.created_at, le.kind, le.account, le.debit_paise::int AS debit_paise, le.credit_paise::int AS credit_paise, le.memo, b.code FROM ledger_entries le LEFT JOIN bookings b ON b.id = le.booking_id ORDER BY le.id DESC LIMIT 60`;
    const webhooks = await sql`SELECT provider, provider_event_id, event_type, signature_verified, processing_status, processing_note, duplicate_count, received_at FROM payment_webhook_events ORDER BY received_at DESC LIMIT 40`;
    return { accounts, unbalancedTransactions: unbalanced.length, recent, webhooks };
  }, A);

  r.get('/api/admin/partners/:id/revenue', async (ctx) => revenue(uuid(ctx.params.id)), A);

  r.post('/api/admin/payouts', async (ctx) => {
    const b = obj(ctx.body);
    const partnerId = uuid(b.partnerId, 'partnerId');
    const periodStart = str(b, 'periodStart', { pattern: DATE });
    const periodEnd = str(b, 'periodEnd', { pattern: DATE });
    if (periodEnd < periodStart) throw badRequest('Period end must be after the start.');
    const row = await sql.begin(async (tx) => {
      const [x] = await tx`
        SELECT coalesce(sum(le.credit_paise - le.debit_paise), 0)::int AS amount, count(DISTINCT b.id)::int AS n
        FROM ledger_entries le JOIN bookings b ON b.id = le.booking_id
        WHERE le.partner_id = ${partnerId} AND le.account = 'partner_payable' AND b.status = 'COMPLETED'
          AND (b.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
          AND NOT EXISTS (SELECT 1 FROM payouts po WHERE po.partner_id = ${partnerId} AND (b.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN po.period_start AND po.period_end)`;
      const [p] = await tx`INSERT INTO payouts (partner_id, period_start, period_end, amount_paise, booking_count, created_by)
                           VALUES (${partnerId}, ${periodStart}, ${periodEnd}, ${x.amount as number}, ${x.n as number}, ${ctx.user!.id}) RETURNING *`;
      await audit(tx, ctx, 'admin', 'payout.statement', 'partner', partnerId, { amount: x.amount, periodStart, periodEnd });
      return p;
    });
    ctx.status = 201;
    return { ok: true, payout: row, note: 'Recorded as PENDING_INTEGRATION: no money is transferred until a payout provider is connected.' };
  }, A);

  // ---- support and audit
  r.get('/api/admin/support', async () => {
    const rows = await sql`SELECT t.id, t.workspace, t.category, t.subject, t.status, t.created_at, t.updated_at, u.full_name, b.code AS booking_code,
                                  (SELECT count(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS messages
                           FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN bookings b ON b.id = t.booking_id
                           ORDER BY (t.status IN ('OPEN', 'IN_PROGRESS')) DESC, t.updated_at DESC LIMIT 100`;
    return { tickets: rows };
  }, A);
  r.post('/api/admin/support/:id/reply', async (ctx) => {
    const id = uuid(ctx.params.id);
    const b = obj(ctx.body);
    const body = str(b, 'body', { max: 2000, label: 'Reply' });
    const status = oneOf(b, 'status', ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const, { optional: true });
    await sql.begin(async (tx) => {
      const [t] = await tx`SELECT id, user_id, subject FROM support_tickets WHERE id = ${id} FOR UPDATE`;
      if (!t) throw notFound('Ticket');
      await tx`INSERT INTO support_messages (ticket_id, author_id, author_role, body) VALUES (${id}, ${ctx.user!.id}, 'admin', ${body})`;
      await tx`UPDATE support_tickets SET status = coalesce(${status || null}, CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END), updated_at = now() WHERE id = ${id}`;
      await notify(tx, t.userId as string, 'support_reply', 'Support replied', `New reply on “${t.subject}”.`, `/support/${id}`);
      await audit(tx, ctx, 'admin', 'support.reply', 'support_ticket', id, { status });
    });
    return { ok: true };
  }, A);

  r.get('/api/admin/audit', async () => {
    const rows = await sql`SELECT a.id, a.actor_role, a.action, a.entity_type, a.entity_id, a.detail, a.created_at, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 150`;
    return { entries: rows };
  }, A);
}
