// Golden cases. Every expected number below is worked out by hand from the
// articles (rules.ts quotes them), not copied from engine output.
//
// Common facts used throughout (condo, zone ย.9 FAR 7 / OSR 4.5%):
// - Floor tops: ground 4.5 m, then +3.0 m: z1(k) = 4.5 + 3(k - 1) = 1.5 + 3k.
// - Low regime: roof < 23 m (MR 33 art. 1) -> k <= 6.something -> 7 floors, top 22.5 m.
//   A 22.5 m building is > 15 m (ord. art. 55: 2 m clear all round) and > 9 m
//   (MR 55 art. 50(2): 3 m from private boundaries on every floor).
// - High regime (MR 33 art. 4): 6 m from every road and private edge, all floors.
// - Road setback (ord. art. 50 / MR 55 art. 41), from the plot edge with gap 0:
//   W < 10: 6 - W/2; 10 <= W <= 20: W/10; W > 20: 2.
// - 2x rule (ord. art. 49 / MR 55 art. 44): floor top z needs z/2 - W from the edge.
// - Engine margin: every setback is cut S = 7 mm wider than the law (PARAMS.safety), so a
//   rectangle inset by legal distances a and b per side has sides (L - a1 - a2 - 2S).
//   The law-only figure is given first in each comment.
import { describe, expect, it } from 'vitest';
import { PARAMS, roadSetback } from '../src/engine/rules.js';
import { RECT, input, level, ok, priv, road } from './helpers.js';

const S = PARAMS.safety;
/** Area of a w x h rectangle whose four sides each moved in by the margin S. */
const rs = (w: number, h: number) => (w - 2 * S) * (h - 2 * S);

const allPass = (r: ReturnType<typeof ok>) => {
  for (const d of r.designs) {
    const fails = d.checks.filter((c) => c.status === 'fail');
    expect(fails, `${d.name}: ${JSON.stringify(fails)}`).toEqual([]);
    expect(d.passes).toBe(true);
  }
};

