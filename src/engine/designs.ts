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

/** Smallest extra inset that brings the area to <= limit (30 bisection steps, ~mm). */
function shrinkTo(p: Paths64, limit: number, base = 0): { paths: Paths64; t: number } {
  if (area(p) <= limit) return { paths: p, t: base };
  let lo = 0;
  let hi = 1;
  while (area(clean(inset(p, hi))) > limit && hi < 512) hi *= 2;
  let best = clean(inset(p, hi));
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const cand = clean(inset(p, mid));
    if (area(cand) <= limit) {
      hi = mid;
      best = cand;
    } else lo = mid;
  }
  return { paths: best, t: base + hi };
}

function stack(
  envPlates: FloorPlate[],
  target: number,
  floorPaths: (k: number) => Paths64,
): StackResult {
  const plates: FloorPlate[] = [];
  let gfa = 0;
  let prev: Paths64 | null = null;
  let stop = 'envelope has no more floors';
  for (let k = 0; k < envPlates.length; k++) {
    const env = envPlates[k]!;
    let p = floorPaths(k);
    if (prev) p = and(p, prev);
    p = clean(p);
    let a = area(p);
    if (a <= 0) {
      stop = `floor ${env.level} has no room left inside the envelope`;
      break;
    }
    const remaining = target - gfa;
    if (a > remaining) {
      if (remaining < PARAMS.minPlateArea) return { plates, gfa, hitTarget: true, stop: 'target reached' };
      p = shrinkTo(p, remaining).paths;
      a = area(p);
      if (a <= 0) return { plates, gfa, hitTarget: true, stop: 'target reached' };
      plates.push({ ...env, polygons: toPolygons(p), area: a });
      gfa += a;
      return { plates, gfa, hitTarget: true, stop: 'target reached' };
    }
    plates.push({ ...env, polygons: toPolygons(p), area: a });
    gfa += a;
    prev = p;
  }
  return { plates, gfa, hitTarget: target - gfa < PARAMS.minPlateArea, stop };
}

function frontage(site: Site): { o: XY; u: XY; v: XY } {
  // main frontage: longest road chain (then widest); no road: longest edge
  const roads = site.chains.filter((c) => c.role === 'road');
  let pts: XY[];
  if (roads.length > 0) {
    const best = roads.reduce((m, c) => (c.length > m.length + 1e-9 || (Math.abs(c.length - m.length) <= 1e-9 && (c.width ?? 0) > (m.width ?? 0)) ? c : m));
    pts = best.points;
  } else pts = [...site.ring, site.ring[0]!];
  let bi = 0;
  let bl = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  const a = pts[bi]!;
  const b = pts[bi + 1]!;
  const u: XY = [(b[0] - a[0]) / bl, (b[1] - a[1]) / bl];
  return { o: a, u, v: [-u[1], u[0]] }; // ring is CCW, so the left normal points into the plot
}

function bandPath(site: Site, ground: Paths64, depth: number): Path64 | null {
  const { o, u, v } = frontage(site);
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
  const fixed = caps.filter((c) => c.id !== 'ORD52-OPEN' && c.id !== 'MR55-33' && c.id !== 'Z16-OSR');
  const target = fixed.reduce((m, c) => (c.value < m.value ? c : m));
  const foot = maxFootprint(site, target.value);
  const footLimit = Math.max(0, foot.value);
  const tp = TYPE_PARAMS[site.type];
  const F = (k: number) => envPaths[k]!;
  const out: DesignDraft[] = [];

  // 1. Tower on podium
  {
    const g = shrinkTo(F(0), footLimit);
    const a = g.t;
    const P = Math.min(tp.podiumFloors, envPlates.length);
    let t = a;
    if (P < envPlates.length) {
      const towerBase = a > 0 ? clean(inset(F(P), a)) : F(P);
      t = shrinkTo(towerBase, tp.towerPlateMax, a).t;
    }
    const r = stack(envPlates, target.value, (k) => {
      const d = k < P ? a : t;
      return d > 0 ? inset(F(k), d) : F(k);
    });
    out.push(draft('tower-podium', 'Tower on podium', regime, site, target, r, a > 0 ? foot.rule : null));
  }

  // 2. Slab parallel to the main frontage
  {
    let depth = tp.slabDepth;
    const fit = (d: number) => {
      const band = bandPath(site, F(0), d);
      return band ? clean(and(F(0), [band])) : [];
    };
    let footCut: string | null = null;
    if (area(fit(depth)) > footLimit) {
      let lo = 0;
      let hi = depth;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (area(fit(mid)) <= footLimit) lo = mid;
        else hi = mid;
      }
      depth = lo;
      footCut = foot.rule;
    }
    const band = bandPath(site, F(0), depth);
    if (band && depth >= 6) {
      const r = stack(envPlates, target.value, (k) => and(F(k), [band]));
      out.push(draft('slab', 'Slab along the frontage', regime, site, target, r, footCut));
    }
  }

  // 3. Courtyard: a ring of wings around a fixed courtyard cut from the ground plate.
  //    Wing depth: as deep as possible up to 0.75 x slab depth, but leaving a
  //    courtyard of at least MIN_COURT m2 and a footprint within the open-space limit.
  {
    const MIN_COURT = 100;
    const MIN_WING = 6;
    const ground = (w: number) => {
      const hole = clean(inset(F(0), w));
      return { hole, plate: clean(minus(F(0), hole)) };
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
      for (let i = 0; i < 30; i++) {
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
      const r = stack(envPlates, target.value, (k) => minus(F(k), hole));
      out.push(draft('courtyard', 'Courtyard block', regime, site, target, r, footCut));
    }
  }
  return out;
}

export type { Chain };
