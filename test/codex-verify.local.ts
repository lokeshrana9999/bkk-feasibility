// Ad-hoc (not a test): reproduce the Codex review findings one by one.
import { evaluate } from '../src/engine/index.js';
import type { EngineInput, EngineResult, FloorPlate, XY } from '../src/engine/index.js';
import { checkDesign } from '../src/engine/checker.js';
import { buildChains } from '../src/engine/chains.js';

const B: EngineInput = {
  units: 'm', ring: [[0, 0], [50, 0], [50, 40], [0, 40]],
  edges: [{ role: 'road', width: 12, source: 'user' }, { role: 'private', source: 'user' }, { role: 'private', source: 'user' }, { role: 'private', source: 'user' }],
  zone: { code: 'Y9', far: 7, osrPct: 4.5 }, type: 'condo', nearStation: false,
};
const P = { role: 'private', source: 'user' } as const;
const run = (o: Partial<EngineInput>) => {
  const r = evaluate({ ...B, ...o });
  if (!r.ok) return `ERROR ${r.code}: ${r.message}`;
  return r;
};
const ds = (r: EngineResult | string) => (typeof r === 'string' ? r : r.designs.map((d) => `${d.kind} ${d.floors}f ${d.height}m gfa ${d.gfa.toFixed(0)} pass=${d.passes}`).join(' | '));
const row = (r: EngineResult, idPrefix: string) => r.designs.map((d) => d.checks.filter((c) => c.id.startsWith(idPrefix)).map((c) => `${d.kind}:${c.id} need ${c.required} got ${c.actual} ${c.status}`).join('; ')).join(' || ');

