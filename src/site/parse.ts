// Pure parsers for the pipeline's static files (no fetch, no import.meta), shared by the web app
// (data.ts) and the MCP server (mcp/data.ts).

import { bboxOf, polysOf } from './geo';
import type { RowFeature, ZonePoly } from './data';

export type FC = { type: 'FeatureCollection'; features: { id?: number | string; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };

export function toZones(fc: FC | null, isY9: boolean): ZonePoly[] {
  if (!fc) return [];
  return fc.features.map((f) => {
    const p = f.properties;
    const polys = polysOf(f.geometry);
    return {
      id: Number(p.id ?? f.id),
      zone: String(p.zone ?? ''),
      sub: String(p.sub ?? p.zone ?? ''),
      subLatin: String(p.subLatin ?? p.sub ?? ''),
      far: Number(p.far),
      osr: Number(p.osr),
      colour: p.colour as string | undefined,
      use: p.use as string | undefined,
      polys,
      bbox: bboxOf(polys.flatMap((q) => q[0]!)),
      isY9,
    };
  });
}

/** City zones outside ย.9 (zones_all.json also holds the ย.9 polygons). */
export const otherZones = (fc: FC): ZonePoly[] => toZones(fc, false).filter((z) => !z.zone.startsWith('ย.๙'));

/** Right-of-way polygons of one area (row/<id>.json). */
export function toRows(fc: FC): RowFeature[] {
  return (fc.features ?? []).map((f) => {
    const polys = polysOf(f.geometry);
    const k = String(f.properties.kind ?? 'road');
    return {
      id: Number(f.id ?? f.properties.id),
      name: String(f.properties.name ?? ''),
      kind: (k === 'canal' || k === 'rail' ? k : 'road') as RowFeature['kind'],
      polys,
      bbox: bboxOf(polys.flatMap((q) => q[0]!)),
    };
  });
}

/** Thai road name reduced to a key that matches across sources ("ซอยนภาศัพท์ 2" ~ "ซอยนภาศัพท์2"). */
export const nameKey = (s: string) => s.replace(/^(ถนน|ซอย|ทาง)/, '').replace(/[\s.()-]+/g, '');

/** English road names (OSM name:en) by Thai name key, from roads/<id>.json. */
export function roadNameMap(fc: FC | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fc?.features ?? []) {
    const th = f.properties.name;
    const en = f.properties.nameEn;
    if (typeof th === 'string' && typeof en === 'string' && en) m.set(nameKey(th), en);
  }
  return m;
}
