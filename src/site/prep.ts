// Plot preparation before evaluation: the drawn outline becomes the buildable plot.
//  1. repeated corners are merged;
//  2. a road / canal edge drawn within 1.5 m of the right-of-way is snapped onto it (a gap that
//     small is a drawing slip at map scale: one pixel is ~0.3 m at zoom 18);
//  3. any part of the plot on a public right-of-way (road, canal, rail) is cut away; if the
//     right-of-way splits the plot, the largest piece is kept.
// Each step that changes the outline leaves a notice for the panel. No legal rule lives here.

import { EndType, FillRule, JoinType, areaPaths, difference, inflatePaths, union, type Path64, type Paths64 } from 'clipper2-ts';
import { bboxHit, bboxOf, makeFrame, openRing, signedArea, toLL, toXY, type BBox, type LL, type XY } from './geo';
import { detectEdges, type DetectedEdge } from './roads';
import type { RowFeature } from './data';

export const SNAP_MAX = 1.5; // m

export interface Snap {
  /** Edge index in the drawn outline (0-based). */
  edge: number;
  by: number;
  label?: string;
  /** The snapped edge, lon/lat, to match it among the final edges. */
  seg: [LL, LL];
}

export interface Prepared {
  ring: LL[];
  /** Road / canal / neighbour detection for each edge of `ring`. */
  edges: DetectedEdge[];
  /** m2 of the drawn plot that lies on the right-of-way and was removed. */
  removed: number;
  /** m2 of plot dropped because the right-of-way split it (smaller pieces). */
  dropped: number;
  /** Area of the drawn outline (after merging repeated corners). */
  drawnArea: number;
  snaps: Snap[];
  rowNames: string[];
  merged: number;
  /** A right-of-way lies wholly inside the plot (a hole the engine cannot take); it is ignored. */
  interiorRow: boolean;
}

const MM = 1000;
const toPath = (r: XY[]): Path64 => r.map((p) => ({ x: Math.round(p[0] * MM), y: Math.round(p[1] * MM) }));
const fromPath = (p: Path64): XY[] => p.map((q) => [q.x / MM, q.y / MM]);

/** Drop repeated corners (< 1 cm apart) and corners on a straight line (< 1 cm off). */
export function cleanRing(r: XY[]): XY[] {
  let out = r.filter((p, i) => {
    const q = r[(i + 1) % r.length]!;
    return Math.hypot(q[0] - p[0], q[1] - p[1]) >= 0.01;
  });
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length]!;
      const p = out[i]!;
      const b = out[(i + 1) % out.length]!;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d = L > 0 ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L : 0;
      const between = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) > 0 && (p[0] - b[0]) * (a[0] - b[0]) + (p[1] - b[1]) * (a[1] - b[1]) > 0;
      if (d < 0.01 && between) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

const OPEN = 5; // mm
function open(p: Paths64): Paths64 {
  if (!p.length) return p;
  const shrunk = inflatePaths(p, -OPEN, JoinType.Miter, EndType.Polygon, 4);
  return shrunk.length ? inflatePaths(shrunk, OPEN, JoinType.Miter, EndType.Polygon, 4) : [];
}

/** A corner where the outline doubles straight back on itself. */
function hasSpike(r: XY[]): boolean {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % n]!;
    const c = r[(i + 2) % n]!;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (dot < 0 && Math.abs(cr) <= 1e-6 * len) return true;
  }
  return false;
}

/** Do two non-adjacent edges of the ring cross? */
function crosses(r: XY[]): boolean {
  const n = r.length;
  const o = (p: XY, q: XY, s: XY) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
  for (let i = 0; i < n; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = r[j]!;
      const d = r[(j + 1) % n]!;
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0])) continue;
      if (o(a, b, c) * o(a, b, d) <= 0 && o(c, d, a) * o(c, d, b) <= 0) return true;
    }
  }
  return false;
}

/** Move edge i of a ring outward by g metres, sliding its ends along the neighbouring edges. */
function pushEdge(r: XY[], i: number, g: number): XY[] {
  const n = r.length;
  const a = r[i]!;
  const b = r[(i + 1) % n]!;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return r;
  const ccw = signedArea(r) > 0;
  const d: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const nOut: XY = ccw ? [d[1], -d[0]] : [-d[1], d[0]];
  const slide = (p: XY, from: XY): XY => {
    const l = Math.hypot(p[0] - from[0], p[1] - from[1]);
    if (l > 1e-6) {
      const u: XY = [(p[0] - from[0]) / l, (p[1] - from[1]) / l];
      const k = u[0] * nOut[0] + u[1] * nOut[1];
      if (Math.abs(k) > 0.3) {
        const t = g / k;
        return [p[0] + u[0] * t, p[1] + u[1] * t];
      }
    }
    return [p[0] + nOut[0] * g, p[1] + nOut[1] * g];
  };
  const out = [...r];
  out[i] = slide(a, r[(i - 1 + n) % n]!);
  out[(i + 1) % n] = slide(b, r[(i + 2) % n]!);
  return out;
}

