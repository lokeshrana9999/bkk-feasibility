// Prints the engine output for golden case G1: a 40 x 50 m plot, 12 m road on
// one long side, condo, zone ย.9 (FAR 7, OSR 4.5%).
// Run: npx tsx scripts/demo.ts

import { evaluate } from '../src/engine/index.js';
import type { EngineInput, Envelope } from '../src/engine/index.js';

const input: EngineInput = {
  units: 'm',
  ring: [[0, 0], [50, 0], [50, 40], [0, 40]],
  edges: [
    { role: 'road', width: 12, name: 'Soi A', source: 'user' },
    { role: 'private', source: 'user' },
    { role: 'private', source: 'user' },
    { role: 'private', source: 'user' },
  ],
  zone: { code: 'ย.๙-๒๓', far: 7, osrPct: 4.5 },
  type: 'condo',
  nearStation: false,
};

const n = (v: number, d = 1) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const out = evaluate(input);
if (!out.ok) {
  console.error(`error ${out.code}: ${out.message}`);
  process.exit(1);
}

const plotArea = out.plot.area;
console.log(`G1: plot ${n(out.plot.area)} m2, perimeter ${n(out.plot.perimeter)} m, zone ${input.zone!.code}`);
console.log('\nRULES');
for (const r of out.rules) {
  if (!r.applies) continue;
  console.log(`- [${r.kind}] ${r.id} | ${r.article} | ${r.value}`);
}

function table(e: Envelope) {
  console.log(`\n${e.regime.toUpperCase()} REGIME: ${e.allowed ? 'allowed' : `not allowed: ${e.reason}`}`);
  if (!e.allowed) return;
  console.log(' level   z0 (m)   z1 (m)   area (m2)');
  for (const p of e.plates) {
    console.log(`${String(p.level).padStart(6)} ${n(p.z0, 2).padStart(8)} ${n(p.z1, 2).padStart(8)} ${n(p.area, 2).padStart(11)}`);
  }
  console.log(`floors ${e.floors}, height ${n(e.height, 2)} m, envelope GFA ${n(e.gfa)} m2 (stop: ${e.stopReason})`);
  console.log(`permitted GFA ${n(e.permittedGfa)} m2, FAR reached ${n(e.farReached, 2)} of ${input.zone!.far}, limited by ${e.limitedBy}`);
  console.log(`open space at envelope footprint: ${n(e.openSpace)} m2 (${n((100 * e.openSpace) / plotArea)}% of plot)`);
}
table(out.regimes.low);
table(out.regimes.high);
console.log(`\nCHOSEN: ${out.regimes.chosen} regime`);

for (const d of out.designs) {
  console.log(`\nDESIGN ${d.name} (${d.regime}): ${d.floors} floors, ${n(d.height, 2)} m, GFA ${n(d.gfa)} m2, FAR ${n(d.far, 2)}, footprint ${n(d.footprint)} m2, open ${n(d.openSpace)} m2`);
  console.log(`  bound by: ${d.binding}`);
  console.log(`  overall: ${d.passes ? 'PASS' : 'FAIL'}`);
  for (const c of d.checks) {
    console.log(`  ${c.status.padEnd(12)} ${c.label} | need ${c.required} | got ${c.actual}${c.reason ? ` | ${c.reason}` : ''}`);
  }
}
if (out.warnings.length) {
  console.log('\nWARNINGS');
  for (const w of out.warnings) console.log(`- ${w.code}: ${w.message}`);
}
