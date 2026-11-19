// Done criterion: evaluate() p95 < 30 ms for a 20-vertex plot.
// Plots: 20-vertex irregular polygons in Bangkok lon/lat (about 2,500 m2).
// - typical: one 12 m soi along three edges, the rest private (the criterion)
// - corner: a 12 m soi along three edges and a 30 m road along two, so the
//   wider-road relief and two 2x fronts run on every floor (regression guard)
import { describe, expect, it } from 'vitest';
import { evaluate, metresPerDegree } from '../src/engine/index.js';
import type { EdgeInfo, EngineInput } from '../src/engine/index.js';
import { priv, road } from './helpers.js';

function plot20(corner: boolean): EngineInput {
  const lat0 = 13.7175;
  const lon0 = 100.574;
  const m = metresPerDegree(lat0);
  const ring: [number, number][] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * 2 * Math.PI;
    const r = 28 + 6 * Math.sin(3 * a) + 3 * Math.cos(5 * a);
    ring.push([lon0 + (r * Math.cos(a)) / m.lon, lat0 + (r * Math.sin(a)) / m.lat]);
  }
  const edges: EdgeInfo[] = ring.map((_, i) => (i < 3 ? road(12, 'Soi 38') : corner && i < 5 ? road(30, 'Rama IV') : priv()));
  return { ring, edges, zone: { code: 'ย.๙-๒๓', far: 7, osrPct: 4.5 }, type: 'condo', nearStation: false };
}

function timings(input: EngineInput, runs: number): { median: number; p95: number } {
  for (let i = 0; i < 10; i++) evaluate(input); // warm-up (JIT)
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    evaluate(input);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(runs / 2)]!, p95: times[Math.ceil(0.95 * runs) - 1]! };
}

const fmt = (t: { median: number; p95: number }) => `median ${t.median.toFixed(1)} ms, p95 ${t.p95.toFixed(1)} ms`;

describe('performance', () => {
  it('p95 under 30 ms for a 20-vertex plot (one road)', () => {
    const input = plot20(false);
    expect(evaluate(input).ok).toBe(true);
    const t = timings(input, 60);
    console.log(`evaluate() 20-vertex plot, one road: ${fmt(t)}`);
    expect(t.p95).toBeLessThan(30);
  });

  it('20-vertex corner plot (two roads, relief) stays under 45 ms p95', () => {
    const input = plot20(true);
    expect(evaluate(input).ok).toBe(true);
    const t = timings(input, 60);
    console.log(`evaluate() 20-vertex corner plot: ${fmt(t)}`);
    expect(t.p95).toBeLessThan(45);
  });

  it('G1 (4 vertices) for scale', () => {
    const g1: EngineInput = {
      units: 'm', ring: [[0, 0], [50, 0], [50, 40], [0, 40]], edges: [road(12), priv(), priv(), priv()],
      zone: { code: 'ย.๙-๒๓', far: 7, osrPct: 4.5 }, type: 'condo', nearStation: false,
    };
    const t = timings(g1, 60);
    console.log(`evaluate() G1 40 x 50 m: ${fmt(t)}`);
    expect(t.p95).toBeLessThan(30);
  });
});
