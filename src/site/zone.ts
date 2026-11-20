// Zone lookup: which city-plan polygon holds the plot. The plot is sampled on a grid; the zone
// holding most samples wins, and the share it holds is reported so the UI can warn below 95%.

import { bboxHit, bboxOf, pointInPoly, pointInRing, type LL } from './geo';
import type { ZonePoly } from './data';

export interface ZoneHit {
  zone: ZonePoly;
  share: number; // 0..1 of the plot inside this zone polygon
}

/** Up to ~400 sample points inside the ring (grid), plus the vertices pulled slightly inward. */
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

export function lookupZone(ring: LL[], zones: ZonePoly[]): ZoneHit | null {
  const bb = bboxOf(ring);
  const cand = zones.filter((z) => bboxHit(z.bbox, bb));
  if (cand.length === 0) return null;
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
  let best: ZonePoly | null = null;
  let bestN = 0;
  for (const [z, c] of counts) if (c > bestN) [best, bestN] = [z, c];
  return best ? { zone: best, share: bestN / pts.length } : null;
}
