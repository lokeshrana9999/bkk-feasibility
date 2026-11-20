import { useState, type ReactNode } from 'react';
import type { BuildingType, CheckRow, Design, EdgeRole, EngineError, EngineResult, Envelope, FloorPlate } from '../engine/types';
import { TYPE_PARAMS } from '../engine/rules';
import type { Area } from '../site/data';
import type { LL } from '../site/geo';
import type { ZoneHit } from '../site/zone';
import { DEMOS, TYPES, fmt, type EdgeOverride, type UiEdge } from './state';

interface Props {
  areas: Area[];
  ring: LL[] | null;
  ringOk: boolean;
  plotAreaM2: number;
  zoneHit: ZoneHit | null;
  outside: ZoneHit | null;
  edges: UiEdge[];
  setOverride: (i: number, o: EdgeOverride | null) => void;
  hoverEdge: number | null;
  setHoverEdge: (i: number | null) => void;
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
  hasRowData: boolean;
  onDraw: () => void;
  onDemo: (r: LL[]) => void;
  onArea: (a: Area) => void;
  onFit: () => void;
}

type Tab = 'designs' | 'rules' | 'floors' | 'notes';

export function Panel(p: Props) {
  const [tab, setTab] = useState<Tab>('designs');
  const r = p.result;
  const chosen = r ? r.regimes[r.regimes.chosen] : null;
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

      <Section title="Plot">
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
            {[...p.areas].sort((a, b) => num(a.labelLatin) - num(b.labelLatin)).map((a) => (
              <option key={a.id} value={a.id}>{a.labelLatin} · {a.label}</option>
            ))}
          </select>
        </div>
        {p.ring && (
          <div className="plot-facts">
            <Fact k="Plot area" v={`${fmt(p.plotAreaM2)} m²`} />
            <Fact k="Corners" v={String(p.ring.length)} />
            {p.zoneHit ? (
              <Fact k="Zone" v={<span className="zone-chip" title={p.zoneHit.zone.use}>{p.zoneHit.zone.sub} · FAR {p.zoneHit.zone.far} · OSR {p.zoneHit.zone.osr}%</span>} />
            ) : (
              <Fact k="Zone" v="outside ย.9" />
            )}
            <button className="link" onClick={p.onFit}>Zoom to plot</button>
          </div>
        )}
        {p.ring && !p.ringOk && <div className="banner err">The outline crosses itself. Drag a corner to untangle it.</div>}
        {p.zoneHit && p.zoneHit.share < 0.95 && (
          <div className="banner warn">Only {fmt(p.zoneHit.share * 100)}% of the plot is in {p.zoneHit.zone.sub}; the rest is in another zone. Rules of {p.zoneHit.zone.sub} are used for the whole plot.</div>
        )}
        {p.ring && p.ringOk && !p.zoneHit && <Outside hit={p.outside} />}
        <p className="hint">Drag corners to reshape, drag the small midpoints to add a corner, right-click a corner to delete it.</p>
      </Section>

      <Section title="Building type">
        <div className="seg">
          {TYPES.map((t) => (
            <button key={t.id} className={p.type === t.id ? 'on' : ''} onClick={() => p.setType(t.id)}>{t.label}</button>
          ))}
        </div>
        <details className="opts">
          <summary>Options</summary>
          <label className="chk"><input type="checkbox" checked={p.nearStation} onChange={(e) => p.setNearStation(e.target.checked)} /> Within 500 m of a BTS/MRT station (waives the office/hotel road-width gates)</label>
          <label className="chk"><input type="checkbox" checked={p.relief} onChange={(e) => p.setRelief(e.target.checked)} /> Apply wider-road relief on corner plots (MR 55 arts. 45-46)</label>
          <div className="row gap">
            <NumField label="Ground floor (m)" value={p.floorH?.ground ?? TYPE_PARAMS[p.type].floorH.ground} min={2.4} max={10} step={0.1}
              onChange={(v) => p.setFloorH({ ground: v, typical: p.floorH?.typical ?? TYPE_PARAMS[p.type].floorH.typical })} />
            <NumField label="Typical floor (m)" value={p.floorH?.typical ?? TYPE_PARAMS[p.type].floorH.typical} min={2.4} max={10} step={0.1}
              onChange={(v) => p.setFloorH({ ground: p.floorH?.ground ?? TYPE_PARAMS[p.type].floorH.ground, typical: v })} />
            {p.floorH && <button className="link" onClick={() => p.setFloorH(null)}>reset</button>}
          </div>
        </details>
      </Section>

      {p.edges.length > 0 && (
        <Section title="Plot edges" aside={p.hasRowData ? 'roads detected from city right-of-way map' : 'no city road data here: mark roads by hand'}>
          <EdgeTable edges={p.edges} setOverride={p.setOverride} hover={p.hoverEdge} setHover={p.setHoverEdge} />
        </Section>
      )}

      {p.engineError && (
        <div className="banner err"><b>Cannot evaluate this plot.</b> {p.engineError.message}{p.engineError.index !== undefined ? ` (corner/edge ${p.engineError.index + 1})` : ''}</div>
      )}

      {r && chosen && (
        <>
          <Summary r={r} env={chosen} ms={p.ms} busy={p.busy} />
          <nav className="tabs">
            {(['designs', 'rules', 'floors', 'notes'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'designs' ? `Designs (${r.designs.length})` : t === 'rules' ? 'Rules' : t === 'floors' ? 'Floors' : `Notes (${r.warnings.length})`}
              </button>
            ))}
          </nav>
          {tab === 'designs' && <Designs r={r} sel={p.design} setSel={p.setDesign} />}
          {tab === 'rules' && <Rules r={r} />}
          {tab === 'floors' && <Floors r={r} design={r.designs[p.design]} />}
          {tab === 'notes' && <Notes r={r} />}
        </>
      )}
      <footer className="pf">
        Data: BMA comprehensive plan 2556 zoning; right-of-way from DOL map sheets (BMA GIS), not surveyed; buildings from OpenStreetMap, Overture and Google Open Buildings. A feasibility aid, not a permit check.
      </footer>
    </aside>
  );
}

