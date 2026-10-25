import type { Q } from '../db';
import { approximate, haversineKm } from './geo';
import { closeMinutes, istParts, toMinutes } from './time';

export type StationRow = Record<string, unknown> & {
  id: string;
  partnerId: string;
  name: string;
  accessType: 'PUBLIC' | 'PRIVATE' | 'HOME';
  discloseExactLocation: boolean;
  latitude: number;
  longitude: number;
  listingStatus: string;
  operationalStatus: string;
  slotMinutes: number;
  isDemo: boolean;
  statusConfirmedAt: Date;
};
export type HoursRow = { weekday: number; opensAt: string; closesAt: string };
export type ConnectorRow = { id: string; stationId: string; label: string; standard: string; currentType: 'AC' | 'DC'; maxPowerKw: number; pricePerKwhPaise: number; status: string };

export const STATION_COLS = (q: Q) => q`
  s.id, s.partner_id, s.name, s.description, s.address, s.area, s.city, s.latitude::float8 AS latitude, s.longitude::float8 AS longitude,
  s.access_type, s.disclose_exact_location, s.access_notes, s.amenities, s.photo_paths, s.listing_status, s.operational_status,
  s.slot_minutes, s.timezone, s.is_demo, s.status_confirmed_at, s.review_note, s.submitted_at, s.approved_at, s.created_at, s.updated_at`;

export async function connectorsFor(q: Q, stationIds: string[]): Promise<ConnectorRow[]> {
  if (!stationIds.length) return [];
  return (await q`SELECT id, station_id, label, standard, current_type, max_power_kw::float8 AS max_power_kw, price_per_kwh_paise, status
                  FROM connectors WHERE station_id = ANY(${stationIds}) ORDER BY current_type DESC, max_power_kw DESC, label`) as unknown as ConnectorRow[];
}
export async function hoursFor(q: Q, stationIds: string[]): Promise<(HoursRow & { stationId: string })[]> {
  if (!stationIds.length) return [];
  return (await q`SELECT station_id, weekday, to_char(opens_at, 'HH24:MI') AS opens_at, to_char(closes_at, 'HH24:MI') AS closes_at
                  FROM station_hours WHERE station_id = ANY(${stationIds}) ORDER BY weekday`) as unknown as (HoursRow & { stationId: string })[];
}

export function isOpenAt(hours: HoursRow[], at: Date) {
  const p = istParts(at);
  const h = hours.find((x) => x.weekday === p.weekday);
  return !!h && p.minutes >= toMinutes(h.opensAt) && p.minutes < closeMinutes(h.closesAt);
}

/** Availability confidence label: never claims live status (no charger telemetry is connected). */
export function confidence(s: StationRow) {
  if (s.isDemo) return 'SIMULATED_DEMO';
  const ageH = (Date.now() - new Date(s.statusConfirmedAt).getTime()) / 36e5;
  return ageH <= 24 ? 'HOST_CONFIRMED' : 'SCHEDULED_ONLY';
}

/** What the public may see about a station's location and operator. */
export function exposure(s: StationRow & { businessName?: string }) {
  const exact = s.accessType === 'PUBLIC' || s.discloseExactLocation;
  const loc = exact ? { latitude: s.latitude, longitude: s.longitude } : approximate(s.id, s.latitude, s.longitude);
  return {
    exactLocation: exact,
    location: loc,
    address: exact ? (s.address as string) : `${s.area as string}, ${s.city as string} (exact address shared after a confirmed booking)`,
    operator: s.accessType === 'HOME' && !s.discloseExactLocation ? 'Private home host' : (s.businessName as string) || 'Station partner',
  };
}

export function distanceFrom(s: { latitude: number; longitude: number }, lat?: number, lng?: number) {
  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return Math.round(haversineKm(lat, lng, s.latitude, s.longitude) * 10) / 10;
}
