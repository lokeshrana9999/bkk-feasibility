// Plot preparation (F01 right-of-way cut, F04 gap snap), zone majority (F03) and the share link
// round trip (F02).

import { describe, expect, it } from 'vitest';
import { areaM2, bboxOf, makeFrame, toLL, type LL, type XY } from '../src/site/geo';
import { detectEdges } from '../src/site/roads';
import { preparePlot } from '../src/site/prep';
import { zoneState } from '../src/site/zone';
import { hashOf, readHash } from '../src/ui/state';
import type { RowFeature, ZonePoly } from '../src/site/data';
import { findSelfIntersection } from '../src/engine/frame';

const F = makeFrame(100.58, 13.72);
const ll = (pts: XY[]): LL[] => pts.map((p) => toLL(F, p));
const row = (id: number, pts: XY[], name = 'ถนนทดสอบ'): RowFeature => {
  const ring = ll(pts);
  return { id, name, kind: 'road', polys: [[ring]], bbox: bboxOf(ring) };
};
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const roadSouth = row(1, rect(-80, -12, 120, 0)); // 12 m road, its north side on y = 0

describe('preparePlot', () => {
  it('leaves a plot clear of the right-of-way untouched', () => {
    const p = preparePlot(ll(rect(0, 5, 40, 45)), [roadSouth]);
    expect(p.removed).toBe(0);
    expect(p.snaps).toEqual([]);
    expect(areaM2(p.ring)).toBeCloseTo(1600, 0);
  });

  it('cuts the part drawn over the road away and the cut edge becomes the road edge (F01)', () => {
    const p = preparePlot(ll(rect(0, -5, 40, 40)), [roadSouth]);
    expect(p.removed).toBeCloseTo(200, 0);
    expect(areaM2(p.ring)).toBeCloseTo(1600, 0);
    const e = detectEdges(p.ring, [roadSouth]);
    const roads = e.filter((x) => x.role === 'road');
    expect(roads.length).toBe(1);
    expect(roads[0]!.gap).toBe(0);
    expect(roads[0]!.width).toBeCloseTo(12, 0);
  });

  it('keeps the largest piece when a road splits the plot', () => {
    const cross = row(2, rect(28, -80, 34, 120)); // 6 m road through the plot
    const p = preparePlot(ll(rect(0, 5, 40, 45)), [roadSouth, cross]);
    expect(areaM2(p.ring)).toBeCloseTo(28 * 40, 0);
    expect(p.dropped).toBeCloseTo(6 * 40, 0);
    expect(p.removed).toBeCloseTo(6 * 40, 0);
  });

  it('snaps a road edge drawn 0.6 m short of the right-of-way onto it (F04)', () => {
    const p = preparePlot(ll(rect(0, 0.6, 40, 40.6)), [roadSouth]);
    expect(p.snaps.length).toBe(1);
    expect(p.snaps[0]!.by).toBeCloseTo(0.6, 1);
    const e = detectEdges(p.ring, [roadSouth]);
    expect(e.find((x) => x.role === 'road')!.gap).toBe(0);
    // the plot grows by the strip up to the road, nothing more, and nothing is reported as removed
    expect(areaM2(p.ring)).toBeCloseTo(40 * 40.6, 0);
    expect(p.removed).toBeLessThan(0.5);
  });

  it('does not snap a 2 m gap (a real setback strip)', () => {
    const p = preparePlot(ll(rect(0, 2, 40, 42)), [roadSouth]);
    expect(p.snaps).toEqual([]);
    expect(detectEdges(p.ring, [roadSouth]).find((x) => x.role === 'road')!.gap).toBeCloseTo(2, 0);
  });

  it('merges repeated corners', () => {
    const r = rect(0, 5, 40, 45);
    const p = preparePlot(ll([r[0]!, r[1]!, r[1]!, r[2]!, r[3]!]), [roadSouth]);
    expect(p.ring.length).toBe(4);
    expect(p.merged).toBe(1);
  });

  it('a plot wholly on the road leaves nothing to build', () => {
    const p = preparePlot(ll(rect(0, -10, 20, -2)), [roadSouth]);
    expect(p.ring.length).toBe(0);
  });
});

