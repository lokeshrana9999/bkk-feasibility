// Independent checker. It re-measures a design from its output polygons with
// point-to-segment distances and shoelace areas (measure.ts, no clipper), derives
// the building class (high-rise / extra-large) from the design itself, and
// compares against the rule formulas in rules.ts. "pass" only when it passes.

import { chainLabel } from './chains.js';
import {
  closeRing, pointInPolygons, pointPolylineDist, polygonSegments, polygonsArea, ringArea, samplePoints,
  segmentsToPolylineDist,
} from './measure.js';
import {
  PARAMS, RULES, TYPE_PARAMS, canalSetback, clearAround, narrowRoadSetback, privateSetback, roadSetback,
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

const TOL = PARAMS.checkTol;
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

/** Minimum distance from any plate boundary to a chain, and the worst 2x margin per floor. */
function chainMeasures(site: CheckSite, c: Chain, plates: FloorPlate[]) {
  const segsByLevel = plates.map((p) => polygonSegments(p.polygons));
  let minDist = Infinity;
  for (const segs of segsByLevel) minDist = Math.min(minDist, segmentsToPolylineDist(segs, c.points));
  let worst2x = { margin: Infinity, level: 0, dist: Infinity, req: 0 };
  if (c.role === 'road') {
    const partners = site.reliefPartners[c.id] ?? [];
    plates.forEach((p, i) => {
      const req = twoXDistance(p.z1, c.width ?? 0, c.gap);
      const segs = segsByLevel[i]!;
      let dist: number;
      if (partners.length === 0) dist = segmentsToPolylineDist(segs, c.points);
      else {
        // relief: points within 60 m of a wider road are exempt (sampled every 0.25 m)
        dist = Infinity;
        for (const q of samplePoints(segs, 0.25)) {
          const nearWide = partners.some((w) => pointPolylineDist(q, site.chains[w]!.points) <= PARAMS.reliefReach);
          if (!nearWide) dist = Math.min(dist, pointPolylineDist(q, c.points));
        }
      }
      const margin = dist - req;
      if (margin < worst2x.margin) worst2x = { margin, level: p.level, dist, req };
    });
  }
  return { minDist, worst2x };
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

  // geometry sanity
  let outside = 0;
  let notNested = 0;
  plates.forEach((p, i) => {
    for (const poly of p.polygons) {
      for (const ring of poly) {
        for (const v of ring) {
          if (!pointInPolygons(v, plotPoly, TOL)) outside++;
          if (i > 0 && !pointInPolygons(v, plates[i - 1]!.polygons, TOL)) notNested++;
        }
      }
    }
  });
  checks.push(row('inside-plot', 'ENVELOPE', 'Every floor inside the plot', '0 vertices outside', `${outside} outside`, outside === 0 ? 'pass' : 'fail'));
  checks.push(row('nested', 'ENVELOPE', 'Upper floors within lower floors (footprint = ground floor)', '0 vertices outside the floor below', `${notNested} outside`, notNested === 0 ? 'pass' : 'fail'));

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
  const tall = ms.floors > 2 || ms.height > 8;
  let clearMin = Infinity;
  for (const c of site.chains) {
    const { minDist, worst2x } = chainMeasures(site, c, plates);
    clearMin = Math.min(clearMin, minDist);
    const lbl = chainLabel(c);
    if (c.role === 'road') {
      const req = tall ? roadSetback(c.width ?? 0, c.gap) : narrowRoadSetback(c.width ?? 0, c.gap);
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
        const req = privateSetback(ms.height);
        checks.push(row(`private-${c.id}`, 'MR55-50-PRIV', `Setback from ${lbl}`, `>= ${fmt(req)} m`, `${fmt(minDist, 3)} m`, minDist >= req - TOL ? 'pass' : 'fail'));
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
  for (const c of site.chains) {
    if (c.role !== 'road') continue;
    let L = 0;
    for (let i = 0; i + 1 < c.points.length; i++) L += Math.hypot(c.points[i + 1]![0] - c.points[i]![0], c.points[i + 1]![1] - c.points[i]![1]);
    widestRoad = Math.max(widestRoad, c.width ?? 0);
    if (L >= PARAMS.highGateFrontage) widestGate = Math.max(widestGate, c.width ?? 0);
  }
  if (ms.high) {
    const needW = ms.gfa > PARAMS.bigGateGfa ? PARAMS.bigGateWidth : PARAMS.highGateWidth;
    checks.push(row('mr33-2', 'MR33-2', 'Frontage for a high-rise', `>= 12 m on a road >= ${needW} m`, widestGate > 0 ? `${widestGate} m road` : 'no road with 12 m frontage', widestGate >= needW ? 'pass' : 'fail'));
    checks.push(row('mr33-2-link', 'MR33-2-LINK', 'That road reaches another >= 10 m road', 'continuous >= 10 m', 'road network not modelled', 'not-assessed', 'needs road network data'));
    checks.push(row('mr33-3', 'MR33-3', '6 m fire lane around the building', '6 m clear lane', 'site layout not modelled', 'not-assessed', 'depends on the site plan'));
    checks.push(row('mr33-5', 'MR33-5', 'FAR <= 10 (high-rise)', `<= ${m2(10 * A)}`, m2(ms.gfa), ms.gfa <= 10 * A + 0.01 ? 'pass' : 'fail'));
  }
  if (site.type === 'office') {
    const ok = ms.gfa <= PARAMS.officeGateGfa || widestRoad >= PARAMS.officeGateWidth || site.nearStation;
    checks.push(row('office-gate', 'Z16-OFFICE', 'Office over 10,000 m2 needs a 16 m road or a station', '<= 10,000 m2, or 16 m road, or station', `${m2(ms.gfa)}, widest road ${widestRoad} m${site.nearStation ? ', near station' : ''}`, ok ? 'pass' : 'fail'));
  }
  if (site.type === 'hotel') {
    const rooms = Math.floor(ms.gfa / PARAMS.hotelGfaPerRoom);
    const ok = rooms <= PARAMS.hotelGateRooms || widestRoad >= PARAMS.hotelGateWidth || site.nearStation;
    checks.push(row('hotel-gate', 'Z16-HOTEL', 'Hotel over 80 rooms needs a 12 m road or a station', '<= 80 rooms, or 12 m road, or station', `~${rooms} rooms (${PARAMS.hotelGfaPerRoom} m2 each), widest road ${widestRoad} m${site.nearStation ? ', near station' : ''}`, ok ? 'pass' : 'fail'));
  }
  if (ms.floors > 3) {
    checks.push(row('front-open', 'ORD52-6-FRONT', '12 m front open space (over 3 storeys)', '12 m wide, 1/6 of perimeter', 'site layout not modelled', 'not-assessed', 'depends on the site plan; art. 53 may waive it'));
  }
  // every row cites a rule that exists
  for (const c of checks) if (c.rule !== 'ENVELOPE' && !RULES[c.rule]) throw new Error(`unknown rule ${c.rule}`);
  return { checks, measured: ms };
}

export { closeRing };
