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
];

export interface HashState {
  ring?: LL[];
  type?: BuildingType;
}

export function readHash(): HashState {
  const h = new URLSearchParams(window.location.hash.slice(1));
  const out: HashState = {};
  const p = h.get('p');
  if (p) {
    const ring = p.split(';').map((s) => s.split(',').map(Number) as LL);
    if (ring.length >= 3 && ring.every((q) => q.length === 2 && q.every(Number.isFinite) && Math.abs(q[0]) <= 180 && Math.abs(q[1]) <= 90)) out.ring = ring;
  }
  const t = h.get('t');
  if (t && TYPES.some((x) => x.id === t)) out.type = t as BuildingType;
  return out;
}

export function writeHash(ring: LL[] | null, type: BuildingType) {
  const h = new URLSearchParams();
  if (ring) h.set('p', ring.map((q) => `${q[0].toFixed(7)},${q[1].toFixed(7)}`).join(';'));
  h.set('t', type);
  const s = `#${h.toString().replace(/%2C/g, ',').replace(/%3B/g, ';')}`;
  if (s !== window.location.hash) history.replaceState(null, '', s);
}

export const fmt = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