describe('G1: 40 x 50 m, 12 m road on the long side, condo', () => {
  const r = ok(input(RECT, [road(12), priv(), priv(), priv()]));

  it('opens the high regime (12 m road >= 10 m, 50 m frontage >= 12 m) and chooses it', () => {
    expect(r.plot.area).toBeCloseTo(2000, 6);
    expect(r.regimes.high.allowed).toBe(true);
    expect(r.regimes.chosen).toBe('high');
  });

  it('high plates: 28 x 38 = 1,064 m2 while the 6 m rule binds (z <= 36 m)', () => {
    // road needs max(6, 12/10 = 1.2, 2, z/2 - 12); z/2 - 12 > 6 only when z > 36.
    // depth (north-south) 40 - 6 - 6 = 28, width 50 - 6 - 6 = 38.
    const h = r.regimes.high.plates;
    for (let k = 1; k <= 11; k++) expect(level(h, k).area).toBeCloseTo(rs(28, 38), 6); // z1(11) = 34.5
    // k = 12: z1 = 37.5 -> road 37.5/2 - 12 = 6.75 -> depth 40 - 6 - 6.75 = 27.25 -> 27.25 x 38 = 1,035.5
    expect(level(h, 12).area).toBeCloseTo(rs(27.25, 38), 6);
    // k = 20: z1 = 61.5 -> 18.75 -> depth 15.25 -> 579.5
    expect(level(h, 20).area).toBeCloseTo(rs(15.25, 38), 6);
    // the floor table reports the legal distance, not the margin
    expect(level(h, 12).dByChain[0]).toBeCloseTo(6.75, 9);
  });

  it('high envelope ends at floor 29 and sums to 21,622 m2', () => {
    // depth(k) = 40 - 6 - (z1/2 - 12) = 46 - (0.75 + 1.5k) = 45.25 - 1.5k for k >= 12.
    // k = 29: depth 1.75 (>= 1.5 m sliver width), area 66.5; k = 30: depth 0.25 -> removed.
    // GFA = 11 x 1064 + 38 x sum_{k=12..29}(45.25 - 1.5k)
    //     = 11,704 + 38 x (18 x 45.25 - 1.5 x 369) = 11,704 + 38 x 261 = 21,622.
    // with the margin: depth 45.25 - 1.5k - 2S (k = 29: 1.736 m, still >= 1.5)
    let gfa = 11 * rs(28, 38);
    for (let k = 12; k <= 29; k++) gfa += rs(45.25 - 1.5 * k, 38);
    expect(r.regimes.high.floors).toBe(29);
    expect(r.regimes.high.gfa).toBeCloseTo(gfa, 4);
    expect(Math.abs(r.regimes.high.gfa - 21622)).toBeLessThan(60); // law-only figure; margin ~0.2%
  });

  it('permitted GFA = FAR 7 x 2,000 = 14,000 m2 (FAR reached 7.0)', () => {
    expect(r.regimes.high.permittedGfa).toBeCloseTo(14000, 6);
    expect(r.regimes.high.farReached).toBeCloseTo(7, 9);
    expect(r.regimes.high.limitedBy).toContain('art. 16');
  });

  it('low plates: 35 x 44 = 1,540 m2 on all 7 floors', () => {
    // road: max(1.2, 2 clear, z/2 - 12 <= 22.5/2 - 12 < 0) = 2; private 3.
    // depth 40 - 2 - 3 = 35; width 50 - 3 - 3 = 44.
    const l = r.regimes.low;
    expect(l.floors).toBe(7);
    expect(l.height).toBeCloseTo(22.5, 9);
    for (const p of l.plates) expect(p.area).toBeCloseTo(rs(35, 44), 6);
    expect(l.gfa).toBeCloseTo(7 * rs(35, 44), 6); // 10,780 by the law alone
  });

  it('low permitted GFA: footprint capped at 70% of plot = 1,400 m2 -> 7 x 1,400 = 9,800', () => {
    // ord. art. 52(1): open >= 30% of 2,000 -> footprint <= 1,400 (MR 55 art. 33 allows 1,538;
    // zoning OSR at 9,999 m2 allows 2,000 - 450 = 1,550). 7 floors x 1,400 = 9,800 < 9,999 cap.
    expect(r.regimes.low.permittedGfa).toBeCloseTo(9800, 6);
    expect(r.regimes.low.farReached).toBeCloseTo(4.9, 9);
  });

  it('returns at least two designs, all inside FAR 7 and passing the checker', () => {
    expect(r.designs.length).toBeGreaterThanOrEqual(2);
    for (const d of r.designs) expect(d.gfa).toBeLessThanOrEqual(14000 + 1e-6);
    expect(r.designs.some((d) => Math.abs(d.gfa - 14000) < 1)).toBe(true);
    allPass(r);
  });

  it('cites every applying rule with an article and a Thai quote', () => {
    for (const rule of r.rules) {
      expect(rule.article.length).toBeGreaterThan(0);
      expect(rule.quoteTh).toMatch(/[฀-๿]/);
    }
    const ids = r.rules.filter((x) => x.applies).map((x) => x.id);
    for (const id of ['Z16-FAR', 'Z16-OSR', 'ORD50-ROAD', 'ORD49-2X', 'MR33-2', 'MR33-4']) expect(ids).toContain(id);
  });
});

