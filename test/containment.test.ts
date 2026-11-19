// containsPolygons(A, B, tol): A inside B grown by tol. Unit cases for the shapes a vertex-only
// test gets wrong, then a property that cross-checks against clipper2-ts: on a 1 m grid with
// rectilinear shapes, A minus B is either empty or at least 1 m2, so "contained" must equal
// "clipper difference area is 0".
import { FillRule, areaPaths, difference, type Paths64 } from 'clipper2-ts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containmentViolation, containsPolygons, pointInPolygons } from '../src/engine/measure.js';
import type { Polygon, XY } from '../src/engine/index.js';

const TOL = 0.002;
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Clockwise rectangle, for holes. */
const hole = (x0: number, y0: number, x1: number, y1: number): XY[] => rect(x0, y0, x1, y1).reverse();
const kind = (A: Polygon[], B: Polygon[]) => containmentViolation(A, B, TOL)?.kind ?? null;
const allVerticesIn = (A: Polygon[], B: Polygon[]) => A.flat(2).every((v) => pointInPolygons(v as XY, B, TOL));

describe('containsPolygons: unit cases', () => {
  it('nested squares: the small one is inside, the big one is not', () => {
    const big = [[rect(0, 0, 10, 10)]];
    const small = [[rect(2, 2, 8, 8)]];
    expect(containsPolygons(small, big, TOL)).toBe(true);
    expect(containsPolygons(big, small, TOL)).toBe(false);
    expect(kind(big, small)).toBe('vertex');
    expect(containsPolygons(big, big, TOL)).toBe(true);
  });

  it('courtyard roof: a solid floor over a floor with a courtyard is not inside it', () => {
    const below = [[rect(0, 0, 30, 30), hole(10, 10, 20, 20)]];
    const roof = [[rect(0, 0, 30, 30)]];
    expect(allVerticesIn(roof, below)).toBe(true); // what the old vertex test saw
    expect(containsPolygons(roof, below, TOL)).toBe(false);
    expect(kind(roof, below)).toBe('hole');
    // the same courtyard on the upper floor is fine, a larger one too
    expect(containsPolygons([[rect(0, 0, 30, 30), hole(10, 10, 20, 20)]], below, TOL)).toBe(true);
    expect(containsPolygons([[rect(0, 0, 30, 30), hole(8, 8, 22, 22)]], below, TOL)).toBe(true);
    // a smaller courtyard covers part of the one below
    expect(containsPolygons([[rect(0, 0, 30, 30), hole(11, 11, 19, 19)]], below, TOL)).toBe(false);
  });

  it('a floor exactly filling the courtyard below is not inside (all its edges are shared)', () => {
    const below = [[rect(0, 0, 30, 30), hole(10, 10, 20, 20)]];
    expect(containsPolygons([[rect(10, 10, 20, 20)]], below, TOL)).toBe(false);
    expect(kind([[rect(10, 10, 20, 20)]], below)).toBe('hole');
  });

  it('a hole whose corners all sit on the upper floor edges is still caught', () => {
    // diamond courtyard touching the midpoints of the square's sides
    const below = [[rect(0, 0, 30, 30), [[15, 10], [10, 15], [15, 20], [20, 15]] as XY[]]];
    expect(containsPolygons([[rect(10, 10, 20, 20)]], below, TOL)).toBe(false);
  });

  it('a courtyard with an island: the probe finds the open ground, not the island', () => {
    const below = [[rect(0, 0, 30, 30), hole(5, 5, 25, 25)], [rect(10, 10, 20, 20)]];
    expect(containsPolygons([[rect(0, 0, 30, 30)]], below, TOL)).toBe(false);
    expect(containsPolygons([[rect(10, 10, 20, 20)]], below, TOL)).toBe(true);
  });

  it('notch bridge: an edge across the notch of a concave plot leaves it', () => {
    // U-shaped plot, notch x 10..20 from y = 10 up
    const plot = [[[[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]] as XY[]]];
    const bridge = [[rect(2, 20, 28, 25)]];
    expect(allVerticesIn(bridge, plot)).toBe(true);
    expect(containsPolygons(bridge, plot, TOL)).toBe(false);
    const v = containmentViolation(bridge, plot, TOL)!;
    expect(v.kind).toBe('edge');
    expect(v.at[0]).toBeGreaterThan(10);
    expect(v.at[0]).toBeLessThan(20);
    // below the notch it is fine, touching the notch floor too
    expect(containsPolygons([[rect(2, 2, 28, 10)]], plot, TOL)).toBe(true);
  });

  it('an edge bridging the gap between two parts of B leaves it', () => {
    const B = [[rect(0, 0, 10, 10)], [rect(12, 0, 22, 10)]];
    const A = [[rect(5, 2, 17, 8)]];
    expect(allVerticesIn(A, B)).toBe(true);
    expect(containsPolygons(A, B, TOL)).toBe(false);
  });

  it('shared edges: a plate sharing three sides with B is inside', () => {
    expect(containsPolygons([[rect(0, 0, 10, 5)]], [[rect(0, 0, 10, 10)]], TOL)).toBe(true);
    // same, ring started elsewhere and run the other way
    expect(containsPolygons([[[[10, 5], [10, 0], [0, 0], [0, 5]]]], [[rect(0, 0, 10, 10)]], TOL)).toBe(true);
  });

  it('collinear overlap: inside when the overlap is within the B edge, outside when it runs past', () => {
    const B = [[rect(0, 0, 10, 10)]];
    expect(containsPolygons([[rect(2, 0, 8, 5)]], B, TOL)).toBe(true);
    expect(containsPolygons([[rect(5, 0, 15, 5)]], B, TOL)).toBe(false);
    // an A edge along an L-shaped B's boundary through a reflex corner, then out
    const L = [[[[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]] as XY[]]];
    expect(containsPolygons([[rect(0, 0, 20, 10)]], L, TOL)).toBe(true);
    expect(containsPolygons([[rect(0, 5, 20, 15)]], L, TOL)).toBe(false);
    // a diagonal edge into the reflex corner (10, 10), then along B's edge up to (10, 20): inside;
    // start the upward edge 1 m to the right and it leaves, though every corner is in B
    expect(containsPolygons([[[[0, 0], [20, 0], [10, 10], [10, 20], [0, 20]] as XY[]]], L, TOL)).toBe(true);
    const off: Polygon[] = [[[[0, 0], [20, 0], [11, 10], [10, 20], [0, 20]] as XY[]]];
    expect(allVerticesIn(off, L)).toBe(true);
    expect(containsPolygons(off, L, TOL)).toBe(false);
  });

  it('tolerance: 1 mm of overhang is inside at 2 mm, 3 mm is not', () => {
    const B = [[rect(0, 0, 10, 10)]];
    expect(containsPolygons([[rect(2, 2, 10.001, 8)]], B, TOL)).toBe(true);
    expect(containsPolygons([[rect(2, 2, 10.003, 8)]], B, TOL)).toBe(false);
  });

  it('a hole thinner than the tolerance is ignored; a 10 mm one is not', () => {
    const roof = [[rect(0, 0, 30, 30)]];
    expect(containsPolygons(roof, [[rect(0, 0, 30, 30), hole(10, 10, 20, 10.001)]], TOL)).toBe(true);
    expect(containsPolygons(roof, [[rect(0, 0, 30, 30), hole(10, 10, 20, 10.01)]], TOL)).toBe(false);
  });

  it('empty A is inside anything; nothing non-empty is inside empty B', () => {
    expect(containsPolygons([], [[rect(0, 0, 1, 1)]], TOL)).toBe(true);
    expect(containsPolygons([[rect(0, 0, 1, 1)]], [], TOL)).toBe(false);
  });
});

