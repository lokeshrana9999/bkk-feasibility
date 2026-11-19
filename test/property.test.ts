// Property tests over random star / comb / rotated plots with random edge roles.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/engine/index.js';
import type { Chain, EngineInput, EngineResult, Envelope, FloorPlate, XY } from '../src/engine/index.js';
import { pointInPolygons, pointPolylineDist, polygonsArea, polylineDist } from '../src/engine/measure.js';
import { PARAMS, chainDistance } from '../src/engine/rules.js';
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

/** Wider road chains within 60 m of each road chain, computed here from scratch. */
function partners(r: EngineResult): number[][] {
  return r.chains.map((n) =>
    n.role !== 'road' || r.regimes === undefined
      ? []
      : r.chains
          .filter((w) => w.role === 'road' && w.id !== n.id && (w.width ?? 0) > (n.width ?? 0) && polylineDist(n.points, w.points) <= PARAMS.reliefReach)
          .map((w) => w.id),
  );
}

function stacks(r: EngineResult): { name: string; plates: FloorPlate[]; env?: Envelope }[] {
  return [
    { name: 'low', plates: r.regimes.low.plates, env: r.regimes.low },
    { name: 'high', plates: r.regimes.high.plates, env: r.regimes.high },
    ...r.designs.map((d) => ({ name: d.id, plates: d.plates })),
  ];
}

const nearWide = (v: XY, c: Chain, r: EngineResult, pr: number[][]) =>
  (pr[c.id] ?? []).some((w) => pointPolylineDist(v, r.chains[w]!.points) <= PARAMS.reliefReach + TOL_D);

/**
 * Per distinct floor geometry and chain: the smallest vertex distance to the chain
 * (all vertices) and over vertices outside the wider-road relief. Floors that share
 * geometry share the result, so checking "every vertex" stays affordable.
 */
function vertexMins(r: EngineResult, pr: number[][]) {
  const cache = new Map<unknown, { all: number; free: number }[]>();
  return (p: FloorPlate) => {
    let m = cache.get(p.polygons);
    if (!m) {
      const vs = vertices(p);
      m = r.chains.map((c) => {
        let all = Infinity;
        let free = Infinity;
        for (const v of vs) {
          const d = pointPolylineDist(v, c.points);
          all = Math.min(all, d);
          if (d < free && !nearWide(v, c, r, pr)) free = d;
        }
        return { all, free };
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

  it('P2: every envelope vertex is at least d from every chain (rule formulas, own distances)', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const r = run(i);
        if (!r) return;
        const mins = vertexMins(r, partners(r));
        for (const env of [r.regimes.low, r.regimes.high]) {
          for (const p of env.plates) {
            // the envelope as a building of its own height must satisfy the distance rules
            const ctx = { z: p.z1, buildingH: env.height, floors: env.floors, high: env.regime === 'high' };
            const m = mins(p);
            for (const c of r.chains) {
              const { base, twoX } = chainDistance(c, ctx);
              const { all, free } = m[c.id]!;
              expect(all, `${env.regime} floor ${p.level} chain ${c.id}: ${all} < ${base}`).toBeGreaterThanOrEqual(base - TOL_D);
              if (Number.isFinite(free)) {
                const req = Math.max(base, twoX);
                expect(free, `${env.regime} floor ${p.level} chain ${c.id} (2x): ${free} < ${req}`).toBeGreaterThanOrEqual(req - TOL_D);
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

  it('P3: z_k <= 2 x (dist + gap + W) at every vertex, for every road outside the wider-road relief', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const r = run(i);
        if (!r) return;
        const mins = vertexMins(r, partners(r));
        for (const s of stacks(r)) {
          for (const p of s.plates) {
            const m = mins(p);
            for (const c of r.chains) {
              if (c.role !== 'road') continue;
              const dist = m[c.id]!.free; // nearest vertex outside the wider-road relief
              if (!Number.isFinite(dist)) continue;
              expect(p.z1, `${s.name} floor ${p.level} road ${c.id}`).toBeLessThanOrEqual(2 * (dist + c.gap + (c.width ?? 0)) + 2 * TOL_D);
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