describe('G2: same plot on an 8 m soi', () => {
  const r = ok(input(RECT, [road(8), priv(), priv(), priv()]));

  it('closes the high regime: 8 m < 10 m (MR 33 art. 2)', () => {
    expect(r.regimes.high.allowed).toBe(false);
    expect(r.regimes.high.reason).toContain('art. 2');
    expect(r.regimes.chosen).toBe('low');
  });

  it('7 floors to 22.5 m; road offset max(6 - 4, z/2 - 8): 2 m, then 3.25 m on floor 7', () => {
    // road: 6 - 8/2 = 2 (centreline rule), clear 2, 2x z/2 - 8.
    // floors 1-6 (z1 <= 19.5): z/2 - 8 <= 1.75 -> 2 m -> depth 40 - 2 - 3 = 35 -> 35 x 44 = 1,540
    // floor 7 (z1 = 22.5): 22.5/2 - 8 = 3.25 -> depth 40 - 3.25 - 3 = 33.75 -> 33.75 x 44 = 1,485
    const l = r.regimes.low;
    expect(l.floors).toBe(7);
    for (let k = 1; k <= 6; k++) expect(level(l.plates, k).area).toBeCloseTo(rs(35, 44), 6);
    expect(level(l.plates, 7).area).toBeCloseTo(rs(33.75, 44), 6);
    expect(level(l.plates, 7).dByChain[0]).toBeCloseTo(3.25, 9);
    expect(l.gfa).toBeCloseTo(6 * rs(35, 44) + rs(33.75, 44), 6); // 10,725 by the law alone
  });

  it('private boundaries are 3 m on every floor (MR 55 art. 50(2): building > 9 m)', () => {
    // stricter reading than "2 m to 9 m then 3 m"; see ENGINE-NOTES.md
    for (const p of r.regimes.low.plates) expect(p.dByChain[1]).toBeCloseTo(3, 9);
  });

  it('FAR 7 is unreachable: permitted 9,800 m2 (FAR 4.9) and the designs stay below 23 m and 10,000 m2', () => {
    expect(r.regimes.low.permittedGfa).toBeCloseTo(9800, 6);
    expect(r.warnings.some((w) => w.code === 'far-unreachable')).toBe(true);
    expect(r.designs.length).toBeGreaterThanOrEqual(2);
    for (const d of r.designs) {
      expect(d.height).toBeLessThan(23);
      expect(d.gfa).toBeLessThan(10000);
    }
    allPass(r);
  });
});

describe('G3: corner plot, 30 m road (south, 50 m) and 12 m road (west, 40 m)', () => {
  const edges = [road(30, 'wide'), priv(), priv(), road(12, 'narrow')];
  const r = ok(input(RECT, edges));
  const off = ok(input(RECT, edges, { widerRoadRelief: false }));

  it('pairs the 12 m road with the 30 m road for relief (MR 55 art. 46)', () => {
    const narrow = r.chains.find((c) => c.width === 12)!;
    const wide = r.chains.find((c) => c.width === 30)!;
    expect(r.rules.find((x) => x.id === 'MR55-46')!.applies).toBe(true);
    expect(r.rules.find((x) => x.id === 'MR55-46')!.value).toContain(`#${wide.id}`);
    expect(narrow).toBeDefined();
  });

  it('with relief: 1,064 m2 up to z = 72 m (the wider road 2x: z/2 - 30 > 6)', () => {
    // narrow road 2x (z/2 - 12) lifted: the whole plot is within 40 m < 60 m of the wide road.
    // floors 1..23 (z1(23) = 70.5): 38 x 28 = 1,064.
    const h = r.regimes.high.plates;
    for (let k = 1; k <= 23; k++) expect(level(h, k).area).toBeCloseTo(rs(38, 28), 6);
    // k = 24: z1 = 73.5 -> south 6.75 -> depth 34 - 6.75 = 27.25 -> 27.25 x 38 = 1,035.5
    expect(level(h, 24).area).toBeCloseTo(rs(27.25, 38), 6);
    // last floor: depth 34 - (z1/2 - 30) >= 1.5 -> z1 <= 125 -> k = 41 (z1 124.5, depth 1.75)
    expect(r.regimes.high.floors).toBe(41);
  });

  it('without relief the 12 m road cuts from z > 36 m: floor 12 is 37.25 x 28 = 1,043 m2', () => {
    // z1(12) = 37.5 -> west 37.5/2 - 12 = 6.75 -> width 50 - 6.75 - 6 = 37.25
    expect(level(off.regimes.high.plates, 12).area).toBeCloseTo(rs(37.25, 28), 6);
    expect(level(r.regimes.high.plates, 12).area).toBeCloseTo(rs(38, 28), 6);
  });

  it('low regime: 2 m from both roads (clear space binds), 3 m private: 45 x 35 = 1,575 m2', () => {
    // south: max(2 (W > 20), 2 clear) = 2; west: max(1.2, 2) = 2; 2x for 12 m: 22.5/2 - 12 < 0.
    for (const p of r.regimes.low.plates) expect(p.area).toBeCloseTo(rs(45, 35), 6);
  });

  it('designs pass the checker, including the 2x check beyond 60 m of the wide road', () => {
    expect(r.designs.length).toBeGreaterThanOrEqual(2);
    allPass(r);
  });
});

