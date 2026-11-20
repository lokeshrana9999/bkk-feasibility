// UI-side types and small helpers: edge overrides, share-link hash, demo plots.

import type { BuildingType, EdgeInfo, EdgeRole } from '../engine/types';
import type { DetectedEdge } from '../site/roads';
import type { LL } from '../site/geo';

export interface EdgeOverride {
  role?: EdgeRole;
  width?: number;
  gap?: number;
}

export interface UiEdge extends EdgeInfo {
  label?: string;
  length: number;
  detected: DetectedEdge;
  edited: boolean;
}

/** Default width when the user marks an edge as a road or canal the city data does not show. */
const DEFAULT_W: Record<EdgeRole, number> = { road: 6, canal: 6, private: 0 };

export function mergeEdges(det: DetectedEdge[], ov: Record<number, EdgeOverride>): UiEdge[] {
  return det.map((d, i) => {
    const o = ov[i];
    const role = o?.role ?? d.role;
    const edited = !!o && (o.role !== undefined || o.width !== undefined || o.gap !== undefined);
    if (role === 'private') {
      return { role, source: edited ? 'user' : d.source, length: d.length, detected: d, edited, label: d.role === 'private' ? d.label : undefined };
    }
    const sameKind = d.role === role;
    const width = o?.width ?? (sameKind ? d.width : undefined) ?? DEFAULT_W[role];
    const gap = o?.gap ?? (sameKind ? d.gap : undefined) ?? 0;
    return {
      role,
      width,
      gap,
      name: sameKind ? d.name : undefined,
      label: sameKind ? d.label : undefined,
      source: edited ? 'user' : d.source,
      length: d.length,
      detected: d,
      edited,
    };
  });
}

export const toEngineEdge = (e: UiEdge): EdgeInfo => {
  const out: EdgeInfo = { role: e.role, source: e.source };
  if (e.role !== 'private') {
    out.width = e.width;
    out.gap = e.gap ?? 0;
  }
  if (e.name) out.name = e.name;
  return out;
};

export const TYPES: { id: BuildingType; label: string }[] = [
  { id: 'condo', label: 'Condo' },
  { id: 'apartment', label: 'Apartment' },
  { id: 'office', label: 'Office' },
  { id: 'hotel', label: 'Hotel' },
];

export interface Demo {
  id: string;
  label: string;
  ring: LL[];
}

/** Shape from a frontage rectangle A-B (on the road) and depth corner D, in (u, v) fractions. */
function shapeOn(A: LL, B: LL, D: LL, uv: [number, number][]): LL[] {
  return uv.map(([u, v]) => [A[0] + u * (B[0] - A[0]) + v * (D[0] - A[0]), A[1] + u * (B[1] - A[1]) + v * (D[1] - A[1])] as LL);
}
const S38: [LL, LL, LL] = [[100.5793403, 13.7210608], [100.5793802, 13.7207012], [100.5797522, 13.7211045]];
const S36: [LL, LL, LL] = [[100.5768191, 13.7224155], [100.5767255, 13.7220655], [100.5772199, 13.7223131]];
const S40: [LL, LL, LL] = [[100.5805892, 13.7121343], [100.5805803, 13.7117726], [100.5810033, 13.7121246]];

// Plots in ย.9-23 around Sukhumvit Soi 36-42, laid against the city right-of-way polygons
// (frontage 40 m, depth 45 m before shaping), fully inside the zone and off the road.
export const DEMOS: Demo[] = [
  { id: 'soi38', label: 'Rectangle, Sukhumvit 38 (1,800 m²)', ring: shapeOn(...S38, [[0, 0], [1, 0], [1, 1], [0, 1]]) },
  { id: 'soi36-l', label: 'L-shape, Sukhumvit 36', ring: shapeOn(...S36, [[0, 0], [1, 0], [1, 0.45], [0.5, 0.45], [0.5, 1], [0, 1]]) },
  { id: 'soi40-odd', label: 'Irregular, Sukhumvit 40', ring: shapeOn(...S40, [[0, 0], [1, 0], [1.1, 0.55], [0.75, 1.05], [0.05, 0.9]]) },
  { id: 'soi38-small', label: 'Narrow lot, Sukhumvit 38 (15 x 45 m)', ring: shapeOn(...S38, [[0.3, 0], [0.675, 0], [0.675, 1], [0.3, 1]]) },
  {
    id: 'corner36',
    label: 'Corner, Sukhumvit 36 x Soi Naphasap 2',
    ring: [[100.5763056, 13.7220546], [100.5766754, 13.7220546], [100.5766754, 13.7224162], [100.5763056, 13.7224162]],
  },
];

