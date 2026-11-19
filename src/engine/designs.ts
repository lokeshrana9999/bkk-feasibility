// Concept designs, built only by intersecting / insetting envelope plates, so
// they sit inside the envelope by construction. Each one stacks floors until
// the target GFA, shaves the top floor to hit it, and names what bound it.

import type { Path64, Paths64 } from 'clipper2-ts';
import { maxFootprint, type Site } from './envelope.js';
import { and, area, dropSmall, inset, minus, openSlivers, toPath, toPolygons } from './geom.js';
import { PARAMS, RULES, TYPE_PARAMS } from './rules.js';
import type { Cap, Chain, Design, DesignKind, FloorPlate, Regime, XY } from './types.js';

export interface DesignDraft extends Omit<Design, 'checks' | 'passes'> {}

interface StackResult {
  plates: FloorPlate[];
  gfa: number;
  hitTarget: boolean;
  stop: string;
}

function clean(p: Paths64): Paths64 {
  return dropSmall(openSlivers(p, PARAMS.slivers), PARAMS.minPlateArea).paths;
}

/** Drops parts under the minimum plate size (no opening: inputs are already clean plates). */
function keep(p: Paths64): Paths64 {
  return dropSmall(p, PARAMS.minPlateArea).paths;
}

/**
 * Extra inset t that brings the area to <= limit, within areaTol m2 below it (or t within
 * 1 mm). Area falls smoothly as the inset grows, so a bracketed secant search (Illinois
 * variant of regula falsi) converges in a handful of steps.
 */
function shrinkTo(p: Paths64, limit: number, base = 0, areaTol = 0.5): { paths: Paths64; t: number } {
  const a0 = area(p);
  if (a0 <= limit) return { paths: p, t: base };
  let lo = 0;
  let flo = a0 - limit; // > 0
  let hi = 1;
  let best = keep(inset(p, hi));
  let fhi = area(best) - limit;
  while (fhi > 0 && hi < 512) {
    lo = hi;
    flo = fhi;
    hi *= 2;
    best = keep(inset(p, hi));
    fhi = area(best) - limit;
  }
  let side = 0;
  for (let i = 0; i < 40 && fhi < -areaTol && hi - lo > 0.001; i++) {
    let t = hi - (fhi * (hi - lo)) / (fhi - flo);
    if (!(t > lo && t < hi)) t = (lo + hi) / 2;
    const cand = keep(inset(p, t));
    const f = area(cand) - limit;
    if (f <= 0) {
      hi = t;
      fhi = f;
      best = cand;
      if (side === -1) flo /= 2;
      side = -1;
    } else {
      lo = t;
      flo = f;
      if (side === 1) fhi /= 2;
      side = 1;
    }
  }
  return { paths: best, t: base + hi };
}

function stack(
  envPlates: FloorPlate[],
  target: number,
  /** Floor k's geometry, already clipped to the floor below (prev) when there is one. */
  floorPaths: (k: number, prev: Paths64 | null) => Paths64,
  /** True when floor k is built from the same envelope plate and transform as floor k-1. */
  sameAsBelow: (k: number) => boolean,
): StackResult {
  const plates: FloorPlate[] = [];
  let gfa = 0;
  let prev: Paths64 | null = null;
  let stop = 'envelope has no more floors';
  for (let k = 0; k < envPlates.length; k++) {
    const env = envPlates[k]!;
    const below = plates[plates.length - 1];
    let p: Paths64;
    let a: number;
    if (prev && below && sameAsBelow(k)) {
      p = prev;
      a = below.area;
    } else {
      p = floorPaths(k, prev);
      p = k === 0 ? clean(p) : keep(p);
      a = area(p);
    }
    if (a <= 0) {
      stop = `floor ${env.level} has no room left inside the envelope`;
      break;
    }
    const remaining = target - gfa;
    if (a > remaining) {
      if (remaining < PARAMS.minPlateArea) return { plates, gfa, hitTarget: true, stop: 'target reached' };
      p = shrinkTo(p, remaining).paths;
      if (prev) p = keep(and(p, prev)); // re-clip: the inset rounds independently of the floor below
      a = area(p);
      if (a <= 0) return { plates, gfa, hitTarget: true, stop: 'target reached' };
      plates.push({ ...env, polygons: toPolygons(p), area: a });
      gfa += a;
      return { plates, gfa, hitTarget: true, stop: 'target reached' };
    }
    plates.push({ ...env, polygons: p === prev && below ? below.polygons : toPolygons(p), area: a });
    gfa += a;
    prev = p;
  }
  return { plates, gfa, hitTarget: target - gfa < PARAMS.minPlateArea, stop };
}

interface Frontage {
  o: XY;
  u: XY;
  v: XY;
  /** canonical tie-break key: the segment's ends in mm, smaller end first */
  key: number[];
}