describe('G4: L-shaped (concave) plot on a 10 m road', () => {
  // (0,0) (40,0) (40,20) (20,20) (20,40) (0,40): 40 x 20 + 20 x 20 = 1,200 m2; road on y = 0.
  const L: [number, number][] = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]];
  const r = ok(input(L, [road(10), priv(), priv(), priv(), priv(), priv()]));

  it('high plates follow the reflex corner with a 6 m round join', () => {
    // inset 6: strip x 6..34, y 6..14 (28 x 8 = 224) + strip x 6..14, y 14..34 (8 x 20 = 160)
    // + the square x 14..20, y 14..20 outside the 6 m circle around the reflex vertex (20, 20):
    //   36 - pi x 36 / 4 = 7.7257. Total 391.7257 m2 (chords add <= ~0.03 m2).
    // With the margin (r = 6 + S): bottom (28 - 2S)(8 - 2S) + left (8 - 2S) x 20 + r^2 (1 - pi/4).
    expect(r.plot.area).toBeCloseTo(1200, 6);
    const h = r.regimes.high.plates;
    const R = 6 + S;
    const corner = R * R * (1 - Math.PI / 4);
    const exact = (28 - 2 * S) * (8 - 2 * S) + (8 - 2 * S) * 20 + corner;
    expect(Math.abs(exact - 391.7257)).toBeLessThan(2); // law-only figure; margin costs ~110 m x S
    for (let k = 1; k <= 10; k++) expect(Math.abs(level(h, k).area - exact)).toBeLessThan(0.1); // z1(10) = 31.5 <= 32
    // k = 11: z1 = 34.5 -> road 34.5/2 - 10 = 7.25 -> bottom strip 28 x (14 - 7.25) = 189
    const f11 = (28 - 2 * S) * (6.75 - 2 * S) + (8 - 2 * S) * 20 + corner;
    expect(Math.abs(level(h, 11).area - f11)).toBeLessThan(0.1);
  });

  it('low plates: 3 m private, 2 m road, 3 m round join at the reflex corner', () => {
    // strip x 3..37, y 2..17 (34 x 15 = 510) + strip x 3..17, y 17..37 (14 x 20 = 280)
    // + 9 - pi x 9 / 4 = 1.9314 -> 791.93 m2 on 7 floors.
    const R = 3 + S;
    const exact = (34 - 2 * S) * (15 - 2 * S) + (14 - 2 * S) * 20 + R * R * (1 - Math.PI / 4);
    for (const p of r.regimes.low.plates) expect(Math.abs(p.area - exact)).toBeLessThan(0.1);
    expect(r.regimes.low.floors).toBe(7);
  });

  it('designs pass the checker', () => {
    expect(r.designs.length).toBeGreaterThanOrEqual(2);
    allPass(r);
  });
});

