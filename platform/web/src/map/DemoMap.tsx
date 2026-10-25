// Interactive demo map used when no map-provider key is configured. It is a real, data-driven map surface
// (equirectangular projection of the station coordinates) with pan, zoom, keyboard-accessible pins, route
// overlay and click-to-pick coordinates — but it has no street tiles, so it is labelled as a demo map.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type ReactElement } from 'react';
import { Icon } from '../components/Icon';
import type { MapProps } from './types';

const W = 1000;

function bounds(props: MapProps) {
  const lats: number[] = [];
  const lngs: number[] = [];
  props.points.forEach((p) => (lats.push(p.lat), lngs.push(p.lng)));
  props.path?.forEach(([a, b]) => (lats.push(a), lngs.push(b)));
  if (props.pick) lats.push(props.pick.lat), lngs.push(props.pick.lng);
  if (!lats.length) lats.push(17.7, 17.75), lngs.push(83.28, 83.34); // Visakhapatnam
  let [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = Math.max(maxLat - minLat, (maxLng - minLng) * 0.95, 0.04);
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  minLat = cLat - span * 0.62;
  maxLat = cLat + span * 0.62;
  const k = Math.cos((cLat * Math.PI) / 180);
  minLng = cLng - (span * 0.62) / k;
  maxLng = cLng + (span * 0.62) / k;
  return { minLat, maxLat, minLng, maxLng, k };
}

function niceStep(span: number) {
  const steps = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2];
  return steps.find((s) => span / s <= 8) ?? 5;
}

