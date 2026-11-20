// Site detection: road edges and widths by ray-casting right-of-way polygons, zone lookup,
// and edge overrides. Geometry is built in local metres and converted to lon/lat.

import { describe, expect, it } from 'vitest';
import { makeFrame, toLL, type LL, type XY } from '../src/site/geo';
import { detectEdges } from '../src/site/roads';
import { lookupZone } from '../src/site/zone';
import { mergeEdges } from '../src/ui/state';
import type { RowFeature, ZonePoly } from '../src/site/data';
import { bboxOf } from '../src/site/geo';

const F = makeFrame(100.58, 13.72);
const ll = (pts: XY[]): LL[] => pts.map((p) => toLL(F, p));
const rot = (p: XY, deg: number): XY => {
  const a = (deg * Math.PI) / 180;
  return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
};

function row(id: number, pts: XY[], kind: RowFeature['kind'] = 'road', name = 'ถนนทดสอบ'): RowFeature {
  const ring = ll(pts);
  return { id, name, kind, polys: [[ring]], bbox: bboxOf(ring) };
}

// plot 40 x 40 m, CCW, south edge first (edge 0 runs west -> east along y = 0)
const plot: XY[] = [[0, 0], [40, 0], [40, 40], [0, 40]];
// road 12 m wide along the south side, 200 m long
const road = (gap = 0, w = 12): XY[] => [[-80, -gap - w], [120, -gap - w], [120, -gap], [-80, -gap]];

describe('detectEdges', () => {
  it('finds the road edge and its width; other edges are neighbours', () => {
    const e = detectEdges(ll(plot), [row(1, road())]);
    expect(e[0]!.role).toBe('road');
    expect(e[0]!.width).toBeCloseTo(12, 0);
    expect(e[0]!.gap).toBe(0);
    expect(e.slice(1).every((x) => x.role === 'private')).toBe(true);
  });

  it('reports a gap between the plot and the road', () => {
    const e = detectEdges(ll(plot), [row(1, road(2))]);
    expect(e[0]!.role).toBe('road');
    expect(e[0]!.gap).toBeCloseTo(2, 0);
    expect(e[0]!.width).toBeCloseTo(12, 0);
  });

  it('a road more than 3 m away is not a road edge', () => {
    const e = detectEdges(ll(plot), [row(1, road(4))]);
    expect(e[0]!.role).toBe('private');
  });

  it('keeps the true width when the plot edge is 20 degrees off the road', () => {
    const p = plot.map((q) => rot(q, 20)).map((q) => [q[0], q[1] + 8] as XY);
    // lowest corner of the rotated plot touches y = 0 ... shift so the plot sits just above the road
    const minY = Math.min(...p.map((q) => q[1]));
    const p2 = p.map((q) => [q[0], q[1] - minY] as XY);
    const e = detectEdges(ll(p2), [row(1, road(0))]);
    const roadEdges = e.filter((x) => x.role === 'road');
    // a rotated square only touches the road at a corner: no edge hits on >= 60% of its length
    expect(roadEdges.length).toBe(0);
    // now an oblique road under a straight plot edge: road rotated by 15 degrees, plot edge parallel
    const r2 = road(0).map((q) => rot(q, 15));
    const p3 = plot.map((q) => rot(q, 15));
    const e3 = detectEdges(ll(p3), [row(1, r2)]);
    expect(e3[0]!.role).toBe('road');
    expect(e3[0]!.width).toBeCloseTo(12, 0);
  });

  it('a plot edge not parallel to the road still measures about the true width', () => {
    // trapezoid whose road edge is parallel, but the road is 12 m; rays at +-15/30 deg pick the minimum
    const trap: XY[] = [[0, 0], [40, 0], [30, 30], [5, 30]];
    const e = detectEdges(ll(trap), [row(1, road())]);
    expect(e[0]!.width).toBeCloseTo(12, 0);
  });

  it('merges a road split into two parcels into one width', () => {
    const a: XY[] = [[-80, -12], [120, -12], [120, -6], [-80, -6]];
    const b: XY[] = [[-80, -6], [120, -6], [120, 0], [-80, 0]];
    const e = detectEdges(ll(plot), [row(1, a), row(2, b)]);
    expect(e[0]!.role).toBe('road');
    expect(e[0]!.width).toBeCloseTo(12, 0);
  });

  it('labels canals as canal edges', () => {
    const e = detectEdges(ll(plot), [row(1, road(0, 8), 'canal', 'คลองทดสอบ')]);
    expect(e[0]!.role).toBe('canal');
    expect(e[0]!.width).toBeCloseTo(8, 0);
  });

  it('detects two roads on a corner plot', () => {
    const west: XY[] = [[-10, -80], [0, -80], [0, 120], [-10, 120]];
    const e = detectEdges(ll(plot), [row(1, road(), 'road', 'ถนนก'), row(2, west, 'road', 'ถนนข')]);
    expect(e[0]!.role).toBe('road');
    expect(e[3]!.role).toBe('road');
    expect(e[3]!.width).toBeCloseTo(10, 0);
    expect(e[0]!.name).not.toBe(e[3]!.name);
  });

  it('handles a plot drawn over the road edge (overlap reported, full width kept)', () => {
    const p = plot.map((q) => [q[0], q[1] - 1.5] as XY);
    const e = detectEdges(ll(p), [row(1, road())]);
    expect(e[0]!.role).toBe('road');
    expect(e[0]!.width).toBeCloseTo(12, 0);
    expect(e[0]!.overlap).toBeCloseTo(1.5, 0);
  });

  it('works for clockwise rings too', () => {
    const cw = [...plot].reverse();
    const e = detectEdges(ll(cw), [row(1, road())]);
    // reversed ring: the south edge is now the edge from [40,0] to [0,0], index 2
    expect(e.filter((x) => x.role === 'road').length).toBe(1);
    expect(e[2]!.role).toBe('road');
  });

  it('gives generic public-way parcels distinct names so the engine keeps them apart', () => {
    const west: XY[] = [[-10, -80], [0, -80], [0, 120], [-10, 120]];
    const e = detectEdges(ll(plot), [row(11, road(), 'road', 'ทางสาธารณประโยชน์'), row(12, west, 'road', 'ทางสาธารณประโยชน์')]);
    expect(e[0]!.name).not.toBe(e[3]!.name);
    expect(e[0]!.label).toBe('public way');
  });
});

