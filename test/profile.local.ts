// Ad-hoc profiler (not a test): npx tsx test/profile.local.ts
import fc from 'fast-check';
import { evaluate } from '../src/engine/index.js';
import { buildChains } from '../src/engine/chains.js';
import { checkDesign } from '../src/engine/checker.js';
import { engineInput } from './arbitraries.js';

const samples = fc.sample(engineInput, { numRuns: 60, seed: 42 });
const times: { ms: number; i: (typeof samples)[number] }[] = [];
for (const i of samples) {
  const t0 = performance.now();
  evaluate(i);
  times.push({ ms: performance.now() - t0, i });
}
times.sort((a, b) => b.ms - a.ms);
console.log('top', times.slice(0, 5).map((t) => t.ms.toFixed(0)).join(' '), 'median', times[30]!.ms.toFixed(1));
const worst = times[0]!.i;
const r = evaluate(worst);
if (r.ok) {
  console.log('chains', r.chains.map((c) => `${c.role}${c.width ?? ''}:${c.length.toFixed(0)}`).join(' '));
  console.log('plot', r.plot.area.toFixed(0), 'low floors', r.regimes.low.floors, 'high floors', r.regimes.high.floors);
  console.log('plate verts high', r.regimes.high.plates.map((p) => p.polygons.flat().reduce((s, x) => s + x.length, 0)).join(','));
  for (const d of r.designs) {
    const t0 = performance.now();
    checkDesign({ ring: r.plot.ring, chains: buildChains(r.plot.ring, r.plot.edges), reliefPartners: r.chains.map(() => []), zone: worst.zone!, type: worst.type, nearStation: false }, d.plates);
    console.log(d.id, 'floors', d.floors, 'check ms (no relief)', (performance.now() - t0).toFixed(1));
  }
}
