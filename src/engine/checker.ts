// Independent checker. It re-measures a design from its output polygons with
// point-to-segment distances and shoelace areas (measure.ts, no clipper), derives
// the building class (high-rise / extra-large) from the design itself, and
// compares against the rule formulas in rules.ts. "pass" only when it passes.

import { chainLabel } from './chains.js';
import {
  closeRing, containmentViolationOf, pointPolylineDist, polygonSegments, polygonsArea, prepareShape, ringArea, samplePoints,
  segmentsToPolylineDist, straightSideLength, type ContainmentViolation, type Shape,
} from './measure.js';
import {
  PARAMS, RULES, TYPE_PARAMS, canalSetback, clearAround, narrowRoadSetback, privateSetback, roadSetback, roadSetbackApplies,
  twoXDistance,
} from './rules.js';
import type { BuildingType, Chain, CheckRow, CheckStatus, FloorPlate, XY, ZoneInfo } from './types.js';

export interface CheckSite {
  ring: XY[];
  chains: Chain[];
  /** Per chain: wider road chains that lift its 2x rule within 60 m (MR 55 arts. 45-46). */
  reliefPartners: number[][];
  zone: ZoneInfo;
  type: BuildingType;
  nearStation: boolean;
  /** Hotel room count when the caller gives it (zoning art. 16 (8)); else estimated from GFA. */
  hotelRooms?: number;
}

export interface Measured {
  gfa: number;
  footprint: number;
  openSpace: number;
  plotArea: number;
  height: number;
  floors: number;
  high: boolean;
}

