// Oracle differential (fv-architecture sections 2 and 7): the engine against the independent
// rule oracle (oracle/index.ts) on exhaustive breakpoint grids, under the comparison rule
//
//     THE ENGINE MAY BE STRICTER THAN THE ORACLE, NEVER LAXER
//     distance:  engine required distance >= oracle max - 1e-9
//     cap:       engine cap <= oracle cap (the oracle's 10,000 m2 no-frontage cap is exclusive)
//     gate:      engine permits  =>  oracle does not block (a NaN reading is "not assessable")
//     relief:    engine eligible =>  oracle eligible
//
// Every case where the engine is laxer fails the test unless it is explained by an entry of
// ALLOW below, and every ALLOW entry is a row of oracle/DISAGREEMENTS.md (checked at the end).
// An entry explains a case only by substitution: the oracle is re-run with that entry's
// engine reading applied to the inputs (eg gap <= 1 mm snapped to 0) and must then agree;
// a laxer case that no allowed substitution reconciles fails.
//
// Deliberate engine strictness (the engine requires more than the oracle; fine, counted in the
// summary test at the end):
//  - ord. art. 55 clear space (1 / 2 m) also on road edges, so it beats W/10 on 10-20 m roads
//    (ENGINE-NOTES 2); the oracle keeps clear space separate from road setbacks
//  - MR 33 art. 4: the engine keeps 6 m from a road or canal edge whatever the gap; the oracle
//    measures 6 m from the road/canal boundary (6 - gap)
//  - ord. art. 50 small-dwelling exemption not applied (ENGINE-NOTES 1a); on these grids MR 55
//    art. 41 (no exemption) always applies too, so it never shows as a surplus
//  - the 2x rule on every road, not only the nearest (ENGINE-NOTES 4): not visible on a scalar
//    grid (the oracle also gives 2x per road), only in property tests
//  - wider-road relief only within 60 m of the wider road, base setback kept (ENGINE-NOTES 5)
//  - ord. art. 49 para. 2 (80 m road) relief not applied; hotel rooms estimated at 50 m2 GFA
//    (stricter than the oracle at rooms = floor(GFA / 50)); low regime capped at 9,999 m2
//    (oracle: < 10,000)
//
// Mapping between the interfaces (what the engine's inputs mean in oracle terms):
//  - a building is (use, height, storeys, GFA, largest floor); the engine's class flags come from
//    the same numbers the checker uses: high = height >= 23 or GFA / any floor >= 10,000
//    (checker.ts measure), art50 = roadSetbackApplies(...) (checker.ts), dwelling = TYPE_PARAMS
//  - a road / canal chain is (width, gap); a frontage is one road chain (width, length, gap),
//    its length the chain's longest straight side, as the oracle's frontage is one side (D5)
//  - relief facts come from two synthetic road chains: corner = they meet at a 90 degree turn,
//    flanked = parallel at the given distance; sameRoad = same name (or, unnamed, meeting at a
//    turn under 30 degrees or not meeting at all, the engine's own inference: DISAGREEMENTS D9). The engine has no
//    building length / width input, so it is compared for every value the oracle takes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as O from '../oracle/index.js';
import type { BuildingType, Chain, ZoneInfo } from '../src/engine/index.js';
import * as Env from '../src/engine/envelope.js';
import * as Ev from '../src/engine/evaluate.js';
import * as R from '../src/engine/rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOL = 1e-9;
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Allowlist: each id is a row of oracle/DISAGREEMENTS.md

const ALLOW = {
  D2: 'frontage float tolerances (engineering, kept): the engine accepts 11.999 m as 12 m and 15.999 m as 16 m, and a gap of at most 1 mm as abutting; the oracle needs the full length and gap 0',
  // D1 (0.5 m gap tolerance): the engine now follows the oracle (gap <= 1 mm, float noise,
  // covered by D2). D3, D6, D7 were engine bugs, fixed. None has an allowance: a laxer case
  // now fails this test.
} as const;
type AllowId = keyof typeof ALLOW;

/** The engine's reading of a frontage, applied to the oracle's input (one per allow id). */
const SNAP: Partial<Record<AllowId, (f: O.Frontage) => O.Frontage>> = {
  D2: (f) => {
    let g = f;
    if (g.gapM > 0 && g.gapM <= 0.001) g = { ...g, gapM: 0 };
    for (const need of [12, 16]) if (g.lengthM >= need - 0.001 && g.lengthM < need) return { ...g, lengthM: need };
    return g;
  },
};

