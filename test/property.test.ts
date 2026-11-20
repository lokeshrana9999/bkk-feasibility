// Property tests over random star / comb / rotated plots with random edge roles.
// P2 and P3 take their distance requirements from the independent rule oracle (oracle/index.ts),
// not from the engine's own chainDistance: see "oracle requirements" below for the mapping.
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import * as O from '../oracle/index.js';
import { evaluate } from '../src/engine/index.js';
import type { BuildingType, Chain, EngineInput, EngineResult, Envelope, FloorPlate, XY } from '../src/engine/index.js';
import { reliefPartners } from '../src/engine/evaluate.js';
import { pointInPolygons, pointPolylineDist, polygonsArea, polylineDist } from '../src/engine/measure.js';
import { PARAMS } from '../src/engine/rules.js';
import { engineInput } from './arbitraries.js';

const RUNS = Number(process.env.PROP_RUNS ?? 80);
const TOL_IN = 0.002; // clipper works in whole millimetres
const TOL_D = PARAMS.checkTol;

function run(i: EngineInput): EngineResult | null {
  const out = evaluate(i);
  if (!out.ok) return null; // random rings can be rejected (e.g. too large); P7 covers errors
  return out;
}

function vertices(p: FloorPlate): XY[] {
  return p.polygons.flatMap((poly) => poly.flat() as XY[]);
}

/**
 * The engine's relief pairs (which road's 2x rule it lifts near which wider road). P2 and P3
 * take relief from the oracle; these pairs only tell whether the engine relieved a chain the
 * oracle refuses for the 60 m building condition alone (DISAGREEMENTS D6 / D7).
 */
function partners(r: EngineResult): number[][] {
  return reliefPartners(r.chains, true);
}

// ---------------------------------------------------------------------------
// Oracle requirements (P2, P3)
//
// Mapping, engine -> oracle:
//  - a stack of plates is a building: use = input type, height = top of the last plate,
//    storeys = number of plates, GFA = sum of plate areas, largest floor = largest plate. For an
//    envelope (the space a building may fill, not a building) GFA is the envelope's permitted
//    GFA and the largest floor is capped by it: the low envelope's plates can add up to more
//    than 10,000 m2, but the building it permits stays under 9,999 m2.
//  - a road chain is (width, gap) and each floor is (level, top); a canal is (width, gap); a
//    private chain is a boundary with openings. Clear space (ord. 55 / MR 33 art. 3) applies on
//    every edge. The 2x readings (MR 55 art. 44, ord. 49) are split off as the part that
//    wider-road relief can lift; everything else is the base. Gap land is treated as public
//    (the engine's model); the oracle would add a private setback if it were someone's land
//    (DISAGREEMENTS D12).
//  - wider-road relief per (narrow road chain, wider road chain): corner = they meet at a turn
//    of 30 degrees or more, or they do not meet and their end-to-end directions differ by 30
//    degrees or more (eg a chamfered corner); flanked (art. 45) = they do not meet and run within
//    30 degrees of parallel; sameRoad = equal names, or (unnamed) meeting at a turn under 30
//    degrees, or (unnamed) not meeting at all (the engine's inference, D9); roads apart = polyline distance; building length /
//    width along a road = extent of the stack's largest plate projected on that chain's end-to-end
//    direction. If MR 55 relieves the narrow road (reliefEligible) its 2x check is skipped; if
//    the oracle cannot assess, skipped and counted; if the only reason it refuses is the 60 m
//    building length / width condition the engine does not model (D6 / D7) and the engine does
//    relieve that chain, skipped and counted as allowlisted. Otherwise every vertex must meet
//    the oracle's 2x distance.

const TWO_X_CITES = new Set(['mr55-update.txt:434', 'bma-ordinance-2544.txt:703']); // clauses.md R-55-44, R-ORD-49
const SKIPS = { checks2x: 0, relievedByOracle: 0, notAssessable: 0, allowD6: 0, allowD7: 0 };

function oracleBuilding(type: BuildingType, plates: FloorPlate[], env?: Envelope): O.Building {
  const areas = plates.map((p) => p.area);
  const total = areas.reduce((s, a) => s + a, 0);
  const gfa = env && env.permittedGfa > 0 ? Math.min(env.permittedGfa, total) : total;
  return { use: type, heightM: plates[plates.length - 1]!.z1, storeys: plates.length, gfaM2: gfa, largestFloorM2: Math.min(Math.max(...areas), gfa) };
}

const finiteMax = (rs: O.Reading[]) => rs.reduce((m, r) => (Number.isFinite(r.d) && r.d > m ? r.d : m), 0);

