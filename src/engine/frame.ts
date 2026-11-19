// Local metric frame and plot-ring cleaning / validation.
// Projection: tangent plane (equirectangular) at the vertex mean, WGS84 metres
// per degree. Error is far below 1 mm over a few hundred metres.

import type { EdgeInfo, EngineError, Frame, Warning, XY } from './types.js';
import { LIMITS } from './rules.js';

const DEG = Math.PI / 180;

export function metresPerDegree(latDeg: number): { lon: number; lat: number } {
  const p = latDeg * DEG;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}

export function toLocal(frame: Frame, lon: number, lat: number): XY {
  return [(lon - frame.lon0) * frame.mPerDegLon + 0, (lat - frame.lat0) * frame.mPerDegLat + 0];
}

/** Inverse of toLocal; the scene layer uses it to place plates on the map. */
export function toLonLat(frame: Frame, p: XY): [number, number] {
  return [frame.lon0 + p[0] / frame.mPerDegLon, frame.lat0 + p[1] / frame.mPerDegLat];
}

export function signedArea(ring: XY[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function edgeKey(e: EdgeInfo): string {
  return e.role === 'private' ? 'private' : `${e.role}|${e.width}|${e.gap ?? 0}|${e.name ?? ''}`;
}

const err = (code: EngineError['code'], message: string, index?: number): EngineError =>
  index === undefined ? { ok: false, code, message } : { ok: false, code, message, index };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface CleanPlot {
  frame: Frame;
  /** Ring the geometry is built from (simplified when the plot had > 500 corners). */
  ring: XY[];
  edges: EdgeInfo[];
  /** Area of the true (unsimplified) plot. */
  area: number;
  /** The true outline when simplification changed it (the checker measures against this), else null. */
  original: { ring: XY[]; edges: EdgeInfo[] } | null;
  /** Largest distance between the true outline and the simplified one (0 when not simplified). */
  simplifyDev: number;
  warnings: Warning[];
}

/** Reverse a ring and remap its edges so edge j still runs ring[j] -> ring[j+1]. */
function reverseRing(ring: XY[], edges: EdgeInfo[]): { ring: XY[]; edges: EdgeInfo[] } {
  const n = ring.length;
  const r2 = ring.slice().reverse();
  return { ring: r2, edges: r2.map((_, j) => edges[(n - 2 - j + n) % n]!) };
}

/** Largest distance from any vertex of one closed ring to the other ring, both ways. */
function ringDeviation(a: XY[], b: XY[]): number {
  const dist = (p: XY, r: XY[]) => {
    let m = Infinity;
    for (let i = 0; i < r.length; i++) m = Math.min(m, lineSegDist(p, r[i]!, r[(i + 1) % r.length]!));
    return m;
  };
  let d = 0;
  for (const p of a) d = Math.max(d, dist(p, b));
  for (const p of b) d = Math.max(d, dist(p, a));
  return d;
}

function lineSegDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Distance from p to the line through a and b (or to a when a == b). */
function lineDev(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  if (L === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}

/** Removes vertex i when it deviates < tol from its neighbours' line and both edges share a key. */
function dropCollinear(ring: XY[], edges: EdgeInfo[], tol: number): void {
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let i = 0; i < ring.length && ring.length > 3; i++) {
      const n = ring.length;
      const prev = (i - 1 + n) % n;
      const a = ring[prev]!;
      const p = ring[i]!;
      const b = ring[(i + 1) % n]!;
      // spikes (direction reverses) are not "collinear"; the self-intersection check reports them
      const dot = (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1]);
      if (dot < 0) continue;
      if (lineDev(p, a, b) < tol && edgeKey(edges[prev]!) === edgeKey(edges[i]!)) {
        ring.splice(i, 1);
        edges.splice(i, 1); // edge prev now runs a -> b and keeps its info
        changed = true;
        i--;
      }
    }
  }
}