// 1 short hotel on 8 m road
{
  const r = run({ type: 'hotel', floorH: { ground: 3, typical: 3 }, zone: { code: 'Y9', far: 1.5, osrPct: 4.5 }, edges: [{ role: 'road', width: 8, source: 'user' }, P, P, P] });
  console.log('#1', ds(r)); if (typeof r !== 'string') console.log('   ', row(r, 'road-'));
}
// 2 third floor below 9 m
{
  const r = run({ ring: [[0, 0], [20, 0], [20, 20], [0, 20]], edges: [P, P, P, P], floorH: { ground: 2.4, typical: 2.4 }, zone: { code: 'Y9', far: 1.8, osrPct: 4.5 } });
  console.log('#2', ds(r)); if (typeof r !== 'string') console.log('   ', row(r, 'private-'));
}
// 3 same road changing width
{
  const r = run({ ring: [[0, 0], [25, 0], [50, 0], [50, 40], [0, 40]], edges: [{ role: 'road', width: 8, name: 'same road', source: 'user' }, { role: 'road', width: 30, name: 'same road', source: 'user' }, P, P, P] });
  if (typeof r !== 'string') console.log('#3 relief rule:', r.rules.find((x) => x.id === 'MR55-46')!.value, '|', ds(r));
}
// 4 width clamp
{
  const r = run({ edges: [{ role: 'road', width: 0.1, source: 'user' }, P, P, P] });
  if (typeof r !== 'string') console.log('#4', r.warnings.map((w) => w.code).join(','), '|', row(r, 'road-'));
}
// 6 gap 50
{
  const r = run({ edges: [{ role: 'road', width: 12, gap: 50, source: 'user' }, P, P, P] });
  if (typeof r !== 'string') console.log('#6 high allowed', r.regimes.high.allowed, 'chosen', r.regimes.chosen, 'permitted', r.regimes.high.permittedGfa.toFixed(0));
}
// 7 far 20 osr 10
{
  const r = run({ zone: { code: 'Y9', far: 20, osrPct: 10 } });
  if (typeof r !== 'string') console.log('#7 high permitted', r.regimes.high.permittedGfa.toFixed(1), 'low', r.regimes.low.permittedGfa.toFixed(1), 'chosen', r.regimes.chosen, '|', r.regimes.high.limitedBy);
}
// 8 rotated 12 m frontage
{
  const a = run({ ring: [[0, 0], [12, 0], [50, 40], [0, 40]] });
  const b = run({ ring: [[0, 0], [11.97076860311789, 0.8370776849295036], [47.0879435632262, 43.390385697599235], [-2.790258949765012, 39.90256201039297]] });
  if (typeof a !== 'string' && typeof b !== 'string') console.log('#8 unrotated high', a.regimes.high.allowed, 'rotated high', b.regimes.high.allowed, 'len', b.chains[0]!.length);
}
// 10 shared polygons in relief check
{
  const r = run({ edges: [{ role: 'road', width: 30, source: 'user' }, P, P, { role: 'road', width: 1, source: 'user' }] }) as EngineResult;
  const chains = buildChains(r.plot.ring, r.plot.edges);
  const narrow = chains.find((c) => c.width === 1)!;
  const wide = chains.find((c) => c.width === 30)!;
  const partners = chains.map((c) => (c.id === narrow.id ? [wide.id] : []));
  const site = { ring: r.plot.ring, chains, reliefPartners: partners, zone: B.zone!, type: 'condo' as const, nearStation: false };
  const poly = [[[[-19, -14], [19, -14], [19, 14], [-19, 14]]]] as XY[][][];
  const plates: FloorPlate[] = Array.from({ length: 12 }, (_, i) => ({ level: i + 1, z0: i === 0 ? 0 : 4.5 + 3 * (i - 1), z1: 4.5 + 3 * i, polygons: poly, area: 1064, dByChain: [] }));
  const shared = checkDesign(site, plates).checks.filter((c) => c.status === 'fail').map((c) => c.id);
  const copied = checkDesign(site, JSON.parse(JSON.stringify(plates))).checks.filter((c) => c.status === 'fail').map((c) => c.id);
  console.log('#10 shared fails', shared.join(','), '| copied fails', copied.join(','));
}
// 11 start vertex
{
  const ring: [number, number][] = [[0, 0], [50, 0], [50, 15], [30, 50], [0, 50]];
  const edges = [{ role: 'road', width: 12, name: 'A', source: 'user' }, P, P, P, { role: 'road', width: 12, name: 'B', source: 'user' }] as EngineInput['edges'];
  const a = run({ ring, edges }) as EngineResult;
  const b = run({ ring: [...ring.slice(1), ring[0]!], edges: [...edges.slice(1), edges[0]!] }) as EngineResult;
  const s = (r: EngineResult) => r.designs.find((d) => d.kind === 'slab')?.gfa.toFixed(1);
  console.log('#11 slab gfa', s(a), 'vs', s(b));
}
// 12 antimeridian
{
  const r = run({ units: 'lonlat', ring: [[179.9999, 13], [-179.9999, 13], [-179.9999, 13.0001], [179.9999, 13.0001]] });
  console.log('#12', typeof r === 'string' ? r : `ok area ${r.plot.area}`);
}
// 9 checker: roof over courtyard
{
  const r = run({ edges: [P, P, P, P] }) as EngineResult;
  const site = { ring: r.plot.ring, chains: buildChains(r.plot.ring, r.plot.edges), reliefPartners: [[]], zone: B.zone!, type: 'condo' as const, nearStation: false };
  const plates = [
    { level: 1, z0: 0, z1: 4.5, area: 456, dByChain: [], polygons: [[[[-23, -18], [23, -18], [23, 18], [-23, 18]], [[-20, -15], [-20, 15], [20, 15], [20, -15]]]] },
    { level: 2, z0: 4.5, z1: 7.5, area: 1656, dByChain: [], polygons: [[[[-23, -18], [23, -18], [23, 18], [-23, 18]]]] },
  ] as unknown as FloorPlate[];
  const { checks, measured } = checkDesign(site, plates);
  console.log('#9 fails', checks.filter((c) => c.status === 'fail').map((c) => c.id).join(',') || 'none', 'open', measured.openSpace);
}
// 13 (80-edge version, timing)
{
  const n = 40;
  const ring = [...Array.from({ length: n }, (_, i) => [3000 * i / (n - 1), 0]), ...Array.from({ length: n }, (_, i) => [3000 * (n - 1 - i) / (n - 1), 60])] as [number, number][];
  const edges = ring.map((_, i) => ({ role: 'road', width: 10 + (i % 10), name: `r${i}`, source: 'user' })) as EngineInput['edges'];
  const t0 = performance.now();
  const r = run({ ring, edges });
  console.log('#13 80 edges ms', (performance.now() - t0).toFixed(0), typeof r === 'string' ? r : 'ok');
}
