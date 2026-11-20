// Road / canal detection for each plot edge by ray-casting against the city's right-of-way
// polygons (DOL map sheets via BMA). Per edge: rays every ~1 m go outward, perpendicular to the
// edge. An edge faces a right-of-way when >= 60% of its rays enter one within 3 m. The width is
// the crossing length of that right-of-way, taken as the shortest of five ray angles (so a plot
// edge that is not parallel to the road does not inflate it), median over the rays.
// No legal rule lives here: this only says what is next to each edge.

import type { EdgeRole } from '../engine/types';
import { bboxHit, bboxOf, makeFrame, openRing, pointInPoly, signedArea, toXY, type BBox, type LL, type XY } from './geo';
import type { RowFeature } from './data';

export interface DetectedEdge {
  role: EdgeRole;
  width?: number;
  gap?: number;
  /** Key the engine uses to tell roads apart (same key = same road). */
  name?: string;
  /** Human label, eg "Sukhumvit 38" or "public way". */
  label?: string;
  source: 'city' | 'none';
  length: number;
  /** Share of rays that hit a right-of-way within 3 m. */
  hitShare: number;
  rowId?: number;
  rowKind?: RowFeature['kind'];
  /** Median metres the plot reaches into the right-of-way (drawn over the road). */
  overlap: number;
}

const HIT_WITHIN = 3; // m outward from the edge
const HIT_SHARE = 0.6;
const BACK = 3; // rays start this far inside the plot, to catch plots drawn over the road edge
const REACH = 120; // m, longest crossing considered
const ANGLES = [0, -15, 15, -30, 30].map((d) => (d * Math.PI) / 180);

interface XYPoly {
  feat: RowFeature;
  rings: XY[][];
  bbox: BBox;
}

const GENERIC: Record<string, string> = {
  'ทางสาธารณประโยชน์': 'public way',
  'ถนนสาธารณประโยชน์': 'public road',
  'ลำรางสาธารณประโยชน์': 'public ditch',
  'ที่สาธารณประโยชน์': 'public land',
};

/** Latin label for common Bangkok road names; the Thai name stays as the key. */
export function roadLabel(name: string): string {
  if (GENERIC[name]) return GENERIC[name]!;
  const m = name.match(/^(?:ถนน|ซอย)?สุขุมวิท\s*(\d+.*)?$/);
  if (m) return m[1] ? `Sukhumvit ${m[1]}` : 'Sukhumvit';
  const r = name.match(/^ถนนพระราม\s*(\d+)$/);
  if (r) return `Rama ${r[1]}`;
  return name;
}

/** Interval [s0, s1] along a ray that lies inside one right-of-way polygon. */
interface Span {
  s0: number;
  s1: number;
  feat: RowFeature;
}

function raySpans(p: XY, d: XY, polys: XYPoly[], sMin: number, sMax: number): Span[] {
  const rb: BBox = [
    Math.min(p[0] + d[0] * sMin, p[0] + d[0] * sMax),
    Math.min(p[1] + d[1] * sMin, p[1] + d[1] * sMax),
    Math.max(p[0] + d[0] * sMin, p[0] + d[0] * sMax),
    Math.max(p[1] + d[1] * sMin, p[1] + d[1] * sMax),
  ];
  const spans: Span[] = [];
  for (const P of polys) {
    if (!bboxHit(P.bbox, rb)) continue;
    const ts: number[] = [];
    for (const ring of P.rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const q = ring[i]!;
        const r = ring[(i + 1) % n]!;
        const ex = r[0] - q[0];
        const ey = r[1] - q[1];
        const den = d[0] * ey - d[1] * ex;
        if (Math.abs(den) < 1e-12) continue;
        const qx = q[0] - p[0];
        const qy = q[1] - p[1];
        const s = (qx * ey - qy * ex) / den;
        const u = (qx * d[1] - qy * d[0]) / den;
        if (u >= 0 && u < 1 && s > sMin && s < sMax) ts.push(s);
      }
    }
    let inside = pointInPoly([p[0] + d[0] * sMin, p[1] + d[1] * sMin], P.rings);
    if (ts.length === 0 && !inside) continue;
    ts.sort((a, b) => a - b);
    let start = inside ? sMin : NaN;
    for (const t of ts) {
      if (inside) spans.push({ s0: start, s1: t, feat: P.feat });
      else start = t;
      inside = !inside;
    }
    if (inside) spans.push({ s0: start, s1: sMax, feat: P.feat });
  }
  spans.sort((a, b) => a.s0 - b.s0);
  // neighbouring right-of-way parcels (one road split in pieces) count as one crossing
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.s0 <= last.s1 + 0.5) last.s1 = Math.max(last.s1, s.s1);
    else merged.push({ ...s });
  }
  return merged;
}