// ---- property: agrees with clipper on rectilinear shapes on a 1 m grid ----

type Shape = Polygon; // one polygon: outer ring (+ holes)

const toPaths = (polys: Polygon[]): Paths64 => polys.flat().map((r) => r.map((p) => ({ x: Math.round(p[0] * 1000), y: Math.round(p[1] * 1000) })));

const rectShape = fc.record({ x: fc.integer({ min: 0, max: 10 }), y: fc.integer({ min: 0, max: 10 }), w: fc.integer({ min: 1, max: 10 }), h: fc.integer({ min: 1, max: 10 }) })
  .map(({ x, y, w, h }): Shape => [rect(x, y, x + w, y + h)]);

const courtyard = fc.record({
  x: fc.integer({ min: 0, max: 8 }), y: fc.integer({ min: 0, max: 8 }), w: fc.integer({ min: 3, max: 12 }), h: fc.integer({ min: 3, max: 12 }),
  a: fc.nat(), b: fc.nat(), c: fc.nat(), d: fc.nat(),
}).map(({ x, y, w, h, a, b, c, d }): Shape => {
  const hx0 = x + 1 + (a % (w - 2));
  const hy0 = y + 1 + (b % (h - 2));
  const hx1 = hx0 + 1 + (c % (x + w - 1 - hx0));
  const hy1 = hy0 + 1 + (d % (y + h - 1 - hy0));
  return [rect(x, y, x + w, y + h), hole(hx0, hy0, hx1, hy1)];
});

