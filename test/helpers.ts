import { evaluate } from '../src/engine/index.js';
import type { EdgeInfo, EngineInput, EngineResult, FloorPlate } from '../src/engine/index.js';

export const Y9 = { code: 'ย.๙-๒๓', far: 7, osrPct: 4.5 };
export const road = (width: number, name = 'road', gap = 0): EdgeInfo => ({ role: 'road', width, gap, name, source: 'user' });
export const priv = (): EdgeInfo => ({ role: 'private', source: 'user' });

export function input(ring: [number, number][], edges: EdgeInfo[], extra: Partial<EngineInput> = {}): EngineInput {
  return { units: 'm', ring, edges, zone: Y9, type: 'condo', nearStation: false, ...extra };
}

export function ok(i: EngineInput): EngineResult {
  const out = evaluate(i);
  if (!out.ok) throw new Error(`engine error ${out.code}: ${out.message}`);
  return out;
}

export const level = (plates: FloorPlate[], k: number): FloorPlate => {
  const p = plates.find((q) => q.level === k);
  if (!p) throw new Error(`no level ${k}`);
  return p;
};

/** 40 x 50 m plot: x in [0, 50], y in [0, 40]; edge 0 is the south (long) side. */
export const RECT: [number, number][] = [[0, 0], [50, 0], [50, 40], [0, 40]];
