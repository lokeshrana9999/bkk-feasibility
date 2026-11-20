// Plot preparation before evaluation: the drawn outline becomes the buildable plot.
//  1. repeated corners are merged;
//  2. a road / canal edge drawn within 1.5 m of the right-of-way is snapped onto it (a gap that
//     small is a drawing slip at map scale: one pixel is ~0.3 m at zoom 18);
//  3. any part of the plot on a public right-of-way (road, canal, rail) is cut away; if the
//     right-of-way splits the plot, the largest piece is kept.
// Each step that changes the outline leaves a notice for the panel. No legal rule lives here.

import { FillRule, areaPaths, difference, union, type Path64, type Paths64 } from 'clipper2-ts';
import { bboxHit, bboxOf, makeFrame, openRing, signedArea, toLL, toXY, type BBox, type LL, type XY } from './geo';
import { detectEdges } from './roads';
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

  // 2. snap small gaps (detected on the cleaned outline)
  const snaps: Snap[] = [];
  if (rows.length) {
    const det = detectEdges(ll(xy), rows);
    det.forEach((e, i) => {
      if (e.role === 'private' || e.gap === undefined || e.gap <= 0 || e.gap >= SNAP_MAX) return;
      xy = pushEdge(xy, i, e.gap + 0.05); // a little past the line; the cut below trims it exact
      const n = xy.length;
      snaps.push({ edge: i, by: e.gap, label: e.label, seg: [toLL(f, xy[i]!), toLL(f, xy[(i + 1) % n]!)] });
    });
  }

  // 3. cut away the right-of-way
  const bb = bboxOf(ll(xy));
  const m = 0.0005;
  const near: BBox = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
  const cut: Paths64 = [];
  const names = new Set<string>();
  for (const feat of rows) {
    if (!bboxHit(feat.bbox, near)) continue;
    for (const poly of feat.polys) {
      for (const ring of poly) cut.push(toPath(openRing(ring).map((p) => toXY(f, p as LL))));
    }
  }
  const plotPath = toPath(xy);
  const plotA = Math.abs(areaPaths([plotPath])) / (MM * MM);
  let ring = xy;
  let removed = 0;
  let dropped = 0;
  let interiorRow = false;
  if (cut.length) {
    const rowU = union(cut, FillRule.NonZero);
    const rest = difference([plotPath], rowU, FillRule.NonZero);
    const restA = Math.abs(areaPaths(rest)) / (MM * MM);
    if (plotA - restA > 0.5) {
      // outer rings are the ones with the plot's orientation sign; holes have the other sign
      const sign = Math.sign(areaPaths([plotPath]));
      const outers = rest.filter((p) => Math.sign(areaPaths([p])) === sign);
      interiorRow = rest.length > outers.length;
      outers.sort((p, q) => Math.abs(areaPaths([q])) - Math.abs(areaPaths([p])));
      if (outers.length) {
        ring = cleanRing(fromPath(outers[0]!));
        const keptA = Math.abs(areaPaths([outers[0]!])) / (MM * MM);
        dropped = outers.slice(1).reduce((s, p) => s + Math.abs(areaPaths([p])) / (MM * MM), 0);
        removed = Math.max(0, plotA - keptA - dropped);
        for (const feat of rows) if (bboxHit(feat.bbox, near) && feat.name) names.add(feat.name);
      } else {
        ring = [];
        removed = plotA;
      }
    }
  }
  // snaps add a sliver up to the right-of-way; count only what lay on it as drawn
  removed = Math.max(0, removed - snaps.reduce((s, x) => s + (x.by + 0.05) * Math.hypot(...(sub(x.seg, f) as [number, number])), 0));
  return { ring: ll(ring), removed, dropped, drawnArea, snaps, rowNames: [...names], merged, interiorRow };
}

function sub(seg: [LL, LL], f: ReturnType<typeof makeFrame>): [number, number] {
  const a = toXY(f, seg[0]);
  const b = toXY(f, seg[1]);
  return [b[0] - a[0], b[1] - a[1]];
}
