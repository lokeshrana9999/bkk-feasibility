// Ad-hoc (not a test): find inputs where two evaluate() runs, or a JSON round trip, differ.
import fc from 'fast-check';
import { evaluate } from '../src/engine/index.js';
import { engineInput } from './arbitraries.js';

function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${String(a)} vs ${String(b)}`;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return `${path}: keys ${ka.join(',')} vs ${kb.join(',')}`;
  for (const k of ka) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

let n = 0;
for (const i of fc.sample(engineInput, { numRuns: 400, seed: Number(process.argv[2] ?? 1) })) {
  const a = evaluate(i);
  const b = evaluate(structuredClone(i));
  const d1 = firstDiff(a, b, 'rerun');
  const d2 = firstDiff(JSON.parse(JSON.stringify(a)), a, 'json');
  if (d1 || d2) {
    console.log(d1 ?? d2);
    if (++n >= 3) break;
  }
}
console.log('done, diffs:', n);
