// Plain point / segment geometry in metres. No clipper: the checker uses only
// this file, so its measurements are independent of the envelope's booleans.

import type { Polygon, XY } from './types.js';

export function pointSegDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function orient(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function segsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** Exact distance between two segments (0 when they cross). */
export function segSegDist(a: XY, b: XY, c: XY, d: XY): number {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

export function polylineDist(p: XY[], q: XY[]): number {
  let m = Infinity;
  for (let i = 0; i + 1 < p.length; i++) {
    for (let j = 0; j + 1 < q.length; j++) {
      const d = segSegDist(p[i]!, p[i + 1]!, q[j]!, q[j + 1]!);
      if (d < m) m = d;
    }
  }
  return m;
}

export function pointPolylineDist(p: XY, q: XY[]): number {
  let m = Infinity;
  for (let j = 0; j + 1 < q.length; j++) {
    const d = pointSegDist(p, q[j]!, q[j + 1]!);
    if (d < m) m = d;
  }
  return m;
}

/** Closed ring as a polyline (first point repeated at the end). */
export function closeRing(r: XY[]): XY[] {
  return r.length === 0 ? [] : [...r, r[0]!];
}

export function ringArea(r: XY[]): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % n]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Net area of polygons (outer + holes), independent of ring orientation. */
export function polygonsArea(polys: Polygon[]): number {
  let s = 0;
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringArea(ring));
      s += i === 0 ? a : -a;
    });
  }
  return s;
}

export function pointInRing(p: XY, r: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!;
    const b = r[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function distToRing(p: XY, r: XY[]): number {
  return pointPolylineDist(p, closeRing(r));
}

/** Point inside a polygon set, counting points within tol of a boundary as inside. */
export function pointInPolygons(p: XY, polys: Polygon[], tol: number): boolean {
  for (const poly of polys) {
    for (const ring of poly) if (distToRing(p, ring) <= tol) return true;
  }
  for (const poly of polys) {
    const [outer, ...holes] = poly;
    if (outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h))) return true;
  }
  return false;
}

/** Every boundary segment of a polygon set. */
export function polygonSegments(polys: Polygon[]): [XY, XY][] {
  const segs: [XY, XY][] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) segs.push([ring[i]!, ring[(i + 1) % ring.length]!]);
    }
  }
  return segs;
}

export function segmentsToPolylineDist(segs: [XY, XY][], q: XY[]): number {
  let m = Infinity;
  for (const [a, b] of segs) {
    for (let j = 0; j + 1 < q.length; j++) {
      const d = segSegDist(a, b, q[j]!, q[j + 1]!);
      if (d < m) m = d;
    }
  }
  return m;
}

/** Points along every boundary segment, at most `step` apart, vertices included. */
export function samplePoints(segs: [XY, XY][], step: number): XY[] {
  const out: XY[] = [];
  for (const [a, b] of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