/** Frontages within 1 mm count as equally long. */
const TIE_LEN = 0.001;

/**
 * Candidate directions for the slab: the longest segment of the main frontage. The main
 * frontage is the longest road chain, then the widest; with no road, the plot ring. Chains
 * and segments tied within 1 mm all become candidates, sorted by a key built from their
 * coordinates, so the set and its order do not depend on where the ring starts or which way
 * it runs (open item #11). buildDesigns evaluates every candidate and keeps the largest slab.
 */
function frontageCandidates(site: Site): Frontage[] {
  const roads = site.chains.filter((c) => c.role === 'road');
  let runs: XY[][];
  if (roads.length > 0) {
    const maxLen = Math.max(...roads.map((c) => c.length));
    const long = roads.filter((c) => c.length >= maxLen - TIE_LEN);
    const maxW = Math.max(...long.map((c) => c.width ?? 0));
    runs = long.filter((c) => (c.width ?? 0) >= maxW - 1e-9).map((c) => c.points);
  } else runs = [[...site.ring, site.ring[0]!]];
  const segs: { a: XY; b: XY; l: number }[] = [];
  for (const pts of runs) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      segs.push({ a, b, l: Math.hypot(b[0] - a[0], b[1] - a[1]) });
    }
  }
  const maxL = Math.max(...segs.map((s) => s.l));
  const mm = (p: XY) => [Math.round(p[0] * 1000), Math.round(p[1] * 1000)];
  const lex = (p: number[], q: number[]) => {
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i]! - q[i]!;
    return 0;
  };
  const out: Frontage[] = segs
    .filter((s) => s.l >= maxL - TIE_LEN && s.l > 0)
    .map(({ a, b, l }) => {
      const u: XY = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const ka = mm(a);
      const kb = mm(b);
      return { o: a, u, v: [-u[1], u[0]] as XY, key: lex(ka, kb) <= 0 ? [...ka, ...kb] : [...kb, ...ka] }; // ring is CCW: v points into the plot
    });
  out.sort((p, q) => lex(p.key, q.key));
  // the band depends only on the line's direction, so parallel candidates (opposite sides of
  // a rectangle) build the same slab: keep the first of each direction
  const dir = (f: Frontage): XY => (f.u[0] < -1e-12 || (Math.abs(f.u[0]) <= 1e-12 && f.u[1] < 0) ? [-f.u[0], -f.u[1]] : f.u);
  return out.filter((f, i) => {
    const d = dir(f);
    return !out.slice(0, i).some((g) => {
      const e = dir(g);
      return Math.abs(e[0] - d[0]) <= 1e-9 && Math.abs(e[1] - d[1]) <= 1e-9;
    });
  });
}

function bandPath(f: Frontage, ground: Paths64, depth: number): Path64 | null {
  const { o, u, v } = f;
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const path of ground) {
    for (const q of path) {
      const x = q.x / 1000 - o[0];
      const y = q.y / 1000 - o[1];
      const pu = x * u[0] + y * u[1];
      const pv = x * v[0] + y * v[1];
      umin = Math.min(umin, pu);
      umax = Math.max(umax, pu);
      vmin = Math.min(vmin, pv);
      vmax = Math.max(vmax, pv);
    }
  }
  if (!Number.isFinite(umin)) return null;
  const D = Math.min(depth, vmax - vmin);
  const vc = (vmin + vmax) / 2;
  const v0 = vc - D / 2;
  const v1 = vc + D / 2;
  const u0 = umin - 1;
  const u1 = umax + 1;
  const at = (pu: number, pv: number): XY => [o[0] + pu * u[0] + pv * v[0], o[1] + pu * u[1] + pv * v[1]];
  return toPath([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]);
}

function binding(target: Cap, r: StackResult, footCut: string | null): string {
  const cap = target.id === 'ENVELOPE' ? 'envelope GFA' : `${RULES[target.id]?.article ?? target.id}: ${target.label}`;
  if (r.hitTarget) return footCut ? `${cap}; footprint held to the open-space limit (${footCut})` : cap;
  const env = `envelope: ${r.stop}`;
  return footCut ? `${env}; footprint held to the open-space limit (${footCut})` : env;
}

function draft(
  kind: DesignKind, name: string, regime: Regime, site: Site, target: Cap, r: StackResult, footCut: string | null,
): DesignDraft {
  const footprint = r.plates[0]?.area ?? 0;
  return {
    id: `${regime}-${kind}`,
    kind,
    name,
    regime,
    plates: r.plates,
    floors: r.plates.length,
    height: r.plates[r.plates.length - 1]?.z1 ?? 0,
    gfa: r.gfa,
    footprint,
    openSpace: site.plotArea - footprint,
    far: r.gfa / site.plotArea,
    targetGfa: target.value,
    binding: binding(target, r, footCut),
  };
}

