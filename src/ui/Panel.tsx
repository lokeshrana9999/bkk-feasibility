import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BuildingType, CheckRow, Design, EdgeRole, EngineError, EngineResult, Envelope, FloorPlate } from '../engine/types';
import { TYPE_PARAMS } from '../engine/rules';
import type { Area } from '../site/data';
import type { LL } from '../site/geo';
import type { Prepared } from '../site/prep';
import type { ZoneState } from '../site/zone';
import { DEMOS, TYPES, fmt, type EdgeOverride, type UiEdge } from './state';
import { makeTidy, type Tidy } from './labels';
import { Search } from './Search';

export type PlotStatus = 'none' | 'too-large' | 'invalid' | 'loading-zone' | 'outside' | 'loading-roads' | 'no-land' | 'ready';

interface Props {
  areas: Area[];
  ring: LL[] | null;
  status: PlotStatus;
  drawnAreaM2: number;
  buildableAreaM2: number;
  prep: Prepared | null;
  zone: ZoneState | null;
  edges: UiEdge[];
  setOverride: (i: number, o: EdgeOverride | null) => void;
  hoverEdge: number | null;
  setHoverEdge: (i: number | null) => void;
  setHoverFloor: (f: { src: 'env' | 'design'; level: number } | null) => void;
  type: BuildingType;
  setType: (t: BuildingType) => void;
  nearStation: boolean;
  setNearStation: (v: boolean) => void;
  relief: boolean;
  setRelief: (v: boolean) => void;
  floorH: { ground: number; typical: number } | null;
  setFloorH: (v: { ground: number; typical: number } | null) => void;
  result: EngineResult | null;
  engineError: EngineError | null;
  ms: number | null;
  busy: boolean;
  design: number;
  setDesign: (i: number) => void;
  drawing: boolean;
  dataError: string | null;
  linkNotice: string | null;
  roadArea: string | null;
  hasRowData: boolean;
  onDraw: () => void;
  onDemo: (r: LL[]) => void;
  onArea: (a: Area) => void;
  onFit: () => void;
  onSearch: (p: LL, zoom: number, area: number | null) => void;
}

type Tab = 'designs' | 'rules' | 'floors' | 'notes';

/** "Y9-14" appears twice in the city data (two polygons): number the parts. */
function areaLabels(areas: Area[]): Map<number, string> {
  const by = new Map<string, Area[]>();
  for (const a of areas) by.set(a.labelLatin, [...(by.get(a.labelLatin) ?? []), a]);
  const out = new Map<number, string>();
  for (const [lab, list] of by) {
    const sorted = [...list].sort((x, y) => y.areaM2 - x.areaM2);
    sorted.forEach((a, i) => out.set(a.id, list.length > 1 ? `${lab} (part ${i + 1}) · ${a.label}` : `${lab} · ${a.label}`));
  }
  return out;
}

