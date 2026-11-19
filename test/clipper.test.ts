// Sanity checks that the pinned clipper2-ts build does what the engine relies on:
// open-path buffers with round ends, differences, and integer-millimetre areas.
import { describe, expect, it } from 'vitest';
import { EndType, FillRule, JoinType, areaPaths, difference, inflatePaths } from 'clipper2-ts';

const MM = 1000;
const rect = (w: number, h: number) => [[
  { x: 0, y: 0 }, { x: w * MM, y: 0 }, { x: w * MM, y: h * MM }, { x: 0, y: h * MM },
]];

describe('clipper2-ts spike', () => {
  it('buffers an open segment by d on each side with round ends', () => {
    const seg = [[{ x: 0, y: 0 }, { x: 10 * MM, y: 0 }]];
    const buf = inflatePaths(seg, 2 * MM, JoinType.Round, EndType.Round, 2, 5);
    // stadium: 10 x 4 rectangle + circle r = 2
    const expected = 10 * 4 + Math.PI * 4;
    expect(Math.abs(areaPaths(buf)) / MM / MM).toBeCloseTo(expected, 1);
  });

  it('plot minus a 6 m strip along one side gives the exact rectangle', () => {
    const plot = rect(50, 40);
    const road = [[{ x: 0, y: 0 }, { x: 50 * MM, y: 0 }]];
    const buf = inflatePaths(road, 6 * MM, JoinType.Round, EndType.Round, 2, 5);
    const out = difference(plot, buf, FillRule.NonZero);
    expect(areaPaths(out) / MM / MM).toBeCloseTo(50 * 34, 6);
  });

  it('negative polygon offset (erosion) with miter keeps rectangles exact', () => {
    const plot = rect(50, 40);
    const inset = inflatePaths(plot, -6 * MM, JoinType.Miter, EndType.Polygon, 4, 5);
    expect(areaPaths(inset) / MM / MM).toBeCloseTo(38 * 28, 6);
  });
});