function segIntersect(a: XY, b: XY, c: XY, d: XY, eps: number): boolean {
  const orient = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSeg = (p: XY, q: XY, r: XY) =>
    Math.min(p[0], q[0]) - eps <= r[0] && r[0] <= Math.max(p[0], q[0]) + eps &&
    Math.min(p[1], q[1]) - eps <= r[1] && r[1] <= Math.max(p[1], q[1]) + eps;
  const scale = (p: XY, q: XY) => Math.hypot(q[0] - p[0], q[1] - p[1]) * eps;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const s1 = scale(a, b);
  const s2 = scale(c, d);
  if (((o1 > s1 && o2 < -s1) || (o1 < -s1 && o2 > s1)) && ((o3 > s2 && o4 < -s2) || (o3 < -s2 && o4 > s2))) return true;
  if (Math.abs(o1) <= s1 && onSeg(a, b, c)) return true;
  if (Math.abs(o2) <= s1 && onSeg(a, b, d)) return true;
  if (Math.abs(o3) <= s2 && onSeg(c, d, a)) return true;
  if (Math.abs(o4) <= s2 && onSeg(c, d, b)) return true;
  return false;
}

/** Returns the index of the first edge that crosses or touches a non-adjacent edge, or -1. */
export function findSelfIntersection(ring: XY[]): number {
  const n = ring.length;
  const eps = 1e-6; // metres
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    // spike: the next edge doubles back over this one
    const c = ring[(i + 2) % n]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (dot < 0 && Math.abs(cross) <= 1e-9 * len) return i;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing vertex
      if (segIntersect(a, b, ring[j]!, ring[(j + 1) % n]!, eps)) return i;
    }
  }
  return -1;
}

