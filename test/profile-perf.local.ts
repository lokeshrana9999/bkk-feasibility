// Ad-hoc profiler (not a test): the perf-test plot, run repeatedly.
import { evaluate, metresPerDegree } from '../src/engine/index.js';
import type { EdgeInfo, EngineInput } from '../src/engine/index.js';
import { priv, road } from './helpers.js';

const lat0 = 13.7175;
const lon0 = 100.574;
const m = metresPerDegree(lat0);
const ring: [number, number][] = [];
for (let i = 0; i < 20; i++) {
  const a = (i / 20) * 2 * Math.PI;
  const r = 28 + 6 * Math.sin(3 * a) + 3 * Math.cos(5 * a);
  ring.push([lon0 + (r * Math.cos(a)) / m.lon, lat0 + (r * Math.sin(a)) / m.lat]);
}
const edges: EdgeInfo[] = ring.map((_, i) => (i < 3 ? road(12, 'Soi 38') : i < 5 ? road(30, 'Rama IV') : priv()));
const input: EngineInput = { ring, edges, zone: { code: 'y9', far: 7, osrPct: 4.5 }, type: 'condo', nearStation: false };
const r = evaluate(input);
if (r.ok) {
  console.log('area', r.plot.area.toFixed(0), 'low', r.regimes.low.floors, 'high', r.regimes.high.floors, 'designs', r.designs.map((d) => `${d.kind}:${d.floors}`).join(' '));
  console.log('high verts', r.regimes.high.plates.map((p) => p.polygons.flat().reduce((s, x) => s + x.length, 0)).join(','));
}
const t0 = performance.now();
for (let k = 0; k < 20; k++) evaluate(input);
console.log('avg ms', ((performance.now() - t0) / 20).toFixed(1));
