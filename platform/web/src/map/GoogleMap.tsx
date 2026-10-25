// Google Maps JavaScript API adapter. Used only when the server reports MAPS_PROVIDER=google and a browser key.
// The key is a restricted browser key (HTTP-referrer locked) served by /api/auth/me config — never a server secret.
import { useEffect, useRef, useState } from 'react';
import type { MapProps } from './types';

declare global {
  interface Window {
    google?: any;
    __gpevMapsLoading?: Promise<void>;
  }
}

function load(key: string) {
  if (window.google?.maps) return Promise.resolve();
  if (!window.__gpevMapsLoading)
    window.__gpevMapsLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
      s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error('Google Maps failed to load'));
      document.head.appendChild(s);
    });
  return window.__gpevMapsLoading;
}

export function GoogleMap({ browserKey, onFail, ...p }: MapProps & { browserKey: string; onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layers = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    load(browserKey)
      .then(() => {
        map.current = new window.google.maps.Map(el.current, { center: { lat: 17.72, lng: 83.3 }, zoom: 11, mapTypeControl: false, streetViewControl: false });
        map.current.addListener('click', (e: any) => p.onPick?.(e.latLng.lat(), e.latLng.lng()));
        setReady(true);
      })
      .catch(onFail);
  }, [browserKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    const g = window.google.maps;
    layers.current.forEach((m) => m.setMap(null));
    layers.current = [];
    const bounds = new g.LatLngBounds();
    p.points.forEach((pt) => {
      const m = new g.Marker({ position: { lat: pt.lat, lng: pt.lng }, map: map.current, title: pt.title, label: pt.label });
      m.addListener('click', () => p.onSelect?.(pt.id));
      if (pt.approximate) layers.current.push(new g.Circle({ center: { lat: pt.lat, lng: pt.lng }, radius: 700, map: map.current, strokeOpacity: 0.4, fillOpacity: 0.08 }));
      layers.current.push(m);
      bounds.extend(m.getPosition());
    });
    if (p.path?.length) layers.current.push(new g.Polyline({ path: p.path.map(([lat, lng]) => ({ lat, lng })), map: map.current, strokeWeight: 4 }));
    if (p.pick) layers.current.push(new g.Marker({ position: { lat: p.pick.lat, lng: p.pick.lng }, map: map.current, title: 'Selected location' }));
    if (!bounds.isEmpty()) map.current.fitBounds(bounds, 48);
  }, [ready, p.points, p.path, p.pick]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="google-map" style={{ height: p.height ?? 420 }} aria-label={p.label} />;
}
