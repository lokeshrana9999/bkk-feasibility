// The single entry point. Pure: no DOM, fetch, Date or random; never throws.

import { buildChains, chainLabel } from './chains.js';
import { checkDesign, type CheckSite } from './checker.js';
import { buildDesigns } from './designs.js';
import { buildHigh, buildLow, highGate, hotelBanLabel, roadFacts, type Site } from './envelope.js';
import { cleanPlot } from './frame.js';
import type { Paths64 } from 'clipper2-ts';
import { and, bufferLine, or, toPath } from './geom.js';
import { polylineDist } from './measure.js';
import {
  PARAMS, RULES, RULE_ORDER, TYPE_PARAMS, canalSetback, clearAround, privateSetback, roadSetback,
} from './rules.js';
import type {
  AppliedRule, BuildingType, Chain, Design, EngineError, EngineInput, EngineOutput, Envelope, Regime, Warning, XY,
} from './types.js';

const TYPES: readonly BuildingType[] = ['condo', 'apartment', 'office', 'hotel'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fail = (code: EngineError['code'], message: string): EngineError => ({ ok: false, code, message });

const samePt = (a: XY, b: XY) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/**
 * Turn in degrees where chain a ends and chain b starts (they share that vertex), or null
 * when they do not meet end-to-start.
 */
function turnAt(a: Chain, b: Chain): number | null {
  const ap = a.points;
  const bp = b.points;
  if (a.closed || b.closed || !samePt(ap[ap.length - 1]!, bp[0]!)) return null;
  const p = ap[ap.length - 2]!;
  const q = ap[ap.length - 1]!;
  const r = bp[1]!;
  const t = Math.atan2((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]), (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]));
  return Math.abs((t * 180) / Math.PI);
}

/**
 * MR 55 arts. 45-46 relief pairs: each narrower road chain with wider road chains that are
 * a different road at a corner (art. 46) or a second road within 60 m (art. 45). When both
 * chains are named, the names decide whether they are the same road. Otherwise chains that meet
 * with a turn under PARAMS.cornerTurnDeg are one road changing width, and chains that do not
 * meet are taken to be the same road (they may be one street interrupted by other land; the
 * oracle takes "same road" as a fact, oracle disagreement D9). No relief within a road.
 */
export function reliefPartners(chains: Chain[], enabled: boolean): number[][] {
  const out: number[][] = chains.map(() => []);
  if (!enabled) return out;
  const sameRoad = (a: Chain, b: Chain) => {
    if (a.name && b.name) return a.name === b.name;
    const t = turnAt(a, b) ?? turnAt(b, a);
    return t === null || t < PARAMS.cornerTurnDeg;
  };
  // the chains cover the whole plot outline, so their points bound any building on it
  const plotPts = chains.flatMap((c) => c.points);
  for (const n of chains) {
    if (n.role !== 'road') continue;
    for (const w of chains) {
      if (w.role !== 'road' || w.id === n.id || (w.width ?? 0) <= (n.width ?? 0)) continue;
      if (sameRoad(n, w)) continue;
      if (polylineDist(n.points, w.points) > PARAMS.reliefReach) continue;
      // Art. 46 (corner): building length along the narrower road <= 60 m. Art. 45 (two roads
      // flanking): building width along the wider road <= 60 m. The building is unknown here,
      // so relief is granted only when the PLOT is at most 60 m long in that direction; then
      // every building on it qualifies (stricter where a shorter building on a longer plot
      // would also qualify). Oracle disagreements D6 / D7.
      // Roads that meet are a corner (art. 46). Roads that do not meet may be flanking (art. 45)
      // or, if skewed, read as a corner; both conditions are required for them so neither
      // reading finds the engine laxer.
      const corner = turnAt(n, w) !== null || turnAt(w, n) !== null;
      const tooLong = corner
        ? extentAlong(plotPts, n) > PARAMS.reliefReach
        : extentAlong(plotPts, w) > PARAMS.reliefReach || extentAlong(plotPts, n) > PARAMS.reliefReach;
      if (tooLong) continue;
      out[n.id]!.push(w.id);
    }
  }
  return out;
}

/**
 * Length of the plot's projection onto a road chain's direction, taken end to end. (The
 * longest segment was used first; on a densified outline a sawtooth tooth could be the longest
 * segment, so the engine, on the simplified outline, and the checker, on the true one,
 * disagreed: nightly M4b. End points survive simplification, rotation and densifying.)
 */