export function Panel(p: Props) {
  const [tab, setTab] = useState<Tab>('designs');
  const r = p.result;
  const chosen = r ? r.regimes[r.regimes.chosen] : null;
  const tidy = useMemo(() => makeTidy(r, p.edges), [r, p.edges]);
  const labels = useMemo(() => areaLabels(p.areas), [p.areas]);
  const zoneHit = p.zone?.kind === 'y9' ? p.zone.hit : null;
  return (
    <aside className="panel">
      <header className="ph">
        <div className="ph-title">
          <span className="logo">ย.9</span>
          <div>
            <h1>Plot feasibility · Bangkok</h1>
            <p>What the law lets you build on a ย.9 plot, and two or more designs that fit.</p>
          </div>
        </div>
      </header>

      {p.dataError && <div className="banner err">{p.dataError}</div>}
      {p.linkNotice && <div className="banner warn">{p.linkNotice}</div>}

      <Section title="Plot">
        <Search onPick={p.onSearch} />
        <div className="row gap">
          <button className="btn primary" onClick={p.onDraw} disabled={p.drawing}>
            {p.drawing ? 'Drawing…' : p.ring ? 'Redraw plot' : 'Draw plot'}
          </button>
          <select className="sel" value="" onChange={(e) => {
            const d = DEMOS.find((x) => x.id === e.target.value);
            if (d) p.onDemo(d.ring);
          }}>
            <option value="">Demo plots…</option>
            {DEMOS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <select className="sel" value="" onChange={(e) => {
            const a = p.areas.find((x) => String(x.id) === e.target.value);
            if (a) p.onArea(a);
          }}>
            <option value="">Go to area…</option>
            {[...p.areas].sort((a, b) => num(a.labelLatin) - num(b.labelLatin) || b.areaM2 - a.areaM2).map((a) => (
              <option key={a.id} value={a.id}>{labels.get(a.id)}</option>
            ))}
          </select>
        </div>
        {p.ring && (
          <div className="plot-facts">
            <Fact k="Plot area" v={`${fmt(p.drawnAreaM2)} m²`} />
            {p.prep && p.status === 'ready' && Math.abs(p.buildableAreaM2 - p.drawnAreaM2) > 0.5 && <Fact k="Buildable" v={`${fmt(p.buildableAreaM2)} m²`} />}
            <Fact k="Corners" v={String(p.ring.length)} />
            {zoneHit ? (
              <Fact k="Zone" v={<span className="zone-chip" title={zoneHit.zone.use}>{zoneHit.zone.sub} · FAR {zoneHit.zone.far} · OSR {zoneHit.zone.osr}%</span>} />
            ) : p.status === 'outside' ? (
              <Fact k="Zone" v="outside ย.9" />
            ) : p.status === 'loading-zone' ? (
              <Fact k="Zone" v="looking up…" />
            ) : null}
            <button className="link" onClick={p.onFit}>Zoom to plot</button>
            <CopyLink />
          </div>
        )}
        {p.status === 'invalid' && <div className="banner err">The outline crosses itself. Drag a corner to untangle it.</div>}
        {p.status === 'too-large' && <div className="banner err">The plot is {fmt(p.drawnAreaM2)} m²; the limit is 200,000 m² (20 ha). Draw a smaller plot.</div>}
        {p.zone?.kind === 'y9' && p.zone.hit.share < 0.95 && <SplitZone hit={p.zone.hit} others={p.zone.others} />}
        {p.status === 'outside' && p.zone?.kind === 'outside' && <Outside z={p.zone} />}
        {p.prep && <PrepNotes prep={p.prep} status={p.status} />}
        <p className="hint">Drag corners to reshape, click a small midpoint to add a corner, right-click a corner to delete it.</p>
      </Section>

      <Section title="Building type">
        <div className="seg">
          {TYPES.map((t) => (
            <button key={t.id} className={p.type === t.id ? 'on' : ''} onClick={() => p.setType(t.id)}>{t.label}</button>
          ))}
        </div>
        <details className="opts" open={p.nearStation || !p.relief || !!p.floorH}>
          <summary>Options</summary>
          <label className="chk"><input type="checkbox" checked={p.nearStation} onChange={(e) => p.setNearStation(e.target.checked)} /> Within 500 m of a BTS/MRT station (waives the office/hotel road-width gates)</label>
          <label className="chk"><input type="checkbox" checked={p.relief} onChange={(e) => p.setRelief(e.target.checked)} /> Apply wider-road relief on corner plots (MR 55 arts. 45-46)</label>
          <div className="row gap">
            <NumField label="Ground floor (m)" value={p.floorH?.ground ?? TYPE_PARAMS[p.type].floorH.ground} min={2.4} max={10}
              onChange={(v) => p.setFloorH({ ground: v, typical: p.floorH?.typical ?? TYPE_PARAMS[p.type].floorH.typical })} />
            <NumField label="Typical floor (m)" value={p.floorH?.typical ?? TYPE_PARAMS[p.type].floorH.typical} min={2.4} max={10}
              onChange={(v) => p.setFloorH({ ground: p.floorH?.ground ?? TYPE_PARAMS[p.type].floorH.ground, typical: v })} />
            {p.floorH && <button className="link" onClick={() => p.setFloorH(null)}>reset</button>}
          </div>
        </details>
      </Section>

      {p.edges.length > 0 && p.status === 'ready' && (
        <Section title="Plot edges" aside={p.hasRowData ? 'roads detected from the city right-of-way map' : 'no city road data here: mark roads by hand'}>
          <EdgeTable edges={p.edges} prep={p.prep} setOverride={p.setOverride} hover={p.hoverEdge} setHover={p.setHoverEdge} />
        </Section>
      )}

      {p.status === 'loading-roads' && (
        <section className="sec summary">
          <div className="sec-h"><h2>Allowed envelope</h2><span className="aside">waiting for road data</span></div>
          <p className="hint">Loading the roads for {p.roadArea ?? 'this area'}; the envelope depends on them.</p>
        </section>
      )}
      {p.status === 'loading-zone' && p.ring && (
        <section className="sec summary">
          <div className="sec-h"><h2>Allowed envelope</h2><span className="aside">checking the zone</span></div>
          <p className="hint">Part of the plot lies outside ย.9; loading the city zone map to see which zone holds most of it.</p>
        </section>
      )}

      {p.engineError && (
        <div className="banner err"><b>Cannot evaluate this plot.</b> {engineMessage(p.engineError, p.buildableAreaM2, tidy)}</div>
      )}

      {r && chosen && (
        <>
          <Summary r={r} env={chosen} ms={p.ms} busy={p.busy} tidy={tidy} edges={p.edges} />
          <nav className="tabs">
            {(['designs', 'rules', 'floors', 'notes'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'designs' ? `Designs (${r.designs.length})` : t === 'rules' ? 'Rules' : t === 'floors' ? 'Floors' : `Notes (${r.warnings.length})`}
              </button>
            ))}
          </nav>
          {tab === 'designs' && <Designs r={r} sel={p.design} setSel={p.setDesign} tidy={tidy} />}
          {tab === 'rules' && <Rules r={r} tidy={tidy} />}
          {tab === 'floors' && <Floors r={r} design={r.designs[p.design]} tidy={tidy} onHover={p.setHoverFloor} />}
          {tab === 'notes' && <Notes r={r} tidy={tidy} />}
        </>
      )}
      <footer className="pf">
        <details className="how">
          <summary>How this works</summary>
          <ol>
            <li><b>Zone.</b> The plot is matched to the BMA comprehensive plan 2556 (all 607 zones); the zone holding most of it decides the rules. Each ย.9 polygon carries its own FAR and open-space ratio (ย.๙-๔ is FAR 6).</li>
            <li><b>Site.</b> Roads and canals come from the public right-of-way on Department of Lands map sheets: each edge is ray-cast against them for role, width and gap. Any part of the drawn plot on the right-of-way is cut away; gaps under 1.5 m snap shut.</li>
            <li><b>Rules.</b> Building Control Ordinance 2544, Ministerial Regulations 33 and 55 and the 2556 plan: road and boundary setbacks, the 2:1 height plane, open space, the high-rise regime (23 m / 10,000 m²) and its road gates. Each rule is cited with its Thai text (Rules tab).</li>
            <li><b>Envelope.</b> Floor by floor, the plot minus every setback buffer, so the allowed space follows the real outline; low-rise and high-rise regimes are computed separately and the one with more floor area is shown.</li>
            <li><b>Designs.</b> Tower-on-podium, slab and courtyard schemes are cut from inside the envelope and sized to the permitted floor area; an independent checker re-measures every design against the rules (pass / fail / not assessed).</li>
          </ol>
          <p>Runs entirely in the browser: no server, no AI at run time. Widths are from map sheets, not surveys; heights of neighbours partly estimated (lighter grey).</p>
        </details>
        <p>
          Data: BMA city planning GIS (zoning, right-of-way); buildings © OpenStreetMap contributors, Overture Maps, Google Open Buildings (CC BY 4.0). A feasibility aid, not a permit check.
          {' '}<a href="https://github.com/lokeshrana9999/bkk-feasibility" target="_blank" rel="noreferrer">Source code</a>
        </p>
      </footer>
    </aside>
  );
}

