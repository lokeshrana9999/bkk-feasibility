// Open item #11: the slab's main frontage must not depend on where the ring starts or which
// way it runs. Codex case: two 12 m roads of equal length (50 m) on a pentagon; the slab came
// out at 10,769 m2 or 12,433 m2 depending on the start vertex. Tied frontages are now all
// built and the larger slab kept (ties by a coordinate key), so every start and direction agree.
import { describe, expect, it } from 'vitest';
import type { EdgeInfo, EngineResult } from '../src/engine/index.js';
import { input, ok, priv, road } from './helpers.js';

const RING: [number, number][] = [[0, 0], [50, 0], [50, 15], [30, 50], [0, 50]];
const EDGES: EdgeInfo[] = [road(12, 'A'), priv(), priv(), priv(), road(12, 'B')];

/** Ring started at vertex s; edge i still runs from vertex i to vertex i + 1. */
function shift(s: number): { ring: [number, number][]; edges: EdgeInfo[] } {
  const n = RING.length;
  return { ring: RING.map((_, i) => RING[(i + s) % n]!), edges: EDGES.map((_, i) => EDGES[(i + s) % n]!) };
}

/** Same plot traversed the other way: vertex j is old vertex n-1-j, edge j is old edge n-2-j. */
function reversed(r: { ring: [number, number][]; edges: EdgeInfo[] }): { ring: [number, number][]; edges: EdgeInfo[] } {
  const n = r.ring.length;
  return { ring: r.ring.slice().reverse(), edges: r.edges.map((_, j) => r.edges[(2 * n - 2 - j) % n]!) };
}

const summary = (r: EngineResult) => r.designs.map((d) => ({ kind: d.kind, gfa: Math.round(d.gfa * 1000) / 1000, passes: d.passes }));

describe('#11 canonical slab frontage', () => {
  const base = ok(input(RING, EDGES));

  it('keeps the larger of the two tied slabs (12,433 m2, not 10,769 m2)', () => {
    const slab = base.designs.find((d) => d.kind === 'slab')!;
    expect(slab).toBeDefined();
    expect(slab.gfa).toBeGreaterThan(12_400);
    expect(slab.passes).toBe(true);
  });

  // Start vertex 0 forward is the base input itself, so it cannot fail: dropped. Start 0
  // reversed keeps road A before road B in ring order (edges 3, 4) and passed on the engine
  // before the fix (3e2b5be) as well, so it is no evidence for #11 either: it moved to the
  // untagged describe below as a plain traversal-direction check.
  for (let s = 1; s < RING.length; s++) {
    for (const rev of [false, true]) {
      it(`start at vertex ${s}${rev ? ', reversed' : ''}: same design kinds and GFAs`, () => {
        const v = rev ? reversed(shift(s)) : shift(s);
        expect(summary(ok(input(v.ring, v.edges)))).toEqual(summary(base));
      });
    }
  }
});

describe('canonical slab frontage: traversal direction only (road order unchanged, not evidence for the tie-break)', () => {
  it('start at vertex 0, reversed: same design kinds and GFAs', () => {
    const base = ok(input(RING, EDGES));
    const v = reversed(shift(0));
    expect(summary(ok(input(v.ring, v.edges)))).toEqual(summary(base));
  });
});
