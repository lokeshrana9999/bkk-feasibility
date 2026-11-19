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
