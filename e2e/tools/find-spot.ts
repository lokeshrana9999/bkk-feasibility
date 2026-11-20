// Finds lon/lat spots for the golden plots on the real map: a 50 x 40 m rectangle inside a
// FAR 7 ย.9 area whose south edge abuts a road right-of-way polygon (G1/G2 by width override)
// or that touches no right-of-way at all. Prints hashes for e2e/accuracy.spec.ts.
// Run: npx tsx e2e/tools/find-spot.ts
import { readFileSync } from 'node:fs';
import { detectEdges } from '../../src/site/roads';
import { preparePlot } from '../../src/site/prep';
import { lookupZone } from '../../src/site/zone';
import { makeFrame, toLL, polysOf, bboxOf, areaM2, type LL } from '../../src/site/geo';
import type { RowFeature, ZonePoly } from '../../src/site/data';

const D = 'public/data/';
const areas = JSON.parse(readFileSync(D + 'areas.json', 'utf8')).areas as { id: number; labelLatin: string; far: number; osr: number; bbox: number[]; labelPoint: LL; files: { row?: string } }[];
const zfc = JSON.parse(readFileSync(D + 'zones_y9.json', 'utf8'));
const zones: ZonePoly[] = zfc.features.map((f: any) => {
  const polys = polysOf(f.geometry);
  return { id: f.properties.id, zone: f.properties.zone, sub: f.properties.sub, subLatin: f.properties.subLatin, far: +f.properties.far, osr: +f.properties.osr, polys, bbox: bboxOf(polys.flatMap((q) => q[0]!)), isY9: true };
});
console.log('areas', areas.map((a) => `${a.id}:${a.labelLatin}:FAR${a.far}`).join(' '));

const target = areas.find((a) => a.labelLatin.endsWith('23')) ?? areas[0]!;
const rfc = JSON.parse(readFileSync(D + (target.files.row ?? `row/${target.id}.json`), 'utf8'));
const rows: RowFeature[] = rfc.features.map((f: any) => {
  const polys = polysOf(f.geometry);
  const k = String(f.properties.kind ?? 'road');
  return { id: Number(f.id ?? f.properties.id), name: String(f.properties.name ?? ''), kind: k === 'canal' || k === 'rail' ? k : 'road', polys, bbox: bboxOf(polys.flatMap((q) => q[0]!)) };
});

function rect(c: LL, w: number, h: number): LL[] {
  const f = makeFrame(c[0], c[1]);
  return [toLL(f, [0, 0]), toLL(f, [w, 0]), toLL(f, [w, h]), toLL(f, [0, h])];
}
const fmt = (r: LL[]) => r.map((p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`).join(';');

const [x0, y0, x1, y1] = target.bbox as [number, number, number, number];
let found = 0;
for (let i = 0; i < 6000 && found < 3; i++) {
  const c: LL = [x0 + ((i * 0.618) % 1) * (x1 - x0), y0 + ((i * 0.381) % 1) * (y1 - y0)];
  // the spot is pasted into helpers.ts at 7 decimals and the ring rebuilt from it: do the same here
  c[0] = Number(c[0].toFixed(7));
  c[1] = Number(c[1].toFixed(7));
  const r = rect(c, 50, 40);
  const z = lookupZone(r, zones);
  if (!z || z.share < 1 || z.zone.far !== 7) continue;
  const e = detectEdges(r, rows);
  // edges clear of any right-of-way, and none crossing the interior (F01: a soi through the plot)
  const p = preparePlot(r, rows);
  // the share link rounds to 7 decimals (~1 cm): keep spots where the rounded plot is 2,000.0 m2,
  // so FAR 7 x area reads exactly 14,000
  const q = r.map((v) => [Number(v[0].toFixed(7)), Number(v[1].toFixed(7))] as LL);
  if (Math.abs(areaM2(q) - 2000) > 0.03) continue;
  if (e.every((x) => x.role === 'private') && p.removed < 0.5 && p.dropped < 0.5 && !p.interiorRow) {
    found++;
    console.log(`EMPTY ${z.zone.subLatin} far ${z.zone.far} osr ${z.zone.osr}\n#p=${fmt(r)}&t=condo`);
  }
}
