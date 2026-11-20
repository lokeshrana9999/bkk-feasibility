// Engine text tidying: edge numbers from 1 (F10), m2 -> m², large numbers with commas (F17).

import { describe, expect, it } from 'vitest';
import { makeTidy } from '../src/ui/labels';
import type { EngineResult } from '../src/engine/types';

const r = { chains: [{ edges: [0] }, { edges: [1, 2] }, { edges: [3] }] } as unknown as EngineResult;
const tidy = makeTidy(r, [
  { name: 'ทางสาธารณประโยชน์ [12727]', label: 'public way' } as never,
]);

describe('makeTidy', () => {
  it('numbers edges from 1 and names chains by their edges', () => {
    expect(tidy('private boundary #0 needs 2.00 m')).toBe('private boundary on edge 1 needs 2.00 m');
    expect(tidy('road X (12 m) #1')).toBe('road X (12 m) on edges 2-3');
  });
  it('formats areas, with or without existing commas', () => {
    expect(tidy('GFA <= 11,041.8 m2')).toBe('GFA <= 11,041.8 m²');
    expect(tidy('FAR 7 x 1793.4 m2')).toBe('FAR 7 x 1,793.4 m²');
    expect(tidy('below 10,000 m2')).toBe('below 10,000 m²');
    expect(tidy('plot is 359997 m2; the limit is 200000 m2')).toBe('plot is 359,997 m²; the limit is 200,000 m²');
  });
  it('replaces road keys by their labels without touching chain ids', () => {
    expect(tidy('road ทางสาธารณประโยชน์ [12727] (6 m) #2')).toBe('road public way (6 m) on edge 4');
  });
});