/** Comb: n teeth 1 m wide and 1 m apart on a base bar; open side up. */
const comb = fc.record({ x: fc.integer({ min: 0, max: 8 }), y: fc.integer({ min: 0, max: 8 }), n: fc.integer({ min: 1, max: 5 }), base: fc.integer({ min: 1, max: 3 }), tooth: fc.integer({ min: 1, max: 6 }) })
  .map(({ x, y, n, base, tooth }): Shape => {
    const W = 2 * n - 1;
    const top = y + base + tooth;
    const pts: XY[] = [[x, y], [x + W, y]];
    for (let i = n - 1; i >= 0; i--) {
      const xl = x + 2 * i;
      pts.push([xl + 1, top], [xl, top]);
      if (i > 0) pts.push([xl, y + base], [xl - 1, y + base]);
    }
    return [pts];
  });

const anyShape = fc.oneof(rectShape, courtyard, comb);
const reverseRings = (s: Shape): Shape => s.map((r) => r.slice().reverse());
const rotateStart = (s: Shape, k: number): Shape => s.map((r) => r.map((_, i) => r[(i + k) % r.length]!));

describe('containsPolygons: agrees with clipper difference', () => {
  it('A inside B iff area(A - B) = 0, over rectangles, combs and courtyards', () => {
    let inside = 0;
    let outside = 0;
    fc.assert(
      fc.property(
        anyShape,
        // A: a random shape, B's outer ring filled in (the courtyard roof), or B itself
        fc.oneof({ arbitrary: anyShape, weight: 4 }, { arbitrary: fc.constant('fill' as const), weight: 1 }, { arbitrary: fc.constant('same' as const), weight: 1 }),
        anyShape.map((s) => s), // a second shape, unioned into B as a separate polygon when disjoint
        fc.boolean(),
        fc.nat(),
        (b, aSel, b2, rev, k) => {
          const B: Polygon[] = [b];
          const A0: Shape = aSel === 'fill' ? [b[0]!] : aSel === 'same' ? b : aSel;
          const A: Polygon[] = [rotateStart(rev ? reverseRings(A0) : A0, k)];
          // add b2 to B only when it is disjoint from b (keeps B a valid, non-overlapping set)
          const Bp = toPaths(B);
          const b2p = toPaths([b2]);
          const overlap = areaPaths(difference(b2p, difference(b2p, Bp, FillRule.EvenOdd), FillRule.EvenOdd));
          const touch = (() => {
            const [p, q] = [b[0]!, b2[0]!];
            const bx = (r: XY[]) => [Math.min(...r.map((v) => v[0])), Math.min(...r.map((v) => v[1])), Math.max(...r.map((v) => v[0])), Math.max(...r.map((v) => v[1]))];
            const [a0, a1, a2, a3] = bx(p);
            const [c0, c1, c2, c3] = bx(q);
            return !(a2! < c0! || c2! < a0! || a3! < c1! || c3! < a1!);
          })();
          if (overlap === 0 && !touch) B.push(b2);
          const diff = areaPaths(difference(toPaths(A), toPaths(B), FillRule.EvenOdd));
          const got = containsPolygons(A, B, TOL);
          if (got) inside++;
          else outside++;
          expect(got).toBe(diff === 0);
        },
      ),
      { numRuns: Number(process.env.PROP_RUNS ?? 2000), seed: Number(process.env.PROP_SEED ?? 20261119) },
    );
    // the property is not vacuous: both outcomes occur often
    expect(inside).toBeGreaterThan(100);
    expect(outside).toBeGreaterThan(100);
  });
});
