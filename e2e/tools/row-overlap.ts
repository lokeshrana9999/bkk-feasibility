// Share of a plot (from a share-link hash) that lies inside city right-of-way polygons, by grid sampling.
// Run: npx tsx e2e/tools/row-overlap.ts "#p=...&t=condo"
import { readFileSync } from 'node:fs';
import { polysOf, bboxOf, pointInRing, pointInPoly, type LL } from '../../src/site/geo';

const h = new URLSearchParams((process.argv[2] ?? '').replace(/^#/, ''));
const ring = h.get('p')!.split(';').map((s) => s.split(',').map(Number) as LL);
const areas = JSON.parse(readFileSync('public/data/areas.json', 'utf8')).areas as any[];
const bb = bboxOf(ring);
let inside = 0, total = 0;
const hits = new Map<string, number>();
const feats = areas
  .filter((a) => !(a.bbox[2] < bb[0] || a.bbox[0] > bb[2] || a.bbox[3] < bb[1] || a.bbox[1] > bb[3]))
  .flatMap((a) => JSON.parse(readFileSync(`public/data/${a.files.row ?? `row/${a.id}.json`}`, 'utf8')).features);
for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
  const p: LL = [bb[0] + ((i + 0.5) / 60) * (bb[2] - bb[0]), bb[1] + ((j + 0.5) / 60) * (bb[3] - bb[1])];
  if (!pointInRing(p, ring)) continue;
  total++;
  const f = feats.find((f: any) => polysOf(f.geometry).some((q) => pointInPoly(p, q)));
  if (f) { inside++; const k = `${f.properties.kind}:${f.properties.name}`; hits.set(k, (hits.get(k) ?? 0) + 1); }
}
console.log(`share of plot in right-of-way: ${((100 * inside) / total).toFixed(1)}%`, [...hits]);
