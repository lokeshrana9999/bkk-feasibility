// Rule claims (fv-architecture section 4): the claims ENGINE-NOTES and rules.ts make about
// the scalar rules, checked as formulas on exhaustive breakpoint grids. The rules are
// piecewise constant or linear, so a grid holding every breakpoint, a value just either
// side of it and two interior points per piece covers every case. Plain loops, no
// randomness; counterexamples are collected and the first few printed.
import { describe, expect, it } from 'vitest';
import type { BuildingType, Chain, CheckRow, EdgeInfo, FloorPlate, XY, ZoneInfo } from '../src/engine/index.js';
import { buildChains } from '../src/engine/chains.js';
import { checkDesign, type CheckSite } from '../src/engine/checker.js';
import { fixedCaps, highGate, type Site } from '../src/engine/envelope.js';
import { cleanPlot } from '../src/engine/frame.js';
import {
  LIMITS, PARAMS, canalSetback, chainDistance, clearAround, floorTop, isGateFrontage, narrowRoadSetback, privateSetback,
  roadSetback, roadSetbackApplies, touchesPlot, twoXDistance, type DistanceCtx,
} from '../src/engine/rules.js';

const EPS = 1e-6;

/** Breakpoints, each +-EPS, the range ends, and two interior points per piece. */
function grid(breaks: number[], lo: number, hi: number, eps = EPS): number[] {
  const bs = [...new Set([lo, ...breaks, hi])].sort((a, b) => a - b);
  const out = new Set<number>();
  for (const b of bs) {
    out.add(b);
    if (b - eps >= lo) out.add(b - eps);
    if (b + eps <= hi) out.add(b + eps);
  }
  for (let k = 0; k + 1 < bs.length; k++) {
    const a = bs[k]!;
    const b = bs[k + 1]!;
    out.add(a + (b - a) / 3);
    out.add(a + (2 * (b - a)) / 3);
  }
  return [...out].sort((a, b) => a - b);
}

// Breakpoints of the rules (rules.ts): road width 6 (narrow road, ord. art. 50 para. 1),
// 10 and 20 (ord. art. 50 (1)-(3)); limits 1 and 100 (LIMITS). Gap: 0.5 (frontage), and the
// values where a setback minus the gap reaches 0 (1, 2, 3, 5.5, 6). Building height 8 (art. 50
// storeys), 9 (MR 55 art. 50 / ord. art. 54), 15 (ord. art. 55), 23 (MR 33 high-rise). Floor top
// z: 9 (ord. art. 54) and 23. Canal width 10 (MR 55 art. 42).
const WS = grid([6, 10, 20], LIMITS.minWidth, LIMITS.maxWidth);
const GAPS = grid([0.5, 1, 2, 3, 5.5, 6], 0, LIMITS.maxGap);
const HS = grid([8, 9, 15, 23], 0, 250);
const ZS = grid([9, 23], 0, 250);
const LEVELS = [1, 2, 3, 4, 10, 30, 60];
const CS = grid([10], LIMITS.minWidth, LIMITS.maxWidth);

const P: EdgeInfo = { role: 'private', source: 'user' };
const road = (width: number, gap = 0): EdgeInfo => ({ role: 'road', width, gap, source: 'user' });
const canal = (width: number, gap = 0): EdgeInfo => ({ role: 'canal', width, gap, source: 'user' });

function chain(role: Chain['role'], width?: number, gap = 0, length = 20): Chain {
  const c: Chain = { id: 0, role, edges: [0], points: [[0, 0], [length, 0]], closed: false, length, gap };
  if (width !== undefined) c.width = width;
  return c;
}

/**
 * A distance context. `floors` is not part of today's DistanceCtx; it is set as well so the
 * same test runs against engines before Codex #1 (which read storeys, not `art50`).
 */
const ctx = (level: number, z: number, buildingH: number, art50: boolean, high: boolean): DistanceCtx =>
  ({ level, z, buildingH, art50, high, floors: art50 ? 3 : 1 }) as DistanceCtx;

