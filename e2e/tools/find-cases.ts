// Finds real-map spots for the break-it cases: a corner plot on two roads, a plot straddling the
// ย.9 boundary, a plot outside ย.9, a plot sitting on a road. Prints hashes.
// Run: npx tsx e2e/tools/find-cases.ts
import { readFileSync } from 'node:fs';
import { detectEdges } from '../../src/site/roads';
import { lookupZone } from '../../src/site/zone';
import { makeFrame, toLL, polysOf, bboxOf, type LL } from '../../src/site/geo';
import type { RowFeature, ZonePoly } from '../../src/site/data';

const D = 'public/data/';
const toZones = (fc: any): ZonePoly[] =>
  fc.features.map((f: any) => {
    const polys = polysOf(f.geometry);
    const p = f.properties;
    return { id: p.id, zone: String(p.zone ?? ''), sub: String(p.sub ?? p.zone), subLatin: p.subLatin, far: +p.far, osr: +p.osr, polys, bbox: bboxOf(polys.flatMap((q) => q[0]!)), isY9: true };
  });
const y9 = toZones(JSON.parse(readFileSync(D + 'zones_y9.json', 'utf8')));
const all = toZones(JSON.parse(readFileSync(D + 'zones_all.json', 'utf8'))).filter((z) => !z.zone.startsWith('ย.๙'));
const areas = JSON.parse(readFileSync(D + 'areas.json', 'utf8')).areas as any[];
const a23 = areas.find((a) => a.labelLatin === 'Y9-23');
const rows: RowFeature[] = JSON.parse(readFileSync(D + `row/${a23.id}.json`, 'utf8')).features.map((f: any) => {
  const polys = polysOf(f.geometry);
  const k = String(f.properties.kind ?? 'road');
  return { id: Number(f.id ?? f.properties.id), name: String(f.properties.name ?? ''), kind: k === 'canal' || k === 'rail' ? k : 'road', polys, bbox: bboxOf(polys.flatMap((q) => q[0]!)) };
});
const rect = (c: LL, w: number, h: number): LL[] => {
  const f = makeFrame(c[0], c[1]);
  return [toLL(f, [0, 0]), toLL(f, [w, 0]), toLL(f, [w, h]), toLL(f, [0, h])];
};
const fmt = (r: LL[]) => '#p=' + r.map((p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`).join(';') + '&t=condo';

const [x0, y0, x1, y1] = a23.bbox;
let corner = 0, straddle = 0, onroad = 0;
for (let i = 0; i < 6000 && (corner < 2 || straddle < 2 || onroad < 1); i++) {
  const c: LL = [x0 + ((i * 0.6180339) % 1) * (x1 - x0), y0 + ((i * 0.4142135) % 1) * (y1 - y0)];
  const r = rect(c, 40, 40);
  const z = lookupZone(r, y9);
  if (!z) continue;
  if (z.share > 0.3 && z.share < 0.8 && straddle < 2) {
    const other = lookupZone(r, all);
    straddle++;
    console.log(`STRADDLE y9 share ${z.share.toFixed(2)} ${z.zone.subLatin}; other ${other?.zone.sub} far ${other?.zone.far}\n${fmt(r)}`);
    continue;
  }
  if (z.share < 1) continue;
  const e = detectEdges(r, rows);
  const roads = e.map((x, k) => (x.role === 'road' ? k : -1)).filter((k) => k >= 0);
  if (roads.length === 2 && Math.abs(roads[0]! - roads[1]!) % 2 === 1 && corner < 2 && e.every((x) => !x.gap && x.overlap < 0.5)) {
    corner++;
    console.log(`CORNER roads ${roads.map((k) => `${k}:${e[k]!.label}:${e[k]!.width}m`).join(' ')}\n${fmt(r)}`);
  }
  if (e.some((x) => x.overlap > 8) && onroad < 1) {
    onroad++;
    console.log(`ONROAD ${e.map((x) => `${x.role}/${x.overlap}`).join(' ')}\n${fmt(r)}`);
  }
}
// outside ย.9: a point in Lumphini area / Silom
for (const c of [[100.5415, 13.7305], [100.5300, 13.7240], [100.60, 13.80]] as LL[]) {
  const r = rect(c, 40, 40);
  console.log(`OUTSIDE y9=${!!lookupZone(r, y9)} all=${lookupZone(r, all)?.zone.sub}\n${fmt(r)}`);
}
// duplicate area labels
const lab = new Map<string, number>();
for (const a of areas) lab.set(a.labelLatin, (lab.get(a.labelLatin) ?? 0) + 1);
console.log('DUP LABELS', [...lab].filter(([, n]) => n > 1));
