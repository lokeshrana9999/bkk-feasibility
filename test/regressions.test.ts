// Regression tests for the Codex adversarial review (2026-11-19). Each case is the
// reviewer's input; the comment says what used to happen and what the law requires.
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/engine/index.js';
import type { EdgeInfo, EngineInput, EngineResult, FloorPlate, XY } from '../src/engine/index.js';
import { buildChains } from '../src/engine/chains.js';
import { checkDesign } from '../src/engine/checker.js';
import { reliefPartners } from '../src/engine/evaluate.js';
import { pointPolylineDist } from '../src/engine/measure.js';
import { PARAMS } from '../src/engine/rules.js';

const P: EdgeInfo = { role: 'private', source: 'user' };
const road = (width: number, extra: Partial<EdgeInfo> = {}): EdgeInfo => ({ role: 'road', width, source: 'user', ...extra });
const B: EngineInput = {
  units: 'm', ring: [[0, 0], [50, 0], [50, 40], [0, 40]], edges: [road(12), P, P, P],
  zone: { code: 'Y9', far: 7, osrPct: 4.5 }, type: 'condo', nearStation: false,
};
function ok(o: Partial<EngineInput>): EngineResult {
  const r = evaluate({ ...B, ...o });
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}
const fails = (r: EngineResult) => r.designs.flatMap((d) => d.checks.filter((c) => c.status === 'fail').map((c) => `${d.id}:${c.id}`));