const num = (s: string) => Number(s.replace(/\D+/g, '')) || 0;

function engineMessage(e: EngineError, area: number, tidy: Tidy): string {
  if (e.code === 'too-large') return `The buildable plot is ${fmt(area)} m²; the limit is 200,000 m². Draw a smaller plot.`;
  if (e.code === 'too-many-vertices') return 'The outline has too many corners (over 500). Simplify it.';
  if (e.code === 'self-intersection') return `The outline crosses itself${e.index !== undefined ? ` near corner ${e.index + 1}` : ''}. Drag a corner to untangle it.`;
  if (e.code === 'zero-area' || e.code === 'too-few-points') return 'The plot has no area. Draw at least three corners apart from each other.';
  const m = tidy(e.message);
  return `${m.charAt(0).toUpperCase()}${m.slice(1)}${e.index !== undefined ? ` (edge ${e.index + 1})` : ''}.`;
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-h"><h2>{title}</h2>{aside && <span className="aside">{aside}</span>}</div>
      {children}
    </section>
  );
}

/** Copies the share link (plot, type, edge edits and options are all in the URL). */
function CopyLink() {
  const [done, setDone] = useState(false);
  return (
    <button
      className="link"
      title="The link carries the plot, building type, edge edits and options"
      onClick={() => {
        const ok = () => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        };
        navigator.clipboard?.writeText(location.href).then(ok, () => window.prompt('Copy this link:', location.href));
      }}
    >
      {done ? 'Link copied' : 'Copy share link'}
    </button>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return <div className="fact"><span>{k}</span><b>{v}</b></div>;
}