describe('lookupZone', () => {
  const zone = (id: number, pts: XY[]): ZonePoly => {
    const ring = ll(pts);
    return { id, zone: 'ย.๙', sub: `z${id}`, subLatin: `Z${id}`, far: 7, osr: 4.5, polys: [[ring]], bbox: bboxOf(ring), isY9: true };
  };
  it('picks the zone holding most of the plot and reports the share', () => {
    const a = zone(1, [[-100, -100], [30, -100], [30, 100], [-100, 100]]);
    const b = zone(2, [[30, -100], [200, -100], [200, 100], [30, 100]]);
    const hit = lookupZone(ll(plot), [a, b])!;
    expect(hit.zone.id).toBe(1);
    expect(hit.share).toBeGreaterThan(0.7);
    expect(hit.share).toBeLessThan(0.8);
  });
  it('returns null outside every zone', () => {
    expect(lookupZone(ll(plot), [zone(1, [[500, 500], [600, 500], [600, 600]])])).toBeNull();
  });
});

describe('mergeEdges', () => {
  const det = detectEdges(ll(plot), [row(1, road())]);
  it('a user width replaces the city width and marks the edge edited', () => {
    const m = mergeEdges(det, { 0: { role: 'road', width: 20 } });
    expect(m[0]!.width).toBe(20);
    expect(m[0]!.source).toBe('user');
    expect(m[0]!.edited).toBe(true);
  });
  it('marking a neighbour edge as a road gives it a default width', () => {
    const m = mergeEdges(det, { 2: { role: 'road' } });
    expect(m[2]!.role).toBe('road');
    expect(m[2]!.width).toBe(6);
  });
  it('turning the road into a neighbour drops width and gap', () => {
    const m = mergeEdges(det, { 0: { role: 'private' } });
    expect(m[0]!.role).toBe('private');
    expect(m[0]!.width).toBeUndefined();
  });
});