export function buildDesigns(site: Site, regime: Regime, envPaths: Paths64[], envPlates: FloorPlate[], caps: Cap[]): DesignDraft[] {
  if (envPlates.length === 0) return [];
  // target = the envelope's permitted GFA (the open-space cap, when present, is already the
  // solved GFA at which footprint and OSR agree); the footprint limit follows from it
  const target = caps.reduce((m, c) => (c.value < m.value ? c : m));
  const foot = maxFootprint(site, target.value);
  const footLimit = Math.max(0, foot.value);
  const tp = TYPE_PARAMS[site.type];
  const F = (k: number) => envPaths[k]!;
  const out: DesignDraft[] = [];

  // 1. Tower on podium
  {
    const g = shrinkTo(F(0), footLimit, 0, 1);
    const a = g.t;
    const P = Math.min(tp.podiumFloors, envPlates.length);
    let t = a;
    if (P < envPlates.length) {
      const towerBase = a > 0 ? keep(inset(F(P), a)) : F(P);
      t = shrinkTo(towerBase, tp.towerPlateMax, a, 5).t;
    }
    const r = stack(
      envPlates,
      target.value,
      (k, prev) => {
        const d = k < P ? a : t;
        const g = d > 0 ? inset(F(k), d) : F(k);
        return prev ? and(g, prev) : g;
      },
      (k) => F(k) === F(k - 1) && (k < P) === (k - 1 < P),
    );
    if (r.plates.length > 0) out.push(draft('tower-podium', 'Tower on podium', regime, site, target, r, a > 0 ? foot.rule : null));
  }

  // 2. Slab parallel to the main frontage. Tied frontages (open item #11): every candidate
  //    is built and the one with the most GFA kept; equal GFA keeps the first in key order.
  {
    const slab = (f: Frontage): { r: StackResult; footCut: string | null } | null => {
      let depth = tp.slabDepth;
      const fit = (d: number) => {
        const band = bandPath(f, F(0), d);
        return band ? keep(and(F(0), [band])) : [];
      };
      let footCut: string | null = null;
      if (area(fit(depth)) > footLimit) {
        let lo = 0;
        let hi = depth;
        while (hi - lo > 0.005) {
          const mid = (lo + hi) / 2;
          if (area(fit(mid)) <= footLimit) lo = mid;
          else hi = mid;
        }
        depth = lo;
        footCut = foot.rule;
      }
      const band = bandPath(f, F(0), depth);
      if (!band || depth < 6) return null;
      // above the ground floor, the floor below already carries the band: one intersection per floor
      const r = stack(envPlates, target.value, (k, prev) => and(F(k), prev ?? [band]), (k) => F(k) === F(k - 1));
      return r.plates.length > 0 ? { r, footCut } : null;
    };
    let best: { r: StackResult; footCut: string | null } | null = null;
    for (const f of frontageCandidates(site)) {
      const s = slab(f);
      if (s && (!best || s.r.gfa > best.r.gfa + 1e-6)) best = s;
    }
    if (best) out.push(draft('slab', 'Slab along the frontage', regime, site, target, best.r, best.footCut));
  }

  // 3. Courtyard: a ring of wings around a fixed courtyard cut from the ground plate.
  //    Wing depth: as deep as possible up to 0.75 x slab depth, but leaving a
  //    courtyard of at least MIN_COURT m2 and a footprint within the open-space limit.
  {
    const MIN_COURT = 100;
    const MIN_WING = 6;
    const ground = (w: number) => {
      const hole = keep(inset(F(0), w));
      return { hole, plate: minus(F(0), hole) };
    };
    const ok = (w: number) => {
      const g = ground(w);
      return area(g.hole) >= MIN_COURT && area(g.plate) <= footLimit;
    };
    let wing = tp.slabDepth * 0.75;
    let footCut: string | null = null;
    let g: { hole: Paths64; plate: Paths64 } = { hole: [], plate: [] };
    if (ok(wing)) g = ground(wing);
    else if (ok(MIN_WING)) {
      // both constraints get easier as the wing gets thinner: bisect the deepest wing that works
      let lo = MIN_WING;
      let hi = wing;
      while (hi - lo > 0.05) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      wing = lo;
      g = ground(wing);
      if (area(ground(hi).hole) >= MIN_COURT) footCut = foot.rule;
    }
    if (g.hole.length > 0 && g.plate.length > 0) {
      const hole = g.hole;
      // above the ground floor, the floor below already has the courtyard cut out
      const r = stack(envPlates, target.value, (k, prev) => (prev ? and(F(k), prev) : minus(F(k), hole)), (k) => F(k) === F(k - 1));
      if (r.plates.length > 0) out.push(draft('courtyard', 'Courtyard block', regime, site, target, r, footCut));
    }
  }
  return out;
}

export type { Chain };
