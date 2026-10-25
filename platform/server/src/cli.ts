// Database CLI: create database, run migrations, seed demo data, reset.
//   node dist/cli.mjs migrate | seed | reset | setup
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { config } from './config';
import { hashPassword } from './lib/auth';

const MIGRATIONS = process.env.MIGRATIONS_DIR || new URL('../database/migrations/', import.meta.url).pathname;

async function ensureDatabase() {
  const u = new URL(config.databaseUrl);
  const dbName = u.pathname.slice(1);
  const admin = new URL(config.databaseUrl);
  admin.pathname = '/postgres';
  const a = postgres(admin.toString(), { onnotice: () => {}, max: 1 });
  const rows = await a`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
  if (!rows.length) {
    await a.unsafe(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
    console.log(`created database ${dbName}`);
  }
  await a.end();
}

async function migrate(sql: postgres.Sql) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set((await sql`SELECT version FROM schema_migrations`).map((r) => r.version as string));
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const text = await readFile(path.join(MIGRATIONS, f), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (version) VALUES (${f})`;
    });
    console.log(`applied ${f}`);
  }
}

type C = [label: string, standard: string, current: 'AC' | 'DC', kw: number, rupeesPerKwh: number];
type H = 'all24' | [string, string] | { weekday: [string, string]; weekend: [string, string] };

