// Floor-by-floor envelope: F_k = plot - union_c buffer(chain_c, d_c(k)).
// Two regimes, never merged: low (roof < 23 m and GFA < 10,000 m2) and high
// (MR 33: 6 m from every boundary, gated on frontage).

import type { Path64, Paths64 } from 'clipper2-ts';
import { chainLabel } from './chains.js';
import { and, area, bufferLine, dropSmall, minus, openSlivers, or, toPath, toPolygons } from './geom.js';
import { PARAMS, RULES, TYPE_PARAMS, chainDistance, floorTop, isGateFrontage, touchesPlot, zoningRoadFrontage, type DistanceCtx } from './rules.js';
import type { BuildingType, Cap, Chain, Envelope, FloorPlate, Regime, Warning, XY, ZoneInfo } from './types.js';

export interface Site {
  ring: XY[];
  plot: Paths64;
  plotArea: number;
  chains: Chain[];
  /**
   * Chains of the true outline when the plot was simplified (else absent): frontage facts
   * (MR 33 art. 2, zoning art. 36) are read from them, as the checker does, so a straight side
   * is measured on the same points in both.
   */
  frontChains?: Chain[];
  chainPaths: Path64[];
  /** Per chain: ids of wider road chains that relieve its 2x cut (MR 55 arts. 45-46). */
  reliefPartners: number[][];
  /** Per chain: union of buffer(partner, 60 m), or null. */
  reliefRegion: (Paths64 | null)[];
  floorH: { ground: number; typical: number };
  type: BuildingType;
  zone: ZoneInfo;
  nearStation: boolean;
  /** Extra cut width (m) on top of PARAMS.safety: how far simplification moved the boundary. */
  extraMargin: number;
  bufCache: Map<string, Paths64>;
}

export interface EnvelopeRun {
  plates: FloorPlate[];
  paths: Paths64[];
  stopReason: string;
  droppedArea: number;
  sliverArea: number;
}

/** Buffer of a chain at legal distance d, cut PARAMS.safety wider (see rules.ts). */
function buf(site: Site, c: Chain, d: number): Paths64 {
  if (d <= 0) return [];
  const dmm = Math.round(d * 1000);
  const key = `${c.id}:${dmm}`;
  let b = site.bufCache.get(key);
  if (!b) {
    b = bufferLine(site.chainPaths[c.id]!, c.closed, dmm / 1000 + PARAMS.safety + site.extraMargin);
    site.bufCache.set(key, b);
  }
  return b;
}

/** The region a chain removes from floor k, honouring the wider-road relief. */
export function chainCut(site: Site, c: Chain, base: number, twoX: number): Paths64 {
  const full = Math.max(base, twoX);
  const region = site.reliefRegion[c.id];
  if (region && twoX > base) {
    const key = `R${c.id}:${Math.round(base * 1000)}:${Math.round(full * 1000)}`;
    let cut = site.bufCache.get(key);
    if (!cut) {
      cut = or([buf(site, c, base), minus(buf(site, c, full), region)]);
      site.bufCache.set(key, cut);
    }
    return cut;
  }
  return buf(site, c, full);
}

interface RunOpts {
  regime: Regime;
  /** Building height / storeys assumed for the height bands of arts. 50, 54, 55. */
  bandH: number;
  bandFloors: number;
  /** Floors must satisfy z1 < zStrict and z1 <= zMax. */
  zStrict: number;
  zMax: number;
}