function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 1; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

/** Smallest set of allowed substitutions that makes `agrees` true, or null. */
function explain(fs: O.Frontage[], ids: AllowId[], agrees: (fs: O.Frontage[]) => boolean): AllowId[] | null {
  for (const sub of subsets(ids)) {
    const g = fs.map((f) => sub.reduce((x, id) => SNAP[id]!(x), f));
    if (agrees(g)) return sub;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bookkeeping

interface Summary { checked: number; allowed: Record<string, number>; stricter: Record<string, number>; notAssessable: number }
const SUMMARY = new Map<string, Summary>();

class Diff {
  n = 0;
  laxer: string[] = [];
  allowed: Record<string, number> = {};
  stricter: Record<string, number> = {};
  notAssessable = 0;
  examples: Record<string, string> = {};
  constructor(readonly name: string) {}
  case(): void {
    this.n++;
  }
  lax(what: string, ids: AllowId[] | null): void {
    if (!ids) {
      this.laxer.push(what);
      return;
    }
    const k = ids.join('+');
    this.allowed[k] = (this.allowed[k] ?? 0) + 1;
    this.examples[k] ??= what;
  }
  strict(category: string): void {
    this.stricter[category] = (this.stricter[category] ?? 0) + 1;
  }
  done(): void {
    SUMMARY.set(this.name, { checked: this.n, allowed: this.allowed, stricter: this.stricter, notAssessable: this.notAssessable });
    expect(this.laxer.length, `${this.name}: engine LAXER than the oracle in ${this.laxer.length} of ${this.n} cases, e.g.\n${this.laxer.slice(0, 6).join('\n')}`).toBe(0);
    expect(this.n).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Grids

function grid(breaks: number[], lo: number, hi: number, eps = EPS): number[] {
  const bs = [...new Set([lo, ...breaks, hi])].sort((a, b) => a - b);
  const out = new Set<number>();
  for (const b of bs) {
    out.add(b);
    if (b - eps >= lo) out.add(b - eps);
    if (b + eps <= hi) out.add(b + eps);
  }
  for (let k = 0; k + 1 < bs.length; k++) {
    out.add(bs[k]! + (bs[k + 1]! - bs[k]!) / 3);
    out.add(bs[k]! + (2 * (bs[k + 1]! - bs[k]!)) / 3);
  }
  return [...out].sort((a, b) => a - b);
}

const USES: BuildingType[] = ['condo', 'apartment', 'office', 'hotel'];
// building class breakpoints: 8 m (art. 50 / 41), 9 m (MR 55 art. 50), 10 m (ord. 50 exemption),
// 15 m (ord. 55, large), 23 m (high-rise); storeys 2 / 3; GFA 1,000 (exemption, large with 15 m),
// 2,000 (large), 10,000 (extra-large), 30,000 (MR 33 art. 2 para. 2)
const HS = [4.5, 8, 8 + EPS, 9, 9 + EPS, 10, 10 + EPS, 15, 15 + EPS, 23 - EPS, 23, 60];
const STOREYS = [1, 2, 3, 4, 20];
const GFAS = [800, 1000, 1000 + EPS, 2000, 2000 + EPS, 9999, 10000, 30000 + EPS];
// road width 6 / 10 / 20 (art. 50 / 41); gap where a setback minus the gap reaches 0
const WS = grid([6, 10, 20], 1, 100);
const GAPS = [0, 0.25, 0.5, 0.5 + EPS, 1, 2, 2 + EPS, 3, 6 - EPS, 6, 6 + EPS, 50];
const CS = grid([10], 1, 100);
// floors as (level, top): storey 2 / 3 and 9 m (ord. art. 54), tall floors for the 2x rule
const FLOORS: [number, number][] = [[1, 4.5], [2, 7.5], [2, 9], [2, 9 + EPS], [3, 8], [3, 10.5], [4, 13.5], [10, 31.5], [20, 61.5]];
const ZS = [0, 4.5, 9, 9 + EPS, 23, 30, 61.5, 100, 181.5, 250];

interface B { b: O.Building; type: BuildingType; dwelling: boolean; high: boolean; art50: boolean; label: string }

/** The class flags exactly as the checker derives them from a design (checker.ts measure / checkDesign). */
function engineFlags(type: BuildingType, h: number, storeys: number, gfa: number, largest: number) {
  const dwelling = R.TYPE_PARAMS[type].dwelling;
  const high = h >= R.PARAMS.highRiseHeight || gfa >= R.PARAMS.extraLargeGfa || largest >= R.PARAMS.extraLargeGfa;
  // roadSetbackApplies is the checker's ORD50-ROAD scope (Codex #1); engines before it read storeys
  const rsa = (R as Partial<typeof R>).roadSetbackApplies;
  const art50 = rsa ? rsa({ floors: storeys, height: h, gfa, dwelling }) : storeys > 2 || h > 8;
  return { dwelling, high, art50 };
}

const BUILDINGS: B[] = [];
for (const type of USES) for (const h of HS) for (const storeys of STOREYS) for (const gfa of GFAS) {
  for (const largest of [...new Set([gfa / storeys, gfa])]) {
    const f = engineFlags(type, h, storeys, gfa, largest);
    BUILDINGS.push({ b: { use: type, heightM: h, storeys, gfaM2: gfa, largestFloorM2: largest }, type, ...f, label: `${type} ${h} m ${storeys} st ${gfa} m2 (largest ${largest.toFixed(1)})` });
  }
}

function chain(role: Chain['role'], width?: number, gap = 0, length = 20, id = 0, name?: string, points?: [number, number][]): Chain {
  const c: Chain = { id, role, edges: [id], points: points ?? [[0, id * 100], [length, id * 100]], closed: false, length, gap };
  if (width !== undefined) c.width = width;
  if (name !== undefined) c.name = name;
  return c;
}

/** The checker's distance context for a building (DistanceCtx; `floors` kept for engines before Codex #1). */
const ctxOf = (x: B, level: number, z: number) =>
  ({ level, z, buildingH: x.b.heightM, art50: x.art50, high: x.high, floors: x.b.storeys }) as R.DistanceCtx;

const topRule = (parts: { rule: string; d: number }[]) => parts.reduce((m, p) => (p.d > m.d ? p : m), parts[0]!).rule;

// the oracle's 2x readings (clauses.md R-55-44 and R-ORD-49)
const TWO_X_CITES = new Set(['mr55-update.txt:434', 'bma-ordinance-2544.txt:703']);

// ---------------------------------------------------------------------------

describe('oracle differential: distances (engine >= oracle max)', () => {
  it('road setback (no 2x part): every building class x road W x gap', () => {
    const diff = new Diff('road setback');
    for (const x of BUILDINGS) for (const W of WS) for (const g of GAPS) {
      diff.case();
      const e = R.chainDistance(chain('road', W, g), ctxOf(x, 1, 0));
      const o = O.requiredRoadDistance(x.b, { widthM: W, gapM: g }, { level: 1, topM: 0 }); // top 0: no 2x part
      if (e.base < o.max - TOL) diff.lax(`${x.label}, road W ${W} gap ${g}: engine ${e.base} < oracle ${o.max} (${o.readings.filter((r) => r.d === o.max).map((r) => r.cite).join(', ')})`, null);
      else if (e.base > o.max + TOL) {
        const rule = topRule(e.parts.filter((p) => p.rule !== 'ORD49-2X'));
        diff.strict(rule === 'ORD55-CLEAR' ? 'clear space (ord. 55) on road edges' : rule === 'MR33-4' ? 'MR 33 art. 4: 6 m not reduced by the gap' : rule);
      }
    }
    diff.done();
  });

  it('2x rule: floor top z x road W x gap (any building)', () => {
    const diff = new Diff('road 2x');
    const x = BUILDINGS[0]!;
    for (const z of ZS) for (const W of WS) for (const g of GAPS) {
      diff.case();
      const e = R.chainDistance(chain('road', W, g), ctxOf(x, 1, z)).twoX;
      const o = O.requiredRoadDistance(x.b, { widthM: W, gapM: g }, { level: 1, topM: z }).readings.filter((r) => TWO_X_CITES.has(r.cite));
      expect(o.length).toBe(2);
      for (const r of o) {
        if (e < r.d - TOL) diff.lax(`z ${z}, W ${W}, gap ${g}: engine 2x ${e} < oracle ${r.d} (${r.cite})`, null);
        else if (e > r.d + TOL) diff.strict('2x');
      }
    }
    diff.done();
  });

  it('private boundary (walls with openings): every building class x floor (level, top)', () => {
    const diff = new Diff('private');
    for (const x of BUILDINGS) for (const [level, top] of FLOORS) {
      if (level > x.b.storeys) continue;
      diff.case();
      const e = R.chainDistance(chain('private'), ctxOf(x, level, top));
      const o = O.requiredPrivateDistance(x.b, { level, topM: top });
      if (e.base < o.max - TOL) diff.lax(`${x.label}, floor ${level} top ${top}: engine ${e.base} < oracle ${o.max} (${o.readings.filter((r) => r.d === o.max).map((r) => r.cite).join(', ')})`, null);
      else if (e.base > o.max + TOL) diff.strict(topRule(e.parts));
    }
    diff.done();
  });

  it('canal: every building class x canal C x gap', () => {
    const diff = new Diff('canal');
    for (const x of BUILDINGS) for (const C of CS) for (const g of GAPS) {
      diff.case();
      const e = R.chainDistance(chain('canal', C, g), ctxOf(x, 1, 0));
      const o = O.requiredCanalDistance(x.b, { widthM: C, gapM: g });
      if (e.base < o.max - TOL) diff.lax(`${x.label}, canal C ${C} gap ${g}: engine ${e.base} < oracle ${o.max}`, null);
      else if (e.base > o.max + TOL) {
        const rule = topRule(e.parts);
        diff.strict(rule === 'MR33-4' ? 'MR 33 art. 4: 6 m not reduced by the gap' : rule === 'ORD55-CLEAR' ? 'clear space (ord. 55) on canal edges' : rule);
      }
    }
    diff.done();
  });

  it('clear space all round: every building class, on road, private and canal edges', () => {
    const diff = new Diff('clear space');
    // edges where nothing but clear space (and MR 33) applies: a road and a canal 50 m away
    const edges = [chain('road', 100, 50), chain('private'), chain('canal', 4, 50)];
    for (const x of BUILDINGS) {
      const o = O.requiredClearSpace(x.b);
      for (const c of edges) {
        diff.case();
        const e = R.chainDistance(c, ctxOf(x, 1, 0)).base;
        if (e < o.max - TOL) diff.lax(`${x.label}, ${c.role} edge: engine ${e} < oracle clear ${o.max}`, null);
        else if (e > o.max + TOL) diff.strict(`${c.role} edge: another rule binds`);
      }
    }
    diff.done();
  });
});

// ---------------------------------------------------------------------------

describe('oracle differential: open space (engine requirement >= oracle max)', () => {
  it('largest footprint the engine allows leaves at least the oracle open space (plot %, largest-floor %, zone OSR)', () => {
    const diff = new Diff('open space');
    for (const type of USES) for (const A of [100, 1000, 5000, 20000]) for (const osr of [0, 4.5, 5, 30]) {
      for (const G of [0, 500, 1000, 4000, 9999, 10000, 30000, 100000]) for (const h of [10, 23]) {
        const zone: ZoneInfo = { code: 'Y9', far: 7, osrPct: osr };
        const F = Env.maxFootprint({ plotArea: A, type, zone } as unknown as Env.Site, G).value;
        if (F <= 0) continue; // the engine allows no building at all
        // plates nest, so the largest floor is the footprint, and it cannot exceed the GFA
        const foot = G > 0 ? Math.min(F, G) : F;
        diff.case();
        const o = O.requiredOpenSpace({ use: type, heightM: h, storeys: 10, gfaM2: G, largestFloorM2: foot }, A, osr);
        const open = A - foot;
        if (open < o.max - TOL * Math.max(1, A)) diff.lax(`${type} A ${A} OSR ${osr} G ${G} h ${h}: engine footprint ${foot} leaves ${open} < oracle ${o.max}`, null);
        else if (open > o.max + 1e-6) diff.strict('footprint below the bound (G < F)');
      }
    }
    diff.done();
  });
});

// ---------------------------------------------------------------------------
// Gates and caps

interface Piece { W: number; L: number; g: number }
const PW = [8, 9.999, 10, 11.999, 12, 15.999, 16, 17.999, 18, 30];
const PL = [5, 11.998, 11.999, 11.9995, 12, 15.999, 16, 40];
const PG = [0, 1e-6, 0.001, 0.001 + 1e-6, 0.25, 0.5, 0.5 + 1e-6, 2];
const SINGLE: Piece[][] = PW.flatMap((W) => PL.flatMap((L) => PG.map((g) => [{ W, L, g }])));
const REP: Piece[] = [
  { W: 18, L: 5, g: 0 }, { W: 10, L: 12, g: 0 }, { W: 16, L: 11.999, g: 0 }, { W: 12, L: 40, g: 0.25 }, { W: 30, L: 40, g: 2 },
  { W: 9.999, L: 40, g: 0 }, { W: 18, L: 12, g: 0.5 }, { W: 16, L: 16, g: 0 }, { W: 12, L: 11.9995, g: 0 }, { W: 30, L: 15.999, g: 0 },
  { W: 17.999, L: 40, g: 0 }, { W: 18, L: 40, g: 0.5 + 1e-6 },
];
const PAIRS: Piece[][] = REP.flatMap((a, i) => REP.slice(i + 1).map((b) => [a, b]));
const SETS: Piece[][] = [[], ...SINGLE, ...PAIRS];
const SCEN: { A: number; far: number }[] = [{ A: 1000, far: 7 }, { A: 5000, far: 7 }, { A: 5000, far: 12 }];

const frontagesOf = (ps: Piece[]): O.Frontage[] => ps.map((p) => ({ widthM: p.W, lengthM: p.L, gapM: p.g }));
const chainsOf = (ps: Piece[]): Chain[] => ps.map((p, i) => chain('road', p.W, p.g, p.L, i, `R${i}`));
const engineSite = (ps: Piece[], A: number, far: number, type: BuildingType, nearStation: boolean) =>
  ({ chains: chainsOf(ps), plotArea: A, zone: { code: 'Y9', far, osrPct: 4.5 }, type, nearStation }) as unknown as Env.Site;
const descr = (ps: Piece[]) => (ps.length ? ps.map((p) => `[W ${p.W} L ${p.L} gap ${p.g}]`).join(' ') : 'no road');

const ZONING_GATES = new Set(['mr2556.txt:1412', 'mr2556.txt:1425']); // G-2556-16-8 hotel, G-2556-16-10 office
const MR33_GATES = new Set(['mr33.txt:60', 'mr33.txt:64']); // G-33-2-1, G-33-2-2
const blocking = (rs: O.Reading[]) => rs.filter((r) => r.d === 0);
const rooms = (gfa: number) => Math.floor(gfa / R.PARAMS.hotelGfaPerRoom);

/** Oracle caps for a regime: low = every cap but MR 33 FAR 10 (binds high-rise / XL only). */
function oracleCaps(use: BuildingType, A: number, far: number, fs: O.Frontage[], nearStation: boolean, high: boolean, office: boolean) {
  const all = O.gfaCaps(use, A, far, fs, nearStation).caps.filter((c) => Number.isFinite(c.value));
  return all.filter((c) => (high || c.cite !== 'mr33.txt:84') && (c.cite === 'mr2556.txt:1425') === office);
}
const capOk = (engineCap: number, caps: { cite: string; value: number; note?: string }[]) =>
  caps.every((c) => (c.cite === 'mr33.txt:60' && /EXCLUSIVE/.test(c.note ?? '') ? engineCap < c.value : engineCap <= c.value + TOL));

describe('oracle differential: gates and caps (engine permits => oracle permits; engine cap <= oracle cap)', () => {
  it('MR 33 art. 2 frontage gate (12 m on a >= 10 m road; > 30,000 m2 on a >= 18 m road)', () => {
    const diff = new Diff('MR 33 art. 2 gate');
    for (const ps of SETS) {
      const s = engineSite(ps, 5000, 7, 'condo', false);
      if (!Env.highGate(s).ok) continue; // engine refuses the high regime: stricter or equal
      const cap = Math.min(...Env.fixedCaps(s, 'high').map((c) => c.value));
      const fs = frontagesOf(ps);
      // high-rise buildings the engine permits: at, below and above the 30,000 m2 line, up to its cap
      for (const G of [5000, 10000, 30000, 30000 + EPS, 35000].filter((v) => v <= cap)) {
        diff.case();
        const b: O.Building = { use: 'condo', heightM: 60, storeys: 20, gfaM2: G, largestFloorM2: G / 20 };
        const agrees = (f: O.Frontage[]) => blocking(O.gates(b, f, false).reasons).filter((r) => MR33_GATES.has(r.cite)).length === 0;
        if (!agrees(fs)) diff.lax(`${descr(ps)}, high-rise ${G} m2: engine opens the high regime, oracle blocks (${blocking(O.gates(b, fs, false).reasons).map((r) => r.cite).join(', ')})`, explain(fs, ['D2'], agrees));
      }
    }
    diff.done();
  });

  it('zoning art. 16 road gates: hotel > 80 rooms (12 m road), office > 10,000 m2 (16 m road), station waiver', () => {
    const diff = new Diff('zoning road gates');
    for (const ps of SETS) for (const type of ['office', 'hotel'] as BuildingType[]) for (const nearStation of [false, true]) {
      const s = engineSite(ps, 5000, 12, type, nearStation);
      const fs = frontagesOf(ps);
      for (const regime of ['low', 'high'] as const) {
        if (regime === 'high' && !Env.highGate(s).ok) continue;
        const cap = Math.min(...Env.fixedCaps(s, regime).map((c) => c.value));
        const h = regime === 'high' ? 60 : 22.9;
        for (const G of [3000, 4000, 4049.99, 4050, 9999, 10000, 10000 + EPS, 20000, 30000].filter((v) => v <= cap)) {
          diff.case();
          const b: O.Building = { use: type, heightM: h, storeys: regime === 'high' ? 20 : 7, gfaM2: G, largestFloorM2: G / 7 };
          const blocks = (f: O.Frontage[]) => blocking(O.gates(b, f, nearStation, rooms(G)).reasons).filter((r) => ZONING_GATES.has(r.cite));
          if (blocks(fs).length) diff.lax(`${type} ${regime} ${G} m2 (${rooms(G)} rooms), ${descr(ps)}${nearStation ? ', station' : ''}: engine permits, oracle blocks (${blocks(fs).map((r) => r.cite).join(', ')})`, explain(fs, ['D2'], (f) => blocks(f).length === 0));
        }
      }
    }
    diff.done();
  });

  it('caps: FAR, MR 33 FAR 10, 9,999 low regime vs exclusive 10,000, 30,000 without an 18 m road', () => {
    const diff = new Diff('FAR and MR 33 caps');
    for (const ps of SETS) for (const { A, far } of SCEN) for (const type of USES) {
      const s = engineSite(ps, A, far, type, false);
      const fs = frontagesOf(ps);
      for (const regime of ['low', 'high'] as const) {
        if (regime === 'high' && !Env.highGate(s).ok) continue;
        const eCaps = Env.fixedCaps(s, regime).filter((c) => c.id !== 'Z16-OFFICE' && c.id !== 'Z16-HOTEL');
        const e = Math.min(...eCaps.map((c) => c.value));
        diff.case();
        const agrees = (f: O.Frontage[]) => capOk(e, oracleCaps(type, A, far, f, false, regime === 'high', false));
        const oCaps = oracleCaps(type, A, far, fs, false, regime === 'high', false);
        if (!agrees(fs)) diff.lax(`${type} ${regime} A ${A} FAR ${far}, ${descr(ps)}: engine cap ${e} > oracle ${JSON.stringify(oCaps.map((c) => [c.cite, c.value]))}`, explain(fs, ['D2'], agrees));
        else if (e < Math.min(...oCaps.map((c) => c.value)) - TOL) {
          const bind = eCaps.reduce((m, c) => (c.value < m.value ? c : m)).id;
          diff.strict(bind === 'MR33-1' ? 'low regime 9,999 m2 (oracle: < 10,000 only without a 12 m frontage, else none)' : bind);
        }
      }
    }
    diff.done();
  });

  it('caps: office 10,000 m2 without a 16 m road or station', () => {
    const diff = new Diff('office cap');
    for (const ps of SETS) for (const nearStation of [false, true]) {
      const s = engineSite(ps, 5000, 12, 'office', nearStation);
      const fs = frontagesOf(ps);
      const eOffice = Env.fixedCaps(s, 'high').find((c) => c.id === 'Z16-OFFICE')?.value ?? Infinity;
      diff.case();
      const agrees = (f: O.Frontage[]) => capOk(eOffice, oracleCaps('office', 5000, 12, f, nearStation, true, true));
      if (!agrees(fs)) diff.lax(`office, ${descr(ps)}${nearStation ? ', station' : ''}: engine has no office cap, oracle caps 10,000 m2`, explain(fs, ['D2'], agrees));
    }
    diff.done();
  });

  it('hotel rooms: the engine caps GFA at 80 x 50 m2; at rooms = floor(GFA / 50) it is never laxer (the conversion is an engine judgement, D4)', () => {
    const diff = new Diff('hotel rooms');
    for (const ps of SETS) for (const nearStation of [false, true]) {
      const s = engineSite(ps, 5000, 7, 'hotel', nearStation);
      const fs = frontagesOf(ps);
      const eHotel = Env.fixedCaps(s, 'low').find((c) => c.id === 'Z16-HOTEL')?.value ?? Infinity;
      for (const G of [3999, 4000, 4049.99, 4050, 8000]) {
        if (G > eHotel) continue;
        diff.case();
        const b: O.Building = { use: 'hotel', heightM: 22.9, storeys: 7, gfaM2: G, largestFloorM2: G / 7 };
        const blocks = (f: O.Frontage[]) => blocking(O.gates(b, f, nearStation, rooms(G)).reasons).filter((r) => r.cite === 'mr2556.txt:1412');
        if (blocks(fs).length) diff.lax(`hotel ${G} m2 (${rooms(G)} rooms), ${descr(ps)}: engine permits, oracle blocks`, explain(fs, ['D2'], (f) => blocks(f).length === 0));
      }
    }
    diff.done();
  });

  it('D4 (documented, not comparable): with 30 m2 of GFA per room the engine admits more than 80 rooms where the oracle bans them', () => {
    const s = engineSite([{ W: 8, L: 40, g: 0 }], 5000, 7, 'hotel', false);
    const cap = Env.fixedCaps(s, 'low').find((c) => c.id === 'Z16-HOTEL')!.value;
    expect(cap).toBe(4000);
    const b: O.Building = { use: 'hotel', heightM: 22.9, storeys: 7, gfaM2: cap, largestFloorM2: cap / 7 };
    expect(O.gates(b, [{ widthM: 8, lengthM: 40, gapM: 0 }], false, Math.floor(cap / 30)).ok).toBe(false);
    expect(O.gates(b, [{ widthM: 8, lengthM: 40, gapM: 0 }], false, undefined).reasons.some((r) => Number.isNaN(r.d))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Relief

type NameMode = 'same-name' | 'other-name' | 'unnamed';

/** reliefChains draws 60 m chains, so the plot is 60 m along each road. */
const PLOT_EXTENT = 60;

/** Two road chains realising the facts; null when the engine cannot express them. */
function reliefChains(narrow: number, wide: number, corner: boolean, apart: number, mode: NameMode): [Chain, Chain] | null {
  const names: [string | undefined, string | undefined] = mode === 'same-name' ? ['A', 'A'] : mode === 'other-name' ? ['A', 'B'] : [undefined, undefined];
  if (corner) {
    // narrow runs down the west side to the corner, wide runs east from it: a 90 degree turn
    return [chain('road', narrow, 0, 60, 0, names[0], [[0, 60], [0, 0]]), chain('road', wide, 0, 60, 1, names[1], [[0, 0], [60, 0]])];
  }
  if (apart <= 0) {
    // one road changing width: collinear, meeting end to start (turn 0)
    return [chain('road', narrow, 0, 60, 0, names[0], [[0, 0], [60, 0]]), chain('road', wide, 0, 60, 1, names[1], [[60, 0], [120, 0]])];
  }
  return [chain('road', narrow, 0, 60, 0, names[0], [[0, 0], [60, 0]]), chain('road', wide, 0, 60, 1, names[1], [[60, apart], [0, apart]])];
}

describe('oracle differential: wider-road relief (engine eligible => oracle eligible)', () => {
  it('MR 55 arts. 45-46 over facts: widths, same road, corner, roads apart, building length / width', () => {
    const diff = new Diff('relief');
    const partnersOf = (Ev as Partial<typeof Ev>).reliefPartners;
    expect(partnersOf, 'evaluate.ts must export reliefPartners').toBeTypeOf('function');
    let ordinanceOnly = 0;
    for (const narrow of [6, 10, 12]) for (const wide of [6, 10, 12, 20, 80]) for (const mode of ['same-name', 'other-name', 'unnamed'] as NameMode[]) {
      for (const [corner, apart] of [[true, 0], [false, 0], [false, 30], [false, 60], [false, 60 + EPS], [false, 100]] as [boolean, number][]) {
        const cs = reliefChains(narrow, wide, corner, apart, mode)!;
        const engineEligible = partnersOf!(cs, true)[0]!.includes(1);
        // the engine's own same-road inference for unnamed chains (D9): collinear chains that meet, and chains that do not meet, are one road
        const sameRoad = mode === 'same-name' || (mode === 'unnamed' && !corner);
        for (const L of [undefined, 40, 60, 60 + EPS, 100]) for (const Wd of [undefined, 40, 60, 60 + EPS, 100]) {
          diff.case();
          const facts = { narrowWidthM: narrow, wideWidthM: wide, sameRoad, corner, roadsApartM: apart, buildingLengthAlongNarrowM: L, buildingWidthAlongWideM: Wd };
          const o = O.reliefEligible(facts);
          if (engineEligible && o.reasons.some((r) => r.cite === 'bma-ordinance-2544.txt:703' && r.d === 0)) ordinanceOnly++;
          if (!engineEligible || o.eligible) {
            if (!engineEligible && o.eligible) diff.strict('engine gives no relief where MR 55 would');
            continue;
          }
          const e45 = o.reasons.find((r) => r.cite === 'mr55-update.txt:447')!;
          const e46 = o.reasons.find((r) => r.cite === 'mr55-update.txt:452')!;
          const what = `narrow ${narrow} wide ${wide} ${mode} corner ${corner} apart ${apart} L ${L} W ${Wd}: engine relieves, oracle does not (45: ${e45.d}, 46: ${e46.d})`;
          // the engine grants relief only when the plot is <= 60 m along the relevant road
          // (D6 / D7 fix), so a building on this 60 m plot cannot be longer than the plot
          const plotExtent = PLOT_EXTENT;
          if (corner && L !== undefined && L > plotExtent) continue;
          if (!corner && Wd !== undefined && Wd > plotExtent) continue;
          // the oracle cannot assess (building length / width not given): not a disagreement
          if ((corner && Number.isNaN(e46.d)) || (!corner && Number.isNaN(e45.d))) {
            diff.notAssessable++;
            continue;
          }
          diff.lax(what, null);
        }
      }
    }
    diff.allowed['D8 (ordinance-only reading, every engine relief)'] = ordinanceOnly;
    diff.done();
  });
});

// ---------------------------------------------------------------------------

describe('oracle differential: allowlist and summary', () => {
  it('every allowlist id is a row of oracle/DISAGREEMENTS.md, and the grids reach D2', () => {
    const log = fs.readFileSync(path.join(root, 'oracle', 'DISAGREEMENTS.md'), 'utf8');
    for (const id of Object.keys(ALLOW)) expect(log, `DISAGREEMENTS.md has no row ${id}`).toMatch(new RegExp(`^\\|\\s*${id}\\s*\\|`, 'm'));
    // rows referenced by comments here and in property.test.ts (not comparable / documented)
    for (const id of ['D4', 'D5', 'D8', 'D9', 'D12']) expect(log).toMatch(new RegExp(`^\\|\\s*${id}\\s*\\|`, 'm'));
    const hit = new Set<string>();
    for (const s of SUMMARY.values()) for (const k of Object.keys(s.allowed)) for (const id of k.split('+')) hit.add(id.split(' ')[0]!);
    if (SUMMARY.size >= 10) for (const id of ['D2']) expect(hit, `no case needed ${id}: is the allowlist entry stale?`).toContain(id);
  });

  it('summary: laxer cases allowed per disagreement, and the main categories of engine strictness', () => {
    const lines: string[] = [];
    for (const [name, s] of SUMMARY) {
      const allowed = Object.entries(s.allowed).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
      const strict = Object.entries(s.stricter).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
      lines.push(`${name.padEnd(20)} ${String(s.checked).padStart(8)} cases | allowed laxer: ${allowed} | stricter: ${strict}${s.notAssessable ? ` | oracle not assessable: ${s.notAssessable}` : ''}`);
    }
    console.log(`oracle differential summary\n${lines.join('\n')}`);
    expect(SUMMARY.size).toBeGreaterThan(0);
  });
});