/** Oracle requirement for a chain at a floor: base (never relieved) and the 2x part. */
function oracleReq(b: O.Building, c: Chain, level: number, top: number, clear: number): { base: number; twoX: number } {
  if (c.role === 'road') {
    const rs = O.requiredRoadDistance(b, { widthM: c.width ?? 0, gapM: c.gap }, { level, topM: top }).readings;
    return { base: Math.max(clear, finiteMax(rs.filter((r) => !TWO_X_CITES.has(r.cite)))), twoX: finiteMax(rs.filter((r) => TWO_X_CITES.has(r.cite))) };
  }
  if (c.role === 'private') return { base: Math.max(clear, O.requiredPrivateDistance(b, { level, topM: top }).max), twoX: 0 };
  return { base: Math.max(clear, O.requiredCanalDistance(b, { widthM: c.width ?? 0, gapM: c.gap }).max), twoX: 0 };
}

const same = (a: XY, b: XY) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
/** Turn (degrees) where a ends and b starts, or null if they do not meet that way. */
function turn(a: Chain, b: Chain): number | null {
  const p = a.points;
  const q = b.points;
  if (a.closed || b.closed || p.length < 2 || q.length < 2 || !same(p[p.length - 1]!, q[0]!)) return null;
  const u = [p[p.length - 1]![0] - p[p.length - 2]![0], p[p.length - 1]![1] - p[p.length - 2]![1]];
  const v = [q[1]![0] - q[0]![0], q[1]![1] - q[0]![1]];
  return Math.abs((Math.atan2(u[0]! * v[1]! - u[1]! * v[0]!, u[0]! * v[0]! + u[1]! * v[1]!) * 180) / Math.PI);
}

/** Angle (0-90 degrees) between two chains' end-to-end directions, ignoring orientation. */
function skewDeg(a: Chain, b: Chain): number {
  const dir = (c: Chain) => {
    const p = c.points[0]!;
    const q = c.points[c.points.length - 1]!;
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  };
  let d = Math.abs(dir(a) - dir(b)) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return (d * 180) / Math.PI;
}

/** Extent of a plate's vertices along a chain's end-to-end direction, or undefined if it has none. */
function extentAlong(c: Chain, vs: XY[]): number | undefined {
  const a = c.points[0]!;
  const z = c.points[c.points.length - 1]!;
  const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
  if (c.closed || L < 1e-9 || vs.length === 0) return undefined;
  const d = [(z[0] - a[0]) / L, (z[1] - a[1]) / L];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vs) {
    const t = v[0] * d[0]! + v[1] * d[1]!;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return hi - lo;
}

type TwoXMode = 'check' | 'skip';
/** Whether the oracle requires road chain c's 2x rule for this stack (see the mapping above). */
function twoXMode(r: EngineResult, pr: number[][], c: Chain, plates: FloorPlate[]): TwoXMode {
  const largest = plates.reduce((m, p) => (p.area > m.area ? p : m), plates[0]!);
  const vs = vertices(largest);
  let notAssessable = false;
  let allow: 'D6' | 'D7' | null = null;
  for (const w of r.chains) {
    if (w.role !== 'road' || w.id === c.id || (w.width ?? 0) <= (c.width ?? 0)) continue;
    const t = turn(c, w) ?? turn(w, c);
    const corner = t !== null ? t >= PARAMS.cornerTurnDeg : skewDeg(c, w) >= PARAMS.cornerTurnDeg;
    const sameRoad = c.name && w.name ? c.name === w.name : t === null || t < PARAMS.cornerTurnDeg;
    const facts = {
      narrowWidthM: c.width ?? 0, wideWidthM: w.width ?? 0, sameRoad, corner, roadsApartM: polylineDist(c.points, w.points),
      buildingLengthAlongNarrowM: extentAlong(c, vs), buildingWidthAlongWideM: extentAlong(w, vs),
    };
    const o = O.reliefEligible(facts);
    if (o.eligible) {
      SKIPS.relievedByOracle++;
      return 'skip';
    }
    const art = o.reasons.find((x) => x.cite === (corner ? 'mr55-update.txt:452' : 'mr55-update.txt:447'));
    if (art && Number.isNaN(art.d)) notAssessable = true;
    else if ((pr[c.id] ?? []).includes(w.id)) {
      // The engine relieves c near w although the oracle refuses for the 60 m building
      // condition. Since the D6 / D7 fix the engine relieves a corner only when the plot is
      // <= 60 m along the narrower road, so for chains that meet (a corner in both readings)
      // this must never happen. Non-adjacent skewed roads stay a classification difference
      // (the engine treats them as flanking, art. 45; this test as a corner) and are skipped.
      if (corner && (facts.buildingLengthAlongNarrowM ?? 0) > 60 && O.reliefEligible({ ...facts, buildingLengthAlongNarrowM: 0 }).eligible) {
        expect(t, `engine relieves a corner whose building is ${facts.buildingLengthAlongNarrowM} m along the narrower road (D6)`).toBeNull();
        allow = 'D6';
      }
      if (!corner && (facts.buildingWidthAlongWideM ?? 0) > 60 && O.reliefEligible({ ...facts, buildingWidthAlongWideM: 0 }).eligible) {
        expect.fail(`engine relieves two flanking roads with a building ${facts.buildingWidthAlongWideM} m along the wider road (D7)`);
      }
    }
  }
  if (notAssessable) {
    SKIPS.notAssessable++;
    return 'skip';
  }
  if (allow) {
    SKIPS[allow === 'D6' ? 'allowD6' : 'allowD7']++;
    return 'skip';
  }
  SKIPS.checks2x++;
  return 'check';
}

