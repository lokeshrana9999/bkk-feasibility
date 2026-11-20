// Static data loading. Files come from the build-time pipeline under /data (areas.json lists
// the ย.9 areas and their per-area chunks). Chunks load lazily and are cached per area.

import { areaM2, bboxOf, centroidLL, polysOf, type BBox, type LL, type Poly } from './geo';

export interface Area {
  id: number;
  label: string;
  labelLatin: string;
  far: number;
  osr: number;
  areaM2: number;
  bbox: [number, number, number, number];
  labelPoint: LL;
  files: { row?: string; roads?: string; buildings?: string };
}

export interface ZonePoly {
  id: number;
  zone: string;
  sub: string;
  subLatin: string;
  far: number;
  osr: number;
  colour?: string;
  use?: string;
  polys: Poly[];
  bbox: BBox;
  isY9: boolean;
}

export interface RowFeature {
  id: number;
  name: string;
  kind: 'road' | 'canal' | 'rail';
  polys: Poly[];
  bbox: BBox;
}

export interface Building {
  id: string;
  ring: LL[];
  height: number;
  /** true when the height is estimated (no measured height or floor count). */
  estimated: boolean;
  source: string;
  centroid: LL;
  bbox: BBox;
}

type FC = { type: 'FeatureCollection'; features: { id?: number | string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    // Vite's dev server answers unknown paths with index.html; treat that as missing
    if (ct.includes('text/html')) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const BASE = `${import.meta.env.BASE_URL}data/`;

export async function loadAreas(): Promise<Area[]> {
  const j = await getJson<{ areas: Area[] }>(`${BASE}areas.json`);
  return j?.areas ?? [];
}

function toZones(fc: FC | null, isY9: boolean): ZonePoly[] {
  if (!fc) return [];
  return fc.features.map((f) => {
    const p = f.properties;
    const polys = polysOf(f.geometry);
    return {
      id: Number(p.id ?? f.id),
      zone: String(p.zone ?? ''),
      sub: String(p.sub ?? p.zone ?? ''),
      subLatin: String(p.subLatin ?? p.sub ?? ''),
      far: Number(p.far),
      osr: Number(p.osr),
      colour: p.colour as string | undefined,
      use: p.use as string | undefined,
      polys,
      bbox: bboxOf(polys.flatMap((q) => q[0]!)),
      isY9,
    };
  });
}

export async function loadZonesY9(): Promise<{ zones: ZonePoly[]; fc: FC | null }> {
  const fc = await getJson<FC>(`${BASE}zones_y9.json`);
  return { zones: toZones(fc, true), fc };
}

let allZones: Promise<ZonePoly[]> | null = null;
/** All 600+ zones of the city plan (simplified), loaded on first need for the outside-ย.9 panel. */
export function loadZonesAll(): Promise<ZonePoly[] | null> {
  allZones ??= getJson<FC>(`${BASE}zones_all.json`).then((fc) => {
    if (!fc) {
      allZones = null;
      return null;
    }
    return toZones(fc, false).filter((z) => !z.zone.startsWith('ย.๙'));
  }) as Promise<ZonePoly[]>;
  return allZones;
}

const rowCache = new Map<number, Promise<RowFeature[] | null>>();
/** Right-of-way polygons of an area; null when the file could not be fetched (retry later). */
export function loadRow(area: Area): Promise<RowFeature[] | null> {
  let p = rowCache.get(area.id);
  if (!p) {
    p = getJson<FC>(`${BASE}${area.files.row ?? `row/${area.id}.json`}`).then((fc) => {
      if (!fc) {
        rowCache.delete(area.id);
        return null;
      }
      return (fc.features ?? []).map((f) => {
        const polys = polysOf(f.geometry);
        const k = String(f.properties.kind ?? 'road');
        return {
          id: Number(f.id ?? f.properties.id),
          name: String(f.properties.name ?? ''),
          kind: (k === 'canal' || k === 'rail' ? k : 'road') as RowFeature['kind'],
          polys,
          bbox: bboxOf(polys.flatMap((q) => q[0]!)),
        };
      });
    });
    rowCache.set(area.id, p);
  }
  return p;
}

/** Thai road name reduced to a key that matches across sources ("ซอยนภาศัพท์ 2" ~ "ซอยนภาศัพท์2"). */
export const nameKey = (s: string) => s.replace(/^(ถนน|ซอย|ทาง)/, '').replace(/[\s.()-]+/g, '');

const enCache = new Map<number, Promise<Map<string, string>>>();
/** English road names (OSM name:en) by Thai name key, for edge labels. Empty on failure. */
export function loadRoadNames(area: Area): Promise<Map<string, string>> {
  let p = enCache.get(area.id);
  if (!p) {
    p = getJson<FC>(`${BASE}${area.files.roads ?? `roads/${area.id}.json`}`).then((fc) => {
      const m = new Map<string, string>();
      for (const f of fc?.features ?? []) {
        const th = f.properties.name;
        const en = f.properties.nameEn;
        if (typeof th === 'string' && typeof en === 'string' && en) m.set(nameKey(th), en);
      }
      return m;
    });
    enCache.set(area.id, p);
  }
  return p;
}

/** Height fallback by footprint when a building has neither a height nor a floor count. */
function defaultHeight(a: number): number {
  if (a < 80) return 6;
  if (a < 250) return 9;
  if (a < 800) return 13;
  if (a < 2500) return 20;
  return 28;
}

function toBuildings(fc: FC | null): Building[] {
  if (!fc) return [];
  const out: Building[] = [];
  let i = 0;
  for (const f of fc.features) {
    const p = f.properties;
    for (const poly of polysOf(f.geometry)) {
      const ring = poly[0]!;
      if (ring.length < 3) continue;
      let height: number | null = null;
      let estimated = false;
      // pipeline format: h in metres (or hdm in decimetres) + src; seed format: Overture fields
      if (typeof p.h === 'number') height = p.h;
      else if (typeof p.hdm === 'number') height = p.hdm / 10;
      else if (typeof p.height === 'number' && p.height > 0) height = p.height;
      else if (typeof p.num_floors === 'number' && p.num_floors > 0) height = p.num_floors * 3.3;
      if (typeof p.est === 'boolean') estimated = p.est;
      if (height === null || !(height > 0)) {
        height = defaultHeight(areaM2(ring));
        estimated = true;
      }
      const src = String(p.src ?? p.source ?? '');
      if (/default|footprint|estimate/i.test(src)) estimated = true;
      out.push({ id: String(f.id ?? p.id ?? i++), ring, height, estimated, source: src, centroid: centroidLL(ring), bbox: bboxOf(ring) });
    }
  }
  return out;
}

/** Pipeline format: columnar, quantised lon/lat (see pipeline/README.md). */
interface BuildingChunk {
  v: number;
  origin: [number, number];
  q: number;
  src: string[];
  h: number[]; // decimetres
  s: number[];
  r: number[][];
}

function decodeChunk(c: BuildingChunk): Building[] {
  const out: Building[] = [];
  const [ox, oy] = c.origin;
  for (let i = 0; i < c.r.length; i++) {
    const enc = c.r[i]!;
    const ring: LL[] = [];
    let x = 0;
    let y = 0;
    for (let k = 0; k + 1 < enc.length; k += 2) {
      x += enc[k]!;
      y += enc[k + 1]!;
      ring.push([ox + x * c.q, oy + y * c.q]);
    }
    if (ring.length < 3) continue;
    const srcName = c.src[c.s[i] ?? 3] ?? 'default';
    out.push({
      id: String(i),
      ring,
      height: Math.max(2, (c.h[i] ?? 60) / 10),
      // Open Buildings raster heights and footprint defaults are estimates
      estimated: srcName === 'ob' || srcName === 'default',
      source: srcName,
      centroid: centroidLL(ring),
      bbox: bboxOf(ring),
    });
  }
  return out;
}

const bldCache = new Map<number, Promise<Building[] | null>>();
/** Neighbour buildings of an area; null when the file could not be fetched (retry later). */
export function loadBuildings(area: Area): Promise<Building[] | null> {
  let p = bldCache.get(area.id);
  if (!p) {
    p = getJson<BuildingChunk | FC>(`${BASE}${area.files.buildings ?? `buildings/${area.id}.json`}`).then((j) => {
      if (!j) {
        bldCache.delete(area.id);
        return null;
      }
      if ('r' in j && Array.isArray(j.r)) return decodeChunk(j);
      if ('features' in j && Array.isArray(j.features)) return toBuildings(j);
      return [];
    });
    bldCache.set(area.id, p);
  }
  return p;
}