/**
 * Everything needed to reproduce a result, in the URL hash:
 *   p  = lon,lat;lon,lat;...   drawn outline
 *   t  = condo | apartment | office | hotel
 *   e  = 0:r20,2:c8g1.5,3:p    edge edits: index, role (r road, c canal, p neighbour), width, gap
 *   s  = 1                      within 500 m of a station
 *   rl = 0                      wider-road relief off
 *   fh = 4.5x3.2                floor-to-floor heights, ground x typical
 */
export interface HashState {
  ring?: LL[];
  type?: BuildingType;
  edges?: Record<number, EdgeOverride>;
  station?: boolean;
  relief?: boolean;
  floorH?: { ground: number; typical: number };
  /** Parts of the hash that were present but could not be read. */
  bad: string[];
}

const ROLE_CODE: Record<EdgeRole, string> = { road: 'r', canal: 'c', private: 'p' };
const CODE_ROLE: Record<string, EdgeRole> = { r: 'road', c: 'canal', p: 'private' };

export function readHash(hash = window.location.hash): HashState {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const out: HashState = { bad: [] };
  const p = h.get('p');
  if (p !== null) {
    const ring = p.split(';').map((s) => s.split(',').map(Number) as LL);
    if (ring.length >= 3 && ring.length <= 2000 && ring.every((q) => q.length === 2 && q.every(Number.isFinite) && Math.abs(q[0]) <= 180 && Math.abs(q[1]) <= 90)) out.ring = ring;
    else out.bad.push('plot outline');
  }
  const t = h.get('t');
  if (t !== null) {
    if (TYPES.some((x) => x.id === t)) out.type = t as BuildingType;
    else out.bad.push('building type');
  }
  const e = h.get('e');
  if (e !== null && e !== '') {
    const edges: Record<number, EdgeOverride> = {};
    let ok = true;
    for (const part of e.split(',')) {
      const m = part.match(/^(\d{1,3}):([rcp])(\d+(?:\.\d+)?)?(?:g(\d+(?:\.\d+)?))?$/);
      if (!m) {
        ok = false;
        continue;
      }
      const role = CODE_ROLE[m[2]!]!;
      const o: EdgeOverride = { role };
      if (m[3] !== undefined) {
        const w = Number(m[3]);
        if (w >= 1 && w <= 100 && role !== 'private') o.width = w;
        else ok = false;
      }
      if (m[4] !== undefined) {
        const g = Number(m[4]);
        if (g >= 0 && g <= 50 && role !== 'private') o.gap = g;
        else ok = false;
      }
      edges[Number(m[1])] = o;
    }
    out.edges = edges;
    if (!ok) out.bad.push('edge edits');
  }
  const s = h.get('s');
  if (s !== null) {
    if (s === '1' || s === '0') out.station = s === '1';
    else out.bad.push('station flag');
  }
  const rl = h.get('rl');
  if (rl !== null) {
    if (rl === '1' || rl === '0') out.relief = rl === '1';
    else out.bad.push('relief flag');
  }
  const fh = h.get('fh');
  if (fh !== null) {
    const m = fh.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
    const g = m ? Number(m[1]) : NaN;
    const ty = m ? Number(m[2]) : NaN;
    if (g >= 2.4 && g <= 10 && ty >= 2.4 && ty <= 10) out.floorH = { ground: g, typical: ty };
    else out.bad.push('floor heights');
  }
  return out;
}

export interface ShareState {
  ring: LL[] | null;
  type: BuildingType;
  edges: Record<number, EdgeOverride>;
  station: boolean;
  relief: boolean;
  floorH: { ground: number; typical: number } | null;
}

export function hashOf(st: ShareState): string {
  const parts: string[] = [];
  if (st.ring) parts.push(`p=${st.ring.map((q) => `${q[0].toFixed(7)},${q[1].toFixed(7)}`).join(';')}`);
  parts.push(`t=${st.type}`);
  const e = Object.entries(st.edges)
    .filter(([, o]) => o.role !== undefined)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([i, o]) => `${i}:${ROLE_CODE[o.role!]}${o.width !== undefined && o.role !== 'private' ? o.width : ''}${o.gap !== undefined && o.role !== 'private' ? `g${o.gap}` : ''}`);
  if (e.length) parts.push(`e=${e.join(',')}`);
  if (st.station) parts.push('s=1');
  if (!st.relief) parts.push('rl=0');
  if (st.floorH) parts.push(`fh=${st.floorH.ground}x${st.floorH.typical}`);
  return `#${parts.join('&')}`;
}

let wroteOnce = false;
/**
 * Write the share link. The first write replaces the entry the page opened with; later writes
 * add history entries, so Back steps through earlier plots instead of leaving the app.
 */
export function writeHash(st: ShareState) {
  const s = hashOf(st);
  if (s === window.location.hash) {
    wroteOnce = true;
    return;
  }
  if (wroteOnce) history.pushState(null, '', s);
  else history.replaceState(null, '', s);
  wroteOnce = true;
}

export const fmt = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