afterAll(() => {
  console.log(`P2/P3 oracle 2x sub-checks: ${JSON.stringify(SKIPS)}`);
});

function stacks(r: EngineResult): { name: string; plates: FloorPlate[]; env?: Envelope }[] {
  return [
    { name: 'low', plates: r.regimes.low.plates, env: r.regimes.low },
    { name: 'high', plates: r.regimes.high.plates, env: r.regimes.high },
    ...r.designs.map((d) => ({ name: d.id, plates: d.plates })),
  ];
}

/**
 * Per distinct floor geometry and chain: the smallest vertex distance to the chain.
 * Floors that share geometry share the result, so checking "every vertex" stays affordable.
 */
function vertexMins(r: EngineResult) {
  const cache = new Map<unknown, { all: number }[]>();
  return (p: FloorPlate) => {
    let m = cache.get(p.polygons);
    if (!m) {
      const vs = vertices(p);
      m = r.chains.map((c) => {
        let all = Infinity;
        for (const v of vs) all = Math.min(all, pointPolylineDist(v, c.points));
        return { all };
      });
      cache.set(p.polygons, m);
    }
    return m;
  };
}

describe('property tests', () => {
  it('P1: plates lie inside the plot and every floor lies inside the floor below', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const r = run(i);
        if (!r) return;
        const plot = [[r.plot.ring]];
        for (const s of stacks(r)) {
          s.plates.forEach((p, k) => {
            for (const v of vertices(p)) {
              expect(pointInPolygons(v, plot, TOL_IN), `${s.name} floor ${p.level} outside plot`).toBe(true);
              if (k > 0) expect(pointInPolygons(v, s.plates[k - 1]!.polygons, TOL_IN), `${s.name} floor ${p.level} overhangs`).toBe(true);
            }
          });
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P2: every envelope vertex is at least the ORACLE distance from every chain (own distances)', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const r = run(i);
        if (!r) return;
        const pr = partners(r);
        const mins = vertexMins(r);
        for (const env of [r.regimes.low, r.regimes.high]) {
          if (env.plates.length === 0) continue;
          // the envelope as a building of its own height, storeys and (permitted) GFA
          const b = oracleBuilding(i.type, env.plates, env);
          const clear = O.requiredClearSpace(b).max;
          const modes = new Map<number, TwoXMode>();
          for (const c of r.chains) if (c.role === 'road') modes.set(c.id, twoXMode(r, pr, c, env.plates));
          for (const p of env.plates) {
            const m = mins(p);
            for (const c of r.chains) {
              const { base, twoX } = oracleReq(b, c, p.level, p.z1, clear);
              const { all } = m[c.id]!;
              expect(all, `${env.regime} floor ${p.level} chain ${c.id} (${c.role}): ${all} < oracle ${base}`).toBeGreaterThanOrEqual(base - TOL_D);
              if (modes.get(c.id) === 'check') {
                expect(all, `${env.regime} floor ${p.level} road ${c.id} (oracle 2x): ${all} < ${twoX}`).toBeGreaterThanOrEqual(twoX - TOL_D);
              }
            }
          }
        }
        // designs: the independent checker must pass every distance and geometry row
        for (const d of r.designs) {
          const bad = d.checks.filter((c) => c.status === 'fail');
          expect(bad, `${d.id}: ${JSON.stringify(bad)}`).toEqual([]);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P3: the ORACLE 2x distance (MR 55 art. 44 / ord. 49) holds at every vertex of every stack, unless MR 55 relief lifts it', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const r = run(i);
        if (!r) return;
        const pr = partners(r);
        const mins = vertexMins(r);
        for (const s of stacks(r)) {
          if (s.plates.length === 0) continue;
          const b = oracleBuilding(i.type, s.plates, s.env);
          for (const c of r.chains) {
            if (c.role !== 'road' || twoXMode(r, pr, c, s.plates) === 'skip') continue;
            for (const p of s.plates) {
              const dist = mins(p)[c.id]!.all;
              const { twoX } = oracleReq(b, c, p.level, p.z1, 0);
              expect(dist, `${s.name} floor ${p.level} (top ${p.z1}) road ${c.id}: ${dist} < oracle 2x ${twoX}`).toBeGreaterThanOrEqual(twoX - TOL_D);
            }
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P4: plate areas add up to GFA; footprint + open space = plot area', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const r = run(i);
        if (!r) return;
        const A = r.plot.area;
        for (const env of [r.regimes.low, r.regimes.high]) {
          const sum = env.plates.reduce((s, p) => s + p.area, 0);
          expect(Math.abs(sum - env.gfa)).toBeLessThan(1e-6 * Math.max(1, sum));
          expect(Math.abs(env.footprint + env.openSpace - A)).toBeLessThan(1e-6 * A);
          for (const p of env.plates) expect(Math.abs(polygonsArea(p.polygons) - p.area)).toBeLessThan(1e-6 * Math.max(1, p.area));
          expect(env.permittedGfa).toBeLessThanOrEqual(env.gfa + 1e-6);
        }
        for (const d of r.designs) {
          const sum = d.plates.reduce((s, p) => s + p.area, 0);
          expect(Math.abs(sum - d.gfa)).toBeLessThan(1e-6 * Math.max(1, sum));
          expect(Math.abs(d.footprint + d.openSpace - A)).toBeLessThan(1e-6 * A);
          expect(d.gfa).toBeLessThanOrEqual(d.targetGfa + 1e-6);
          for (const p of d.plates) expect(Math.abs(polygonsArea(p.polygons) - p.area)).toBeLessThan(1e-6 * Math.max(1, p.area));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P7: never throws, always returns a typed result (random valid and garbage input)', () => {
    const codes = ['invalid-input', 'too-few-points', 'non-finite', 'edge-mismatch', 'invalid-edge', 'invalid-zone', 'zero-area', 'self-intersection', 'too-large', 'too-many-vertices'];
    const check = (i: unknown) => {
      let out: ReturnType<typeof evaluate> | undefined;
      expect(() => {
        out = evaluate(i as EngineInput);
      }).not.toThrow();
      expect(out).toBeDefined();
      expect(typeof out!.ok).toBe('boolean');
      if (!out!.ok) {
        expect(codes, out!.message).toContain(out!.code);
        expect(typeof out!.message).toBe('string');
      }
    };
    fc.assert(fc.property(fc.anything(), check), { numRuns: 300 });
    // near-valid inputs with one field broken
    const breakers: fc.Arbitrary<(i: EngineInput) => unknown> = fc.constantFrom(
      (i: EngineInput) => ({ ...i, ring: i.ring.map((p, k) => (k === 1 ? [Number.NaN, p[1]] : p)) }),
      (i: EngineInput) => ({ ...i, ring: i.ring.map((p, k) => (k === 0 ? [Infinity, p[1]] : p)) }),
      (i: EngineInput) => ({ ...i, edges: i.edges.slice(1) }),
      (i: EngineInput) => ({ ...i, ring: i.ring.slice(0, 2), edges: i.edges.slice(0, 2) }),
      (i: EngineInput) => ({ ...i, zone: null }),
      (i: EngineInput) => ({ ...i, zone: { code: 'x', far: -1, osrPct: 4.5 } }),
      (i: EngineInput) => ({ ...i, type: 'factory' }),
      (i: EngineInput) => ({ ...i, edges: i.edges.map((e) => (e.role === 'private' ? e : { ...e, width: Number.NaN })) }),
      (i: EngineInput) => ({ ...i, ring: i.ring.map(([x, y]) => [x * 1000, y * 1000]) }),
      (i: EngineInput) => ({ ...i, ring: [...i.ring, i.ring[0]!], edges: i.edges }), // closed ring
      (i: EngineInput) => ({ ...i, ring: i.ring.flatMap((p) => [p, p]), edges: i.edges.flatMap((e) => [e, e]) }), // duplicates
      (i: EngineInput) => ({ ...i, ring: [[0, 0], [10, 10], [10, 0], [0, 10]], edges: i.edges.slice(0, 4) }), // bow-tie
      (i: EngineInput) => ({ ...i, floorH: { ground: 0, typical: 3 } }),
      (i: EngineInput) => ({ ...i, units: 'lonlat' }),
    );
    fc.assert(fc.property(engineInput, breakers, (i, b) => check(b(i))), { numRuns: 120 });
  });

  it('P9: deterministic and structured-clone safe (same input, deep-equal output)', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const a = evaluate(i);
        const b = evaluate(structuredClone(i));
        expect(b).toEqual(a);
        expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      }),
      { numRuns: Math.max(20, Math.floor(RUNS / 2)) },
    );
  });
});
