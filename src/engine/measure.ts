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

/** Distance from p to the infinite line through a and b (to a when a == b). */
function lineDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}

/** Douglas-Peucker: indices of the vertices kept at tolerance tol (both ends always kept). */
function simplifyIdx(pts: XY[], tol: number): number[] {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      // closed loops repeat the first point at the end: measure to the point, not a line
      const d = lineDist(pts[k]!, pts[a]!, pts[b]!);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/**
 * Length of the longest straight side of a polyline: "ด้านหนึ่งด้านใดของที่ดิน" (one side of the
 * land, MR 33 art. 2; zoning art. 36) read as one straight side (oracle disagreement D5).
 * Vertices within `noise` m of the line through their neighbours (Douglas-Peucker) are
 * digitising noise and removed first. A side is then a run of consecutive remaining edges whose
 * directions all lie within `turnDeg` of each other (so neither a bend nor a curve made of
 * small turns counts as one side); its length is the sum of those edges.
 */
export function straightSideLength(points: XY[], turnDeg: number, noise: number): number {
  const idx = simplifyIdx(points, noise);
  const segs: { dir: number; len: number }[] = [];
  for (let k = 0; k + 1 < idx.length; k++) {
    const a = points[idx[k]!]!;
    const b = points[idx[k + 1]!]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 0) segs.push({ dir: Math.atan2(b[1] - a[1], b[0] - a[0]), len });
  }
  const lim = (turnDeg * Math.PI) / 180;
  let best = 0;
  for (let i = 0; i < segs.length; i++) {
    let lo = 0;
    let hi = 0;
    let sum = 0;
    for (let j = i; j < segs.length; j++) {
      let r = segs[j]!.dir - segs[i]!.dir;
      if (r > Math.PI) r -= 2 * Math.PI;
      else if (r < -Math.PI) r += 2 * Math.PI;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      if (hi - lo >= lim) break;
      sum += segs[j]!.len;
    }
    if (sum > best) best = sum;
  }
  return best;
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
    const [outer, ...holes] = poly;
    if (outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h))) return true;
  }
  // outside by the ray test: still counts if it sits on a boundary (within tol)
  for (const poly of polys) {
    for (const ring of poly) if (distToRing(p, ring) <= tol) return true;
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
  // bounding boxes give a cheap lower bound; exact distances only where it could beat the minimum
  const boxes: number[][] = [];
  for (let j = 0; j + 1 < q.length; j++) {
    const c = q[j]!;
    const d = q[j + 1]!;
    boxes.push([Math.min(c[0], d[0]), Math.min(c[1], d[1]), Math.max(c[0], d[0]), Math.max(c[1], d[1])]);
  }
  let m = Infinity;
  for (const [a, b] of segs) {
    const x0 = Math.min(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    for (let j = 0; j < boxes.length; j++) {
      const bx = boxes[j]!;
      const gx = Math.max(0, bx[0]! - x1, x0 - bx[2]!);
      const gy = Math.max(0, bx[1]! - y1, y0 - bx[3]!);
      if (gx * gx + gy * gy >= m * m) continue;
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

// ---------------------------------------------------------------------------
// Containment: is polygon set A inside polygon set B (A within B grown by tol)?
//
// The checker's "inside the plot" and "inside the floor below" rows use this. Testing
// only A's vertices is not enough: an edge can bridge a notch of a concave B with both
// ends inside, and an upper floor can roof over a courtyard (a hole of B lying wholly
// inside A) without any vertex outside. Three tests together decide A ⊆ B ⊕ tol:
//   1. every vertex of A is in B within tol;
//   2. no piece of an A edge leaves B: each edge is split at every point where it meets
//      a ring edge of B (crossings, touching vertices, ends of collinear overlaps), and
//      the midpoint of each piece is tested in B within tol. A piece meets B's boundary
//      only at its ends, so it lies wholly inside, outside or along B; the midpoint tells
//      which (a shared or collinear edge has its midpoint on B's boundary: inside);
//   3. no hole of B lies inside A: once A's boundary is inside B, each hole of B is
//      either wholly inside A or wholly outside it, so one probe point per hole, inside
//      the hole and more than tol from B's boundary, decides it.
// Splitting uses exact integer orientation on coordinates rounded to the millimetre
// (exact while coordinate differences stay under ~94 km); the inside tests use the
// unrounded metres. Limits: a hole of B with no point more than tol from B's boundary
// (thinner than ~2 x tol) is ignored, as B grown by tol covers it; B must be normalised
// like clipper output (an enclosed void is a hole ring, not a gap between touching
// outers); a hole split in two by an island of B touching it at points gets one probe;
// a piece of edge outside B whose midpoint is within tol is taken as inside.
// ---------------------------------------------------------------------------

interface ShapeRing {
  n: number;
  /** metres */
  x: Float64Array;
  y: Float64Array;
  /** integer millimetres */
  ix: Float64Array;
  iy: Float64Array;
  /** bounding box, metres */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** bounding box, millimetres */
  ix0: number;
  iy0: number;
  ix1: number;
  iy1: number;
  /** exact numeric key of each millimetre vertex (NaN when out of the keyed range: no shortcut) */
  vk: Float64Array;
}

const KEY_RANGE = 2 ** 25; // mm (33.5 km): ix * 2^26 + iy is exact and unique inside it
const vkey = (ix: number, iy: number) => (Math.abs(ix) < KEY_RANGE && Math.abs(iy) < KEY_RANGE ? ix * 2 ** 26 + iy : NaN);

export interface Shape {
  /** polys[k][0] is the outer ring, the rest are holes */
  polys: ShapeRing[][];
  rings: ShapeRing[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Vertex key -> key of the next and of the previous vertex along its ring (built on demand).
   * A vertex on several rings keeps one pair: only a shortcut is lost, never a test.
   */
  next?: Map<number, number>;
  prev?: Map<number, number>;
}

export interface ContainmentViolation {
  kind: 'vertex' | 'edge' | 'hole';
  /** metres: the vertex outside, the midpoint of the piece of edge outside, or a point of the covered hole */
  at: XY;
}

function prepRing(r: XY[]): ShapeRing {
  const n = r.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const ix = new Float64Array(n);
  const iy = new Float64Array(n);
  const vk = new Float64Array(n);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = r[i]!;
    x[i] = p[0];
    y[i] = p[1];
    ix[i] = Math.round(p[0] * 1000);
    iy[i] = Math.round(p[1] * 1000);
    vk[i] = vkey(ix[i]!, iy[i]!);
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return {
    n, x, y, ix, iy, vk, x0, y0, x1, y1,
    ix0: Math.round(x0 * 1000), iy0: Math.round(y0 * 1000), ix1: Math.round(x1 * 1000), iy1: Math.round(y1 * 1000),
  };
}

/** Precomputes a polygon set for containment tests (reuse it when a set is tested more than once). */
export function prepareShape(polys: Polygon[]): Shape {
  const ps = polys.map((poly) => poly.filter((r) => r.length >= 3).map(prepRing)).filter((p) => p.length > 0);
  const rings = ps.flat();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  return { polys: ps, rings, x0, y0, x1, y1 };
}

/** Vertex adjacency of a shape by exact millimetre keys: a vertex or edge of B is on B's boundary. */
function adjacency(s: Shape): { next: Map<number, number>; prev: Map<number, number> } {
  if (!s.next || !s.prev) {
    const next = new Map<number, number>();
    const prev = new Map<number, number>();
    for (const r of s.rings) {
      for (let i = 0, j = r.n - 1; i < r.n; j = i++) {
        const a = r.vk[j]!;
        const b = r.vk[i]!;
        if (Number.isNaN(a) || Number.isNaN(b)) continue;
        next.set(a, b);
        prev.set(b, a);
      }
    }
    s.next = next;
    s.prev = prev;
  }
  return { next: s.next, prev: s.prev };
}

function inRingStrict(px: number, py: number, r: ShapeRing): boolean {
  if (px < r.x0 || px > r.x1 || py < r.y0 || py > r.y1) return false;
  const { x, y, n } = r;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = y[i]!;
    const yj = y[j]!;
    if ((yi > py) !== (yj > py) && px < ((x[j]! - x[i]!) * (py - yi)) / (yj - yi) + x[i]!) inside = !inside;
  }
  return inside;
}

/** Inside by the ray test (a point exactly on the boundary may go either way). */
function inShapeStrict(px: number, py: number, s: Shape): boolean {
  for (const poly of s.polys) {
    if (!inRingStrict(px, py, poly[0]!)) continue;
    let inHole = false;
    for (let h = 1; h < poly.length && !inHole; h++) inHole = inRingStrict(px, py, poly[h]!);
    if (!inHole) return true;
  }
  return false;
}

/** Squared distance from a point to a shape's boundary; rings farther than sqrt(lim2) by bbox are skipped. */
function boundaryDist2(px: number, py: number, s: Shape, lim2: number): number {
  const lim = Math.sqrt(lim2);
  let m = Infinity;
  for (const r of s.rings) {
    if (px < r.x0 - lim || px > r.x1 + lim || py < r.y0 - lim || py > r.y1 + lim) continue;
    const { x, y, n } = r;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = x[j]!;
      const ay = y[j]!;
      const dx = x[i]! - ax;
      const dy = y[i]! - ay;
      const L2 = dx * dx + dy * dy;
      let t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (ax + t * dx);
      const ey = py - (ay + t * dy);
      const d2 = ex * ex + ey * ey;
      if (d2 < m) {
        m = d2;
        if (m === 0) return 0;
      }
    }
  }
  return m;
}

/** Inside within tol. Clears info.exact when the point needed the tolerance (more than 1 nm out). */
function inShapeTol(px: number, py: number, s: Shape, tol: number, info?: { exact: boolean }): boolean {
  if (inShapeStrict(px, py, s)) return true;
  const d2 = boundaryDist2(px, py, s, tol * tol);
  if (d2 > tol * tol) return false;
  if (info && d2 > 1e-18) info.exact = false;
  return true;
}

/** Parameters t in (0, 1) where the integer segment a-b meets ring edges of B (pushed onto out). */
function splitParams(ax: number, ay: number, bx: number, by: number, B: Shape, out: number[]): void {
  const ex0 = Math.min(ax, bx);
  const ex1 = Math.max(ax, bx);
  const ey0 = Math.min(ay, by);
  const ey1 = Math.max(ay, by);
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  for (const r of B.rings) {
    if (r.ix1 < ex0 || r.ix0 > ex1 || r.iy1 < ey0 || r.iy0 > ey1) continue;
    const { ix, iy, n } = r;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const cx = ix[j]!;
      const cy = iy[j]!;
      const fx = ix[i]!;
      const fy = iy[i]!;
      if (Math.max(cx, fx) < ex0 || Math.min(cx, fx) > ex1 || Math.max(cy, fy) < ey0 || Math.min(cy, fy) > ey1) continue;
      const o1 = dx * (cy - ay) - dy * (cx - ax);
      const o2 = dx * (fy - ay) - dy * (fx - ax);
      // an end of the B edge on the line of a-b (touching, or a collinear overlap): split there if on the segment
      if (o1 === 0) {
        const t = ((cx - ax) * dx + (cy - ay) * dy) / L2;
        if (t > 0 && t < 1) out.push(t);
      }
      if (o2 === 0) {
        const t = ((fx - ax) * dx + (fy - ay) * dy) / L2;
        if (t > 0 && t < 1) out.push(t);
      }
      if ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) {
        const gx = fx - cx;
        const gy = fy - cy;
        const o3 = gx * (ay - cy) - gy * (ax - cx);
        const o4 = gx * (by - cy) - gy * (bx - cx);
        if ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)) out.push(o3 / (o3 - o4));
      }
    }
  }
}