/** Every chain the grid covers: roads (W x gap), canals (C x gap) and a private boundary. */
const CHAINS: Chain[] = [
  ...WS.flatMap((W) => GAPS.map((g) => chain('road', W, g))),
  ...CS.flatMap((C) => GAPS.map((g) => chain('canal', C, g))),
  chain('private'),
];
const label = (c: Chain) => `${c.role}${c.width !== undefined ? ` W ${c.width}` : ''} gap ${c.gap}`;

/** Collects counterexamples; fails with the count and the first few. */
class Claim {
  n = 0;
  bad: string[] = [];
  check(ok: boolean, what: () => string): void {
    this.n++;
    if (!ok) this.bad.push(what());
  }
  done(name: string): void {
    expect(this.bad.length, `${name}: ${this.bad.length} of ${this.n} cases fail, e.g.\n${this.bad.slice(0, 5).join('\n')}`).toBe(0);
    expect(this.n).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// hand-built designs for the checker claims

const H = { ground: 4.5, typical: 3 };
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** `floors` floors of one rectangle, sharing one polygons array (as the engine shares them). */
function stack(floors: number, r: XY[]): FloorPlate[] {
  const polygons = [[r]];
  const area = Math.abs((r[1]![0] - r[0]![0]) * (r[2]![1] - r[1]![1]));
  return Array.from({ length: floors }, (_, k) => ({
    level: k + 1, z0: k === 0 ? 0 : floorTop(k, H), z1: floorTop(k + 1, H), polygons, area, dByChain: [],
  }));
}

function site(ring: XY[], edges: EdgeInfo[], type: BuildingType, zone: ZoneInfo = { code: 'Y9', far: 7, osrPct: 4.5 }, nearStation = false): CheckSite {
  const chains = buildChains(ring, edges);
  return { ring, chains, reliefPartners: chains.map(() => []), zone, type, nearStation };
}

const status = (rows: { id: string; status: string }[], id: string) => rows.find((r) => r.id === id)?.status;

// ---------------------------------------------------------------------------

describe('rule claims (breakpoint grids)', () => {
  it('stricter of readings: privateSetback >= MR 55 art. 50 and >= ord. art. 54 for every H, level, z (Codex #2)', () => {
    // Both readings written out here from ENGINE-NOTES rule question 1, not from rules.ts:
    // MR 55 art. 50 (mr55-update.txt 513-517), by building height: up to 9 m, 2 m; over 9 m, 3 m.
    const mr55 = (h: number) => (h <= 9 ? 2 : 3);
    // Ordinance art. 54, per floor: floors 1-2 up to 9 m, 2 m; floor 3 up, or above 9 m, 3 m.
    const ord54 = (level: number, z: number) => (level >= 3 || z > 9 ? 3 : 2);
    const claim = new Claim();
    for (const h of HS) for (const level of LEVELS) for (const z of ZS) {
      const d = privateSetback(h, level, z);
      claim.check(d >= mr55(h) && d >= ord54(level, z), () => `H ${h}, level ${level}, z ${z}: ${d} < max(${mr55(h)}, ${ord54(level, z)})`);
      // and through chainDistance, as the envelope and P2 use it (low regime)
      const base = chainDistance(chain('private'), ctx(level, z, h, true, false)).base;
      claim.check(base >= Math.max(mr55(h), ord54(level, z), clearAround(h)), () => `chainDistance private H ${h} level ${level} z ${z}: ${base}`);
    }
    claim.done('stricter of readings');
  });

  it('stricter of readings, in the checker: floor 3 of a 7.2 m building needs 3 m from a private boundary (Codex #2)', () => {
    const ring = rect(0, 0, 20, 20);
    const s = site(ring, [P, P, P, P], 'condo', { code: 'Y9', far: 2, osrPct: 4.5 });
    const h = { ground: 2.4, typical: 2.4 };
    const plates = (d3: number): FloorPlate[] => [1, 2, 3].map((k) => {
      const d = k < 3 ? 2 : d3;
      return { level: k, z0: (k - 1) * 2.4, z1: floorTop(k, h), polygons: [[rect(d, d, 20 - d, 20 - d)]], area: (20 - 2 * d) ** 2, dByChain: [] };
    });
    expect(status(checkDesign(s, plates(3)).checks, 'private-0')).toBe('pass');
    expect(status(checkDesign(s, plates(2.5)).checks, 'private-0')).toBe('fail');
  });

  it('monotonicity: the base distance never falls as building height, level or z rises; 2x never rises with W or gap', () => {
    const claim = new Claim();
    const LZ: [number, number][] = [[1, 4.5], [2, 7.5], [3, 8], [3, 10.5], [4, 9], [10, 31.5], [60, 181.5]];
    for (const c of CHAINS) {
      for (const art50 of [true, false]) for (const high of [false, true]) {
        // building height
        for (const [level, z] of LZ) {
          let prev = -Infinity;
          for (const h of HS) {
            const b = chainDistance(c, ctx(level, z, h, art50, high)).base;
            claim.check(b >= prev - 1e-12, () => `${label(c)} art50 ${art50} high ${high} level ${level} z ${z}: base falls to ${b} at H ${h}`);
            prev = b;
          }
        }
        // level and z (building height fixed)
        for (const h of [4.5, 9, 9 + EPS, 15, 22.5, 60]) {
          for (const z of [4.5, 9, 9 + EPS, 30]) {
            let prev = -Infinity;
            for (const level of LEVELS) {
              const b = chainDistance(c, ctx(level, z, h, art50, high)).base;
              claim.check(b >= prev - 1e-12, () => `${label(c)} H ${h} z ${z}: base falls to ${b} at level ${level}`);
              prev = b;
            }
          }
          for (const level of [1, 2, 3]) {
            let prev = -Infinity;
            for (const z of ZS) {
              const b = chainDistance(c, ctx(level, z, h, art50, high)).base;
              claim.check(b >= prev - 1e-12, () => `${label(c)} H ${h} level ${level}: base falls to ${b} at z ${z}`);
              prev = b;
            }
          }
        }
      }
    }
    // the 2x distance: non-increasing in W and in gap, non-decreasing in z
    for (const z of ZS) {
      for (const g of GAPS) {
        let prev = Infinity;
        for (const W of WS) {
          const t = twoXDistance(z, W, g);
          claim.check(t <= prev + 1e-12, () => `2x rises with W at z ${z} gap ${g} W ${W}`);
          prev = t;
        }
      }
      for (const W of WS) {
        let prev = Infinity;
        for (const g of GAPS) {
          const t = twoXDistance(z, W, g);
          claim.check(t <= prev + 1e-12, () => `2x rises with gap at z ${z} W ${W} gap ${g}`);
          prev = t;
        }
      }
    }
    for (const W of WS) for (const g of GAPS) {
      let prev = -Infinity;
      for (const z of ZS) {
        const t = chainDistance(chain('road', W, g), ctx(1, z, z, true, false)).twoX;
        claim.check(t >= prev - 1e-12, () => `2x falls with z at W ${W} gap ${g} z ${z}`);
        prev = t;
      }
    }
    // the stand-alone formulas
    for (const level of LEVELS) for (const z of ZS) {
      let prev = -Infinity;
      for (const h of HS) {
        const d = privateSetback(h, level, z);
        claim.check(d >= prev, () => `privateSetback falls at H ${h}`);
        prev = d;
      }
    }
    let prevClear = -Infinity;
    for (const h of HS) {
      claim.check(clearAround(h) >= prevClear, () => `clearAround falls at H ${h}`);
      prevClear = clearAround(h);
    }
    claim.done('monotonicity');
  });

  it('road setback is NOT monotone in road width (documented: 1.005 m at 9.99, 1.0 at 10, 2.0 at 20 and above)', () => {
    expect(roadSetback(9.99, 0)).toBeCloseTo(1.005, 12);
    expect(roadSetback(10, 0)).toBeCloseTo(1, 12);
    expect(roadSetback(20, 0)).toBeCloseTo(2, 12);
    expect(roadSetback(20 + EPS, 0)).toBe(2);
  });

  it('ORD50-ROAD scope: roadSetbackApplies is monotone in storeys, height and GFA, and the road setback it switches on is never smaller (Codex #1)', () => {
    const claim = new Claim();
    const FL = [1, 2, 3, 4];
    const HT = grid([8, 15], 0, 30);
    const GF = grid([1000, 2000], 0, 5000);
    const at = (fi: number, hi: number, gi: number, dwelling: boolean) =>
      roadSetbackApplies({ floors: FL[fi]!, height: HT[hi]!, gfa: GF[gi]!, dwelling });
    for (const dwelling of [true, false]) {
      for (let fi = 0; fi < FL.length; fi++) for (let hi = 0; hi < HT.length; hi++) for (let gi = 0; gi < GF.length; gi++) {
        const a = at(fi, hi, gi, dwelling);
        const where = () => `floors ${FL[fi]} H ${HT[hi]} GFA ${GF[gi]} dwelling ${dwelling}`;
        if (!dwelling) claim.check(a, () => `non-dwelling (commercial / public) not covered: ${where()}`);
        else claim.check(!a || at(fi, hi, gi, false), () => `dwelling covered but non-dwelling not: ${where()}`);
        if (fi + 1 < FL.length) claim.check(!a || at(fi + 1, hi, gi, dwelling), () => `more storeys drops the setback: ${where()}`);
        if (hi + 1 < HT.length) claim.check(!a || at(fi, hi + 1, gi, dwelling), () => `more height drops the setback: ${where()}`);
        if (gi + 1 < GF.length) claim.check(!a || at(fi, hi, gi + 1, dwelling), () => `more GFA drops the setback: ${where()}`);
      }
    }
    for (const W of WS) for (const g of GAPS) {
      claim.check(roadSetback(W, g) >= narrowRoadSetback(W, g), () => `roadSetback(${W}, ${g}) < narrowRoadSetback`);
    }
    claim.done('roadSetbackApplies');
  });

  it('low <= high regime: for every role, W and gap the high base is >= the low base; low is at most 6 m, high at least 6 m', () => {
    const claim = new Claim();
    const lowH = HS.filter((h) => h < PARAMS.highRiseHeight);
    const LZ: [number, number][] = [[1, 4.5], [2, 7.5], [3, 10.5], [7, 22.5]];
    for (const c of CHAINS) for (const art50 of [true, false]) for (const h of lowH) for (const [level, z] of LZ) {
      const low = chainDistance(c, ctx(level, z, h, art50, false)).base;
      claim.check(low <= PARAMS.highSetback + 1e-12, () => `${label(c)} H ${h}: low base ${low} > 6 m`);
      for (const hh of [h, 23, 60, 181.5]) {
        const high = chainDistance(c, ctx(level, z, hh, art50, true)).base;
        claim.check(high >= low - 1e-12, () => `${label(c)} H ${h}/${hh} level ${level}: high ${high} < low ${low}`);
        claim.check(high >= PARAMS.highSetback - 1e-12, () => `${label(c)}: high base ${high} < 6 m`);
      }
    }
    claim.done('low <= high');
  });

  it('clamp direction: widths under 1 m are refused, over 100 m treated as 100 m, gaps over 50 m as 50 m, and each clamp only raises distances (Codex #4)', () => {
    const claim = new Claim();
    const ring: [number, number][] = [[0, 0], [60, 0], [60, 60], [0, 60]];
    const widths = [0.001, 0.5, 1 - EPS, 1, 1 + EPS, 10, 50, 100 - EPS, 100, 100 + EPS, 150, 10_000];
    const gaps = [0, 25, 50 - EPS, 50, 50 + EPS, 80, 1000];
    for (const mk of [road, canal]) for (const W of widths) for (const g of gaps) {
      const e = mk(W, g);
      const out = cleanPlot(ring, [e, P, P, P], 'm');
      const what = `${e.role} W ${W} gap ${g}`;
      if (W < LIMITS.minWidth) {
        claim.check('ok' in out && out.ok === false && out.code === 'invalid-edge', () => `${what}: not refused (${JSON.stringify('ok' in out ? out : out.edges[0])})`);
        continue;
      }
      if ('ok' in out) {
        claim.check(false, () => `${what}: refused (${out.code})`);
        continue;
      }
      const w = out.edges[0]!.width!;
      const gg = out.edges[0]!.gap!;
      claim.check(w === Math.min(W, LIMITS.maxWidth), () => `${what}: width became ${w}`);
      claim.check(gg === Math.min(g, LIMITS.maxGap), () => `${what}: gap became ${gg}`);
      // the clamped values may only raise what the law requires
      claim.check(roadSetback(w, gg) >= roadSetback(W, g) - 1e-12, () => `${what}: road setback lowered`);
      claim.check(narrowRoadSetback(w, gg) >= narrowRoadSetback(W, g) - 1e-12, () => `${what}: narrow-road setback lowered`);
      claim.check(canalSetback(w, gg) >= canalSetback(W, g) - 1e-12, () => `${what}: canal setback lowered`);
      for (const z of ZS) claim.check(twoXDistance(z, w, gg) >= twoXDistance(z, W, g) - 1e-12, () => `${what}: 2x lowered at z ${z}`);
    }
    claim.done('clamp direction');
  });

  it('frontage: touchesPlot is gap <= 1 mm (D1), isGateFrontage is a touching road >= 12 m (1 mm float tolerance), and the checker and the engine agree on it (Codex #6, #8)', () => {
    const claim = new Claim();
    const LS = grid([12 - 0.001, 12], 0.5, 40);
    const GS = [0, 0.001 - EPS, 0.001, 0.001 + EPS, 0.25, 0.5, 1, 2, 50];
    for (const role of ['private', 'canal'] as const) claim.check(!touchesPlot(chain(role, role === 'canal' ? 12 : undefined)), () => `${role} touches`);
    for (const W of [9.999, 10, 18, 30]) for (const g of GS) {
      let prevGate = false;
      for (const L of LS) {
        const c = chain('road', W, g, L);
        const t = touchesPlot(c);
        const gate = isGateFrontage(c);
        claim.check(t === g <= PARAMS.frontageGapTol, () => `touchesPlot gap ${g}: ${t}`);
        claim.check(!gate || t, () => `gate frontage without touching at gap ${g}`);
        claim.check(gate === (t && L >= PARAMS.highGateFrontage - 0.001), () => `isGateFrontage L ${L} gap ${g}: ${gate}`);
        claim.check(!prevGate || gate, () => `isGateFrontage not monotone in length at L ${L} gap ${g}`);
        prevGate = gate;
      }
    }
    // the checker retypes the frontage test (checker.ts gates); it must agree with the engine's
    for (const W of [9.999, 10, 18]) for (const g of GS) for (const L of [11.998, 12 - 0.001, 11.9995, 12, 12.001]) {
      const ring = rect(0, 0, L, 400);
      const s = site(ring, [road(W, g), P, P, P], 'condo', { code: 'Y9', far: 7, osrPct: 4.5 });
      const engineSite = { chains: s.chains } as unknown as Site;
      const gateOpen = highGate(engineSite).ok;
      const frontage = s.chains.some((c) => isGateFrontage(c) && (c.width ?? 0) >= PARAMS.highGateWidth);
      claim.check(gateOpen === frontage, () => `highGate ${gateOpen} vs isGateFrontage ${frontage} at W ${W} gap ${g} L ${L}`);
      // a 26.5 m tower of 8 x 100 m2: high-rise, GFA far under 30,000 m2
      const row = status(checkDesign(s, stack(8, rect(2, 100, 7, 120))).checks, 'mr33-2');
      claim.check(row === (gateOpen ? 'pass' : 'fail'), () => `checker mr33-2 ${row} but engine gate ${gateOpen} at W ${W} gap ${g} L ${L}`);
    }
    claim.done('frontage');
  });

  describe('caps and the checker gate rows', () => {
    // Gate rows: FAR (Z16-FAR), MR 33 art. 2 frontage and its 30,000 m2 step, MR 33 art. 5,
    // zoning art. 16 office and hotel bans. The checker allows FAR 0.01 m2 of float noise.
    const GATE_ROWS = ['far', 'mr33-2', 'mr33-5', 'office-gate', 'hotel-gate'];
    const AREA_TOL = 0.01;
    // road widths either side of each gate that matters for the type: MR 33 art. 2 (10 m,
    // 18 m), the hotel ban (12 m), the office ban (16 m); stations only waive the two bans
    const WIDTHS: Record<string, number[]> = {
      condo: [9.999, 10, 17.999, 18],
      office: [9.999, 10, 15.999, 16, 17.999, 18],
      hotel: [9.999, 10, 11.999, 12, 17.999, 18],
    };
    // frontage: 12 m touching, 11.998 m touching (too short), 12 m with a 0.5 m gap (not abutting).
    // FAR 20 (MR 33 art. 5's FAR 10 cap) on condos only: the other types add nothing to it.
    const SCEN: { type: BuildingType; W: number; g: number; L: number; station: boolean; far: number }[] = [];
    for (const type of ['condo', 'office', 'hotel'] as const) for (const W of WIDTHS[type]!) {
      for (const [g, L] of [[0, 12], [0, 11.998], [0.5 + EPS, 12]] as const) {
        for (const station of type === 'condo' ? [false] : [false, true]) for (const far of type === 'condo' ? [7, 20] : [7]) {
          SCEN.push({ type, W, g, L, station, far });
        }
      }
    }

    /** Engine caps for a design of this class, without the low regime's 9,999 m2 (a regime choice, not a law). */
    function capsFor(s: CheckSite, plotArea: number, high: boolean) {
      const engineSite = { plotArea, zone: s.zone, chains: s.chains, nearStation: s.nearStation, type: s.type } as unknown as Site;
      const caps = fixedCaps(engineSite, high ? 'high' : 'low').filter((c) => c.id !== 'MR33-1');
      return { min: Math.min(...caps.map((c) => c.value)), caps, gateOpen: highGate(engineSite).ok };
    }

    /** 1 floor (4.5 m) or 8 floors (25.5 m, high-rise) totalling `gfa`, on a 10 m wide rectangle. */
    const design = (gfa: number, floors: number) => stack(floors, rect(0, 0, 10, gfa / floors / 10));

    interface GateCase { s: CheckSite; A: number; gfa: number; rows: CheckRow[]; high: boolean; what: string }
    let cases: GateCase[] | null = null;
    /**
     * Every scenario x every cap (and the 4,000 / 10,000 / 30,000 m2 thresholds) x GFA at
     * (1e-6 under) and over it (0.02, and 49.99 m2: the hotel's old floor(GFA / 50) slack). A 1-floor design tests the low-regime caps, an 8-floor one (25.5 m) the high.
     * Built once and shared by both claims (the checker formats its rows, ~0.4 ms a call).
     */
    function allCases(): GateCase[] {
      if (cases) return cases;
      cases = [];
      for (const sc of SCEN) {
        const ring = rect(0, 0, sc.L, 400);
        const A = sc.L * 400;
        const s = site(ring, [road(sc.W, sc.g), P, P, P], sc.type, { code: 'Y9', far: sc.far, osrPct: 4.5 }, sc.station);
        for (const floors of [1, 8]) {
          if (floors === 1 && sc.far !== 7) continue;
          const marks = new Set<number>(capsFor(s, A, floors === 8).caps.map((c) => c.value));
          for (const t of sc.type === 'hotel' ? [4000, 10_000, 30_000] : [10_000, 30_000]) marks.add(t);
          for (const m of marks) {
            for (const gfa of [m - EPS, m + 0.02, m + 49.99]) {
              const { checks, measured } = checkDesign(s, design(gfa, floors));
              cases.push({ s, A, gfa: measured.gfa, rows: checks, high: measured.high, what: `${sc.type} W ${sc.W} gap ${sc.g} L ${sc.L} station ${sc.station} FAR ${sc.far}: ${floors} floors, GFA ${measured.gfa.toFixed(4)}` });
            }
          }
        }
      }
      return cases;
    }
    const forEachCase = (fn: (c: GateCase) => void) => allCases().forEach(fn);

    it('caps imply checker pass: a design at or under the engine caps passes every gate row', () => {
      const claim = new Claim();
      forEachCase(({ s, A, gfa, rows, high, what }) => {
        const caps = capsFor(s, A, high);
        if (high && !caps.gateOpen) return; // the engine offers no high design here
        if (gfa > caps.min) return;
        const bad = rows.filter((r) => GATE_ROWS.includes(r.id) && r.status === 'fail');
        claim.check(bad.length === 0, () => `${what} under cap ${caps.min.toFixed(4)} fails ${bad.map((r) => `${r.id} (${r.actual})`).join(', ')}`);
      });
      claim.done('caps imply checker pass');
    });

    it('checker implies caps: a design passing every gate row is within the engine caps (hotel: <= 4,000 m2 without a 12 m road or station)', () => {
      const claim = new Claim();
      forEachCase(({ s, A, gfa, rows, high, what }) => {
        const gates = rows.filter((r) => GATE_ROWS.includes(r.id));
        if (gates.some((r) => r.status === 'fail')) return;
        const caps = capsFor(s, A, high);
        claim.check(!high || caps.gateOpen, () => `${what}: checker passes a high-rise the engine's MR 33 art. 2 gate refuses`);
        const over = caps.caps.filter((c) => gfa > c.value + AREA_TOL);
        claim.check(over.length === 0, () => `${what}: checker passes it, but it is over ${over.map((c) => `${c.id} ${c.value.toFixed(2)}`).join(', ')}`);
      });
      claim.done('checker implies caps');
    });
  });

  it('tolerance: a plate 0.5 mm short of a requirement fails the checker; at or beyond it passes', () => {
    // 60 x 60 m plot, edge 0 on y = 0. Each case puts one face of the plate at the
    // requirement + delta from one edge and keeps 10 m from the rest.
    const ring = rect(0, 0, 60, 60);
    const cases: { name: string; type: BuildingType; edges: EdgeInfo[]; floors: number; req: number; place: (d: number) => XY[]; row: string }[] = [
      // office: commercial, so ORD50-ROAD applies at any height: 12 m road, W/10 = 1.2 m
      { name: 'road setback', type: 'office', edges: [road(12), P, P, P], floors: 1, req: 1.2, place: (d) => rect(10, d, 50, 50), row: 'road-0' },
      // 4.5 m building: MR 55 art. 50 2 m
      { name: 'private setback', type: 'condo', edges: [P, P, P, P], floors: 1, req: 2, place: (d) => rect(d, 10, 50, 50), row: 'private-0' },
      // canal under 10 m wide: 3 m
      { name: 'canal setback', type: 'condo', edges: [canal(8), P, P, P], floors: 1, req: 3, place: (d) => rect(10, d, 50, 50), row: 'canal-0' },
      // road 12 m with a 0.5 m gap: road setback 0.7 m, so ord. art. 55's 1 m binds
      { name: 'clear space', type: 'office', edges: [road(12, 0.5), P, P, P], floors: 1, req: 1, place: (d) => rect(10, d, 50, 50), row: 'clear' },
      // 8 floors to 25.5 m: high-rise, 6 m from the private boundary (chain 1 = edges 1-3)
      { name: 'MR 33 art. 4', type: 'condo', edges: [road(30), P, P, P], floors: 8, req: 6, place: (d) => rect(d, 10, 50, 50), row: 'mr33-4-1' },
      // 6 m road, roof at 25.5 m: 25.5 / 2 - 6 = 6.75 m
      { name: '2x rule', type: 'condo', edges: [road(6), P, P, P], floors: 8, req: 6.75, place: (d) => rect(10, d, 50, 50), row: 'twox-0' },
    ];
    const claim = new Claim();
    for (const c of cases) {
      const s = site(ring, c.edges, c.type);
      for (const [delta, want] of [[-0.0005, 'fail'], [0, 'pass'], [0.0005, 'pass']] as const) {
        const got = status(checkDesign(s, stack(c.floors, c.place(c.req + delta))).checks, c.row);
        claim.check(got === want, () => `${c.name} (${c.row}) at ${delta * 1000} mm: ${got}, want ${want}`);
      }
    }
    claim.done('tolerance');
  });
});