/**
 * A number input that applies a value only when it is complete and valid: after a pause in
 * typing, on Enter, or on leaving the field. Out-of-range values are flagged and not applied.
 */
function useNumInput(value: number, min: number, max: number, onChange: (v: number) => void) {
  const [txt, setTxt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parse = (s: string) => {
    const v = Number(s);
    return s.trim() !== '' && Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  const bad = txt !== null && parse(txt) === null;
  const commit = (s: string | null, done: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    if (s === null) return;
    const v = parse(s);
    if (v !== null && v !== value) onChange(v);
    if (done) setTxt(null);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return {
    bad,
    props: {
      type: 'number' as const,
      inputMode: 'decimal' as const,
      min,
      max,
      step: 'any',
      value: txt ?? String(value),
      'aria-invalid': bad,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const s = e.target.value;
        setTxt(s);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(s, false), 700);
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit(txt, true);
      },
      onBlur: () => commit(txt, true),
    },
  };
}

function NumField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  const n = useNumInput(value, min, max, onChange);
  return (
    <label className={`numf${n.bad ? ' bad' : ''}`}>
      <span>{label}</span>
      <input {...n.props} />
      {n.bad && <small className="err-txt">{min}-{max} m</small>}
    </label>
  );
}

function SplitZone({ hit, others }: { hit: { zone: { sub: string }; share: number }; others: { zone: { sub: string; far: number; isY9: boolean }; share: number }[] }) {
  const rest = others.filter((o) => o.share >= 0.02);
  return (
    <div className="banner warn">
      {fmt(hit.share * 100)}% of the plot is in {hit.zone.sub}
      {rest.length ? <>; {rest.map((o) => `${fmt(o.share * 100)}% in ${o.zone.sub} (FAR ${o.zone.far})`).join(', ')}</> : '; the rest has no zone in the city plan'}.
      {' '}The {hit.zone.sub} rules are used for the whole plot; check the boundary with the land office.
    </div>
  );
}