/** A point inside hole ring h of B, outside B and more than tol from B's boundary, or null. */
function holeProbe(h: ShapeRing, B: Shape, tol: number): XY | null {
  let a2 = 0;
  for (let i = 0, j = h.n - 1; i < h.n; j = i++) a2 += h.x[j]! * h.y[i]! - h.x[i]! * h.y[j]!;
  const sgn = a2 >= 0 ? 1 : -1; // CCW: the interior is on the left of each edge
  const tol2 = tol * tol;
  const ok = (px: number, py: number) => inRingStrict(px, py, h) && !inShapeStrict(px, py, B) && boundaryDist2(px, py, B, tol2) > tol2;
  // edge midpoints (then quarter points) pushed inward: deep first, then just past tol
  for (const ts of [[0.5], [0.25, 0.75]]) {
    for (const df of [0.25, 0.05, 0]) {
      for (let i = 0, j = h.n - 1; i < h.n; j = i++) {
        const dx = h.x[i]! - h.x[j]!;
        const dy = h.y[i]! - h.y[j]!;
        const L = Math.hypot(dx, dy);
        if (L === 0) continue;
        const nx = (-dy / L) * sgn;
        const ny = (dx / L) * sgn;
        for (const d of df > 0 ? [df * L] : [1.5 * tol, 4 * tol]) {
          for (const t of ts) {
            const px = h.x[j]! + t * dx + d * nx;
            const py = h.y[j]! + t * dy + d * ny;
            if (ok(px, py)) return [px, py];
          }
        }
      }
    }
  }
  // fallback: a coarse grid over the hole's bounding box
  for (let gi = 1; gi < 8; gi++) {
    for (let gj = 1; gj < 8; gj++) {
      const px = h.x0 + ((h.x1 - h.x0) * gi) / 8;
      const py = h.y0 + ((h.y1 - h.y0) * gj) / 8;
      if (ok(px, py)) return [px, py];
    }
  }
  return null;
}