function extentAlong(pts: XY[], c: Chain): number {
  const a = c.points[0]!;
  const z = c.points[c.points.length - 1]!;
  const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
  if (c.closed || L < 1e-9) return Infinity; // no direction: never grant relief
  const ux = (z[0] - a[0]) / L;
  const uy = (z[1] - a[1]) / L;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const t = p[0] * ux + p[1] * uy;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return hi - lo;
}

function appliedRules(site: Site, chosen: Envelope, low: Envelope, high: Envelope, partners: number[][]): AppliedRule[] {
  const A = site.plotArea;
  const tp = TYPE_PARAMS[site.type];
  const roads = site.chains.filter((c) => c.role === 'road');
  const privs = site.chains.filter((c) => c.role === 'private');
  const canals = site.chains.filter((c) => c.role === 'canal');
  const rf = roadFacts(site.frontChains ?? site.chains);
  const reliefOn = partners.some((p) => p.length > 0);
  const n = (v: number, d = 1) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const val: Record<string, [string, boolean]> = {
    'Z16-FAR': [`zone ${site.zone.code}: FAR ${site.zone.far} -> GFA <= ${n(site.zone.far * A)} m2`, true],
    'Z16-OSR': [`open space >= ${site.zone.osrPct}% of GFA (${n((site.zone.osrPct / 100) * chosen.permittedGfa)} m2 at ${n(chosen.permittedGfa)} m2)`, true],
    'Z16-PERM': ['not assessed', true],
    'Z16-HOTEL': [site.type !== 'hotel' ? 'not a hotel'
      : site.nearStation || rf.hotelRoad ? 'waived (12 m frontage on a 12 m road, or station)'
      : site.hotelRooms === undefined ? `<= 80 rooms (~${n(PARAMS.hotelGateRooms * PARAMS.hotelGfaPerRoom, 0)} m2 at ${PARAMS.hotelGfaPerRoom} m2 per room)`
      : site.hotelRooms > PARAMS.hotelGateRooms ? hotelBanLabel(site.hotelRooms)
      : `${site.hotelRooms} rooms (given): not over 80, not banned`, site.type === 'hotel'],
    'Z16-OFFICE': [site.type === 'office' ? (site.nearStation || rf.officeRoad ? 'waived (16 m frontage on a 16 m road, or station)' : '<= 10,000 m2') : 'not an office', site.type === 'office'],
    'ORD52-OPEN': [`${tp.dwelling ? 30 : 10}% of plot = ${n((tp.dwelling ? 0.3 : 0.1) * A)} m2 (${tp.label}${site.type === 'hotel' ? ', non-dwelling call' : ''})`, true],
    'MR33-6': [`${tp.dwelling ? 30 : 10}% of plot (same as above)`, chosen.regime === 'high'],
    'MR55-33': [`${tp.dwelling ? 30 : 10}% of the largest floor`, true],
    'ORD50-ROAD': [roads.length ? roads.map((c) => `${chainLabel(c)}: ${n(roadSetback(c.width ?? 0, c.gap), 2)} m`).join('; ') : 'no road edge', roads.length > 0],
    'ORD49-2X': [roads.length ? roads.map((c) => `${chainLabel(c)}: floor top z needs z/2 - ${n((c.width ?? 0) + c.gap, 2)} m`).join('; ') : 'no road edge', roads.length > 0],
    'MR55-46': [reliefOn ? site.chains.filter((c) => partners[c.id]!.length).map((c) => `${chainLabel(c)} relieved within 60 m of ${partners[c.id]!.map((w) => chainLabel(site.chains[w]!)).join(', ')}`).join('; ') : 'not a corner / two-road plot (or relief off)', reliefOn],
    'MR55-50-PRIV': [privs.length ? `low regime: ${privateSetback(low.height)} m (building ${n(low.height, 2)} m)` : 'no private edge', privs.length > 0],
    'ORD55-CLEAR': [`low regime: ${clearAround(low.height)} m; high regime: covered by 6 m`, true],
    'MR55-42-CANAL': [canals.length ? canals.map((c) => `${chainLabel(c)}: ${canalSetback(c.width ?? 0, c.gap)} m`).join('; ') : 'no canal edge', canals.length > 0],
    'MR33-1': [`chosen: ${chosen.regime} regime (${chosen.regime === 'high' ? 'MR 33 applies' : 'below 23 m and 10,000 m2'})`, true],
    'MR33-2': [high.allowed ? `widest road with 12 m frontage: ${rf.widestGateRoad} m -> high regime allowed${rf.widestGateRoad >= PARAMS.bigGateWidth ? ', over 30,000 m2 allowed' : ', capped at 30,000 m2'}` : (high.reason ?? 'not allowed'), true],
    'MR33-2-LINK': ['not assessed', high.allowed],
    'MR33-3': ['not assessed', high.allowed],
    'MR33-4': ['high regime: 6 m from every road and private edge, all floors', high.allowed],
    'MR33-5': [`FAR <= 10 (zone FAR ${site.zone.far} is ${site.zone.far <= 10 ? 'lower, so moot' : 'higher'})`, high.allowed],
    'ORD52-6-FRONT': ['not assessed', true],
    'ORD52-6-FRONT6': ['not assessed (buildings up to 3 storeys)', true],
    'ORD52-7-REAR': [tp.dwelling ? 'not a commercial or public building' : 'not assessed', !tp.dwelling],
  };
  return RULE_ORDER.map((id) => {
    const r = RULES[id]!;
    const [value, applies] = val[id] ?? ['', false];
    return { id, source: r.source, article: r.article, quoteTh: r.quoteTh, text: r.text, kind: r.kind, value, applies };
  });
}