/** Distances pass only when measured >= required - TOL (float noise, not a millimetre). */
const TOL = PARAMS.checkTol;
/** m2, float noise for GFA against a fixed cap. */
const AREA_EPS = 1e-6;
const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const m2 = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} m2`;

function row(id: string, rule: string, label: string, required: string, actual: string, status: CheckStatus, reason?: string): CheckRow {
  const r: CheckRow = { id, rule, label, required, actual, status };
  if (reason !== undefined) r.reason = reason;
  return r;
}

export function measure(site: CheckSite, plates: FloorPlate[]): Measured {
  const plotArea = Math.abs(ringArea(site.ring));
  const areas = plates.map((p) => polygonsArea(p.polygons));
  const gfa = areas.reduce((s, a) => s + a, 0);
  const footprint = areas[0] ?? 0;
  const height = plates[plates.length - 1]?.z1 ?? 0;
  const high = height >= PARAMS.highRiseHeight || gfa >= PARAMS.extraLargeGfa || areas.some((a) => a >= PARAMS.extraLargeGfa);
  return { gfa, footprint, openSpace: plotArea - footprint, plotArea, height, floors: plates.length, high };
}

/**
 * Minimum distance from any plate boundary to a chain, and the worst 2x margin per floor.
 * Floors that share geometry with the floor below (same polygons array) reuse its distances.
 */
function chainMeasures(site: CheckSite, c: Chain, plates: FloorPlate[], segCache: Map<unknown, [XY, XY][]>) {
  const segsOf = (p: FloorPlate) => {
    let s = segCache.get(p.polygons);
    if (!s) {
      s = polygonSegments(p.polygons);
      segCache.set(p.polygons, s);
    }
    return s;
  };
  const distCache = new Map<unknown, number>();
  const plainDist = (p: FloorPlate) => {
    let d = distCache.get(p.polygons);
    if (d === undefined) {
      d = segmentsToPolylineDist(segsOf(p), c.points);
      distCache.set(p.polygons, d);
    }
    return d;
  };
  let minDist = Infinity;
  const perLevel = plates.map((p) => plainDist(p));
  for (const d of perLevel) minDist = Math.min(minDist, d);
  let worst2x = { margin: Infinity, level: 0, dist: Infinity, req: 0 };
  if (c.role === 'road') {
    const partners = site.reliefPartners[c.id] ?? [];
    // the relief measurement depends on the floor's requirement, so it is cached per
    // (geometry, requirement), never per geometry alone
    const reliefCache = new Map<unknown, Map<number, number>>();
    plates.forEach((p) => {
      const req = twoXDistance(p.z1, c.width ?? 0, c.gap);
      const segs = segsOf(p);
      let dist: number;
      const byReq = reliefCache.get(p.polygons) ?? new Map<number, number>();
      reliefCache.set(p.polygons, byReq);
      if (partners.length === 0) dist = plainDist(p);
      else if (byReq.has(req)) dist = byReq.get(req)!;
      else {
        // relief: points within 60 m of a wider road are exempt (sampled every 0.25 m)
        // Reported distance: the smallest sample distance among samples that can matter, ie
        // samples already at or beyond the requirement (pass either way) and samples short
        // of it that are not exempt. Exemption is only looked up for samples short of it.
        dist = Infinity;
        for (const q of samplePoints(segs, 0.25)) {
          const dq = pointPolylineDist(q, c.points);
          if (dq >= dist) continue; // cannot lower the minimum
          if (dq < req - TOL) {
            const nearWide = partners.some((w) => pointPolylineDist(q, site.chains[w]!.points) <= PARAMS.reliefReach + TOL);
            if (nearWide) continue;
          }
          dist = dq;
        }
        byReq.set(req, dist);
      }
      const margin = dist - req;
      if (margin < worst2x.margin) worst2x = { margin, level: p.level, dist, req };
    });
  }
  return { minDist, perLevel, worst2x };
}

export function checkDesign(site: CheckSite, plates: FloorPlate[]): { checks: CheckRow[]; measured: Measured } {
  const ms = measure(site, plates);
  const checks: CheckRow[] = [];
  const plotPoly = [[site.ring]];
  const dwelling = TYPE_PARAMS[site.type].dwelling;
  const A = ms.plotArea;

  if (plates.length === 0) {
    checks.push(row('empty', 'ENVELOPE', 'Design has floors', '>= 1 floor', '0 floors', 'fail', 'no floor fits'));
    return { checks, measured: ms };
  }

  // geometry sanity: whole-polygon containment (vertices, every piece of every edge, and no
  // courtyard of the floor below roofed over), within PARAMS.geomTol. Nesting is what makes
  // the ground floor the footprint, so the open-space rows below rely on it.
  let plotFail: string | null = null;
  let nestFail: string | null = null;
  const shapes = new Map<unknown, Shape>();
  const shapeOf = (polys: FloorPlate['polygons']) => {
    let s = shapes.get(polys);
    if (!s) {
      s = prepareShape(polys);
      shapes.set(polys, s);
    }
    return s;
  };
  const plotShape = prepareShape(plotPoly);
  const where = (v: ContainmentViolation) => `(${fmt(v.at[0], 3)}, ${fmt(v.at[1], 3)})`;
  // geometries known to be inside the plot (within tol): a floor whose boundary lies exactly in
  // a floor below that is inside the plot is inside it too (the plot has no holes), so its own
  // plot test is skipped; tolerance never accumulates, as only an exact nesting is chained
  const inPlot = new Set<unknown>();
  for (let i = 0; i < plates.length; i++) {
    const p = plates[i]!;
    const below = plates[i - 1]?.polygons;
    if (below === p.polygons) continue; // same geometry as the floor below: already checked, trivially nested
    const A = shapeOf(p.polygons);
    if (below && nestFail === null) {
      const info = { exact: true };
      const v = containmentViolationOf(A, shapeOf(below), PARAMS.geomTol, info);
      if (v) {
        nestFail = v.kind === 'hole'
          ? `floor ${p.level}: covers a courtyard of the floor below at ${where(v)}`
          : `floor ${p.level}: ${v.kind === 'vertex' ? 'corner outside the floor below' : 'edge leaves the floor below'} at ${where(v)}`;
      } else if (info.exact && inPlot.has(below)) inPlot.add(p.polygons);
    }
    if (plotFail === null && !inPlot.has(p.polygons)) {
      const v = containmentViolationOf(A, plotShape, PARAMS.geomTol);
      if (v) plotFail = `floor ${p.level}: ${v.kind === 'vertex' ? 'corner outside' : 'edge leaves'} at ${where(v)}`;
      else inPlot.add(p.polygons);
    }
  }
  checks.push(row('inside-plot', 'ENVELOPE', 'Every floor inside the plot', 'contained (corners and edges)', plotFail ?? 'contained', plotFail === null ? 'pass' : 'fail'));
  checks.push(row(
    'nested', 'ENVELOPE', 'Upper floors within lower floors (footprint = ground floor)',
    'contained in the floor below, no courtyard covered', nestFail ?? 'contained', nestFail === null ? 'pass' : 'fail',
  ));

  // class
  checks.push(row(
    'class', 'MR33-1', 'High-rise or extra-large building?',
    `high-rise >= ${PARAMS.highRiseHeight} m or >= ${PARAMS.extraLargeGfa.toLocaleString('en-US')} m2`,
    `${fmt(ms.height)} m, ${m2(ms.gfa)}: ${ms.high ? 'yes, MR 33 applies' : 'no, MR 33 not triggered'}`,
    'pass',
  ));

  // FAR and open space
  const farMax = site.zone.far * A;
  checks.push(row('far', 'Z16-FAR', `FAR <= ${site.zone.far}`, `GFA <= ${m2(farMax)}`, `${m2(ms.gfa)} (FAR ${fmt(ms.gfa / A)})`, ms.gfa <= farMax + 0.01 ? 'pass' : 'fail'));
  const osrNeed = (site.zone.osrPct / 100) * ms.gfa;
  checks.push(row('osr', 'Z16-OSR', `Open space >= ${site.zone.osrPct}% of GFA`, `>= ${m2(osrNeed)}`, m2(ms.openSpace), ms.openSpace >= osrNeed - 0.01 ? 'pass' : 'fail'));
  checks.push(row('permeable', 'Z16-PERM', 'Permeable planting >= 50% of open space', `>= ${m2(ms.openSpace * 0.5)}`, 'no landscape data', 'not-assessed', 'needs a landscape plan'));
  const plotPct = dwelling ? 0.3 : 0.1;
  checks.push(row('open-plot', 'ORD52-OPEN', `Open space >= ${plotPct * 100}% of plot`, `>= ${m2(plotPct * A)}`, m2(ms.openSpace), ms.openSpace >= plotPct * A - 0.01 ? 'pass' : 'fail'));
  if (ms.high) {
    checks.push(row('open-plot-mr33', 'MR33-6', `Open space >= ${plotPct * 100}% of plot (high-rise)`, `>= ${m2(plotPct * A)}`, m2(ms.openSpace), ms.openSpace >= plotPct * A - 0.01 ? 'pass' : 'fail'));
  }
  const largest = Math.max(...plates.map((p) => polygonsArea(p.polygons)));
  checks.push(row('open-floor', 'MR55-33', `Open space >= ${plotPct * 100}% of the largest floor`, `>= ${m2(plotPct * largest)}`, m2(ms.openSpace), ms.openSpace >= plotPct * largest - 0.01 ? 'pass' : 'fail'));

  // distances per chain
  const art50 = roadSetbackApplies({ floors: ms.floors, height: ms.height, gfa: ms.gfa, dwelling });
  let clearMin = Infinity;
  const segCache = new Map<unknown, [XY, XY][]>();
  for (const c of site.chains) {
    const { minDist, perLevel, worst2x } = chainMeasures(site, c, plates, segCache);
    clearMin = Math.min(clearMin, minDist);
    const lbl = chainLabel(c);
    if (c.role === 'road') {
      const req = art50 ? roadSetback(c.width ?? 0, c.gap) : narrowRoadSetback(c.width ?? 0, c.gap);
      checks.push(row(`road-${c.id}`, 'ORD50-ROAD', `Road setback from ${lbl}`, `>= ${fmt(req)} m`, `${fmt(minDist, 3)} m`, minDist >= req - TOL ? 'pass' : 'fail'));
      const relief = (site.reliefPartners[c.id] ?? []).length > 0;
      checks.push(row(
        `twox-${c.id}`, relief ? 'MR55-46' : 'ORD49-2X',
        `Height <= 2 x distance to the far side of ${lbl}${relief ? ' (beyond 60 m of the wider road)' : ''}`,
        Number.isFinite(worst2x.margin) ? `floor ${worst2x.level}: >= ${fmt(worst2x.req)} m` : 'no floor beyond 60 m of the wider road',
        Number.isFinite(worst2x.margin) ? `${fmt(worst2x.dist, 3)} m` : 'exempt',
        worst2x.margin >= -TOL ? 'pass' : 'fail',
      ));
    } else if (c.role === 'private') {
      if (!ms.high) {
        // per floor: MR 55 art. 50 (building height) and ord. art. 54 (floor 3 up / above 9 m)
        let worst = { margin: Infinity, level: 0, req: 0, dist: Infinity };
        plates.forEach((p, i) => {
          const req = privateSetback(ms.height, p.level, p.z1);
          const margin = perLevel[i]! - req;
          if (margin < worst.margin) worst = { margin, level: p.level, req, dist: perLevel[i]! };
        });
        checks.push(row(`private-${c.id}`, 'MR55-50-PRIV', `Setback from ${lbl}`, `floor ${worst.level}: >= ${fmt(worst.req)} m`, `${fmt(worst.dist, 3)} m`, worst.margin >= -TOL ? 'pass' : 'fail'));
      }
    } else {
      const req = canalSetback(c.width ?? 0, c.gap);
      checks.push(row(`canal-${c.id}`, 'MR55-42-CANAL', `Setback from ${lbl}`, `>= ${fmt(req)} m`, `${fmt(minDist, 3)} m`, minDist >= req - TOL ? 'pass' : 'fail'));
    }
    if (ms.high) {
      checks.push(row(`mr33-4-${c.id}`, 'MR33-4', `6 m from ${lbl} (high-rise)`, `>= ${fmt(PARAMS.highSetback)} m`, `${fmt(minDist, 3)} m`, minDist >= PARAMS.highSetback - TOL ? 'pass' : 'fail'));
    }
  }
  const clearReq = clearAround(ms.height);
  checks.push(row('clear', 'ORD55-CLEAR', 'Clear space around the building', `>= ${fmt(clearReq)} m`, `${fmt(clearMin, 3)} m`, clearMin >= clearReq - TOL ? 'pass' : 'fail'));

  // gates
  let widestGate = 0;
  let widestRoad = 0;
  let officeRoad = false; // zoning art. 16 + 36: >= 16 m of frontage on a >= 16 m road
  let hotelRoad = false; // >= 12 m of frontage on a >= 12 m road
  for (const c of site.chains) {
    // only a road that abuts the plot is frontage (zoning art. 16 / 36, MR 33 art. 2), and its
    // length is one straight side of the plot along it (D5), measured on the outline itself
    if (c.role !== 'road' || c.gap > PARAMS.frontageGapTol) continue;
    const L = straightSideLength(c.points, PARAMS.sideTurnDeg, PARAMS.sideNoise);
    const W = c.width ?? 0;
    widestRoad = Math.max(widestRoad, W);
    if (L >= PARAMS.highGateFrontage - 0.001) widestGate = Math.max(widestGate, W);
    if (W >= PARAMS.officeGateWidth && L >= PARAMS.officeGateWidth - 0.001) officeRoad = true;
    if (W >= PARAMS.hotelGateWidth && L >= PARAMS.hotelGateWidth - 0.001) hotelRoad = true;
  }
  if (ms.high) {
    const needW = ms.gfa > PARAMS.bigGateGfa ? PARAMS.bigGateWidth : PARAMS.highGateWidth;
    checks.push(row('mr33-2', 'MR33-2', 'Frontage for a high-rise', `>= 12 m on a road >= ${needW} m`, widestGate > 0 ? `${widestGate} m road` : 'no road with 12 m frontage', widestGate >= needW ? 'pass' : 'fail'));
    checks.push(row('mr33-2-link', 'MR33-2-LINK', 'That road reaches another >= 10 m road', 'continuous >= 10 m', 'road network not modelled', 'not-assessed', 'needs road network data'));
    checks.push(row('mr33-3', 'MR33-3', '6 m fire lane around the building', '6 m clear lane', 'site layout not modelled', 'not-assessed', 'depends on the site plan'));
    checks.push(row('mr33-5', 'MR33-5', 'FAR <= 10 (high-rise)', `<= ${m2(10 * A)}`, m2(ms.gfa), ms.gfa <= 10 * A + 0.01 ? 'pass' : 'fail'));
  }
  if (site.type === 'office') {
    const ok = ms.gfa <= PARAMS.officeGateGfa || officeRoad || site.nearStation;
    checks.push(row('office-gate', 'Z16-OFFICE', 'Office over 10,000 m2 needs 16 m of frontage on a 16 m road, or a station', '<= 10,000 m2, or 16 m frontage on a 16 m road, or station', `${m2(ms.gfa)}, widest road ${widestRoad} m${officeRoad ? ' (16 m frontage)' : ''}${site.nearStation ? ', near station' : ''}`, ok ? 'pass' : 'fail'));
  }
  if (site.type === 'hotel' && site.hotelRooms !== undefined) {
    // the room count is given: the zoning art. 16 (8) gate on rooms exactly (oracle D4)
    const rooms = site.hotelRooms;
    const ok = rooms <= PARAMS.hotelGateRooms || hotelRoad || site.nearStation;
    checks.push(row(
      'hotel-gate', 'Z16-HOTEL', 'Hotel over 80 rooms needs 12 m of frontage on a 12 m road, or a station',
      '<= 80 rooms, or 12 m frontage on a 12 m road, or station',
      `${rooms} rooms (given), widest road ${widestRoad} m${hotelRoad ? ' (12 m frontage)' : ''}${site.nearStation ? ', near station' : ''}`,
      ok ? 'pass' : 'fail', ok ? undefined : 'zoning art. 16 (8): a hotel of this size is not permitted on this plot',
    ));
  } else if (site.type === 'hotel') {
    // the same cap as the engine (envelope.ts fixedCaps): 80 rooms x 50 m2 = 4,000 m2 of GFA
    const cap = PARAMS.hotelGateRooms * PARAMS.hotelGfaPerRoom;
    const ok = ms.gfa <= cap + AREA_EPS || hotelRoad || site.nearStation;
    checks.push(row(
      'hotel-gate', 'Z16-HOTEL', 'Hotel over 80 rooms needs 12 m of frontage on a 12 m road, or a station',
      `<= ${m2(cap)} (80 rooms x ${PARAMS.hotelGfaPerRoom} m2), or 12 m frontage on a 12 m road, or station`,
      `${m2(ms.gfa)} (~${fmt(ms.gfa / PARAMS.hotelGfaPerRoom, 1)} rooms), widest road ${widestRoad} m${hotelRoad ? ' (12 m frontage)' : ''}${site.nearStation ? ', near station' : ''}`,
      ok ? 'pass' : 'fail',
    ));
  }
  if (ms.floors > 3) {
    checks.push(row('front-open', 'ORD52-6-FRONT', '12 m front open space (over 3 storeys)', '12 m wide, 1/6 of perimeter', 'site layout not modelled', 'not-assessed', 'depends on the site plan; art. 53 may waive it'));
  }
  // every row cites a rule that exists
  for (const c of checks) if (c.rule !== 'ENVELOPE' && !RULES[c.rule]) throw new Error(`unknown rule ${c.rule}`);
  return { checks, measured: ms };
}

export { closeRing };