/**
 * First way A fails to lie inside B (within tol), or null when A is inside B grown by tol.
 * When info is given, info.exact stays true only if no tested point needed the tolerance
 * (each was inside B or on its boundary), so A's boundary lies in B itself, not B grown by tol.
 */
export function containmentViolationOf(A: Shape, B: Shape, tol: number, info?: { exact: boolean }): ContainmentViolation | null {
  const { next, prev } = adjacency(B);
  // 1. vertices (a vertex of B is on B's boundary: inside)
  for (const r of A.rings) {
    for (let i = 0; i < r.n; i++) {
      if (next.has(r.vk[i]!)) continue;
      if (!inShapeTol(r.x[i]!, r.y[i]!, B, tol, info)) return { kind: 'vertex', at: [r.x[i]!, r.y[i]!] };
    }
  }
  // 2. pieces of edges (an edge of B is on B's boundary: inside)
  const ts: number[] = [];
  for (const r of A.rings) {
    for (let i = 0; i < r.n; i++) {
      const j = (i + 1) % r.n;
      const ax = r.ix[i]!;
      const ay = r.iy[i]!;
      const bx = r.ix[j]!;
      const by = r.iy[j]!;
      if (ax === bx && ay === by) continue;
      const ka = r.vk[i]!;
      const kb = r.vk[j]!;
      if (!Number.isNaN(kb) && (next.get(ka) === kb || prev.get(ka) === kb)) continue;
      ts.length = 0;
      ts.push(0, 1);
      splitParams(ax, ay, bx, by, B, ts);
      ts.sort((p, q) => p - q);
      const fx = r.x[i]!;
      const fy = r.y[i]!;
      const gx = r.x[j]! - fx;
      const gy = r.y[j]! - fy;
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1]! - ts[k]! <= 1e-12) continue;
        const tm = (ts[k]! + ts[k + 1]!) / 2;
        const px = fx + tm * gx;
        const py = fy + tm * gy;
        if (!inShapeTol(px, py, B, tol, info)) return { kind: 'edge', at: [px, py] };
      }
    }
  }
  // 3. holes of B covered by A
  for (const poly of B.polys) {
    for (let h = 1; h < poly.length; h++) {
      const hr = poly[h]!;
      if (hr.x1 < A.x0 || hr.x0 > A.x1 || hr.y1 < A.y0 || hr.y0 > A.y1) continue;
      const p = holeProbe(hr, B, tol);
      if (p && inShapeStrict(p[0], p[1], A)) return { kind: 'hole', at: p };
    }
  }
  return null;
}

export function containmentViolation(A: Polygon[], B: Polygon[], tol: number): ContainmentViolation | null {
  return containmentViolationOf(prepareShape(A), prepareShape(B), tol);
}

/** True iff polygon set A lies inside polygon set B, allowing tol (metres) of overhang. */
export function containsPolygons(A: Polygon[], B: Polygon[], tol: number): boolean {
  return containmentViolation(A, B, tol) === null;
}
