// Engine strings, made readable for the panel: chain ids ("#0") become the edge numbers the
// edge table shows (from 1), road keys become their labels, and "1793.4 m2" becomes
// "1,793.4 m²". Nothing here changes a number, only how it is written.

import type { EngineResult } from '../engine/types';
import type { UiEdge } from './state';

const fmtNum = (s: string) => {
  const v = Number(s);
  if (!Number.isFinite(v)) return s;
  const d = s.includes('.') ? Math.min(2, s.split('.')[1]!.length) : 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

function edgeList(idx: number[]): string {
  const n = [...idx].sort((a, b) => a - b).map((i) => i + 1);
  if (n.length === 0) return '';
  if (n.length === 1) return `edge ${n[0]}`;
  const contiguous = n.every((v, i) => i === 0 || v === n[i - 1]! + 1);
  return contiguous ? `edges ${n[0]}-${n[n.length - 1]}` : `edges ${n.join(', ')}`;
}

export type Tidy = (s: string | undefined) => string;

export function makeTidy(r: EngineResult | null, edges: UiEdge[]): Tidy {
  const names: [string, string][] = [];
  for (const e of edges) if (e.name && e.label && e.name !== e.label) names.push([e.name, e.label]);
  // longest first so a key that contains another is replaced whole
  names.sort((a, b) => b[0].length - a[0].length);
  return (s) => {
    if (!s) return '';
    let out = s;
    for (const [k, v] of names) out = out.split(k).join(v);
    if (r) {
      out = out.replace(/\s#(\d+)\b/g, (m, id: string) => {
        const c = r.chains[Number(id)];
        return c ? ` on ${edgeList(c.edges)}` : m;
      });
    }
    out = out.replace(/(\d+(?:\.\d+)?)\s?m2\b/g, (_, v: string) => `${fmtNum(v)} m²`);
    out = out.replace(/\b(\d{5,})\b/g, (v) => fmtNum(v));
    return out;
  };
}
