// Small planar helpers for site detection. Everything runs in a local tangent frame in metres
// (x east, y north) around a chosen origin; at plot scale (< 1 km) the error is far below 1 cm.

export type LL = [lon: number, lat: number];
export type XY = [x: number, y: number];
/** Polygon: outer ring first, then holes. Rings may be closed or open. */
export type Poly = LL[][];

export interface LocalFrame {
  lon0: number;
  lat0: number;
  kx: number; // metres per degree lon
  ky: number; // metres per degree lat
}

export function makeFrame(lon0: number, lat0: number): LocalFrame {
  const p = (lat0 * Math.PI) / 180;
  // WGS84 series, same formula family as the engine's frame
  const ky = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  const kx = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  return { lon0, lat0, kx, ky };
}

/** Longitude difference unwrapped to [-180, 180) so a plot across the 180th meridian stays small. */
const dLon = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;
export const toXY = (f: LocalFrame, p: LL): XY => [dLon(p[0], f.lon0) * f.kx, (p[1] - f.lat0) * f.ky];
export const toLL = (f: LocalFrame, p: XY): LL => [f.lon0 + p[0] / f.kx, f.lat0 + p[1] / f.ky];

/** Drop the closing vertex if the ring repeats its first point. */
export function openRing<T extends number[]>(r: T[]): T[] {
  if (r.length > 1) {
    const a = r[0]!;
    const b = r[r.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1]) return r.slice(0, -1);
  }
  return r;
}

export function signedArea(r: XY[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function centroidLL(r: LL[]): LL {
  const f = makeFrame(r[0]![0], r[0]![1]);
  const xy = r.map((p) => toXY(f, p));
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i]!;
    const q = xy[(i + 1) % xy.length]!;
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) return r[0]!;
  return toLL(f, [cx / (3 * a), cy / (3 * a)]);
}

export function pointInRing(p: number[], ring: number[][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1]! > p[1]! !== b[1]! > p[1]! && p[0]! < ((b[0]! - a[0]!) * (p[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}

export function pointInPoly(p: number[], poly: number[][][]): boolean {
  if (!pointInRing(p, poly[0]!)) return false;
  for (let h = 1; h < poly.length; h++) if (pointInRing(p, poly[h]!)) return false;
  return true;
}

export type BBox = [minX: number, minY: number, maxX: number, maxY: number];

export function bboxOf(pts: number[][]): BBox {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const p of pts) {
    if (p[0]! < a) a = p[0]!;
    if (p[1]! < b) b = p[1]!;
    if (p[0]! > c) c = p[0]!;
    if (p[1]! > d) d = p[1]!;
  }
  return [a, b, c, d];
}

export const bboxHit = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** GeoJSON Polygon / MultiPolygon geometry to a list of polygons. */
export function polysOf(g: { type: string; coordinates: unknown } | null | undefined): Poly[] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as Poly];
  if (g.type === 'MultiPolygon') return g.coordinates as Poly[];
  return [];
}

/** Is a lon/lat ring free of self-intersections (non-adjacent edges never cross)? */
export function selfIntersects(r: LL[]): boolean {
  const n = r.length;
  const cross = (a: LL, b: LL, c: LL, d: LL) => {
    const o = (p: LL, q: LL, s: LL) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (cross(r[i]!, r[(i + 1) % n]!, r[j]!, r[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

export function areaM2(r: LL[]): number {
  const f = makeFrame(r[0]![0], r[0]![1]);
  return Math.abs(signedArea(r.map((p) => toXY(f, p))));
}
