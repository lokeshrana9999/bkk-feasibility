// The checker must catch violations on hand-built designs, not just bless the
// engine's own output. Plot: G1 rectangle x 0..50, y 0..40, 12 m road on y = 0.
import { describe, expect, it } from 'vitest';
import { buildChains } from '../src/engine/chains.js';
import { checkDesign, type CheckSite } from '../src/engine/checker.js';
import { floorTop } from '../src/engine/rules.js';
import type { EdgeInfo, FloorPlate, XY } from '../src/engine/index.js';
import { RECT, Y9, priv, road } from './helpers.js';

const H = { ground: 4.5, typical: 3.0 };

function site(edges: EdgeInfo[], reliefPartners?: number[][]): CheckSite {
  const ring = RECT.map((p) => [p[0], p[1]] as XY);
  const chains = buildChains(ring, edges);
  return { ring, chains, reliefPartners: reliefPartners ?? chains.map(() => []), zone: Y9, type: 'condo', nearStation: false };
}

const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function tower(floors: number, ring: (k: number) => XY[]): FloorPlate[] {
  return Array.from({ length: floors }, (_, i) => {
    const k = i + 1;
    const r = ring(k);
    const area = Math.abs((r[1]![0] - r[0]![0]) * (r[2]![1] - r[1]![1]));
    return { level: k, z0: k === 1 ? 0 : floorTop(k - 1, H), z1: floorTop(k, H), polygons: [[r]], area, dByChain: [] };
  });
}

const status = (checks: ReturnType<typeof checkDesign>['checks'], id: string) => checks.find((c) => c.id === id)?.status;

describe('checker', () => {
  const g1 = site([road(12), priv(), priv(), priv()]);

  it('passes a legal high-rise: 28 x 38 plate, 6 m all round, 11 floors to 34.5 m', () => {
    const { checks, measured } = checkDesign(g1, tower(11, () => rect(6, 6, 44, 34)));
    expect(measured.gfa).toBeCloseTo(11 * 1064, 6);
    expect(measured.high).toBe(true);
    expect(checks.filter((c) => c.status === 'fail')).toEqual([]);
    // checks it cannot compute are never shown as passing
    expect(status(checks, 'permeable')).toBe('not-assessed');
    expect(status(checks, 'mr33-3')).toBe('not-assessed');
  });

  it('fails MR 33 art. 4 when a high-rise is 5 m from the road', () => {
    const { checks } = checkDesign(g1, tower(11, () => rect(6, 5, 44, 34)));
    expect(status(checks, 'mr33-4-0')).toBe('fail');
  });

  it('fails the private setback when a 16.5 m building is 2 m from a private edge (needs 3 m)', () => {
    // 5 floors x 46 x 35 = 8,050 m2 (< 10,000) and 16.5 m (< 23): not MR 33, so MR 55 art. 50 applies
    const { checks, measured } = checkDesign(g1, tower(5, () => rect(2, 2, 48, 37)));
    expect(measured.high).toBe(false);
    expect(status(checks, 'private-1')).toBe('fail');
    expect(status(checks, 'open-plot')).toBe('fail'); // footprint 1,610 > 1,400 (70% of plot)
  });

  it('treats 7 floors of 1,610 m2 (11,270 m2) as extra-large even below 23 m', () => {
    const { measured, checks } = checkDesign(g1, tower(7, () => rect(2, 2, 48, 37)));
    expect(measured.high).toBe(true);
    expect(status(checks, 'mr33-4-1')).toBe('fail'); // 2 m from a private edge, needs 6 m
  });

  it('fails FAR when GFA exceeds 7 x 2,000', () => {
    // 14 floors x 1,064 = 14,896 > 14,000 (and floor 12+ also breaks the 2x rule)
    const { checks } = checkDesign(g1, tower(14, () => rect(6, 6, 44, 34)));
    expect(status(checks, 'far')).toBe('fail');
  });

  it('fails the 2x rule: floor 12 tops out at 37.5 m but sits 6 m from a 12 m road (needs 6.75 m)', () => {
    const { checks } = checkDesign(g1, tower(12, () => rect(6, 6, 44, 34)));
    expect(status(checks, 'twox-0')).toBe('fail');
    const ok = checkDesign(g1, tower(12, (k) => rect(6, k === 12 ? 6.75 : 6, 44, 34)));
    expect(status(ok.checks, 'twox-0')).toBe('pass');
  });

  it('fails when a floor leaves the plot or overhangs the floor below', () => {
    expect(status(checkDesign(g1, tower(3, () => rect(6, 6, 52, 34))).checks, 'inside-plot')).toBe('fail');
    const overhang = checkDesign(g1, tower(3, (k) => (k === 3 ? rect(6, 6, 44, 34) : rect(8, 6, 44, 34))));
    expect(status(overhang.checks, 'nested')).toBe('fail');
  });

  it('wider-road relief exempts the narrow road 2x within 60 m of the wide road, and only then', () => {
    // corner: 30 m road on y = 0 (chain 0), 12 m road on x = 0 (chain 2). Floor 12 (37.5 m) at
    // 6 m from the 12 m road: needs 6.75 m without relief; exempt with relief (within 40 m of y = 0).
    const edges = [road(30, 'wide'), priv(), priv(), road(12, 'narrow')];
    const plain = site(edges);
    const narrow = plain.chains.find((c) => c.width === 12)!;
    const wide = plain.chains.find((c) => c.width === 30)!;
    const partners = plain.chains.map((c) => (c.id === narrow.id ? [wide.id] : []));
    const plates = tower(12, () => rect(6, 6, 44, 34));
    expect(status(checkDesign(plain, plates).checks, `twox-${narrow.id}`)).toBe('fail');
    expect(status(checkDesign(site(edges, partners), plates).checks, `twox-${narrow.id}`)).toBe('pass');
  });

  it('reports an empty design as failing', () => {
    const { checks } = checkDesign(g1, []);
    expect(checks.some((c) => c.status === 'fail')).toBe(true);
  });
});