describe('preparePlot fuzz: never hands the engine a self-crossing outline', () => {
  it('random plots over and near crossing roads', () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const roads = [roadSouth, row(7, [[-60, 10], [90, 40], [92, 31], [-58, 1]]), row(8, rect(55, -80, 61, 120))];
    for (let k = 0; k < 300; k++) {
      const n = 3 + Math.floor(rnd() * 30);
      const cx = rnd() * 60 - 10;
      const cy = rnd() * 50 - 15;
      const pts: XY[] = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        const rr = 8 + rnd() * 25;
        pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
      const p = preparePlot(ll(pts), roads);
      if (p.ring.length < 3) continue;
      const g = makeFrame(p.ring[0]![0], p.ring[0]![1]);
      const xy = p.ring.map((q) => [(q[0] - g.lon0) * g.kx, (q[1] - g.lat0) * g.ky] as [number, number]);
      expect(findSelfIntersection(xy), `case ${k}`).toBe(-1);
      expect(p.edges.length).toBe(p.ring.length);
    }
  });
});

describe('zoneState (majority over all zones)', () => {
  const zone = (id: number, pts: XY[], y9: boolean, sub = `z${id}`): ZonePoly => {
    const ring = ll(pts);
    return { id, zone: y9 ? 'ย.๙' : 'ย.๑๐', sub, subLatin: sub, far: y9 ? 7 : 8, osr: 4.5, polys: [[ring]], bbox: bboxOf(ring), isY9: y9 };
  };
  const plot = ll(rect(0, 0, 40, 40));
  const y9 = zone(1, rect(-100, -100, 14, 100), true); // 35% of the plot
  const y10 = zone(2, rect(14, -100, 200, 100), false, 'ย.๑๐-๗'); // 65%

  it('waits for the city zones when part of the plot is outside ย.9', () => {
    expect(zoneState(plot, [y9], null).kind).toBe('loading');
  });
  it('names the majority zone when it is not ย.9 (F03)', () => {
    const s = zoneState(plot, [y9], [y10]);
    expect(s.kind).toBe('outside');
    if (s.kind === 'outside') {
      expect(s.hit!.zone.sub).toBe('ย.๑๐-๗');
      expect(s.y9Share).toBeCloseTo(0.35, 1);
    }
  });
  it('a plot wholly in ย.9 needs no city zones', () => {
    const s = zoneState(plot, [zone(3, rect(-100, -100, 200, 100), true)], null);
    expect(s.kind).toBe('y9');
  });
  it('ย.9 majority keeps ย.9 rules and lists the other zone', () => {
    const big = zone(4, rect(-100, -100, 30, 100), true);
    const rest = zone(5, rect(30, -100, 200, 100), false);
    const s = zoneState(plot, [big], [rest]);
    expect(s.kind).toBe('y9');
    if (s.kind === 'y9') expect(s.others[0]!.zone.id).toBe(5);
  });
});

describe('share link (F02)', () => {
  it('round-trips edge edits, station, relief and floor heights', () => {
    const st = {
      ring: [[100.5, 13.7], [100.501, 13.7], [100.501, 13.701]] as LL[],
      type: 'office' as const,
      edges: { 0: { role: 'road' as const, width: 20 }, 2: { role: 'canal' as const, width: 8, gap: 1.5 }, 1: { role: 'private' as const } },
      station: true,
      relief: false,
      floorH: { ground: 4.5, typical: 3.8 },
    };
    const h = readHash(hashOf(st));
    expect(h.bad).toEqual([]);
    expect(h.type).toBe('office');
    expect(h.edges).toEqual(st.edges);
    expect(h.station).toBe(true);
    expect(h.relief).toBe(false);
    expect(h.floorH).toEqual(st.floorH);
    expect(h.ring).toEqual(st.ring);
  });
  it('flags malformed parts and keeps the rest', () => {
    const h = readHash('#p=100.5,13.7;100.501,13.7;100.501,13.701&t=castle&e=0:r999,1:x&fh=1x2&s=maybe');
    expect(h.ring?.length).toBe(3);
    expect(h.type).toBeUndefined();
    expect(h.bad).toEqual(expect.arrayContaining(['building type', 'edge edits', 'floor heights', 'station flag']));
  });
});