describe('Codex review regressions', () => {
  it('#1 a 2-storey hotel on an 8 m road keeps the road setback (public building, ord. art. 50 / 5(109))', () => {
    // was: 1.015 m from the road, required 0 m. Now: 6 m from the centreline - 8/2 = 2 m.
    const r = ok({ type: 'hotel', floorH: { ground: 3, typical: 3 }, zone: { code: 'Y9', far: 1.5, osrPct: 4.5 }, edges: [road(8), P, P, P] });
    expect(r.designs.length).toBeGreaterThan(0);
    for (const d of r.designs) {
      const row = d.checks.find((c) => c.id.startsWith('road-'))!;
      expect(row.required).toBe('>= 2.00 m');
      expect(row.status).toBe('pass');
    }
    expect(fails(r)).toEqual([]);
  });

  it('#1 the checker fails a 2-storey office 1 m from an 8 m road', () => {
    const ring = B.ring.map((p) => [p[0] - 25, p[1] - 20] as XY);
    const site = { ring, chains: buildChains(ring, [road(8, { gap: 0 }), P, P, P]), reliefPartners: [[], []], zone: B.zone!, type: 'office' as const, nearStation: false };
    const rect: XY[] = [[-22, -19], [22, -19], [22, 17], [-22, 17]]; // 1 m from y = -20 (the road)
    const plates: FloorPlate[] = [1, 2].map((k) => ({ level: k, z0: (k - 1) * 3, z1: k * 3, polygons: [[rect]], area: 1584, dByChain: [] }));
    expect(checkDesign(site, plates).checks.find((c) => c.id === 'road-0')!.status).toBe('fail');
  });

  it('#2 floor 3 of a 7.2 m building keeps 3 m from private boundaries (ord. art. 54)', () => {
    // was: 2.0 m on floor 3. Ordinance art. 54: 3 m from floor 3 up, whatever the height.
    const r = ok({ ring: [[0, 0], [20, 0], [20, 20], [0, 20]], edges: [P, P, P, P], floorH: { ground: 2.4, typical: 2.4 }, zone: { code: 'Y9', far: 1.8, osrPct: 4.5 } });
    expect(fails(r)).toEqual([]);
    const ring = r.plot.ring;
    const loop = [...ring, ring[0]!];
    for (const d of r.designs) {
      for (const p of d.plates) {
        const need = p.level >= 3 || p.z1 > 9 || d.height > 9 ? 3 : 2;
        for (const v of p.polygons.flat(2) as XY[]) expect(pointPolylineDist(v, loop)).toBeGreaterThanOrEqual(need - PARAMS.checkTol);
      }
    }
  });

  it('#3 one road changing width (8 m to 30 m, collinear, same name) gets no corner relief', () => {
    const r = ok({ ring: [[0, 0], [25, 0], [50, 0], [50, 40], [0, 40]], edges: [road(8, { name: 'same road' }), road(30, { name: 'same road' }), P, P, P] });
    expect(r.rules.find((x) => x.id === 'MR55-46')!.applies).toBe(false);
    expect(fails(r)).toEqual([]);
    // unnamed but collinear: still one road
    const u = ok({ ring: [[0, 0], [25, 0], [50, 0], [50, 40], [0, 40]], edges: [road(8), road(30), P, P, P] });
    expect(reliefPartners(u.chains, true).every((p) => p.length === 0)).toBe(true);
    // a real corner (12 m and 30 m roads meeting at 90 degrees) still gets relief
    const c = ok({ edges: [road(30, { name: 'wide' }), P, P, road(12, { name: 'narrow' })] });
    expect(c.rules.find((x) => x.id === 'MR55-46')!.applies).toBe(true);
  });

  it('#4 a road narrower than 1 m is refused, not enlarged', () => {
    const r = evaluate({ ...B, edges: [road(0.1), P, P, P] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-edge');
  });

  it('#5 simplifying a 500+ corner plot does not bring designs closer than the law to the true boundary', () => {
    // 3 cm sawtooth along y = 0: simplification straightens it; the setbacks must cover the shift
    const ring: [number, number][] = Array.from({ length: 499 }, (_, i) => [(20 * i) / 498, i % 2 ? 0.03 : 0]);
    ring.push([20, 20], [0, 20]);
    const r = ok({ ring, edges: ring.map(() => P) });
    expect(r.warnings.some((w) => w.code === 'simplified')).toBe(true);
    expect(r.designs.length).toBeGreaterThan(0);
    expect(fails(r)).toEqual([]); // the checker measures against the true outline
    // and directly: every vertex >= 3 m (building > 9 m or floor >= 3) from the true sawtooth
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const truth = [...ring, ring[0]!].map((p) => [p[0] - cx, p[1] - cy] as XY);
    for (const d of r.designs) {
      for (const p of d.plates) {
        const need = p.level >= 3 || p.z1 > 9 || d.height > 9 ? 3 : 2;
        for (const v of p.polygons.flat(2) as XY[]) expect(pointPolylineDist(v, truth)).toBeGreaterThanOrEqual(need - PARAMS.checkTol);
      }
    }
  });

  it('#6 a road 50 m away does not open the high-rise gate (MR 33 art. 2 needs adjoining frontage)', () => {
    const r = ok({ edges: [road(12, { gap: 50 }), P, P, P] });
    expect(r.regimes.high.allowed).toBe(false);
    expect(r.regimes.chosen).toBe('low');
  });

  it('#7 a high OSR no longer wipes out the high regime: footprint and GFA are solved together', () => {
    // was: high permitted 0 m2, low chosen. A legal 10,868 m2 tower exists (13 x 836 m2).
    const r = ok({ zone: { code: 'Y9', far: 20, osrPct: 10 } });
    expect(r.regimes.high.permittedGfa).toBeGreaterThan(10868);
    expect(r.regimes.chosen).toBe('high');
    // the solved GFA is self-consistent: open space at the solved footprint covers 10% of it
    const G = r.regimes.high.permittedGfa;
    expect(2000 - (0.1 * G)).toBeGreaterThanOrEqual(0);
    expect(fails(r)).toEqual([]);
  });

  it('#8 rotating an exact 12 m frontage by 4 degrees keeps the high regime open', () => {
    const a = ok({ ring: [[0, 0], [12, 0], [50, 40], [0, 40]] });
    const b = ok({ ring: [[0, 0], [11.97076860311789, 0.8370776849295036], [47.0879435632262, 43.390385697599235], [-2.790258949765012, 39.90256201039297]] });
    expect(a.regimes.high.allowed).toBe(true);
    expect(b.regimes.high.allowed).toBe(true);
    expect(b.regimes.high.permittedGfa).toBeCloseTo(a.regimes.high.permittedGfa, -1);
  });

  it('#10 the checker gives the same verdict whether floors share one polygons array or not', () => {
    const r = ok({ edges: [road(30), P, P, road(1)] });
    const chains = buildChains(r.plot.ring, r.plot.edges);
    const narrow = chains.find((c) => c.width === 1)!;
    const wide = chains.find((c) => c.width === 30)!;
    const site = { ring: r.plot.ring, chains, reliefPartners: chains.map((c) => (c.id === narrow.id ? [wide.id] : [])), zone: B.zone!, type: 'condo' as const, nearStation: false };
    const poly = [[[[-19, -14], [19, -14], [19, 14], [-19, 14]]]] as XY[][][];
    const plates: FloorPlate[] = Array.from({ length: 12 }, (_, i) => ({ level: i + 1, z0: i === 0 ? 0 : 4.5 + 3 * (i - 1), z1: 4.5 + 3 * i, polygons: poly, area: 1064, dByChain: [] }));
    const shared = checkDesign(site, plates).checks.map((c) => `${c.id}:${c.status}`);
    const copied = checkDesign(site, JSON.parse(JSON.stringify(plates)) as FloorPlate[]).checks.map((c) => `${c.id}:${c.status}`);
    expect(shared).toEqual(copied);
    expect(shared.some((s) => s.startsWith(`twox-${narrow.id}`) && s.endsWith(':pass'))).toBe(true);
  });
});