const plate = (k: number, polys: XY[][][], area: number): FloorPlate =>
  ({ level: k, z0: k === 1 ? 0 : floorTop(k - 1, H), z1: floorTop(k, H), polygons: polys, area, dByChain: [] });
const row = (checks: ReturnType<typeof checkDesign>['checks'], id: string) => checks.find((c) => c.id === id)!;

describe('checker: containment (open item #9)', () => {
  const g1 = site([road(12), priv(), priv(), priv()]);
  const court = rect(16, 14, 34, 26).reverse(); // courtyard hole, clockwise

  it('fails an upper floor that roofs over the courtyard of the floor below', () => {
    const ground = [[rect(6, 6, 44, 34), court]];
    const roof = [[rect(6, 6, 44, 34)]];
    const bad = checkDesign(g1, [plate(1, ground, 848), plate(2, roof, 1064)]);
    expect(row(bad.checks, 'nested').status).toBe('fail');
    expect(row(bad.checks, 'nested').actual).toContain('covers a courtyard of the floor below');
    expect(row(bad.checks, 'inside-plot').status).toBe('pass');
    // the same courtyard on both floors is nested
    const good = checkDesign(g1, [plate(1, ground, 848), plate(2, [[rect(6, 6, 44, 34), court]], 848)]);
    expect(row(good.checks, 'nested').status).toBe('pass');
    expect(row(good.checks, 'nested').actual).toBe('contained');
  });

  it('fails a floor whose edge bridges the notch of a concave plot', () => {
    // U-shaped plot: notch x 20..30 from y = 15 up to the north edge
    const ring: XY[] = [[0, 0], [50, 0], [50, 40], [30, 40], [30, 15], [20, 15], [20, 40], [0, 40]];
    const u: CheckSite = { ...g1, ring, chains: buildChains(ring, [road(12), priv(), priv(), priv(), priv(), priv(), priv(), priv()]) };
    u.reliefPartners = u.chains.map(() => []);
    const { checks } = checkDesign(u, [plate(1, [[rect(2, 20, 48, 30)]], 460)]);
    expect(row(checks, 'inside-plot').status).toBe('fail');
    expect(row(checks, 'inside-plot').actual).toContain('edge leaves');
    expect(row(checkDesign(u, [plate(1, [[rect(2, 2, 48, 12)]], 460)]).checks, 'inside-plot').status).toBe('pass');
  });
});

describe('checker: strict gates and distances', () => {
  const hotel = (w: number): CheckSite => ({ ...site([road(w), priv(), priv(), priv()]), type: 'hotel' });
  // four floors of 40 m x d on the 40 x 50 plot; 1,000.25 m2 each = 4,001 m2
  const floors = (d: number) => tower(4, () => rect(5, 6, 45, 6 + d));

  it('hotel: 4,001 m2 without a 12 m road fails (80 rooms x 50 m2 = 4,000 m2, the engine cap)', () => {
    const over = checkDesign(hotel(10), floors(1000.25 / 40));
    expect(over.measured.gfa).toBeCloseTo(4001, 6);
    expect(row(over.checks, 'hotel-gate').status).toBe('fail'); // floor(4001 / 50) = 80 passed before
    expect(row(checkDesign(hotel(10), floors(25)).checks, 'hotel-gate').status).toBe('pass'); // exactly 4,000 m2
    expect(row(checkDesign(hotel(12), floors(1000.25 / 40)).checks, 'hotel-gate').status).toBe('pass'); // 12 m road
    expect(row(checkDesign({ ...hotel(10), nearStation: true }, floors(1000.25 / 40)).checks, 'hotel-gate').status).toBe('pass');
  });

  it('a plate 0.5 mm short of a required distance fails', () => {
    const g1 = site([road(12), priv(), priv(), priv()]);
    // high-rise (11 floors, 34.5 m): MR 33 art. 4 needs 6 m from the road (y = 0) and the north boundary (y = 40)
    expect(row(checkDesign(g1, tower(11, () => rect(6, 5.9995, 44, 34))).checks, 'mr33-4-0').status).toBe('fail');
    expect(row(checkDesign(g1, tower(11, () => rect(6, 6, 44, 34.0005))).checks, 'mr33-4-1').status).toBe('fail');
    expect(row(checkDesign(g1, tower(11, () => rect(6, 6, 44, 34))).checks, 'mr33-4-0').status).toBe('pass');
    // low-rise (5 floors of 20 x 20 m, 16.5 m): 3 m from private boundaries (the west edge x = 0)
    const lowPlates = (x0: number) => tower(5, () => rect(x0, 10, x0 + 20, 30));
    expect(row(checkDesign(g1, lowPlates(3)).checks, 'private-1').status).toBe('pass');
    expect(row(checkDesign(g1, lowPlates(2.9995)).checks, 'private-1').status).toBe('fail');
  });
});