export function cleanPlot(rawRing: unknown, rawEdges: unknown, units: 'lonlat' | 'm'): CleanPlot | EngineError {
  const warnings: Warning[] = [];
  if (!Array.isArray(rawRing)) return err('invalid-input', 'ring must be an array of [x, y] points');
  if (!Array.isArray(rawEdges)) return err('invalid-input', 'edges must be an array');
  if (rawRing.length > LIMITS.maxRawVertices) {
    return err('too-many-vertices', `plot has ${rawRing.length} points; the limit is ${LIMITS.maxRawVertices}`);
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < rawRing.length; i++) {
    const p = rawRing[i] as unknown;
    if (!Array.isArray(p) || p.length < 2) return err('invalid-input', `point ${i} is not [x, y]`, i);
    if (!isNum(p[0]) || !isNum(p[1])) return err('non-finite', `point ${i} has a non-finite coordinate`, i);
    if (units === 'lonlat' && (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85)) {
      return err('invalid-input', `point ${i} is not a valid lon/lat`, i);
    }
    if (units === 'm' && (Math.abs(p[0]) > 1e7 || Math.abs(p[1]) > 1e7)) {
      return err('invalid-input', `point ${i} is too far from the origin`, i);
    }
    pts.push([p[0], p[1]]);
  }
  // closed ring: drop the repeated last point
  if (pts.length > 1) {
    const f = pts[0]!;
    const l = pts[pts.length - 1]!;
    if (f[0] === l[0] && f[1] === l[1]) pts.pop();
  }
  if (pts.length < 3) return err('too-few-points', 'a plot needs at least 3 distinct points');
  if (rawEdges.length !== pts.length) {
    return err('edge-mismatch', `ring has ${pts.length} sides but ${rawEdges.length} edge descriptions were given`);
  }

  const edges: EdgeInfo[] = [];
  for (let i = 0; i < rawEdges.length; i++) {
    const e = rawEdges[i] as Partial<EdgeInfo> | null;
    if (!e || typeof e !== 'object') return err('invalid-edge', `edge ${i} is not an object`, i);
    if (e.role !== 'road' && e.role !== 'private' && e.role !== 'canal') {
      return err('invalid-edge', `edge ${i} has an unknown role`, i);
    }
    const out: EdgeInfo = { role: e.role, source: e.source === 'city' || e.source === 'user' ? e.source : 'none' };
    if (typeof e.name === 'string') out.name = e.name;
    if (e.role !== 'private') {
      if (!isNum(e.width) || e.width <= 0) {
        return err('invalid-edge', `edge ${i} is a ${e.role} but has no valid width`, i);
      }
      let w = e.width;
      // a narrower road needs a larger setback, so a tiny width is refused, never enlarged
      if (w < LIMITS.minWidth) {
        return err('invalid-edge', `edge ${i}: a ${e.role} narrower than ${LIMITS.minWidth} m is not supported (got ${w} m)`, i);
      }
      // clamping a very wide road down only makes the 2x rule stricter
      if (w > LIMITS.maxWidth) {
        warnings.push({ code: 'width-clamped', message: `edge ${i}: width ${w} m treated as ${LIMITS.maxWidth} m (stricter)` });
        w = LIMITS.maxWidth;
      }
      out.width = w;
      let g = 0;
      if (e.gap !== undefined) {
        if (!isNum(e.gap) || e.gap < 0) return err('invalid-edge', `edge ${i} has an invalid gap`, i);
        g = Math.min(e.gap, LIMITS.maxGap);
        if (g !== e.gap) warnings.push({ code: 'gap-clamped', message: `edge ${i}: gap clamped to ${g} m` });
      }
      out.gap = g;
    }
    edges.push(out);
  }

  // frame: origin at the vertex mean (metre input is translated too, so local
  // coordinates stay small and integer-millimetre geometry stays exact)
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p[0];
    sy += p[1];
  }
  const lon0 = sx / pts.length;
  const lat0 = sy / pts.length;
  let frame: Frame;
  if (units === 'lonlat') {
    const m = metresPerDegree(lat0);
    frame = { lon0, lat0, mPerDegLon: m.lon, mPerDegLat: m.lat, units };
  } else {
    frame = { lon0, lat0, mPerDegLon: 1, mPerDegLat: 1, units };
  }
  const ring: XY[] = pts.map((p) => toLocal(frame, p[0], p[1]));

  // drop consecutive duplicates (< 1 mm): the zero-length edge goes, the next edge keeps its info
  // (edge i runs ring[i] -> ring[i+1]; at the wrap the start vertex goes instead of ring[0])
  for (let i = 0; i < ring.length && ring.length > 1; ) {
    const n = ring.length;
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.001) {
      ring.splice(i + 1 < n ? i + 1 : i, 1);
      edges.splice(i, 1);
    } else i++;
  }
  if (ring.length < 3) return err('too-few-points', 'a plot needs at least 3 distinct points');

  dropCollinear(ring, edges, 0.001);
  let original: { ring: XY[]; edges: EdgeInfo[] } | null = null;
  let simplifyDev = 0;
  if (ring.length > LIMITS.maxVertices) {
    // the true outline must be valid on its own; the simplified one only drives the geometry
    const badTrue = findSelfIntersection(ring);
    if (badTrue >= 0) return err('self-intersection', `plot outline crosses itself near side ${badTrue}`, badTrue);
    original = { ring: ring.slice(), edges: edges.slice() };
    dropCollinear(ring, edges, LIMITS.simplifyTol);
    if (ring.length > LIMITS.maxVertices) {
      return err('too-many-vertices', `plot has ${ring.length} corners after simplifying at ${LIMITS.simplifyTol} m; the limit is ${LIMITS.maxVertices}`);
    }
    simplifyDev = ringDeviation(original.ring, ring);
    warnings.push({
      code: 'simplified',
      message: `plot outline simplified at ${LIMITS.simplifyTol} m (boundary moved up to ${(simplifyDev * 1000).toFixed(0)} mm; setbacks are cut that much deeper)`,
    });
  }
  if (ring.length < 3) return err('too-few-points', 'a plot needs at least 3 distinct points');

  let area = signedArea(ring);
  if (Math.abs(area) < LIMITS.minArea) return err('zero-area', 'plot has (almost) no area');
  if (area < 0) {
    const r = reverseRing(ring, edges);
    ring.splice(0, ring.length, ...r.ring);
    edges.splice(0, edges.length, ...r.edges);
    area = -area;
  }
  if (original) {
    const a0 = signedArea(original.ring);
    if (a0 < 0) original = reverseRing(original.ring, original.edges);
    area = Math.abs(a0); // FAR and open space use the true plot area
  }
  const bad = findSelfIntersection(ring);
  if (bad >= 0) return err('self-intersection', `plot outline crosses itself near side ${bad}`, bad);
  if (area > LIMITS.maxArea) {
    return err('too-large', `plot is ${Math.round(area)} m2; the limit is ${LIMITS.maxArea} m2`);
  }
  return { frame, ring, edges, area, original, simplifyDev, warnings };
}