async function seed(sql: postgres.Sql) {
  if (config.nodeEnv === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'yes')
    throw new Error('Refusing to load demo seed data in production (set SEED_ALLOW_PRODUCTION=yes only for a disposable staging database).');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM users`;
  if (n > 0) {
    console.log('seed skipped: database already has users (use "reset" to start over)');
    return;
  }
  const pw = async (k: string, d: string) => hashPassword(process.env[k] || d);
  const user = async (email: string, name: string, pass: string, roles: string[], phone: string | null = null) => {
    const [u] = await sql`INSERT INTO users (email, password_hash, full_name, phone, email_verified_at) VALUES (${email}, ${pass}, ${name}, ${phone}, now()) RETURNING id`;
    for (const r of roles) await sql`INSERT INTO user_roles (user_id, role) VALUES (${u.id}, ${r})`;
    return u.id as string;
  };
  const admin = await user('admin@greenplug.test', 'Platform Admin', await pw('SEED_ADMIN_PASSWORD', 'AdminDemo2026'), ['driver', 'admin']);
  const asha = await user('asha@greenplug.test', 'Asha Varma', await pw('SEED_DEMO_PASSWORD', 'DriverDemo2026'), ['driver'], '+91 90000 00001');
  await user('ravi@greenplug.test', 'Ravi Teja', await pw('SEED_DEMO_PASSWORD', 'DriverDemo2026'), ['driver'], '+91 90000 00002');
  const pOwner = await user('partner@greenplug.test', 'Kiran Rao', await pw('SEED_DEMO_PASSWORD', 'PartnerDemo2026'), ['driver', 'partner'], '+91 90000 00003');
  const p2Owner = await user('coastal@greenplug.test', 'Meera Das', await pw('SEED_DEMO_PASSWORD', 'PartnerDemo2026'), ['driver', 'partner'], '+91 90000 00004');
  const applicant = await user('applicant@greenplug.test', 'Sanjay Kumar', await pw('SEED_DEMO_PASSWORD', 'DriverDemo2026'), ['driver'], '+91 90000 00005');

  const partner = async (owner: string, name: string, status: string, docs: [string, string][]) => {
    const [p] = await sql`INSERT INTO partners (owner_user_id, business_name, business_type, contact_email, contact_phone, address, status, reviewed_by, reviewed_at)
                          VALUES (${owner}, ${name}, 'company', ${`ops+${name.split(' ')[0].toLowerCase()}@greenplug.test`}, '+91 90000 10000', 'Visakhapatnam, Andhra Pradesh',
                                  ${status}, ${status === 'APPROVED' ? admin : null}, ${status === 'APPROVED' ? new Date() : null}) RETURNING id`;
    for (const [t, ref] of docs) await sql`INSERT INTO partner_verifications (partner_id, document_type, reference, status) VALUES (${p.id}, ${t}, ${ref}, ${status === 'APPROVED' ? 'ACCEPTED' : 'SUBMITTED'})`;
    return p.id as string;
  };
  const vizagVolt = await partner(pOwner, 'VizagVolt Charging (demo)', 'APPROVED', [['operating_authority', 'DEMO-OPS-2026-001 (sample reference)'], ['electrical_safety', 'DEMO-ELEC-INSPECTION-17 (sample)']]);
  const coastal = await partner(p2Owner, 'Coastal Charge Co (demo)', 'APPROVED', [['ownership_proof', 'DEMO-OWN-2026-044 (sample reference)']]);
  await partner(applicant, 'Gajuwaka EV Point (demo applicant)', 'PENDING', [['ownership_proof', 'DEMO-OWN-2026-090 (sample reference)']]);

  const station = async (pid: string, name: string, area: string, city: string, lat: number, lng: number, access: 'PUBLIC' | 'PRIVATE' | 'HOME', conns: C[], hours: H, amenities: string[], description: string) => {
    const [s] = await sql`INSERT INTO stations (partner_id, name, description, address, area, city, latitude, longitude, access_type, access_notes, amenities, listing_status, approved_at, approved_by, slot_minutes, is_demo, submitted_at)
                          VALUES (${pid}, ${name}, ${description}, ${`${area}, ${city}, Andhra Pradesh (demo address)`}, ${area}, ${city}, ${lat}, ${lng}, ${access},
                                  ${access === 'PUBLIC' ? 'Enter from the main gate; chargers are in the marked green bays.' : 'Ring the host at the gate. Park only in the marked bay.'},
                                  ${amenities}, 'APPROVED', now(), ${admin}, ${access === 'PUBLIC' ? 30 : 60}, true, now()) RETURNING id`;
    for (const [label, std, cur, kw, rs] of conns) {
      const [c] = await sql`INSERT INTO connectors (station_id, label, standard, current_type, max_power_kw, price_per_kwh_paise) VALUES (${s.id}, ${label}, ${std}, ${cur}, ${kw}, ${Math.round(rs * 100)}) RETURNING id`;
      await sql`INSERT INTO pricing_history (connector_id, price_per_kwh_paise, changed_by) VALUES (${c.id}, ${Math.round(rs * 100)}, ${admin})`;
    }
    for (let d = 0; d < 7; d++) {
      const [o, cl] = hours === 'all24' ? ['00:00', '00:00'] : Array.isArray(hours) ? hours : d === 0 || d === 6 ? hours.weekend : hours.weekday;
      await sql`INSERT INTO station_hours (station_id, weekday, opens_at, closes_at) VALUES (${s.id}, ${d}, ${o}, ${cl})`;
    }
    return s.id as string;
  };
  await station(vizagVolt, 'MVP Colony Fast Charge Hub', 'MVP Colony', 'Visakhapatnam', 17.7406, 83.3365, 'PUBLIC',
    [['DC-1', 'CCS2', 'DC', 60, 21], ['DC-2', 'CCS2', 'DC', 30, 19], ['AC-1', 'TYPE2', 'AC', 7.4, 14]], ['06:00', '23:00'], ['parking', 'restroom', 'cafe', 'cctv', 'wifi'],
    'Covered public hub with two DC fast chargers and an AC point.');
  await station(vizagVolt, 'RK Beach Charging Point', 'RK Beach Road', 'Visakhapatnam', 17.7149, 83.3236, 'PUBLIC',
    [['DC-A', 'CCS2', 'DC', 50, 20], ['DC-B', 'CHADEMO', 'DC', 50, 20], ['AC-A', 'TYPE2', 'AC', 22, 15]], 'all24', ['parking', 'security', 'cctv'], 'Open-air seafront bays, open all day.');
  await station(vizagVolt, 'Madhurawada IT Park Chargers', 'Madhurawada', 'Visakhapatnam', 17.8129, 83.3592, 'PUBLIC',
    [['DC-1', 'BHARAT_DC001', 'DC', 15, 16], ['AC-1', 'TYPE2', 'AC', 7.4, 13], ['Bike socket', 'SOCKET_15A', 'AC', 3, 10]], ['07:00', '22:00'], ['parking', 'two_wheeler_parking', 'cafe'], 'Office campus parking with a socket for electric two-wheelers.');
  await station(vizagVolt, 'Anakapalle Highway Stop', 'NH16 Bypass', 'Anakapalle', 17.6913, 83.0039, 'PUBLIC', [['DC-1', 'CCS2', 'DC', 60, 22], ['AC-1', 'TYPE2', 'AC', 11, 15]], 'all24', ['parking', 'restroom', 'cafe'], 'Highway stop with a restaurant next door.');
  await station(vizagVolt, 'Tuni NH16 Charging Bay', 'NH16', 'Tuni', 17.3594, 82.5466, 'PUBLIC', [['DC-1', 'CCS2', 'DC', 60, 22]], 'all24', ['parking', 'restroom'], 'Single fast charger on the Visakhapatnam–Vijayawada highway.');
  await station(vizagVolt, 'Rajamahendravaram Riverside Chargers', 'Kotipalli Bus Stand Road', 'Rajamahendravaram', 17.0005, 81.804, 'PUBLIC', [['DC-1', 'CCS2', 'DC', 50, 21], ['AC-1', 'TYPE2', 'AC', 11, 15]], ['06:00', '23:00'], ['parking', 'cafe'], 'City-centre chargers near the river.');
  await station(vizagVolt, 'Eluru Bypass Fast Charge', 'Eluru Bypass', 'Eluru', 16.7107, 81.0952, 'PUBLIC', [['DC-1', 'CCS2', 'DC', 30, 20]], 'all24', ['parking'], 'Bypass fuel-station forecourt charger.');
  await station(vizagVolt, 'Vijayawada Benz Circle Hub', 'Benz Circle', 'Vijayawada', 16.5062, 80.648, 'PUBLIC',
    [['DC-1', 'CCS2', 'DC', 120, 23], ['DC-2', 'CCS2', 'DC', 60, 21], ['AC-1', 'TYPE2', 'AC', 22, 15]], 'all24', ['parking', 'restroom', 'cafe', 'wifi', 'cctv'], 'Large city hub with a 120 kW charger.');
  await station(coastal, 'Dwaraka Nagar Mall Chargers', 'Dwaraka Nagar', 'Visakhapatnam', 17.7276, 83.3052, 'PUBLIC', [['DC-1', 'CCS2', 'DC', 30, 19], ['AC-1', 'TYPE2', 'AC', 7.4, 14]], ['09:00', '22:00'], ['parking', 'restroom', 'cafe', 'covered'], 'Basement level 2 of the mall car park.');
  await station(coastal, 'Seethammadhara Home Charger', 'Seethammadhara', 'Visakhapatnam', 17.7432, 83.3127, 'HOME', [['Wallbox', 'TYPE2', 'AC', 7.4, 12], ['Scooter socket', 'SOCKET_15A', 'AC', 3, 9]],
    { weekday: ['18:00', '23:00'], weekend: ['08:00', '20:00'] }, ['parking'], 'A private home charger offered by its owner in the evenings and at weekends.');
  await station(coastal, 'Rushikonda Residency Visitor Charger', 'Rushikonda', 'Visakhapatnam', 17.782, 83.385, 'PRIVATE', [['AC-1', 'TYPE2', 'AC', 7.4, 13]], ['08:00', '20:00'], ['parking', 'security'], 'Visitor bay inside a gated residency. Booking required; gate pass issued on arrival.');

  // vehicle catalogue (connector types only; power and battery figures deliberately left empty until verified)
  const cat: [string, 'car' | 'two_wheeler', string, string[], string[]][] = [
    ['Tata', 'car', 'Nexon EV', ['Medium Range', 'Long Range'], ['CCS2', 'TYPE2']],
    ['Tata', 'car', 'Tiago EV', ['Standard'], ['CCS2', 'TYPE2']],
    ['Tata', 'car', 'Punch EV', ['Standard'], ['CCS2', 'TYPE2']],
    ['MG', 'car', 'ZS EV', ['Standard'], ['CCS2', 'TYPE2']],
    ['MG', 'car', 'Comet EV', ['Standard'], ['TYPE2']],
    ['Mahindra', 'car', 'XUV400', ['Standard'], ['CCS2', 'TYPE2']],
    ['Hyundai', 'car', 'Kona Electric', ['Standard'], ['CCS2', 'TYPE2']],
    ['BYD', 'car', 'Atto 3', ['Standard'], ['CCS2', 'TYPE2']],
    ['Citroën', 'car', 'eC3', ['Standard'], ['CCS2', 'TYPE2']],
    ['Ather', 'two_wheeler', '450X', ['Standard'], ['TYPE7_LECCS']],
    ['Ola Electric', 'two_wheeler', 'S1 Pro', ['Standard'], ['SOCKET_15A']],
    ['TVS', 'two_wheeler', 'iQube', ['Standard'], ['SOCKET_15A']],
    ['Bajaj', 'two_wheeler', 'Chetak', ['Standard'], ['SOCKET_15A']],
  ];
  const variantIds: Record<string, string> = {};
  for (const [brand, seg, model, variants, conns] of cat) {
    const [b] = await sql`INSERT INTO ev_brands (name, segment) VALUES (${brand}, ${seg}) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    const [m] = await sql`INSERT INTO ev_models (brand_id, name) VALUES (${b.id}, ${model}) RETURNING id`;
    for (const v of variants) {
      const [vr] = await sql`INSERT INTO ev_variants (model_id, label, connectors, evidence_state, source_note)
                             VALUES (${m.id}, ${v}, ${conns}, 'unverified', 'Seed data: inlet type only. Verify power, battery and inlet against manufacturer documentation before relying on it.') RETURNING id`;
      variantIds[`${model} ${v}`] = vr.id as string;
    }
  }
  await sql`INSERT INTO user_vehicles (user_id, variant_id, nickname, is_default) VALUES (${asha}, ${variantIds['Nexon EV Long Range']}, 'My Nexon', true)`;
  console.log('seeded demo users, partners, 11 demo stations and the vehicle catalogue');
}

async function main() {
  const cmd = process.argv[2];
  if (!['migrate', 'seed', 'reset', 'setup'].includes(cmd)) {
    console.log('usage: cli.mjs migrate | seed | reset | setup');
    process.exit(1);
  }
  await ensureDatabase();
  const sql = postgres(config.databaseUrl, { onnotice: () => {}, max: 2 });
  if (cmd === 'reset') {
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    console.log('schema reset');
  }
  if (cmd !== 'seed') await migrate(sql);
  if (cmd === 'seed' || cmd === 'reset' || cmd === 'setup') await seed(sql);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
