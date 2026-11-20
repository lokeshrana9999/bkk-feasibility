// Zone lookup: which city-plan polygons hold the plot. The plot is sampled on a grid; each zone's
// share is the fraction of samples inside it. The majority zone decides the rules (ย.9 or not).

import { bboxHit, bboxOf, pointInPoly, pointInRing, type LL } from './geo';
import type { ZonePoly } from './data';

export interface ZoneHit {
  zone: ZonePoly;
  share: number; // 0..1 of the plot inside this zone polygon
}

/** Up to ~400 sample points inside the ring (grid), plus the vertices if the plot is a sliver. */
export function samplePlot(ring: LL[]): LL[] {
  const bb = bboxOf(ring);
  const n = 20;
  const pts: LL[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p: LL = [bb[0] + ((i + 0.5) / n) * (bb[2] - bb[0]), bb[1] + ((j + 0.5) / n) * (bb[3] - bb[1])];
      if (pointInRing(p, ring)) pts.push(p);
    }
  }
  if (pts.length < 5) pts.push(...ring);
  return pts;
}

/** Share of the plot in each zone, largest first. Shares sum to < 1 where no zone covers it. */
export function zoneShares(ring: LL[], zones: ZonePoly[]): ZoneHit[] {
  const bb = bboxOf(ring);
  const cand = zones.filter((z) => bboxHit(z.bbox, bb));
  if (cand.length === 0) return [];
  const pts = samplePlot(ring);
  const counts = new Map<ZonePoly, number>();
  for (const p of pts) {
    for (const z of cand) {
      if (z.polys.some((q) => pointInPoly(p, q))) {
        counts.set(z, (counts.get(z) ?? 0) + 1);
        break;
      }
    }
  }
  return [...counts].map(([zone, c]) => ({ zone, share: c / pts.length })).sort((a, b) => b.share - a.share);
}

export function lookupZone(ring: LL[], zones: ZonePoly[]): ZoneHit | null {
  return zoneShares(ring, zones)[0] ?? null;
}

export type ZoneState =
  /** The majority of the plot is in a ย.9 zone: evaluate with its rules. */
  | { kind: 'y9'; hit: ZoneHit; others: ZoneHit[] }
  /** The majority is in another zone (named when the city zones are loaded). */
  | { kind: 'outside'; hit: ZoneHit | null; y9Share: number; loading: boolean }
  /** Part of the plot is outside ย.9 and the city zones are not loaded yet: wait. */
  | { kind: 'loading' };

/**
 * Majority zone over all city zones. A plot wholly in ย.9 is decided from the ย.9 zones alone;
 * otherwise the city zones are needed to know whether ย.9 holds the majority.
 */
export function zoneState(ring: LL[], y9: ZonePoly[], all: ZonePoly[] | null): ZoneState {
  const y = zoneShares(ring, y9);
  const yTotal = y.reduce((s, h) => s + h.share, 0);
  if (y.length && yTotal > 0.999) return { kind: 'y9', hit: y[0]!, others: y.slice(1) };
  if (!all) return yTotal === 0 ? { kind: 'outside', hit: null, y9Share: 0, loading: true } : { kind: 'loading' };
  const s = zoneShares(ring, [...y9, ...all]);
  const top = s[0];
  if (top && top.zone.isY9) return { kind: 'y9', hit: top, others: s.slice(1) };
  return { kind: 'outside', hit: top ?? null, y9Share: yTotal, loading: false };
}