export function DemoMap(props: MapProps) {
  const { points, path, selectedId, onSelect, pick, onPick, height = 420, label = 'Charging station map' } = props;
  // Fit once per data set; user pan/zoom is kept while the same points are shown.
  const key = points.map((p) => p.id).join(',') + (path ? path.length : '') + (onPick ? 'pick' : '');
  const b = useMemo(() => bounds(props), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const H = Math.round((W * (b.maxLat - b.minLat)) / ((b.maxLng - b.minLng) * b.k));
  const proj = (lat: number, lng: number) => [((lng - b.minLng) / (b.maxLng - b.minLng)) * W, ((b.maxLat - lat) / (b.maxLat - b.minLat)) * H] as const;
  const unproj = (x: number, y: number) => [b.maxLat - (y / H) * (b.maxLat - b.minLat), b.minLng + (x / W) * (b.maxLng - b.minLng)] as const;

  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  useEffect(() => setVb({ x: 0, y: 0, w: W, h: H }), [key, H]);
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth || 600, h: el.clientHeight || 400 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const toSvg = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    // preserveAspectRatio="xMidYMid meet": compute the uniform scale actually used
    const s = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = (r.width - vb.w * s) / 2;
    const oy = (r.height - vb.h * s) / 2;
    return [vb.x + (cx - r.left - ox) / s, vb.y + (cy - r.top - oy) / s, s] as const;
  };
  const zoom = (f: number, cx?: number, cy?: number) =>
    setVb((v) => {
      const w = Math.min(W * 1.5, Math.max(W / 40, v.w / f));
      const h = (w * v.h) / v.w;
      const [px, py] = cx === undefined ? [v.x + v.w / 2, v.y + v.h / 2] : toSvg(cx, cy!);
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onDown = (e: RPE<SVGSVGElement>) => {
    if ((e.target as Element).closest('.dm-pin')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPE<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const [, , s] = toSvg(e.clientX, e.clientY);
    const dx = (e.clientX - d.x) / s;
    const dy = (e.clientY - d.y) / s;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
    setVb((v) => ({ ...v, x: d.vx - dx, y: d.vy - dy }));
  };
  const onUp = (e: RPE<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && onPick) {
      const [x, y] = toSvg(e.clientX, e.clientY);
      const [lat, lng] = unproj(x, y);
      onPick(Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6);
    }
  };

  const u = 1 / Math.min(box.w / vb.w, box.h / vb.h); // svg units per screen pixel: pins keep a constant on-screen size
  const step = niceStep(b.maxLat - b.minLat);
  const grid: ReactElement[] = [];
  for (let la = Math.ceil(b.minLat / step) * step; la < b.maxLat; la += step) {
    const [, y] = proj(la, b.minLng);
    grid.push(<line key={'la' + la} x1={-W} x2={W * 2} y1={y} y2={y} />);
  }
  for (let lo = Math.ceil(b.minLng / step) * step; lo < b.maxLng; lo += step) {
    const [x] = proj(b.minLat, lo);
    grid.push(<line key={'lo' + lo} y1={-H} y2={H * 2} x1={x} x2={x} />);
  }

  return (
    <div className="demo-map" style={{ height }} data-testid="demo-map">
      <svg
        ref={svg}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="application"
        aria-label={`${label} (demo map${onPick ? '; click to set the station location' : ''})`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className={onPick ? 'is-pick' : ''}
      >
        <defs>
          <radialGradient id="dm-glow">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={-W} y={-H} width={W * 3} height={H * 3} className="dm-bg" />
        <g className="dm-grid" strokeWidth={u}>
          {grid}
        </g>
        {path && path.length > 1 && (
          <polyline className="dm-route" points={path.map(([a, c]) => proj(a, c).join(',')).join(' ')} strokeWidth={4 * u} strokeDasharray={`${10 * u} ${7 * u}`} />
        )}
        {points.map((p) => {
          const [x, y] = proj(p.lat, p.lng);
          const sel = p.id === selectedId;
          return (
            <g
              key={p.id}
              className={`dm-pin tone-${p.tone || 'neutral'} ${sel ? 'is-selected' : ''}`}
              transform={`translate(${x} ${y}) scale(${u})`}
              role="button"
              tabIndex={0}
              aria-label={p.title}
              aria-pressed={sel}
              data-station={p.id}
              onClick={() => onSelect?.(p.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect?.(p.id))}
            >
              {p.approximate && <circle r={26} className="dm-approx" />}
              {sel && <circle r={40} fill="url(#dm-glow)" />}
              <path d="M0 0 C-4 -9 -13 -14 -13 -24 A13 13 0 1 1 13 -24 C13 -14 4 -9 0 0Z" className="dm-pin-body" />
              <circle cy={-24} r={5} className="dm-pin-dot" />
              {p.label && (
                <g transform="translate(0 -46)">
                  <rect x={-(p.label.length * 4 + 10)} y={-11} width={p.label.length * 8 + 20} height={20} rx={10} className="dm-pin-tag" />
                  <text textAnchor="middle" y={4} className="dm-pin-text">
                    {p.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {pick && (
          <g transform={`translate(${proj(pick.lat, pick.lng).join(' ')}) scale(${u})`} className="dm-pick">
            <circle r={14} />
            <path d="M-22 0H-8M8 0H22M0 -22V-8M0 8V22" />
          </g>
        )}
      </svg>
      <div className="dm-controls">
        <button type="button" className="icon-btn" onClick={() => zoom(1.5)} aria-label="Zoom in">
          <Icon name="zoom-in" />
        </button>
        <button type="button" className="icon-btn" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">
          <Icon name="zoom-out" />
        </button>
        <button type="button" className="icon-btn" onClick={() => setVb({ x: 0, y: 0, w: W, h: H })} aria-label="Fit all">
          <Icon name="locate-fixed" />
        </button>
      </div>
      <div className="dm-badge" title="No map provider key configured. Coordinates are real; street tiles are not shown.">
        <Icon name="map" /> Demo map · no street tiles
      </div>
      <div className="dm-legend" aria-hidden="true">
        <span className="tone-good">Bookable now</span>
        <span className="tone-warn">Closed now</span>
        <span className="tone-bad">Unavailable</span>
        <span className="dm-legend-approx">Approx. location</span>
      </div>
    </div>
  );
}