function Outside({ z }: { z: Extract<ZoneState, { kind: 'outside' }> }) {
  const hit = z.hit;
  return (
    <div className="banner info">
      <b>This plot is outside zone ย.9.</b>{' '}
      {hit ? (
        <>Most of it ({fmt(hit.share * 100)}%) is in <b>{hit.zone.sub}</b>{hit.zone.use ? ` (${hit.zone.use})` : ''}: FAR {hit.zone.far}, open space ratio {hit.zone.osr}%. </>
      ) : z.loading ? (
        'Looking up its zone in the city plan… '
      ) : (
        'No city-plan zone covers it. '
      )}
      {z.y9Share > 0 && <>Only {fmt(z.y9Share * 100)}% of it is in ย.9. </>}
      This tool models the ย.9 rules only; move the plot into a ย.9 area (brown dashed outline) to see the envelope and designs.
    </div>
  );
}

function PrepNotes({ prep, status }: { prep: Prepared; status: PlotStatus }) {
  if (status !== 'ready' && status !== 'no-land') return null;
  const notes: ReactNode[] = [];
  if (prep.ring.length < 3) notes.push(<>The whole plot lies on the public right-of-way (road or canal); nothing can be built.</>);
  else if (prep.removed > 0.5) notes.push(<>{fmt(prep.removed)} m² of the drawn plot lies on the public right-of-way (road or canal) and is not counted: it cannot be built on. The road edges are taken from where the plot meets it.</>);
  if (prep.dropped > 0.5) notes.push(<>The right-of-way cuts the plot in pieces; the largest is used ({fmt(prep.dropped)} m² on the other side is left out).</>);
  if (prep.interiorRow) notes.push(<>A public way runs inside the plot; it is ignored here (the plot is treated as one piece around it).</>);
  const byRoad = new Map<string, number>();
  for (const s of prep.snaps) byRoad.set(s.label ?? 'road', Math.max(byRoad.get(s.label ?? 'road') ?? 0, s.by));
  for (const [road, by] of byRoad) notes.push(<>The plot was drawn up to {fmt(by, 1)} m short of the {road} right-of-way and is snapped onto it (a drawing gap under 1.5 m is taken as touching the road; edges marked “snapped”).</>);
  if (prep.merged > 0) notes.push(<>{prep.merged} repeated or in-line corner{prep.merged > 1 ? 's' : ''} merged.</>);
  if (!notes.length) return null;
  return <>{notes.map((n, i) => <div key={i} className="banner note">{n}</div>)}</>;
}

const ROLES: { id: EdgeRole; label: string }[] = [
  { id: 'road', label: 'Road' },
  { id: 'canal', label: 'Canal' },
  { id: 'private', label: 'Neighbour' },
];

/**
 * Total snap of a final edge (lon/lat a-b): the snapped segments it lies along (its midpoint
 * within 0.6 m of the segment, directions within ~10 degrees). Several passes can add up.
 */
function snappedBy(prep: Prepared | null, a: LL, b: LL): number | null {
  if (!prep) return null;
  const kx = 108000;
  const ky = 110600;
  const m = [((a[0] + b[0]) / 2) * kx, ((a[1] + b[1]) / 2) * ky];
  const d = [(b[0] - a[0]) * kx, (b[1] - a[1]) * ky];
  const dl = Math.hypot(d[0]!, d[1]!) || 1;
  let total = 0;
  for (const s of prep.snaps) {
    const p = [s.seg[0][0] * kx, s.seg[0][1] * ky];
    const q = [s.seg[1][0] * kx, s.seg[1][1] * ky];
    const v = [q[0]! - p[0]!, q[1]! - p[1]!];
    const L = Math.hypot(v[0]!, v[1]!) || 1;
    const t = Math.max(0, Math.min(1, ((m[0]! - p[0]!) * v[0]! + (m[1]! - p[1]!) * v[1]!) / (L * L)));
    const dist = Math.hypot(m[0]! - (p[0]! + v[0]! * t), m[1]! - (p[1]! + v[1]! * t));
    const cos = Math.abs((d[0]! * v[0]! + d[1]! * v[1]!) / (dl * L));
    if (dist < 0.6 && cos > 0.985) total += s.by;
  }
  return total > 0 ? total : null;
}

