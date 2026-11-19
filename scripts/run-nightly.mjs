// Nightly run (local only): typecheck, then the whole suite with PROP_RUNS=1000 and no
// practical per-test timeout. Cross-platform: `npm run ci:nightly`. Extra arguments go to
// vitest, e.g. `npm run ci:nightly -- test/metamorphic.test.ts`. PROP_RUNS can be overridden.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PROP_RUNS: process.env.PROP_RUNS ?? '1000' };
const steps = [
  { name: 'typecheck', args: [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'] },
  {
    name: `test (PROP_RUNS=${env.PROP_RUNS})`,
    args: [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--testTimeout=3600000', ...process.argv.slice(2)],
  },
];

const results = [];
for (const s of steps) {
  console.log(`\n== ${s.name}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, s.args, { cwd: root, env, stdio: 'inherit' });
  results.push({ step: s.name, ok: r.status === 0, seconds: ((Date.now() - t0) / 1000).toFixed(1) });
}
console.log('\nstep                         result  seconds');
for (const r of results) console.log(`${r.step.padEnd(28)} ${(r.ok ? 'PASS' : 'FAIL').padEnd(7)} ${r.seconds.padStart(7)}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
