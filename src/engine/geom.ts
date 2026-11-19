// Thin wrappers over clipper2-ts. Geometry is integer millimetres inside these
// helpers and metres everywhere else.

import {
  EndType, FillRule, JoinType, areaPaths, difference, inflatePaths, intersect, union,
  type Path64, type Paths64,
} from 'clipper2-ts';
import { PARAMS } from './rules.js';
import type { Polygon, XY } from './types.js';

export const MM = 1000;
const ARC = PARAMS.arcTol * MM;

export function toPath(ring: XY[]): Path64 {
  return ring.map((p) => ({ x: Math.round(p[0] * MM), y: Math.round(p[1] * MM) }));
}

export function area(paths: Paths64): number {
  return areaPaths(paths) / (MM * MM);
}

/** Buffer an open polyline (or closed loop) by d metres on both sides, round joins and ends. */
export function bufferLine(path: Path64, closed: boolean, d: number): Paths64 {
  if (d <= 0) return [];
  return inflatePaths([path], d * MM, JoinType.Round, closed ? EndType.Joined : EndType.Round, 2, ARC);
}

export function minus(a: Paths64, b: Paths64): Paths64 {
  if (a.length === 0) return [];
  if (b.length === 0) return a;
  return difference(a, b, FillRule.NonZero);
}

export function and(a: Paths64, b: Paths64): Paths64 {
  if (a.length === 0 || b.length === 0) return [];
  return intersect(a, b, FillRule.NonZero);
}

export function or(paths: Paths64[]): Paths64 {
  const all = paths.flat();
  if (all.length === 0) return [];
  return union(all, FillRule.NonZero);
}

/** Inset (d > 0) or outset (d < 0) a polygon set with miter joins (keeps right angles exact). */
export function inset(paths: Paths64, d: number): Paths64 {
  if (paths.length === 0) return [];
  if (d === 0) return paths;
  return inflatePaths(paths, -d * MM, JoinType.Miter, EndType.Polygon, 4, ARC);
}

/**
 * Morphological opening of width w (erode w/2, dilate w/2, miter joins),
 * clipped back to the input so the result can never grow. Removes parts
 * narrower than w without rounding right-angle corners.
 */
export function openSlivers(paths: Paths64, w: number): Paths64 {
  if (paths.length === 0) return [];
  const r = w / 2;
  const eroded = inflatePaths(paths, -r * MM, JoinType.Miter, EndType.Polygon, 4, ARC);
  if (eroded.length === 0) return [];
  const dilated = inflatePaths(eroded, r * MM, JoinType.Miter, EndType.Polygon, 4, ARC);
  return and(dilated, paths);
}

function pathArea(p: Path64): number {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function pointInPath(x: number, y: number, p: Path64): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface Group {
  outer: Path64;
  outerArea: number;
  holes: Path64[];
  net: number;
}

/** Group clipper output (outer rings positive, holes negative) into polygons. */
function groupPaths(paths: Paths64): Group[] {
  const outers: Group[] = [];
  const holes: Path64[] = [];
  for (const p of paths) {
    if (p.length < 3) continue;
    const a = pathArea(p);
    if (a > 0) outers.push({ outer: p, outerArea: a, holes: [], net: a });
    else if (a < 0) holes.push(p);
  }
  // smallest containing outer wins (handles islands inside holes)
  const bySize = outers.slice().sort((g, h) => g.outerArea - h.outerArea);
  for (const h of holes) {
    const pt = h[0]!;
    const owner = bySize.find((g) => pointInPath(pt.x + 0.5, pt.y + 0.5, g.outer) || pointInPath(pt.x, pt.y, g.outer));
    if (owner) {
      owner.holes.push(h);
      owner.net += pathArea(h);
    }
  }
  return outers;
}

/** Drop polygons whose net area is below minArea m2. Returns kept paths and dropped area. */
export function dropSmall(paths: Paths64, minArea: number): { paths: Paths64; dropped: number } {
  const groups = groupPaths(paths);
  const out: Paths64 = [];
  let dropped = 0;
  for (const g of groups) {
    const a = g.net / (MM * MM);
    if (a < minArea) dropped += a;
    else out.push(g.outer, ...g.holes);
  }
  return { paths: out, dropped };
}

export function toPolygons(paths: Paths64): Polygon[] {
  const conv = (p: Path64): XY[] => p.map((q) => [q.x / MM, q.y / MM] as XY);
  return groupPaths(paths)
    .sort((g, h) => h.net - g.net)
    .map((g) => [conv(g.outer), ...g.holes.map(conv)]);
}

export function partCount(paths: Paths64): number {
  return groupPaths(paths).length;
}
