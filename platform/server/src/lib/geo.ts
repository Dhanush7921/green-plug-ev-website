import { createHash } from 'node:crypto';

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Private/home chargers publish only an approximate position: rounded to ~1 km and shifted by a stable,
 * station-specific offset so the exact home cannot be recovered from the public map.
 */
export function approximate(stationId: string, lat: number, lng: number) {
  const h = createHash('sha256').update(stationId).digest();
  const dx = (h[0] / 255 - 0.5) * 0.012;
  const dy = (h[1] / 255 - 0.5) * 0.012;
  return { latitude: Math.round((lat + dy) * 100) / 100, longitude: Math.round((lng + dx) * 100) / 100 };
}

/** Distance from point P to segment AB (km), on a local equirectangular projection (fine for corridor search). */
export function distanceToSegmentKm(p: [number, number], a: [number, number], b: [number, number]) {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  const toXY = (q: [number, number]) => [q[1] * k * 111.32, q[0] * 110.57];
  const [px, py] = toXY(p);
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { km: Math.hypot(px - cx, py - cy), t };
}
