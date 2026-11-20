// Place search over the static gazetteer (zones, roads, sois, stations) plus pasted "lat, lng".
// No runtime geocoder: the file is built from OSM at build time and loaded on first focus.

import { useMemo, useRef, useState } from 'react';
import type { LL } from '../site/geo';

interface Entry {
  t: 'zone' | 'road' | 'soi' | 'station';
  name: string;
  en?: string;
  p: LL;
  area: number | null;
  bbox?: [number, number, number, number];
  system?: string;
}

let gaz: Promise<Entry[]> | null = null;
function loadGaz(): Promise<Entry[]> {
  gaz ??= fetch(`${import.meta.env.BASE_URL}data/gazetteer.json`)
    .then((r) => (r.ok ? r.json() : { e: [] }))
    .then((j: { e: Entry[] }) => j.e ?? [])
    .catch(() => []);
  return gaz;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');
const TYPE_LABEL: Record<Entry['t'], string> = { zone: 'zone', road: 'road', soi: 'soi', station: 'station' };

export function Search({ onPick }: { onPick: (p: LL, zoom: number, area: number | null) => void }) {
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    const ll = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (ll) {
      let a = Number(ll[1]);
      let b = Number(ll[2]);
      // accept "lat, lng" (Google Maps order) and "lng, lat"
      if (Math.abs(a) < Math.abs(b)) [a, b] = [b, a];
      return [{ t: 'road' as const, name: `${b.toFixed(6)}, ${a.toFixed(6)}`, en: 'coordinates', p: [a, b] as LL, area: null }];
    }
    if (!entries) return [];
    const n = norm(s);
    const scored: [number, Entry][] = [];
    for (const e of entries) {
      const a = norm(e.name);
      const b = e.en ? norm(e.en) : '';
      let sc = -1;
      if (a === n || b === n) sc = 0;
      else if (a.startsWith(n) || b.startsWith(n)) sc = 1;
      else if (a.includes(n) || b.includes(n)) sc = 2;
      if (sc < 0) continue;
      // places inside a ย.9 area first
      scored.push([sc * 10 + (e.area ? 0 : 5) + (e.t === 'zone' ? -1 : 0), e]);
    }
    scored.sort((x, y) => x[0] - y[0]);
    return scored.slice(0, 8).map((x) => x[1]);
  }, [q, entries]);

  const pick = (e: Entry) => {
    setOpen(false);
    setQ(e.en && e.en !== 'coordinates' ? e.en : e.name);
    onPick(e.p, e.t === 'zone' ? 15.5 : 17, e.area);
  };

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        placeholder="Search a soi, road, station or paste lat, lng"
        value={q}
        onFocus={() => {
          setOpen(true);
          if (!entries) loadGaz().then(setEntries);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((v) => Math.min(v + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setSel((v) => Math.max(v - 1, 0));
          else if (e.key === 'Enter' && results[sel]) pick(results[sel]!);
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim() && (
        <ul className="results">
          {results.length === 0 && <li className="none">{entries ? 'No match' : 'Loading places…'}</li>}
          {results.map((e, i) => (
            <li key={`${e.t}-${e.name}-${i}`} className={i === sel ? 'on' : ''} onMouseDown={(ev) => { ev.preventDefault(); pick(e); }}>
              <span className="rt">{e.en === 'coordinates' ? 'point' : e.system ?? TYPE_LABEL[e.t]}</span>
              <span className="rn">{e.en && e.en !== 'coordinates' ? e.en : e.name}</span>
              {e.en && e.en !== e.name && e.en !== 'coordinates' && <span className="rth">{e.name}</span>}
              {e.area === null && e.en !== 'coordinates' && <span className="rth">outside ย.9</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
