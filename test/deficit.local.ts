// Ad-hoc (not a test): worst amount by which any envelope vertex falls short of
// its required distance, over many random plots. Sets the checker tolerance.
import { writeFileSync } from 'node:fs';
import fc from 'fast-check';
import { evaluate } from '../src/engine/index.js';
import type { XY } from '../src/engine/index.js';
import { pointPolylineDist, polylineDist } from '../src/engine/measure.js';
import { PARAMS, chainDistance } from '../src/engine/rules.js';
import { engineInput } from './arbitraries.js';

const N = Number(process.argv[2] ?? 300);
let worst = 0;
for (const i of fc.sample(engineInput, { numRuns: N, seed: 7 })) {
  const r = evaluate(i);
  if (!r.ok) continue;
  const pr = r.chains.map((n) => r.chains.filter((w) => n.role === 'road' && w.role === 'road' && (w.width ?? 0) > (n.width ?? 0) && polylineDist(n.points, w.points) <= PARAMS.reliefReach).map((w) => w.id));
  for (const env of [r.regimes.low, r.regimes.high]) {
    const done = new Map<unknown, number>();
    for (const p of env.plates) {
      const ctx = { level: p.level, z: p.z1, buildingH: env.height, art50: true, high: env.regime === 'high' };
      for (const c of r.chains) {
        const { base, twoX } = chainDistance(c, ctx);
        for (const v of p.polygons.flatMap((q) => q.flat() as XY[])) {
          const near = pr[c.id]!.some((w) => pointPolylineDist(v, r.chains[w]!.points) <= PARAMS.reliefReach + PARAMS.checkTol);
          const req = near ? base : Math.max(base, twoX);
          const d = pointPolylineDist(v, c.points);
          if (req - d > 0.001 && worst <= 0.001) {
            console.log(JSON.stringify({ regime: env.regime, level: p.level, z1: p.z1, chain: c.id, role: c.role, width: c.width, base, twoX, near, req, d, v, partners: pr[c.id] }));
            writeFileSync(process.argv[3] ?? 'deficit-case.json', JSON.stringify(i));
          }
          worst = Math.max(worst, req - d);
        }
      }
      done.set(p.polygons, 1);
    }
  }
}
console.log(`worst deficit over ${N} plots: ${(worst * 1000).toFixed(3)} mm`);