export function runEnvelope(site: Site, o: RunOpts): EnvelopeRun {
  const plates: FloorPlate[] = [];
  const paths: Paths64[] = [];
  let prev: Paths64 | null = null;
  let base: Paths64 | null = null; // plot minus every chain's floor-1 base cut, computed once per run
  const base0: number[] = []; // each chain's floor-1 base distance
  let stopReason = `reached ${PARAMS.maxFloors} floors`;
  let droppedArea = 0;
  let sliverArea = 0;
  for (let k = 1; k <= PARAMS.maxFloors; k++) {
    const z0 = k === 1 ? 0 : floorTop(k - 1, site.floorH);
    const z1 = floorTop(k, site.floorH);
    if (!(z1 < o.zStrict) || z1 > o.zMax) {
      stopReason = o.regime === 'low' && o.zStrict === PARAMS.highRiseHeight
        ? `next floor would reach ${z1.toFixed(2)} m; the low regime stays below ${PARAMS.highRiseHeight} m (MR 33 art. 1)`
        : `next floor would reach ${z1.toFixed(2)} m, above the ${o.zMax} m height band`;
      break;
    }
    // the envelope applies the road setback to every building (art50: true, stricter)
    const ctx: DistanceCtx = { level: k, z: z1, buildingH: o.bandH, art50: true, high: o.regime === 'high' };
    // F_k = (plot - floor-1 base cuts) - (cuts that grew since floor 1: 2x fronts at z_k,
    // and base distances that step up, e.g. 3 m from floor 3 under ord. art. 54),
    // computed fresh from the same cached geometry every floor (never from floor k-1,
    // which would compound rounding), then clipped to floor k-1 so plates nest.
    const baseCuts: Paths64 = [];
    const cuts: Paths64 = [];
    const dByChain: number[] = [];
    // relief chains sharing a relief region are cut together: (union of their 2x buffers) - region
    const reliefGroups = new Map<Paths64, Paths64>();
    for (const c of site.chains) {
      const d = chainDistance(c, ctx);
      dByChain[c.id] = Math.max(d.base, d.twoX);
      if (!base) {
        base0[c.id] = d.base;
        baseCuts.push(...buf(site, c, d.base));
      } else if (d.base > base0[c.id]! + 1e-9) cuts.push(...buf(site, c, d.base));
      if (d.twoX > d.base) {
        const region = site.reliefRegion[c.id];
        if (region) {
          const g = reliefGroups.get(region) ?? [];
          g.push(...buf(site, c, d.twoX));
          reliefGroups.set(region, g);
        } else cuts.push(...buf(site, c, d.twoX));
      }
    }
    if (!base) base = minus(site.plot, baseCuts);
    for (const [region, g] of reliefGroups) cuts.push(...minus(g, region));
    if (prev && cuts.length === 0) {
      // nothing grew: same plate as the floor below (shared geometry)
      const below = plates[plates.length - 1]!;
      plates.push({ level: k, z0, z1, polygons: below.polygons, area: below.area, dByChain });
      paths.push(prev);
      continue;
    }
    let F = minus(base, cuts);
    if (prev) F = and(F, prev);
    const before = area(F);
    // Full morphological opening on the run's first floor (plot-shape slivers, acute
    // corners). Above it only 2x fronts move, so parts are dropped when their mean
    // thickness falls under the sliver width (the cheap test keeps 60 floors fast).
    const opened = prev ? F : openSlivers(F, PARAMS.slivers);
    const kept = dropSmall(opened, PARAMS.minPlateArea, prev ? PARAMS.slivers : 0);
    const a = area(kept.paths);
    if (a > 0) {
      droppedArea += kept.dropped;
      sliverArea += Math.max(0, before - area(opened));
    }
    if (a <= 0) {
      stopReason = `floor ${k} has no buildable area: ${emptyReason(site, ctx)}`;
      break;
    }
    plates.push({ level: k, z0, z1, polygons: toPolygons(kept.paths), area: a, dByChain });
    paths.push(kept.paths);
    prev = kept.paths;
  }
  return { plates, paths, stopReason, droppedArea, sliverArea };
}

