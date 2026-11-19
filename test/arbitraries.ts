// fast-check generators: star, comb and rotated-rectangle plots with random edge roles.
import fc from 'fast-check';
import type { BuildingType, EdgeInfo, EngineInput } from '../src/engine/index.js';

type Pt = [number, number];

const star = fc
  .record({
    n: fc.integer({ min: 3, max: 20 }),
    seedAngles: fc.array(fc.double({ min: 0.2, max: 1, noNaN: true }), { minLength: 20, maxLength: 20 }),
    radii: fc.array(fc.double({ min: 12, max: 70, noNaN: true }), { minLength: 20, maxLength: 20 }),
  })
  .map(({ n, seedAngles, radii }) => {
    // cumulative positive steps -> strictly increasing angles, so the star is simple
    const steps = seedAngles.slice(0, n);
    const total = steps.reduce((s, v) => s + v, 0);
    let acc = 0;
    return steps.map((s, i) => {
      const a = (acc / total) * 2 * Math.PI;
      acc += s;
      const r = radii[i]!;
      return [r * Math.cos(a), r * Math.sin(a)] as Pt;
    });
  });

const comb = fc
  .record({
    teeth: fc.integer({ min: 1, max: 4 }),
    toothW: fc.double({ min: 8, max: 20, noNaN: true }),
    gapW: fc.double({ min: 4, max: 15, noNaN: true }),
    base: fc.double({ min: 10, max: 30, noNaN: true }),
    depth: fc.double({ min: 8, max: 30, noNaN: true }),
  })
  .map(({ teeth, toothW, gapW, base, depth }) => {
    const L = teeth * toothW + (teeth - 1) * gapW;
    const pts: Pt[] = [[0, 0], [L, 0], [L, base]];
    // teeth go up from the base, walking right to left
    for (let t = teeth - 1; t >= 0; t--) {
      const x1 = t * (toothW + gapW) + toothW;
      const x0 = t * (toothW + gapW);
      pts.push([x1, base + depth], [x0, base + depth]);
      if (t > 0) pts.push([x0, base], [x0 - gapW, base]);
    }
    pts.push([0, base]);
    // drop consecutive duplicates (the last tooth starts at x = 0)
    return pts.filter((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9;
    });
  });

const rect = fc
  .record({ w: fc.double({ min: 12, max: 120, noNaN: true }), h: fc.double({ min: 12, max: 120, noNaN: true }) })
  .map(({ w, h }) => [[0, 0], [w, 0], [w, h], [0, h]] as Pt[]);

export const plotRing = fc
  .record({
    shape: fc.oneof(star, comb, rect),
    angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    dx: fc.double({ min: -500, max: 500, noNaN: true }),
    dy: fc.double({ min: -500, max: 500, noNaN: true }),
    reverse: fc.boolean(),
  })
  .map(({ shape, angle, dx, dy, reverse }) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = shape.map(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy] as Pt);
    return reverse ? out.reverse() : out;
  });

const edge: fc.Arbitrary<EdgeInfo> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ w: fc.double({ min: 3, max: 40, noNaN: true }), g: fc.constantFrom(0, 0, 0.5, 2) }).map(({ w, g }): EdgeInfo => ({ role: 'road', width: Math.round(w * 2) / 2, gap: g, source: 'user' })) },
  { weight: 6, arbitrary: fc.constant<EdgeInfo>({ role: 'private', source: 'user' }) },
  { weight: 1, arbitrary: fc.double({ min: 4, max: 20, noNaN: true }).map((w): EdgeInfo => ({ role: 'canal', width: Math.round(w), source: 'user' })) },
);

export const engineInput: fc.Arbitrary<EngineInput> = plotRing.chain((ring) =>
  fc.record({
    edges: fc.array(edge, { minLength: ring.length, maxLength: ring.length }),
    type: fc.constantFrom<BuildingType>('condo', 'apartment', 'office', 'hotel'),
    far: fc.constantFrom(6, 7),
    osr: fc.constantFrom(4.5, 5),
    nearStation: fc.boolean(),
  }).map(({ edges, type, far, osr, nearStation }): EngineInput => ({
    units: 'm', ring, edges, type, nearStation, zone: { code: 'ย.9', far, osrPct: osr },
  })),
);