const num = (s: string) => Number(s.replace(/\D+/g, '')) || 0;

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-h"><h2>{title}</h2>{aside && <span className="aside">{aside}</span>}</div>
      {children}
    </section>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return <div className="fact"><span>{k}</span><b>{v}</b></div>;
}

function NumField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  const [txt, setTxt] = useState<string | null>(null);
  return (
    <label className="numf">
      <span>{label}</span>
      <input
        type="number" inputMode="decimal" min={min} max={max} step={step}
        value={txt ?? String(value)}
        onChange={(e) => {
          setTxt(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => setTxt(null)}
      />
    </label>
  );
}

function Outside({ hit }: { hit: ZoneHit | null }) {
  return (
    <div className="banner info">
      <b>This plot is outside zone ย.9.</b>{' '}
      {hit
        ? <>It is in <b>{hit.zone.sub}</b>{hit.zone.use ? ` (${hit.zone.use})` : ''}: FAR {hit.zone.far}, open space ratio {hit.zone.osr}%. </>
        : 'No city-plan zone found here. '}
      This tool models the ย.9 rules only; move the plot into a ย.9 area (brown dashed outline) to see the envelope and designs.
    </div>
  );
}

const ROLES: { id: EdgeRole; label: string }[] = [
  { id: 'road', label: 'Road' },
  { id: 'canal', label: 'Canal' },
  { id: 'private', label: 'Neighbour' },
];

function EdgeTable({ edges, setOverride, hover, setHover }: { edges: UiEdge[]; setOverride: Props['setOverride']; hover: number | null; setHover: (i: number | null) => void }) {
  return (
    <div className="edges">
      {edges.map((e, i) => (
        <div key={i} className={`edge${hover === i ? ' hov' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className={`eno r-${e.role}`}>{i + 1}</span>
          <span className="elen">{fmt(e.length, 1)} m</span>
          <div className="chips">
            {ROLES.map((ro) => (
              <button key={ro.id} className={`chip${e.role === ro.id ? ` on r-${ro.id}` : ''}`} onClick={() => setOverride(i, { role: ro.id, width: undefined, gap: undefined })}>{ro.label}</button>
            ))}
          </div>
          {e.role !== 'private' ? (
            <div className="ew">
              <WidthInput value={e.width ?? 0} onChange={(v) => setOverride(i, { role: e.role, width: v })} />
              <span className="unit">m wide</span>
            </div>
          ) : <div className="ew muted">{e.label ?? ''}</div>}
          <div className="esrc">
            {e.role !== 'private' && e.label && <span className="ename" title={e.name}>{e.label}</span>}
            {e.edited ? (
              <button className="link" onClick={() => setOverride(i, null)} title="Back to the value from the city map">edited · reset</button>
            ) : e.source === 'city' ? (
              <span className="tag" title="Width measured on the city right-of-way map sheet, not surveyed">city map</span>
            ) : null}
            {e.role !== 'private' && (e.gap ?? 0) > 0 && <span className="tag">gap {fmt(e.gap ?? 0, 1)} m</span>}
            {e.detected.overlap > 0.5 && !e.edited && <span className="tag warn" title="The drawn plot reaches into the public right-of-way">overlaps road {fmt(e.detected.overlap, 1)} m</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function WidthInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState<string | null>(null);
  return (
    <input
      className="win" type="number" inputMode="decimal" min={1} max={100} step={0.5}
      value={txt ?? String(value)}
      onChange={(e) => {
        setTxt(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v) && v >= 1 && v <= 100) onChange(v);
      }}
      onBlur={() => setTxt(null)}
    />
  );
}

function Summary({ r, env, ms, busy }: { r: EngineResult; env: Envelope; ms: number | null; busy: boolean }) {
  const zoneFar = r.rules.find((x) => x.id === 'Z16-FAR');
  void zoneFar;
  const farCap = env.caps.find((c) => c.id === 'Z16-FAR');
  return (
    <section className="sec summary">
      <div className="sec-h">
        <h2>Allowed envelope</h2>
        <span className="aside">{busy ? 'updating…' : ms !== null ? `computed in ${fmt(ms)} ms` : ''}</span>
      </div>
      {env.plates.length === 0 ? (
        <div className="banner err">Nothing can be built: {env.stopReason || env.reason || 'the setbacks leave no floor plate'}.</div>
      ) : (
        <>
          <div className="kpis">
            <Kpi k="Permitted floor area" v={`${fmt(env.permittedGfa)} m²`} s={farCap ? `FAR cap ${fmt(farCap.value)} m²` : undefined} />
            <Kpi k="FAR reached" v={`${fmt(env.farReached, 2)}`} s={`of ${r.rules.length ? zoneFarOf(r) : ''}`} />
            <Kpi k="Height" v={`${fmt(env.height, 1)} m`} s={`${env.floors} floors`} />
            <Kpi k="Regime" v={env.regime === 'high' ? 'High-rise' : 'Low-rise'} s={env.regime === 'high' ? '≥ 23 m (MR 33)' : '< 23 m'} />
          </div>
          <p className="limit"><b>Limited by:</b> {env.limitedBy}</p>
          <RegimeLine r={r} />
        </>
      )}
    </section>
  );
}

const zoneFarOf = (r: EngineResult) => {
  const m = r.rules.find((x) => x.id === 'Z16-FAR')?.value.match(/FAR ([\d.]+)/);
  return m ? m[1]! : '';
};

function RegimeLine({ r }: { r: EngineResult }) {
  const other = r.regimes.chosen === 'low' ? r.regimes.high : r.regimes.low;
  const name = other.regime === 'high' ? 'High-rise' : 'Low-rise';
  if (!other.allowed) return <p className="sub">{name} regime not available: {other.reason}</p>;
  return <p className="sub">{name} alternative: {fmt(other.permittedGfa)} m² in {other.floors} floors, {fmt(other.height, 1)} m (outline toggle on the map).</p>;
}

function Kpi({ k, v, s }: { k: string; v: string; s?: string }) {
  return <div className="kpi"><span>{k}</span><b>{v}</b>{s && <small>{s}</small>}</div>;
}

const KIND_ICON: Record<Design['kind'], string> = { 'tower-podium': '▥', slab: '▬', courtyard: '◰' };

function Designs({ r, sel, setSel }: { r: EngineResult; sel: number; setSel: (i: number) => void }) {
  if (r.designs.length === 0) return <div className="banner warn">No design fits this envelope. See Notes.</div>;
  return (
    <div className="designs">
      {r.designs.map((d, i) => (
        <div key={d.id} className={`dcard${i === sel ? ' on' : ''}`} onClick={() => setSel(i)}>
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
          <p className="binding"><b>Binding:</b> {d.binding}</p>
          {i === sel && <Checklist checks={d.checks} />}
        </div>
      ))}
    </div>
  );
}

function Checklist({ checks }: { checks: CheckRow[] }) {
  const n = { pass: 0, fail: 0, 'not-assessed': 0 };
  for (const c of checks) n[c.status]++;
  return (
    <div className="checks">
      <div className="ch-sum">{n.pass} pass · {n.fail} fail · {n['not-assessed']} not assessed</div>
      {checks.map((c) => (
        <div key={c.id} className={`ck s-${c.status}`} title={c.reason ?? ''}>
          <span className="cks">{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '–'}</span>
          <div className="ckb">
            <b>{c.label}</b>
            <small>required {c.required} · actual {c.actual}</small>
            {c.reason && c.status === 'not-assessed' && <small className="why">{c.reason}</small>}
          </div>
          <span className="ckr">{c.rule}</span>
        </div>
      ))}
    </div>
  );
}

function Rules({ r }: { r: EngineResult }) {
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
              <span className="rv">{x.value}</span>
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

function Floors({ r, design }: { r: EngineResult; design?: Design }) {
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
            <tr key={p.level}><td>{p.level}</td><td>{fmt(p.z0, 1)}–{fmt(p.z1, 1)}</td><td>{fmt(p.area, 1)}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Sum of floors</td><td>{fmt(total, 1)}</td></tr>
          <tr className="muted"><td colSpan={2}>{which === 'env' ? 'Envelope GFA (engine)' : 'Design GFA (engine)'}</td><td>{fmt(reported, 1)}</td></tr>
        </tfoot>
      </table>
      {which === 'env' && env.permittedGfa < env.gfa - 0.5 && (
        <p className="hint">The envelope holds {fmt(env.gfa)} m², but only {fmt(env.permittedGfa)} m² may be built ({env.limitedBy}). Designs are sized to the permitted area.</p>
      )}
      <p className="hint">Floor areas are measured on plates cut 15 mm inside every legal line (rounding margin).</p>
    </div>
  );
}

function Notes({ r }: { r: EngineResult }) {
  if (!r.warnings.length) return <p className="hint">No warnings for this plot.</p>;
  return (
    <ul className="notes">
      {r.warnings.map((w, i) => <li key={i}><code>{w.code}</code> {w.message}</li>)}
    </ul>
  );
}