function validate(input: unknown): EngineError | null {
  if (!input || typeof input !== 'object') return fail('invalid-input', 'input must be an object');
  const i = input as Partial<EngineInput>;
  if (!TYPES.includes(i.type as BuildingType)) return fail('invalid-input', `type must be one of ${TYPES.join(', ')}`);
  if (i.units !== undefined && i.units !== 'lonlat' && i.units !== 'm') return fail('invalid-input', "units must be 'lonlat' or 'm'");
  if (i.zone === null || i.zone === undefined) return fail('invalid-zone', 'the plot has no zone; pick one before evaluating');
  const z = i.zone;
  if (typeof z !== 'object' || !isNum(z.far) || z.far <= 0 || z.far > 20) return fail('invalid-zone', 'zone FAR must be a number in (0, 20]');
  if (!isNum(z.osrPct) || z.osrPct < 0 || z.osrPct > 100) return fail('invalid-zone', 'zone OSR must be a percentage in [0, 100]');
  if (typeof z.code !== 'string') return fail('invalid-zone', 'zone code must be a string');
  if (typeof i.nearStation !== 'boolean') return fail('invalid-input', 'nearStation must be true or false');
  if (i.floorH !== undefined) {
    const f = i.floorH;
    if (!f || !isNum(f.ground) || !isNum(f.typical) || f.ground < 2.4 || f.ground > 10 || f.typical < 2.4 || f.typical > 10) {
      return fail('invalid-input', 'floor heights must be numbers between 2.4 and 10 m');
    }
  }
  if (i.widerRoadRelief !== undefined && typeof i.widerRoadRelief !== 'boolean') return fail('invalid-input', 'widerRoadRelief must be a boolean');
  if (i.hotelRooms !== undefined && !(isNum(i.hotelRooms) && Number.isInteger(i.hotelRooms) && i.hotelRooms > 0)) {
    return fail('invalid-input', 'hotelRooms must be a positive whole number');
  }
  return null;
}

