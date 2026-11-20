// Regression tests for the Codex adversarial review (2026-11-19). Each case is the
// reviewer's input; the comment says what used to happen and what the law requires.
import { readFileSync } from 'node:fs';
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

  it('D1 a road 25 cm away (a strip of other land) is not frontage: MR 33 art. 2 and zoning art. 36 need the plot to abut the road (ติด)', () => {
    // was: gap <= 0.5 m counted as touching, so the high regime opened and the office cap was
    // waived. Now only float noise (1 mm) is tolerated.
    const r = ok({ edges: [road(12, { gap: 0.25 }), P, P, P] });
    expect(r.regimes.high.allowed).toBe(false);
    expect(ok({ edges: [road(12, { gap: 0.001 }), P, P, P] }).regimes.high.allowed).toBe(true);
    const office = ok({
      ring: [[0, 0], [100, 0], [100, 50], [0, 50]], edges: [road(16, { gap: 0.5 }), P, road(12, { name: 'Soi' }), P], type: 'office',
    });
    expect(office.regimes.high.caps.some((c) => c.id === 'Z16-OFFICE')).toBe(true);
    for (const d of office.designs) expect(d.gfa).toBeLessThanOrEqual(10000 + 1e-6);
    expect(fails(office)).toEqual([]);
  });

  it('D5 frontage is one straight side: 6 m + 7 m of one road around a 90 degree corner is not a 12 m side (MR 33 art. 2)', () => {
    // was: the chain's edges were summed (13 m), so the high regime opened. "ด้านหนึ่งด้านใด"
    // (one side) is now read as one straight side: edges within 5 degrees of each other.
    const A = road(12, { name: 'A' });
    const bent = ok({ ring: [[0, 6], [0, 0], [7, 0], [50, 0], [50, 40], [0, 40]], edges: [A, A, P, P, P, P] });
    expect(bent.regimes.high.allowed).toBe(false);
    expect(fails(bent)).toEqual([]);
    // a 3 degree kink along the road stays one side (6 m + 6.5 m)
    const k = (3 * Math.PI) / 180;
    const kink = ok({ ring: [[0, 0], [6, 0], [6 + 6.5 * Math.cos(k), 6.5 * Math.sin(k)], [50, 40], [0, 40]], edges: [A, A, P, P, P] });
    expect(kink.regimes.high.allowed).toBe(true);
    // digitising noise (2 cm sawtooth along a straight 12 m side) does not split the side
    const saw: [number, number][] = Array.from({ length: 25 }, (_, i) => [i / 2, i % 2 ? -0.02 : 0]);
    const noisy = ok({ ring: [...saw, [50, 40], [0, 40]], edges: [...saw.slice(0, -1).map(() => A), P, P, P] });
    expect(noisy.regimes.high.allowed).toBe(true);
    expect(fails(noisy)).toEqual([]);
  });

  it('D9 two unnamed road frontages that do not meet are not assumed to be two roads: no relief between them', () => {
    // a 10 m and a 12 m frontage on the south side, separated by 10 m of private boundary. Was:
    // unnamed chains that do not meet were always different roads, so the 10 m road got relief
    // from the 12 m one (possibly the same street changing width). Now only differing names
    // make them two roads (MR 55 arts. 45-46 need "ถนนสาธารณะสองสาย").
    const ring: [number, number][] = [[0, 0], [20, 0], [30, 0], [50, 0], [50, 40], [0, 40]];
    const unnamed = ok({ ring, edges: [road(10), P, road(12), P, P, P] });
    expect(reliefPartners(unnamed.chains, true).every((p) => p.length === 0)).toBe(true);
    expect(unnamed.rules.find((x) => x.id === 'MR55-46')!.applies).toBe(false);
    expect(fails(unnamed)).toEqual([]);
    // one name missing: still not known to be two roads
    expect(reliefPartners(ok({ ring, edges: [road(10, { name: 'A' }), P, road(12), P, P, P] }).chains, true).every((p) => p.length === 0)).toBe(true);
    // two different names: two roads within 60 m, relief applies
    const named = ok({ ring, edges: [road(10, { name: 'A' }), P, road(12, { name: 'B' }), P, P, P] });
    expect(named.rules.find((x) => x.id === 'MR55-46')!.applies).toBe(true);
  });

  it('D4 a hotel with a given room count: over 80 rooms without a 12 m road or station is not permitted (zoning art. 16 (8))', () => {
    // was: no room input; rooms were estimated at 50 m2 GFA, so a 4,000 m2 hotel of 133 small
    // rooms passed. Now the given count decides, as the text counts rooms.
    const hotel = (extra: Partial<EngineInput>) => ok({ type: 'hotel', edges: [road(8), P, P, P], ...extra });
    const banned = hotel({ hotelRooms: 133 });
    expect(banned.regimes.low.permittedGfa).toBe(0);
    expect(banned.regimes.low.limitedBy).toMatch(/133 rooms .*not permitted/);
    expect(banned.designs).toEqual([]);
    expect(banned.warnings.some((w) => w.code === 'use-not-permitted')).toBe(true);
    expect(banned.rules.find((x) => x.id === 'Z16-HOTEL')!.value).toMatch(/not permitted/);
    // the checker fails a hand-made design for it
    const site = { ring: banned.plot.ring, chains: banned.chains, reliefPartners: banned.chains.map(() => []), zone: B.zone!, type: 'hotel' as const, nearStation: false, hotelRooms: 133 };
    const rect: XY[] = [[-20, -10], [20, -10], [20, 10], [-20, 10]];
    const plates: FloorPlate[] = [1, 2].map((k) => ({ level: k, z0: (k - 1) * 3, z1: k * 3, polygons: [[rect]], area: 800, dByChain: [] }));
    expect(checkDesign(site, plates).checks.find((c) => c.id === 'hotel-gate')!.status).toBe('fail');
    expect(checkDesign({ ...site, hotelRooms: 80 }, plates).checks.find((c) => c.id === 'hotel-gate')!.status).toBe('pass');
    // 80 rooms: not banned, and no 4,000 m2 estimate cap
    const small = hotel({ hotelRooms: 80 });
    expect(small.regimes.low.caps.some((c) => c.id === 'Z16-HOTEL')).toBe(false);
    expect(small.regimes.low.permittedGfa).toBeGreaterThan(4000);
    expect(fails(small)).toEqual([]);
    // a station waives the gate
    expect(hotel({ hotelRooms: 133, nearStation: true }).regimes.low.permittedGfa).toBeGreaterThan(0);
    // the count must be a positive whole number
    for (const bad of [0, -3, 2.5, Number.NaN]) expect(evaluate({ ...B, type: 'hotel', hotelRooms: bad }).ok).toBe(false);
  });

  it('D12 a 2 m gap strip owned by someone else: the plot edge keeps the private-boundary distance as well (MR 55 art. 50 / ord. art. 54)', () => {
    // condo below 23 m on a 12 m road, gap 2 m. Was: road setback 1.2 - 2 = 0 and clear space
    // 2 m only. With gapOwner 'private' the edge is another owner's boundary: 3 m (> 9 m tall).
    const pub = ok({ edges: [road(12, { gap: 2 }), P, P, P] });
    const prv = ok({ edges: [road(12, { gap: 2, gapOwner: 'private' }), P, P, P] });
    const low = (r: EngineResult) => r.regimes.low;
    expect(low(pub).height).toBeGreaterThan(9);
    expect(low(pub).plates[0]!.dByChain[0]).toBe(2);
    expect(low(prv).plates[0]!.dByChain[0]).toBe(3);
    expect(low(prv).gfa).toBeLessThan(low(pub).gfa);
    expect(fails(prv)).toEqual([]);
    for (const d of prv.designs) expect(d.checks.find((c) => c.id === 'private-0')!.status).toBe('pass');
    // the default owner is the road (the strip is public reserve), and the input is validated
    expect(ok({ edges: [road(12, { gap: 2, gapOwner: 'road' }), P, P, P] }).regimes.low.gfa).toBe(low(pub).gfa);
    expect(evaluate({ ...B, edges: [road(12, { gap: 2, gapOwner: 'state' as 'road' }), P, P, P] }).ok).toBe(false);
  });

  it('D10 a 2-storey condo within 20 m of a road keeps the road setback: MR 55 counts it as commercial (stricter reading)', () => {
    // 7.5 m, 1,500 m2 condo on an 8 m road. Was: a small dwelling, so only the narrow-road rule
    // (0 m on an 8 m road) applied, and 1 m from the road passed. MR 55 also calls commercial any
    // building within 20 m of a road "which may be used commercially"; not assessable, so the
    // checker applies it: 6 m from the centreline = 2 m from the plot edge.
    const ring = B.ring.map((p) => [p[0] - 25, p[1] - 20] as XY);
    const site = { ring, chains: buildChains(ring, [road(8, { gap: 0 }), P, P, P]), reliefPartners: [[], [], [], []], zone: B.zone!, type: 'condo' as const, nearStation: false };
    const plates = (rect: XY[]): FloorPlate[] => [1, 2].map((k) => ({ level: k, z0: (k - 1) * 3.75, z1: k * 3.75, polygons: [[rect]], area: 750, dByChain: [] }));
    const near = checkDesign(site, plates([[-15, -19], [15, -19], [15, 6], [-15, 6]])).checks.find((c) => c.id === 'road-0')!; // 1 m from the road
    expect(near.required).toBe('>= 2.00 m');
    expect(near.status).toBe('fail');
    // the D10 example: 15 m from the road passes (the setback is met anyway)
    expect(checkDesign(site, plates([[-15, -5], [15, -5], [15, 20], [-15, 20]])).checks.find((c) => c.id === 'road-0')!.status).toBe('pass');
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

  it('nightly M1 (seed -1305305052): a plot and its mirror differ only by the reported sliver opening', () => {
    // 8 m wide plot; a strip narrows slowly through 1.5 m along near-tangent arcs, so the
    // floor-1 sliver opening cuts at a slightly different place in the mirror image.
    const base: EngineInput = {
      ...B,
      ring: [[0, 0], [8, 0], [8, 10], [8, 27.984500000000004], [0, 27.984500000000004], [0, 10]],
      edges: [P, { role: 'canal', width: 4, source: 'user' }, P, road(8, { gap: 0 }), road(8, { gap: 0 }), road(3, { gap: 0.5 })],
      zone: { code: 'Y9', far: 6, osrPct: 4.5 },
    };
    const a = ok(base);
    const b = ok({ ...base, ring: base.ring.map(([x, y]) => [-x, y] as [number, number]) });
    const la = a.regimes.low;
    const lb = b.regimes.low;
    expect(la.floors).toBe(lb.floors);
    const slack = Math.abs(la.sliverArea - lb.sliverArea) * la.floors;
    expect(Math.abs(la.gfa - lb.gfa)).toBeLessThanOrEqual(slack + 0.05);
    expect(fails(a)).toEqual([]);
    expect(fails(b)).toEqual([]);
  });

  it('nightly M1 (seed -134161514): the sliver opening cuts a 0.97 m neck in both mirror images', () => {
    // two-tooth comb; the right tooth joins the body through a 0.97 m neck between two round
    // setback caps. With a miter limit of 4 the dilation re-joined it in one image only.
    const ring: [number, number][] = [[0, 0], [20.014297880739193, 0], [20.014297880739193, 10], [20.014297880739193, 24.07012489363602], [12.014297880739178, 24.07012489363602], [12.014297880739178, 10], [8, 10], [8, 24.07012489363602], [0, 24.07012489363602], [0, 10]];
    const edges = [road(3, { gap: 0 }), P, road(5, { gap: 0.5 }), P, P, road(4, { gap: 0 }), P, P, P, P];
    const a = ok({ ring, edges, zone: { code: 'Y9', far: 6, osrPct: 4.5 } });
    const b = ok({ ring: ring.map(([x, y]) => [-x, y] as [number, number]), edges, zone: { code: 'Y9', far: 6, osrPct: 4.5 } });
    expect(a.regimes.low.plates[0]!.polygons.length).toBe(b.regimes.low.plates[0]!.polygons.length);
    expect(Math.abs(a.regimes.low.gfa - b.regimes.low.gfa)).toBeLessThan(0.5);
    expect(fails(a)).toEqual([]);
    expect(fails(b)).toEqual([]);
  });

  it('D3 office: a 16 m road waives the 10,000 m2 cap only with 16 m of frontage (zoning art. 36(3))', () => {
    // south edge split: the first `front` metres are the 16 m road, the rest private; a 12 m
    // road on the north side opens the high regime (MR 33 art. 2) so the office cap can bind.
    const plot = (front: number) => ok({
      ring: [[0, 0], [front, 0], [100, 0], [100, 50], [0, 50]],
      edges: [road(16, { name: 'Main' }), P, P, road(12, { name: 'Soi' }), P],
      type: 'office', zone: { code: 'Y9', far: 7, osrPct: 4.5 },
    });
    const short = plot(5);
    expect(short.rules.find((x) => x.id === 'Z16-OFFICE')!.value).toBe('<= 10,000 m2');
    expect(short.regimes.high.caps.some((c) => c.id === 'Z16-OFFICE')).toBe(true);
    for (const d of short.designs) expect(d.gfa).toBeLessThanOrEqual(10000 + 1e-6);
    expect(fails(short)).toEqual([]);
    const full = plot(16);
    expect(full.rules.find((x) => x.id === 'Z16-OFFICE')!.value).toMatch(/^waived/);
    expect(full.regimes.high.caps.some((c) => c.id === 'Z16-OFFICE')).toBe(false);
  });

  it('D3 hotel: a 12 m road waives the 80-room cap only with 12 m of frontage (zoning art. 36(2))', () => {
    const plot = (front: number) => ok({
      ring: [[0, 0], [front, 0], [100, 0], [100, 50], [0, 50]],
      edges: [road(12, { name: 'Main' }), P, P, road(10, { name: 'Soi' }), P],
      type: 'hotel', zone: { code: 'Y9', far: 7, osrPct: 4.5 },
    });
    expect(plot(11).rules.find((x) => x.id === 'Z16-HOTEL')!.value).toMatch(/^<= 80 rooms/);
    expect(fails(plot(11))).toEqual([]);
    expect(plot(12).rules.find((x) => x.id === 'Z16-HOTEL')!.value).toMatch(/^waived/);
  });

  it('D6 corner relief needs the plot within 60 m along the narrower road (MR 55 art. 46)', () => {
    // 30 m road on the south (wide), 12 m road on the west (narrow); plot depth along the narrow road varies
    const corner = (depth: number) => ok({
      ring: [[0, 0], [50, 0], [50, depth], [0, depth]],
      edges: [road(30, { name: 'wide' }), P, P, road(12, { name: 'narrow' })],
    });
    expect(corner(40).rules.find((x) => x.id === 'MR55-46')!.applies).toBe(true);
    const long = corner(100);
    expect(long.rules.find((x) => x.id === 'MR55-46')!.applies).toBe(false);
    expect(fails(long)).toEqual([]);
  });

  it('D7 two-road relief needs the plot within 60 m along the wider road (MR 55 art. 45)', () => {
    // 30 m road on the south, 12 m road on the north, 40 m apart; plot length along the wide road varies
    const flank = (len: number) => ok({
      ring: [[0, 0], [len, 0], [len, 40], [0, 40]],
      edges: [road(30, { name: 'A' }), P, road(12, { name: 'B' }), P],
    });
    expect(flank(50).rules.find((x) => x.id === 'MR55-46')!.applies).toBe(true);
    const long = flank(100);
    expect(long.rules.find((x) => x.id === 'MR55-46')!.applies).toBe(false);
    expect(fails(long)).toEqual([]);
  });

  it('nightly M1/M4a (seeds -420666221, -1064604905): design insets agree for a plot and its mirror / split edge', () => {
    // Insets used miter joins (limit 4); on sharp corners they flipped between a spike and a
    // squared tip, so the courtyard hole was 102.5 m2 in one image and 71.9 m2 in the other.
    const cases = JSON.parse(readFileSync(new URL('./fixtures/nightly-inset-cases.json', import.meta.url), 'utf8')) as {
      input: EngineInput; transform: { mirror?: boolean; splitEdge?: number; t?: number };
    }[];
    for (const c of cases) {
      const i = c.input;
      let j: EngineInput;
      if (c.transform.mirror) j = { ...i, ring: i.ring.map(([x, y]) => [-x, y] as [number, number]) };
      else {
        const k = c.transform.splitEdge!;
        const a = i.ring[k]!;
        const b = i.ring[(k + 1) % i.ring.length]!;
        const t = c.transform.t!;
        const m: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        j = { ...i, ring: [...i.ring.slice(0, k + 1), m, ...i.ring.slice(k + 1)], edges: [...i.edges.slice(0, k + 1), i.edges[k]!, ...i.edges.slice(k + 1)] };
      }
      const ra = evaluate(i);
      const rb = evaluate(j);
      if (!ra.ok || !rb.ok) throw new Error('fixture rejected');
      expect(rb.designs.map((d) => d.kind).sort()).toEqual(ra.designs.map((d) => d.kind).sort());
      for (const d of ra.designs) {
        const e = rb.designs.find((x) => x.kind === d.kind)!;
        expect(Math.abs(d.gfa - e.gfa), `${d.kind}`).toBeLessThan(5);
      }
    }
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