/** Names the chain whose setback removes the most plot area on an empty floor. */
function emptyReason(site: Site, ctx: DistanceCtx): string {
  let best = '';
  let bestArea = -1;
  for (const c of site.chains) {
    const { base, twoX, parts } = chainDistance(c, ctx);
    const removed = area(and(site.plot, chainCut(site, c, base, twoX)));
    if (removed > bestArea) {
      bestArea = removed;
      const d = Math.max(base, twoX);
      const top = parts.reduce((m, p) => (p.d > m.d ? p : m), parts[0]!);
      best = `${chainLabel(c)} needs ${d.toFixed(2)} m (${RULES[top.rule]!.article})`;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Caps and the permitted GFA of an envelope

export interface RoadFacts {
  /** Widest touching road chain with at least the gate frontage (m), or 0. */
  widestGateRoad: number;
  /** Widest road chain that touches the plot, or 0 (for messages). */
  widestRoad: number;
  /** Zoning art. 16 + 36: a touching road >= 16 m with >= 16 m of frontage (office exception). */
  officeRoad: boolean;
  /** Zoning art. 16 + 36: a touching road >= 12 m with >= 12 m of frontage (hotel exception). */
  hotelRoad: boolean;
}

export function roadFacts(chains: Chain[]): RoadFacts {
  let widestGateRoad = 0;
  let widestRoad = 0;
  let officeRoad = false;
  let hotelRoad = false;
  for (const c of chains) {
    if (!touchesPlot(c)) continue;
    const w = c.width ?? 0;
    widestRoad = Math.max(widestRoad, w);
    if (isGateFrontage(c)) widestGateRoad = Math.max(widestGateRoad, w);
    if (zoningRoadFrontage(c, PARAMS.officeGateWidth)) officeRoad = true;
    if (zoningRoadFrontage(c, PARAMS.hotelGateWidth)) hotelRoad = true;
  }
  return { widestGateRoad, widestRoad, officeRoad, hotelRoad };
}

/** GFA caps that do not depend on geometry (FAR, gates, zoning bans). */
export function fixedCaps(site: Site, regime: Regime): Cap[] {
  const A = site.plotArea;
  const caps: Cap[] = [{ id: 'Z16-FAR', label: `FAR ${site.zone.far} x ${A.toFixed(1)} m2`, value: site.zone.far * A }];
  const rf = roadFacts(site.frontChains ?? site.chains);
  if (regime === 'low') {
    caps.push({ id: 'MR33-1', label: 'low regime: below 10,000 m2 (extra-large threshold)', value: PARAMS.lowRegimeGfaCap });
  } else {
    if (site.zone.far > 10) caps.push({ id: 'MR33-5', label: 'MR 33 FAR 10', value: 10 * A });
    if (rf.widestGateRoad < PARAMS.bigGateWidth) {
      caps.push({ id: 'MR33-2', label: `no 18 m road with 12 m frontage: 30,000 m2`, value: PARAMS.bigGateGfa });
    }
  }
  if (!site.nearStation) {
    if (site.type === 'office' && !rf.officeRoad) {
      caps.push({ id: 'Z16-OFFICE', label: 'office without 16 m of frontage on a 16 m road, or a station: 10,000 m2', value: PARAMS.officeGateGfa });
    }
    if (site.type === 'hotel' && !rf.hotelRoad) {
      caps.push({
        id: 'Z16-HOTEL',
        label: `hotel without 12 m of frontage on a 12 m road, or a station: 80 rooms x ${PARAMS.hotelGfaPerRoom} m2`,
        value: PARAMS.hotelGateRooms * PARAMS.hotelGfaPerRoom,
      });
    }
  }
  return caps;
}

/** Largest ground footprint the open-space rules allow for a target GFA, and the rule that sets it. */
export function maxFootprint(site: Site, targetGfa: number): { value: number; rule: string } {
  const A = site.plotArea;
  const dwelling = TYPE_PARAMS[site.type].dwelling;
  const cands = [
    { rule: 'ORD52-OPEN', value: (dwelling ? 0.7 : 0.9) * A },
    { rule: 'MR55-33', value: A / (dwelling ? 1.3 : 1.1) },
    { rule: 'Z16-OSR', value: A - (site.zone.osrPct / 100) * targetGfa },
  ];
  return cands.reduce((m, c) => (c.value < m.value ? c : m));
}

/**
 * Open space couples footprint and GFA: zoning OSR needs open >= osr% x GFA, so more GFA
 * allows a smaller footprint, which allows less GFA. Find the largest G <= upper with
 * G <= sum_k min(plate_k, F(G)), where F(G) is the footprint allowed at G. The right side
 * falls as G grows, so bisection finds it. Returns a cap only when open space binds.
 */
export function solveOpenSpace(site: Site, plates: FloorPlate[], upper: number): Cap | null {
  const reach = (G: number) => {
    const F = Math.max(0, maxFootprint(site, G).value);
    return plates.reduce((s, p) => s + Math.min(p.area, F), 0);
  };
  if (reach(upper) >= upper - 1e-6) return null;
  let lo = 0;
  let hi = upper;
  for (let i = 0; i < 60 && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) >= mid) lo = mid;
    else hi = mid;
  }
  // snap to the exact fixed point when the footprint limit is flat there (eg 7 x 1,400 m2)
  const snap = reach(lo);
  if (snap > lo && snap <= upper && reach(snap) >= snap - 1e-9) lo = snap;
  const foot = maxFootprint(site, lo);
  return {
    id: foot.rule,
    label: `open space holds the footprint to ${Math.max(0, foot.value).toFixed(1)} m2 at this GFA`,
    value: lo,
  };
}

export function finishEnvelope(site: Site, regime: Regime, run: EnvelopeRun, allowed: boolean, reason?: string): Envelope {
  const A = site.plotArea;
  const gfa = run.plates.reduce((s, p) => s + p.area, 0);
  const caps = allowed ? fixedCaps(site, regime) : [];
  let permitted = 0;
  let limitedBy = reason ?? '';
  if (allowed && run.plates.length > 0) {
    caps.push({ id: 'ENVELOPE', label: `envelope: ${run.stopReason}`, value: gfa });
    const open = solveOpenSpace(site, run.plates, Math.min(...caps.map((c) => c.value)));
    if (open) caps.push(open);
    const best = caps.reduce((m, c) => (c.value < m.value ? c : m));
    permitted = best.value;
    limitedBy = best.id === 'ENVELOPE' ? best.label : `${RULES[best.id]!.article} ${RULES[best.id]!.source.split(' (')[0]}: ${best.label}`;
  } else if (allowed) {
    limitedBy = run.stopReason;
  }
  const footprint = run.plates[0]?.area ?? 0;
  const env: Envelope = {
    regime,
    allowed,
    plates: run.plates,
    floors: run.plates.length,
    height: run.plates[run.plates.length - 1]?.z1 ?? 0,
    gfa,
    permittedGfa: permitted,
    limitedBy,
    caps,
    farReached: permitted / A,
    footprint,
    openSpace: A - footprint,
    stopReason: run.stopReason,
    sliverArea: run.sliverArea,
    droppedArea: run.droppedArea,
  };
  if (reason !== undefined) env.reason = reason;
  return env;
}

// ---------------------------------------------------------------------------

export interface RegimeBuild {
  env: Envelope;
  paths: Paths64[];
  warnings: Warning[];
}

/** Low regime: try the height bands of arts. 50/54/55 and keep the one that permits most GFA. */
export function buildLow(site: Site): RegimeBuild {
  const bands = [8, 9, 15, PARAMS.highRiseHeight];
  let best: { env: Envelope; run: EnvelopeRun } | null = null;
  let lastFloors = -1;
  for (const U of bands) {
    const strict = U === PARAMS.highRiseHeight;
    let floors = 0;
    while (floors < PARAMS.maxFloors) {
      const z = floorTop(floors + 1, site.floorH);
      if (strict ? z >= U : z > U) break;
      floors++;
    }
    // the band's building is at most `floors` storeys, so its height is that floor's top;
    // a band fitting the same number of floors is the same building: skip it
    if (floors === 0 || floors === lastFloors) continue;
    lastFloors = floors;
    const run = runEnvelope(site, {
      regime: 'low',
      bandH: floorTop(floors, site.floorH),
      bandFloors: floors,
      zStrict: strict ? U : Infinity,
      zMax: strict ? Infinity : U,
    });
    const env = finishEnvelope(site, 'low', run, true);
    if (!best || env.permittedGfa > best.env.permittedGfa + 1e-6) best = { env, run };
  }
  if (!best) {
    const run: EnvelopeRun = { plates: [], paths: [], stopReason: 'ground floor is taller than every height band', droppedArea: 0, sliverArea: 0 };
    return { env: finishEnvelope(site, 'low', run, true), paths: [], warnings: [] };
  }
  return { env: best.env, paths: best.run.paths, warnings: runWarnings('low', best.run) };
}

export function highGate(site: Site): { ok: boolean; reason?: string } {
  const rf = roadFacts(site.frontChains ?? site.chains);
  if (rf.widestGateRoad >= PARAMS.highGateWidth) return { ok: true };
  const anyRoad = site.chains.some((c) => c.role === 'road');
  return {
    ok: false,
    reason: anyRoad
      ? `MR 33 art. 2: no road of ${PARAMS.highGateWidth} m or more with ${PARAMS.highGateFrontage} m of contiguous frontage (widest road ${rf.widestRoad} m)`
      : 'MR 33 art. 2: the plot has no road frontage',
  };
}

export function buildHigh(site: Site): RegimeBuild {
  const gate = highGate(site);
  if (!gate.ok) {
    const run: EnvelopeRun = { plates: [], paths: [], stopReason: gate.reason!, droppedArea: 0, sliverArea: 0 };
    return { env: finishEnvelope(site, 'high', run, false, gate.reason), paths: [], warnings: [] };
  }
  const run = runEnvelope(site, { regime: 'high', bandH: Infinity, bandFloors: PARAMS.maxFloors, zStrict: Infinity, zMax: Infinity });
  return { env: finishEnvelope(site, 'high', run, true), paths: run.paths, warnings: runWarnings('high', run) };
}

function runWarnings(regime: Regime, run: EnvelopeRun): Warning[] {
  const w: Warning[] = [];
  if (run.droppedArea > 0.01) {
    w.push({ code: 'part-dropped', message: `${regime} regime: plate parts under ${PARAMS.minPlateArea} m2 dropped (${run.droppedArea.toFixed(1)} m2 over all floors)` });
  }
  if (run.sliverArea > 1) {
    w.push({ code: 'sliver-removed', message: `${regime} regime: strips narrower than ${PARAMS.slivers} m removed (${run.sliverArea.toFixed(1)} m2 over all floors)` });
  }
  if (run.plates.length === 0) w.push({ code: 'empty-envelope', message: `${regime} regime: ${run.stopReason}` });
  return w;
}

export { toPath };