describe('G5: road widths at the 10 m and 20 m boundaries', () => {
  it('ord. art. 50 values: 9.99 -> 1.005, 10 -> 1.0, 20 -> 2.0, 20.01 -> 2.0', () => {
    // 9.99 < 10: 6 - 9.99/2 = 1.005 (from centreline); 10 and 20 are "10-20": W/10; 20.01 > 20: 2.
    expect(roadSetback(9.99, 0)).toBeCloseTo(1.005, 12);
    expect(roadSetback(10, 0)).toBeCloseTo(1.0, 12);
    expect(roadSetback(20, 0)).toBeCloseTo(2.0, 12);
    expect(roadSetback(20.01, 0)).toBeCloseTo(2.0, 12);
    // a 1 m gap between the plot and the road line comes off the distance
    expect(roadSetback(12, 1)).toBeCloseTo(0.2, 12);
  });

  it('high regime opens at exactly 10 m (MR 33 art. 2: "ไม่น้อยกว่า 10.00 เมตร")', () => {
    const at = (w: number) => ok(input(RECT, [road(w), priv(), priv(), priv()]));
    expect(at(9.99).regimes.high.allowed).toBe(false);
    expect(at(10).regimes.high.allowed).toBe(true);
  });

  it('a 12 m gate frontage is needed: an 11.99 m frontage on a 15 m road keeps the high regime closed', () => {
    // plot 11.99 x 50 with the short side on the road
    const thin: [number, number][] = [[0, 0], [11.99, 0], [11.99, 50], [0, 50]];
    const r = ok(input(thin, [road(15), priv(), priv(), priv()]));
    expect(r.regimes.high.allowed).toBe(false);
    const wide: [number, number][] = [[0, 0], [12, 0], [12, 50], [0, 50]];
    expect(ok(input(wide, [road(15), priv(), priv(), priv()])).regimes.high.allowed).toBe(true);
  });

  it('the rule list shows the per-road value', () => {
    const r = ok(input(RECT, [road(20.01), priv(), priv(), priv()]));
    expect(r.rules.find((x) => x.id === 'ORD50-ROAD')!.value).toContain('2.00 m');
  });
});

describe('G6: 5,000 m2 plot on a 12 m road (30,000 m2 cap)', () => {
  // 100 m frontage x 50 m deep. FAR 7 x 5,000 = 35,000 > 30,000, and the only road is 12 m < 18 m,
  // so MR 33 art. 2 caps GFA at 30,000 -> FAR 6.0.
  // Envelope check: 88 x 38 = 3,344 m2 per floor up to z = 36 m (11 floors = 36,784 >= 30,000).
  // Footprint check: min(70% = 3,500, 5,000/1.3, 5,000 - 0.045 x 30,000 = 3,650) = 3,500 >= 3,344.
  const plot: [number, number][] = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const r = ok(input(plot, [road(12), priv(), priv(), priv()]));

  it('permitted GFA 30,000 m2, FAR reached 6.0, limited by MR 33 art. 2', () => {
    expect(r.plot.area).toBeCloseTo(5000, 6);
    expect(level(r.regimes.high.plates, 1).area).toBeCloseTo(rs(88, 38), 6);
    expect(r.regimes.high.permittedGfa).toBeCloseTo(30000, 6);
    expect(r.regimes.high.farReached).toBeCloseTo(6, 9);
    expect(r.regimes.high.limitedBy).toContain('art. 2');
  });

  it('a design reaches 30,000 m2 and none exceeds it', () => {
    for (const d of r.designs) expect(d.gfa).toBeLessThanOrEqual(30000 + 1e-6);
    expect(r.designs.some((d) => d.gfa > 30000 - 1)).toBe(true);
    allPass(r);
  });

  it('on an 18 m road the cap lifts: FAR 7 x 5,000 = 35,000 m2', () => {
    // 2x binds only above z = 2 x (6 + 18) = 48 m: 15 floors of 3,344 = 50,160 >= 35,000.
    const r18 = ok(input(plot, [road(18), priv(), priv(), priv()]));
    expect(r18.regimes.high.permittedGfa).toBeCloseTo(35000, 6);
    expect(r18.regimes.high.farReached).toBeCloseTo(7, 9);
  });
});