export function preparePlot(drawn: LL[], rows: RowFeature[]): Prepared {
  const f = makeFrame(drawn[0]![0], drawn[0]![1]);
  const raw = openRing(drawn).map((p) => toXY(f, p));
  let xy = cleanRing(raw);
  const merged = raw.length - xy.length;
  const drawnArea = Math.abs(signedArea(xy));
  const ll = (r: XY[]) => r.map((p) => toLL(f, p));

  const absA = (r: XY[]) => Math.abs(signedArea(r));

  // right-of-way near the plot, as one clipper union
  const bb = bboxOf(ll(xy));
  const m = 0.0008;
  const near: BBox = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
  const cut: Paths64 = [];
  const names = new Set<string>();
  for (const feat of rows) {
    if (!bboxHit(feat.bbox, near)) continue;
    if (feat.name) names.add(feat.name);
    for (const poly of feat.polys) {
      for (const ring of poly) cut.push(toPath(openRing(ring).map((p) => toXY(f, p as LL))));
    }
  }
  const rowU = cut.length ? union(cut, FillRule.NonZero) : [];

  // 2. snap small gaps, then 3. cut the right-of-way away. Twice: a cut can expose a new edge
  // that runs just short of the road (a corner plot drawn over one road and short of the other).
  const snaps: Snap[] = [];
  let ring = xy;
  let added = 0;
  let dropped = 0;
  let interiorRow = false;
  // detection of the current ring, reused while the ring does not change
  let det: DetectedEdge[] | null = null;
  for (let pass = 0; pass < 3 && ring.length >= 3; pass++) {
    let snapped = false;
    if (rows.length) {
      det = detectEdges(ll(ring), rows);
      det.forEach((e, i) => {
        if (e.role === 'private' || e.gap === undefined || e.gap <= 0 || e.gap >= SNAP_MAX) return;
        const before = absA(ring);
        ring = pushEdge(ring, i, e.gap + 0.05); // a little past the line; the cut trims it exact
        // count the strip up to the road, not the 5 cm overshoot the cut takes back
        added += ((absA(ring) - before) * e.gap) / (e.gap + 0.05);
        const n = ring.length;
        snaps.push({ edge: i, by: e.gap, label: e.label, seg: [toLL(f, ring[i]!), toLL(f, ring[(i + 1) % n]!)] });
        snapped = true;
      });
    }
    if (snapped) det = null;
    if (pass > 0 && !snapped) break;
    if (!rowU.length) {
      if (!snapped) break;
      continue;
    }
    const plotPath = toPath(ring);
    const plotA = Math.abs(areaPaths([plotPath])) / (MM * MM);
    // a 5 mm opening splits pieces that touch at a point (clipper may return one pinched ring,
    // which the engine would read as self-crossing) and drops hairline slivers
    const rest = open(difference([plotPath], rowU, FillRule.NonZero));
    const restA = Math.abs(areaPaths(rest)) / (MM * MM);
    if (plotA - restA <= 0.5) {
      if (!snapped) break; // ring unchanged since the detection: it is final
      continue;
    }
    det = null;
    // outer rings have the plot's orientation sign; holes the other
    const sign = Math.sign(areaPaths([plotPath]));
    const outers = rest.filter((p) => Math.sign(areaPaths([p])) === sign);
    interiorRow ||= rest.length > outers.length;
    outers.sort((p, q) => Math.abs(areaPaths([q])) - Math.abs(areaPaths([p])));
    dropped += outers.slice(1).reduce((s, p) => s + Math.abs(areaPaths([p])) / (MM * MM), 0);
    if (outers.length) {
      const rawR = fromPath(outers[0]!);
      const c = cleanRing(rawR);
      // dropping in-line corners must never make the outline cross itself
      ring = crosses(c) ? rawR : c;
    } else ring = [];
  }
  // a snap on a jagged outline can fold an edge over its neighbour: rebuild such a ring as the
  // simple polygon it encloses (largest piece)
  if (ring.length >= 3 && (crosses(ring) || hasSpike(ring))) {
    const fixed = open(union([toPath(ring)], FillRule.NonZero)).sort((p, q) => Math.abs(areaPaths([q])) - Math.abs(areaPaths([p])));
    ring = fixed.length ? fromPath(fixed[0]!) : [];
    det = null;
  }
  const kept = ring.length >= 3 ? absA(ring) : 0;
  // what lay on the right-of-way as drawn (snapping added the strips up to it)
  const removed = Math.max(0, drawnArea + added - kept - dropped);
  const out = ring.length >= 3 ? ll(ring) : [];
  const edges = out.length ? (det && det.length === out.length ? det : detectEdges(out, rows)) : [];
  return { ring: out, edges, removed, dropped, drawnArea, snaps, rowNames: [...names], merged, interiorRow };
}
