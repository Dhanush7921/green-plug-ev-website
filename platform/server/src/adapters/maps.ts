// Geocoding and routing adapters. DEMO uses a small built-in gazetteer of Andhra Pradesh places (approximate
// centre coordinates) and straight-line route geometry. GOOGLE uses the Geocoding API with a server key
// (no call is made unless MAPS_PROVIDER=google and MAPS_SERVER_API_KEY are set).
import { config } from '../config';
import { ApiError } from '../lib/errors';
import { haversineKm } from '../lib/geo';

export type Place = { label: string; latitude: number; longitude: number; source: 'demo-gazetteer' | 'google' };

const GAZETTEER: [string, number, number][] = [
  ['Visakhapatnam', 17.6868, 83.2185],
  ['MVP Colony, Visakhapatnam', 17.7406, 83.3365],
  ['RK Beach Road, Visakhapatnam', 17.7149, 83.3236],
  ['Madhurawada, Visakhapatnam', 17.8129, 83.3592],
  ['Seethammadhara, Visakhapatnam', 17.7432, 83.3127],
  ['Dwaraka Nagar, Visakhapatnam', 17.7276, 83.3052],
  ['Gajuwaka, Visakhapatnam', 17.687, 83.208],
  ['Rushikonda, Visakhapatnam', 17.782, 83.385],
  ['Anakapalle', 17.6913, 83.0039],
  ['Vizianagaram', 18.1067, 83.3956],
  ['Srikakulam', 18.2949, 83.8938],
  ['Tuni', 17.3594, 82.5466],
  ['Kakinada', 16.9891, 82.2475],
  ['Rajamahendravaram', 17.0005, 81.804],
  ['Eluru', 16.7107, 81.0952],
  ['Vijayawada', 16.5062, 80.648],
  ['Guntur', 16.3067, 80.4365],
  ['Amaravati', 16.515, 80.515],
  ['Ongole', 15.5057, 80.0499],
  ['Nellore', 14.4426, 79.9865],
  ['Tirupati', 13.6288, 79.4192],
  ['Kurnool', 15.8281, 78.0373],
  ['Kadapa', 14.4673, 78.8242],
  ['Anantapuramu', 14.6819, 77.6006],
];

export async function geocode(query: string): Promise<Place[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (config.maps.provider === 'google') {
    if (!config.maps.serverKey) throw new ApiError(503, 'MAPS_NOT_CONFIGURED', 'Maps provider key is not configured.');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?region=in&address=${encodeURIComponent(query)}&key=${config.maps.serverKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new ApiError(502, 'MAPS_PROVIDER_ERROR', 'Geocoding provider error.');
    const j = (await res.json()) as { results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[] };
    return (j.results || []).slice(0, 6).map((r) => ({ label: r.formatted_address, latitude: r.geometry.location.lat, longitude: r.geometry.location.lng, source: 'google' as const }));
  }
  return GAZETTEER.filter(([n]) => n.toLowerCase().includes(q))
    .slice(0, 8)
    .map(([label, latitude, longitude]) => ({ label, latitude, longitude, source: 'demo-gazetteer' as const }));
}

/** Route geometry. Demo: straight line, distance scaled by a typical road-winding factor and clearly labelled. */
export function route(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const straight = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
  const steps = 24;
  const path: [number, number][] = [];
  for (let i = 0; i <= steps; i++) path.push([a.latitude + ((b.latitude - a.latitude) * i) / steps, a.longitude + ((b.longitude - a.longitude) * i) / steps]);
  return { path, distanceKm: Math.round(straight * 1.25 * 10) / 10, straightKm: Math.round(straight * 10) / 10, source: 'demo-straight-line' as const, note: 'Demo routing: straight-line geometry with a 1.25x road factor. Not turn-by-turn directions.' };
}

export function directionsUrl(lat: number, lng: number) {
  // Opens the user's own maps app; no API key involved.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
