// Timing for plots with many road edges (Codex #13), plus a fingerprint of the full output so a
// speed-up can be shown not to change any result.
//   npx tsx scripts/perf-many-roads.ts            timings + fingerprint
//   npx tsx scripts/perf-many-roads.ts --hash-only fingerprint of the random-plot sample only
// The fingerprint hashes JSON.stringify(evaluate(input)) for the timing plots and for a fixed
// fast-check sample of the property-test generator (seed 1305), so two runs on two commits
// print the same hashes exactly when every output is deep-equal.
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { evaluate } from '../src/engine/index.js';
import type { EdgeInfo, EngineInput } from '../src/engine/index.js';
import { engineInput } from '../test/arbitraries.js';

const P: EdgeInfo = { role: 'private', source: 'user' };
const zone = { code: 'Y9', far: 7, osrPct: 4.5 };

/** Codex #13 as reported: a 3,000 x 60 m strip, 80 named road edges of widths 10-19 m. */
function codexStrip(n: number): EngineInput {
  const h = n / 2;
  const ring = [
    ...Array.from({ length: h }, (_, i) => [(3000 * i) / (h - 1), 0]),
    ...Array.from({ length: h }, (_, i) => [(3000 * (h - 1 - i)) / (h - 1), 60]),
  ] as [number, number][];
  const edges = ring.map((_, i): EdgeInfo => ({ role: 'road', width: 10 + (i % 10), name: `r${i}`, source: 'user' }));
  return { units: 'm', ring, edges, zone, type: 'condo', nearStation: false };
}

/**
 * A round plot of radius R (a 56 m circle by default) whose n edges are all roads of widths
 * 4-9 m: narrow roads give large 2x cuts on every floor, and every pair of different roads is
 * within 60 m, so wider-road relief applies between many chains (the slow case).
 */
function roundPlot(n: number, naming: 'distinct' | 'none', R = 28): EngineInput {
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  const edges = ring.map((_, i): EdgeInfo => ({ role: 'road', width: 4 + (i % 6), ...(naming === 'distinct' ? { name: `r${i}` } : {}), source: 'user' }));
  return { units: 'm', ring, edges, zone, type: 'condo', nearStation: false };
}

/** A 50 x 40 m plot: a 12 m road on the south side (high regime open), the north side split into n roads. */
function rectMany(n: number): EngineInput {
  const north = Array.from({ length: n }, (_, i) => [50 - (50 * i) / n, 40] as [number, number]);
  const ring: [number, number][] = [[0, 0], [50, 0], ...north];
  const edges: EdgeInfo[] = [{ role: 'road', width: 12, name: 'south', source: 'user' }, P];
  for (let i = 0; i < n - 1; i++) edges.push({ role: 'road', width: 4 + (i % 6), name: `n${i}`, source: 'user' });
  edges.push(P); // west side, from [50/n, 40]... closes at [0, 0]
  return { units: 'm', ring, edges, zone, type: 'condo', nearStation: false };
}

const CASES: [string, EngineInput, number][] = [
  ['codex strip, 80 road edges', codexStrip(80), 3],
  ['round 56 m, 80 roads 4-9 m (named)', roundPlot(80, 'distinct'), 3],
  ['round 56 m, 80 roads 4-9 m (unnamed)', roundPlot(80, 'none'), 3],
  ['rect, 12 m road + 40 north edges', rectMany(40), 3],
  ['codex strip, 500 road edges', codexStrip(500), 1],
  ['round 56 m, 500 roads 4-9 m (named)', roundPlot(500, 'distinct'), 1],
];

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const hashOnly = process.argv.includes('--hash-only');

if (!hashOnly) {
  console.log('case                                   runs  median ms   min ms  output');
  for (const [name, input, runs] of CASES) {
    const times: number[] = [];
    let out = evaluate(input); // warm-up, also the output
    for (let k = 0; k < runs; k++) {
      const t0 = performance.now();
      out = evaluate(input);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const summary = out.ok
      ? `low ${out.regimes.low.permittedGfa.toFixed(1)} high ${out.regimes.high.permittedGfa.toFixed(1)} designs ${out.designs.length} #${hash(out)}`
      : `error ${out.code}`;
    console.log(`${name.padEnd(38)} ${String(runs).padStart(4)} ${times[Math.floor(times.length / 2)]!.toFixed(0).padStart(10)} ${times[0]!.toFixed(0).padStart(8)}  ${summary}`);
  }
}

// fixed random sample of the property-test generator
const sample = fc.sample(engineInput, { numRuns: 150, seed: 1305 });
const h = createHash('sha256');
let t = 0;
for (const i of sample) {
  const t0 = performance.now();
  const out = evaluate(i);
  t += performance.now() - t0;
  h.update(JSON.stringify(out));
}
console.log(`random sample: ${sample.length} plots, ${t.toFixed(0)} ms total, fingerprint ${h.digest('hex').slice(0, 16)}`);