function EdgeTable({ edges, prep, setOverride, hover, setHover }: { edges: UiEdge[]; prep: Prepared | null; setOverride: Props['setOverride']; hover: number | null; setHover: (i: number | null) => void }) {
  const ring = prep?.ring ?? [];
  return (
    <div className="edges">
      {edges.map((e, i) => {
        const snap = ring.length === edges.length ? snappedBy(prep, ring[i]!, ring[(i + 1) % ring.length]!) : null;
        return (
          <div key={i} className={`edge${hover === i ? ' hov' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className={`eno r-${e.role}`}>{i + 1}</span>
            <span className="elen">{fmt(e.length, 1)} m</span>
            <div className="chips">
              {ROLES.map((ro) => (
                <button key={ro.id} className={`chip${e.role === ro.id ? ` on r-${ro.id}` : ''}`} aria-pressed={e.role === ro.id} onClick={() => setOverride(i, { role: ro.id, width: undefined, gap: undefined })}>{ro.label}</button>
              ))}
            </div>
            {e.role !== 'private' ? (
              <WidthField
                value={e.width ?? 0}
                gap={e.gap ?? 0}
                onChange={(v) => setOverride(i, { role: e.role, width: v, gap: e.gap })}
                onGap={(g) => setOverride(i, { role: e.role, width: e.width, gap: g })}
              />
            ) : <div className="ew muted">{e.label ?? ''}</div>}
            <div className="esrc">
              {e.role !== 'private' && e.label && <span className="ename" title={e.name}>{e.label}</span>}
              {e.edited ? (
                <button className="link" onClick={() => setOverride(i, null)} title="Back to the value from the city map">edited · reset</button>
              ) : e.source === 'city' ? (
                <span className="tag" title="Width measured on the city right-of-way map sheet, not surveyed">city map</span>
              ) : null}
              {snap !== null && <span className="tag" title="The drawn edge stopped short of the right-of-way and was moved onto it">snapped {fmt(snap, 1)} m</span>}
              {e.role !== 'private' && (e.gap ?? 0) > 0 && <span className="tag warn" title="The plot does not touch this road; the high-rise frontage rule needs it to">not abutting: gap {fmt(e.gap ?? 0, 1)} m</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WidthField({ value, gap, onChange, onGap }: { value: number; gap: number; onChange: (v: number) => void; onGap: (g: number) => void }) {
  const n = useNumInput(value, 1, 100, onChange);
  const g = useNumInput(gap, 0, 50, onGap);
  return (
    <div className={`ew${n.bad || g.bad ? ' bad' : ''}`}>
      <input className="win" aria-label="road width (m)" {...n.props} />
      <span className="unit">m wide</span>
      <input className="gin" aria-label="gap to the road (m)" title="Distance from this plot edge to the road (0 = touching)" {...g.props} />
      <span className="unit">m gap</span>
      {n.bad && <small className="err-txt">width must be 1-100 m</small>}
      {g.bad && <small className="err-txt">gap must be 0-50 m</small>}
    </div>
  );
}

function Summary({ r, env, ms, busy, tidy, edges }: { r: EngineResult; env: Envelope; ms: number | null; busy: boolean; tidy: Tidy; edges: UiEdge[] }) {
  const farCap = env.caps.find((c) => c.id === 'Z16-FAR');
  return (
    <section className="sec summary">
      <div className="sec-h">
        <h2>Allowed envelope</h2>
        <span className="aside">{busy ? 'updating…' : ms !== null ? `computed in ${fmt(ms)} ms` : ''}</span>
      </div>
      {env.plates.length === 0 ? (
        <div className="banner err">Nothing can be built: {tidy(env.stopReason || env.reason || 'the setbacks leave no floor plate')}.</div>
      ) : (
        <>
          <div className="kpis">
            <Kpi k="Permitted floor area" v={`${fmt(env.permittedGfa)} m²`} s={farCap ? `FAR cap ${fmt(farCap.value)} m²` : undefined} />
            <Kpi k="FAR reached" v={`${fmt(env.farReached, 2)}`} s={`of ${zoneFarOf(r)}`} />
            <Kpi k="Height" v={`${fmt(env.height, 1)} m`} s={`${env.floors} floors`} />
            <Kpi k="Regime" v={env.regime === 'high' ? 'High-rise' : 'Low-rise'} s={env.regime === 'high' ? '≥ 23 m (MR 33)' : '< 23 m'} />
          </div>
          <p className="limit"><b>Limited by:</b> {tidy(env.limitedBy)}</p>
          <RegimeLine r={r} tidy={tidy} edges={edges} />
        </>
      )}
    </section>
  );
}

const zoneFarOf = (r: EngineResult) => {
  const m = r.rules.find((x) => x.id === 'Z16-FAR')?.value.match(/FAR ([\d.]+)/);
  return m ? m[1]! : '';
};

function RegimeLine({ r, tidy, edges }: { r: EngineResult; tidy: Tidy; edges: UiEdge[] }) {
  const other = r.regimes.chosen === 'low' ? r.regimes.high : r.regimes.low;
  const name = other.regime === 'high' ? 'High-rise' : 'Low-rise';
  if (!other.allowed) {
    // a wide enough road that the plot does not touch: say so (the frontage rule needs contact)
    const gapped = other.regime === 'high' ? edges.findIndex((e) => e.role === 'road' && (e.width ?? 0) >= 10 && (e.gap ?? 0) > 0) : -1;
    const why = gapped >= 0 ? ` Edge ${gapped + 1} is not abutting its ${fmt(edges[gapped]!.width ?? 0, 1)} m road: gap ${fmt(edges[gapped]!.gap ?? 0, 1)} m. Set the gap to 0 if the plot reaches the road.` : '';
    return <p className="sub">{name} regime not available: {tidy(other.reason)}.{why}</p>;
  }
  return <p className="sub">{name} alternative: {fmt(other.permittedGfa)} m² in {other.floors} floors, {fmt(other.height, 1)} m (outline toggle on the map).</p>;
}

function Kpi({ k, v, s }: { k: string; v: string; s?: string }) {
  return <div className="kpi"><span>{k}</span><b>{v}</b>{s && <small>{s}</small>}</div>;
}

const KIND_ICON: Record<Design['kind'], string> = { 'tower-podium': '▥', slab: '▬', courtyard: '◰' };

function Designs({ r, sel, setSel, tidy }: { r: EngineResult; sel: number; setSel: (i: number) => void; tidy: Tidy }) {
  if (r.designs.length === 0) return <div className="banner warn">No design fits this envelope. See Notes.</div>;
  return (
    <div className="designs">
      {r.designs.map((d, i) => (
        <div key={d.id} className={`dcard${i === sel ? ' on' : ''}`} onClick={() => setSel(i)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(i)}>
          <div className="dh">
            <span className="dicon">{KIND_ICON[d.kind]}</span>
            <div className="dt">
              <b>{d.name}</b>
              <small>{d.floors} floors · {fmt(d.height, 1)} m · {d.regime === 'high' ? 'high-rise' : 'low-rise'}</small>
            </div>
            <span className={`pill ${d.passes ? 'pass' : 'fail'}`}>{d.passes ? 'passes' : 'fails'}</span>
          </div>
          <div className="dk">
            <span><small>Floor area</small>{fmt(d.gfa)} m²</span>
            <span><small>FAR</small>{fmt(d.far, 2)}</span>
            <span><small>Footprint</small>{fmt(d.footprint)} m²</span>
            <span><small>Open space</small>{fmt(d.openSpace)} m²</span>
          </div>
          <p className="binding"><b>Binding:</b> {tidy(d.binding)}</p>
          {i === sel && <Checklist checks={d.checks} tidy={tidy} />}
        </div>
      ))}
    </div>
  );
}

function Checklist({ checks, tidy }: { checks: CheckRow[]; tidy: Tidy }) {
  const n = { pass: 0, fail: 0, 'not-assessed': 0 };
  for (const c of checks) n[c.status]++;
  return (
    <div className="checks">
      <div className="ch-sum">{n.pass} pass · {n.fail} fail · {n['not-assessed']} not assessed</div>
      {checks.map((c) => (
        <div key={c.id} className={`ck s-${c.status}`} title={c.reason ?? ''}>
          <span className="cks">{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '–'}</span>
          <div className="ckb">
            <b>{tidy(c.label)}</b>
            <small>required {tidy(c.required)} · actual {tidy(c.actual)}</small>
            {c.reason && c.status !== 'pass' && <small className="why">{tidy(c.reason)}</small>}
          </div>
          <span className="ckr">{c.rule}</span>
        </div>
      ))}
    </div>
  );
}

function Rules({ r, tidy }: { r: EngineResult; tidy: Tidy }) {
  const [open, setOpen] = useState<string | null>(null);
  const rules = [...r.rules].sort((a, b) => Number(b.applies) - Number(a.applies));
  return (
    <div className="rules">
      {rules.map((x) => (
        <div key={x.id} className={`rule${x.applies ? '' : ' na'}`}>
          <div className="rh" onClick={() => setOpen(open === x.id ? null : x.id)}>
            <span className={`rk k-${x.kind}`}>{x.kind === 'not-assessed' ? 'n/a' : x.kind}</span>
            <div className="rb">
              <b>{x.text}</b>
              <span className="rv">{tidy(x.value)}</span>
            </div>
            <span className="rsrc">{x.source}<br />{x.article}</span>
          </div>
          {open === x.id && <blockquote lang="th">{x.quoteTh}</blockquote>}
        </div>
      ))}
      <p className="hint">Click a rule to see the Thai text it is taken from. Grey rules do not apply to this plot.</p>
    </div>
  );
}

function Floors({ r, design, tidy, onHover }: { r: EngineResult; design?: Design; tidy: Tidy; onHover: Props['setHoverFloor'] }) {
  useEffect(() => () => onHover(null), [onHover]);
  const [which, setWhich] = useState<'env' | 'design'>('env');
  const env = r.regimes[r.regimes.chosen];
  const plates: FloorPlate[] = which === 'design' && design ? design.plates : env.plates;
  const total = plates.reduce((s, p) => s + p.area, 0);
  const reported = which === 'design' && design ? design.gfa : env.gfa;
  return (
    <div className="floors">
      <div className="seg small">
        <button className={which === 'env' ? 'on' : ''} onClick={() => setWhich('env')}>Envelope</button>
        <button className={which === 'design' ? 'on' : ''} onClick={() => setWhich('design')} disabled={!design}>{design ? design.name : 'Design'}</button>
      </div>
      <table>
        <thead><tr><th>Floor</th><th>From–to (m)</th><th>Area (m²)</th></tr></thead>
        <tbody>
          {[...plates].reverse().map((p) => (
            <tr key={p.level} onMouseEnter={() => onHover({ src: which, level: p.level })} onMouseLeave={() => onHover(null)}>
              <td>{p.level}</td><td>{fmt(p.z0, 1)}–{fmt(p.z1, 1)}</td><td>{fmt(p.area, 1)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Sum of floors</td><td>{fmt(total, 1)}</td></tr>
          <tr className="muted"><td colSpan={2}>{which === 'env' ? 'Envelope GFA (engine)' : 'Design GFA (engine)'}</td><td>{fmt(reported, 1)}</td></tr>
        </tfoot>
      </table>
      {which === 'env' && env.permittedGfa < env.gfa - 0.5 && (
        <p className="hint">The envelope holds {fmt(env.gfa)} m², but only {fmt(env.permittedGfa)} m² may be built ({tidy(env.limitedBy)}). Designs are sized to the permitted area.</p>
      )}
      <p className="hint">Floor areas are measured on plates cut 15 mm inside every legal line (rounding margin).</p>
    </div>
  );
}

function Notes({ r, tidy }: { r: EngineResult; tidy: Tidy }) {
  if (!r.warnings.length) return <p className="hint">No warnings for this plot.</p>;
  return (
    <ul className="notes">
      {r.warnings.map((w, i) => <li key={i}><code>{w.code}</code> {tidy(w.message)}</li>)}
    </ul>
  );
}