function run(input: EngineInput): EngineOutput {
  const bad = validate(input);
  if (bad) return bad;
  const units = input.units ?? 'lonlat';
  const plot = cleanPlot(input.ring, input.edges, units);
  if ('ok' in plot) return plot;
  const warnings: Warning[] = [...plot.warnings];
  const chains = buildChains(plot.ring, plot.edges);
  // the true outline's chains (the checker measures against them; frontage is read from them)
  const trueChains = plot.original ? buildChains(plot.original.ring, plot.original.edges) : null;
  const partners = reliefPartners(chains, input.widerRoadRelief !== false);
  const chainPaths = chains.map((c) => toPath(c.points));
  // only the part of each relief region inside the plot matters (cuts are subtracted from the plot)
  const plotPath = [toPath(plot.ring)];
  // chains with the same partners share one region object (the envelope groups cuts by it)
  const regionByKey = new Map<string, Paths64>();
  const reliefRegion = chains.map((c) => {
    const ps = partners[c.id]!;
    if (ps.length === 0) return null;
    const key = ps.join(',');
    let region = regionByKey.get(key);
    if (!region) {
      // built short of 60 m by the safety margin and any simplification shift, so neither
      // rounding nor simplification can stretch the relief past 60 m of the true road
      region = and(or(ps.map((w) => bufferLine(chainPaths[w]!, chains[w]!.closed, PARAMS.reliefReach - PARAMS.safety - plot.simplifyDev))), plotPath);
      regionByKey.set(key, region);
    }
    return region;
  });
  const tp = TYPE_PARAMS[input.type];
  const site: Site = {
    ring: plot.ring,
    plot: plotPath,
    plotArea: plot.area,
    chains,
    ...(trueChains ? { frontChains: trueChains } : {}),
    chainPaths,
    reliefPartners: partners,
    reliefRegion,
    floorH: input.floorH ? { ground: input.floorH.ground, typical: input.floorH.typical } : { ...tp.floorH },
    type: input.type,
    zone: { code: input.zone!.code, far: input.zone!.far, osrPct: input.zone!.osrPct },
    nearStation: input.nearStation,
    ...(input.type === 'hotel' && input.hotelRooms !== undefined ? { hotelRooms: input.hotelRooms } : {}),
    // simplification moved the boundary by up to this much: every setback is cut that much deeper
    extraMargin: plot.simplifyDev,
    bufCache: new Map(),
  };
  if (!chains.some((c) => c.role === 'road')) {
    warnings.push({ code: 'no-road', message: 'no edge is marked as a road: the 2x height rule has nothing to measure from and the high regime is closed (MR 33 art. 2)' });
  }

  const low = buildLow(site);
  const high = buildHigh(site);
  warnings.push(...low.warnings, ...high.warnings);
  const chosen: Regime = high.env.allowed && high.env.permittedGfa > low.env.permittedGfa + 1e-6 ? 'high' : 'low';
  const pick = chosen === 'high' ? high : low;

  // the checker measures against the true outline, even when the geometry used a simplified one
  const rooms = site.hotelRooms !== undefined ? { hotelRooms: site.hotelRooms } : {};
  const checkSite: CheckSite = plot.original && trueChains
    ? {
        ring: plot.original.ring, chains: trueChains, reliefPartners: reliefPartners(trueChains, input.widerRoadRelief !== false),
        zone: site.zone, type: site.type, nearStation: site.nearStation, ...rooms,
      }
    : { ring: plot.ring, chains, reliefPartners: partners, zone: site.zone, type: site.type, nearStation: site.nearStation, ...rooms };
  // a use the zoning bans on this plot (a hotel over 80 rooms, room count given) permits 0 m2: no design
  const banned = pick.env.caps.find((c) => c.id === 'Z16-HOTEL' && c.value === 0);
  if (banned) warnings.push({ code: 'use-not-permitted', message: `${RULES['Z16-HOTEL']!.article}: ${banned.label}` });
  const designs: Design[] = (banned ? [] : buildDesigns(site, chosen, pick.paths, pick.env.plates, pick.env.caps, warnings)).map((d) => {
    const { checks } = checkDesign(checkSite, d.plates);
    return { ...d, checks, passes: checks.every((c) => c.status !== 'fail') };
  });
  if (pick.env.plates.length > 0 && designs.length < 2 && !banned) {
    warnings.push({ code: 'few-designs', message: `only ${designs.length} design fits this envelope` });
  }
  if (!highGate(site).ok && low.env.plates.length > 0) {
    warnings.push({ code: 'far-unreachable', message: `FAR reached ${low.env.farReached.toFixed(2)} of ${site.zone.far}: ${low.env.limitedBy}` });
  }

  return {
    ok: true,
    frame: plot.frame,
    plot: { ring: plot.ring, area: plot.area, perimeter: plot.ring.reduce((s, p, i) => {
      const q = plot.ring[(i + 1) % plot.ring.length]!;
      return s + Math.hypot(q[0] - p[0], q[1] - p[1]);
    }, 0), edges: plot.edges },
    chains,
    rules: appliedRules(site, pick.env, low.env, high.env, partners),
    regimes: { low: low.env, high: high.env, chosen },
    designs,
    warnings,
  };
}

export function evaluate(input: EngineInput): EngineOutput {
  try {
    return run(input);
  } catch (e) {
    return fail('internal', `engine error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