/** The crossing next to the plot edge: starts within HIT_WITHIN m and ends outside the edge. */
const firstNear = (spans: Span[], within: number) => spans.find((s) => s.s0 <= within && s.s1 > 0.05);

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function detectEdges(ringIn: LL[], rows: RowFeature[]): DetectedEdge[] {
  const ring = openRing(ringIn);
  const n = ring.length;
  const f = makeFrame(ring[0]![0], ring[0]![1]);
  const xy = ring.map((p) => toXY(f, p));
  const ccw = signedArea(xy) > 0;
  const bb = bboxOf(ring);
  const m = 0.0016; // ~170 m
  const near: BBox = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
  const polys: XYPoly[] = [];
  for (const feat of rows) {
    if (!bboxHit(feat.bbox, near)) continue;
    for (const poly of feat.polys) {
      const rings = poly.map((r) => openRing(r).map((p) => toXY(f, p as LL)));
      polys.push({ feat, rings, bbox: bboxOf(rings[0]!) });
    }
  }

  type Raw = DetectedEdge & { widths: number[]; dir: XY };
  const raws: Raw[] = [];
  for (let i = 0; i < n; i++) {
    const a = xy[i]!;
    const b = xy[(i + 1) % n]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: XY = L > 0 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [1, 0];
    const out: XY = ccw ? [dir[1], -dir[0]] : [-dir[1], dir[0]];
    const ns = Math.max(3, Math.min(40, Math.ceil(L)));
    let hits = 0;
    const widths: number[] = [];
    const gaps: number[] = [];
    const overlaps: number[] = [];
    const featCount = new Map<RowFeature, number>();
    for (let k = 0; k < ns; k++) {
      // skip the last 8% at each end: rays from a corner run along the neighbouring road
      const t = 0.08 + (0.84 * (k + 0.5)) / ns;
      const p: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const s = firstNear(raySpans(p, out, polys, -BACK, REACH), HIT_WITHIN);
      if (!s) continue;
      hits++;
      featCount.set(s.feat, (featCount.get(s.feat) ?? 0) + 1);
      gaps.push(Math.max(0, s.s0));
      overlaps.push(Math.max(0, -s.s0));
      let w = s.s1 - s.s0;
      // angled rays on every other hit keep the cost down; the shortest crossing is the width
      if (k % 2 === 0) {
        for (const ang of ANGLES.slice(1)) {
          const c = Math.cos(ang);
          const sn = Math.sin(ang);
          const d: XY = [out[0] * c - out[1] * sn, out[1] * c + out[0] * sn];
          const s2 = firstNear(raySpans(p, d, polys, -BACK, REACH), HIT_WITHIN / c);
          if (s2) w = Math.min(w, s2.s1 - s2.s0);
        }
      }
      widths.push(w);
    }
    const share = hits / ns;
    let feat: RowFeature | undefined;
    let best = 0;
    for (const [ft, c] of featCount) if (c > best) [feat, best] = [ft, c];
    if (share >= HIT_SHARE && feat) {
      const generic = GENERIC[feat.name] !== undefined || feat.name === '';
      const role: EdgeRole = feat.kind === 'canal' ? 'canal' : feat.kind === 'rail' ? 'private' : 'road';
      raws.push({
        role,
        width: role === 'private' ? undefined : median(widths),
        gap: role === 'private' ? undefined : median(gaps),
        // generic names ("public way") are many different ways: key them by parcel id
        name: generic ? `${feat.name || 'way'} #${feat.id}` : feat.name,
        label: feat.kind === 'rail' ? `railway (${roadLabel(feat.name)})` : roadLabel(feat.name),
        source: 'city',
        length: L,
        hitShare: share,
        rowId: feat.id,
        rowKind: feat.kind,
        overlap: median(overlaps),
        widths,
        dir,
      });
    } else {
      raws.push({ role: 'private', source: 'none', length: L, hitShare: share, overlap: 0, widths: [], dir });
    }
  }

  // consecutive edges on the same right-of-way parcel, turning less than 35 degrees, are one
  // road: give them one width so the engine sees one chain
  const cosMax = Math.cos((35 * Math.PI) / 180);
  const group: number[] = raws.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = raws[i]!;
    const B = raws[j]!;
    if (j === 0 && n < 3) continue;
    if (A.role !== 'private' && A.rowId !== undefined && A.rowId === B.rowId && A.dir[0] * B.dir[0] + A.dir[1] * B.dir[1] > cosMax) {
      const gi = group[i]!;
      const gj = group[j]!;
      for (let k = 0; k < n; k++) if (group[k] === gj) group[k] = gi;
    }
  }
  const pooled = new Map<number, number[]>();
  raws.forEach((r, i) => {
    if (r.width === undefined) return;
    const g = group[i]!;
    pooled.set(g, [...(pooled.get(g) ?? []), ...r.widths]);
  });
  return raws.map((r, i) => {
    const { widths, dir, ...e } = r;
    void dir;
    if (e.width !== undefined) {
      const w = median(pooled.get(group[i]!) ?? widths);
      e.width = Math.min(100, Math.max(1, Math.round(w * 10) / 10));
      e.gap = e.gap !== undefined && e.gap >= 0.3 ? Math.round(e.gap * 10) / 10 : 0;
    }
    e.overlap = Math.round(e.overlap * 10) / 10;
    return e;
  });
}
