// Place search over the static gazetteer (gazetteer.json: ย.9 zones, roads, sois, stations from
// OSM, built by the pipeline). Pure, shared by the app's search box (ui/Search.tsx) and the MCP
// server's search_place tool.

import type { LL } from './geo';

export interface Place {
  t: 'zone' | 'road' | 'soi' | 'station';
  name: string;
  en?: string;
  p: LL;
  /** ย.9 area id the place's point is in; null outside ย.9. */
  area: number | null;
  bbox?: [number, number, number, number];
  /** Rail system of a station (BTS, MRT, ARL, SRT). */
  system?: string;
  ref?: string;
  lenM?: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');

/** A pasted "lat, lng" (Google Maps order) or "lng, lat": the larger magnitude is the longitude (Bangkok). */
export function parseLatLng(s: string): LL | null {
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  let a = Number(m[1]);
  let b = Number(m[2]);
  if (Math.abs(a) < Math.abs(b)) [a, b] = [b, a];
  return [a, b];
}

/**
 * Best matches for a query, Thai or English: exact, then prefix, then substring; places inside
 * a ย.9 area first, zones first among equals.
 */
export function searchPlaces(entries: Place[], q: string, limit = 8): Place[] {
  const n = norm(q.trim());
  if (!n) return [];
  const scored: [number, Place][] = [];
  for (const e of entries) {
    const a = norm(e.name);
    const b = e.en ? norm(e.en) : '';
    let sc = -1;
    if (a === n || b === n) sc = 0;
    else if (a.startsWith(n) || b.startsWith(n)) sc = 1;
    else if (a.includes(n) || b.includes(n)) sc = 2;
    if (sc < 0) continue;
    scored.push([sc * 10 + (e.area ? 0 : 5) + (e.t === 'zone' ? -1 : 0), e]);
  }
  scored.sort((x, y) => x[0] - y[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}
