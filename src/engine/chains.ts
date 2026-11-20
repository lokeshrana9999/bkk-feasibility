// Split the plot ring into chains: runs of consecutive edges with the same role
// and (for roads and canals) the same width, gap and name.

import { edgeKey } from './frame.js';
import type { Chain, EdgeInfo, XY } from './types.js';

export function buildChains(ring: XY[], edges: EdgeInfo[]): Chain[] {
  const n = ring.length;
  const keys = edges.map(edgeKey);
  // start at an edge whose predecessor has a different key, so no chain wraps around index 0
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (keys[i] !== keys[(i - 1 + n) % n]) {
      start = i;
      break;
    }
  }
  const len = (i: number) => {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  const make = (id: number, idx: number[], closed: boolean): Chain => {
    const e = edges[idx[0]!]!;
    const points: XY[] = idx.map((i) => ring[i]!);
    points.push(ring[(idx[idx.length - 1]! + 1) % n]!);
    const c: Chain = {
      id,
      role: e.role,
      edges: idx,
      points,
      closed,
      length: idx.reduce((s, i) => s + len(i), 0),
      gap: e.gap ?? 0,
    };
    if (e.width !== undefined) c.width = e.width;
    if (e.gapOwner === 'private' && c.gap > 0) c.gapOwner = 'private';
    if (e.name !== undefined) c.name = e.name;
    return c;
  };
  if (start < 0) {
    // every edge has the same key: one closed chain
    return [make(0, ring.map((_, i) => i), true)];
  }
  const chains: Chain[] = [];
  let cur: number[] = [];
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n;
    if (cur.length > 0 && keys[i] !== keys[cur[0]!]) {
      chains.push(make(chains.length, cur, false));
      cur = [];
    }
    cur.push(i);
  }
  if (cur.length > 0) chains.push(make(chains.length, cur, false));
  return chains;
}

export function chainLabel(c: Chain): string {
  if (c.role === 'private') return `private boundary #${c.id}`;
  const nm = c.name ? ` ${c.name}` : '';
  return `${c.role}${nm} (${c.width} m) #${c.id}`;
}
