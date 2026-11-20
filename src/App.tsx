import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuildingType, EngineError, EngineInput, EngineResult } from './engine/types';
import { MapView, type MapHandle } from './scene/MapView';
import { buildLayers } from './scene/layers';
import {
  loadAreas, loadBuildings, loadRoadNames, loadRow, loadZonesAll, loadZonesY9, nameKey, type Area, type Building, type RowFeature, type ZonePoly,
} from './site/data';
import { areaM2, bboxHit, bboxOf, centroidLL, makeFrame, pointInRing, selfIntersects, toXY, type LL } from './site/geo';
import type { DetectedEdge } from './site/roads';
import { preparePlot } from './site/prep';
import { zoneState } from './site/zone';
import { EngineClient } from './worker/client';
import { Panel, type PlotStatus } from './ui/Panel';
import { DEMOS, mergeEdges, readHash, toEngineEdge, writeHash, type EdgeOverride, type HashState } from './ui/state';

export interface ViewToggles {
  envelope: boolean;
  ghost: boolean;
  twoX: boolean;
  buildings: boolean;
  row: boolean;
}

const NEAR_M = 600;
const NONE: RowFeature[] = [];
/** Same limit as the engine's: larger drawings are refused before any site work. */
const MAX_PLOT_M2 = 200_000;

export default function App() {
  const mapRef = useRef<MapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailure, setMapFailure] = useState<string | null>(null);
  const [basemapDown, setBasemapDown] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [zones, setZones] = useState<ZonePoly[]>([]);
  const [zonesAll, setZonesAll] = useState<ZonePoly[] | null>(null);
  const [zonesFc, setZonesFc] = useState<unknown>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);

  const [ring, setRing] = useState<LL[] | null>(null);
  const [plotSeq, setPlotSeq] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [type, setType] = useState<BuildingType>('condo');
  const [nearStation, setNearStation] = useState(false);
  const [relief, setRelief] = useState(true);
  const [floorH, setFloorH] = useState<{ ground: number; typical: number } | null>(null);
  const [hotelRooms, setHotelRooms] = useState<number | null>(null);
  const [ov, setOv] = useState<{ key: string; map: Record<number, EdgeOverride> }>({ key: '', map: {} });
  const ovNext = useRef<Record<number, EdgeOverride> | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [hoverFloor, setHoverFloor] = useState<{ src: 'env' | 'design'; level: number } | null>(null);
  const [design, setDesign] = useState(0);
  const [view, setView] = useState<ViewToggles>({ envelope: true, ghost: false, twoX: false, buildings: true, row: true });

  const [viewArea, setViewArea] = useState<Area | null>(null);
  const [rows, setRows] = useState<RowFeature[]>([]);
  const [rowsFor, setRowsFor] = useState<number | null>(null);
  const [bldFor, setBldFor] = useState<number | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [rowFc, setRowFc] = useState<unknown>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [enNames, setEnNames] = useState<Map<string, string>>(new Map());

  const [result, setResult] = useState<EngineResult | null>(null);
  const [engineError, setEngineError] = useState<EngineError | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- static data: ย.9 zones first (the map needs them), the city's 607 zones in the background
  useEffect(() => {
    Promise.all([loadAreas(), loadZonesY9()]).then(([a, z]) => {
      if (!a.length || !z.zones.length) setDataError('Could not load the zoning data. Check your connection and reload.');
      setAreas(a);
      setZones(z.zones);
      setZonesFc(z.fc);
    });
  }, []);
  useEffect(() => {
    let live = true;
    let tries = 0;
    const go = () =>
      loadZonesAll().then((all) => {
        if (!live) return;
        if (all) setZonesAll(all);
        else if (++tries < 4) setTimeout(go, 1500 * tries);
        else setDataError('Could not load the city zone map; plots on a zone boundary cannot be checked. Reload to retry.');
      });
    go();
    return () => {
      live = false;
    };
  }, []);

  // ---- engine worker
  const clientRef = useRef<EngineClient | null>(null);
  const inputRef = useRef<EngineInput | null>(null);
  useEffect(() => {
    const c = new EngineClient(
      (out, t, inp, pending) => {
        // still busy when a newer input is queued or this answer is for an older input
        setBusy(pending || inp !== inputRef.current);
        setMs(t);
        if (out.ok) {
          setResult(out);
          setEngineError(null);
        } else {
          setResult(null);
          setEngineError(out);
        }
      },
      (msg) => {
        setBusy(false);
        setEngineError({ ok: false, code: 'internal', message: msg });
      },
    );
    clientRef.current = c;
    return () => c.dispose();
  }, []);

  // ---- share link in, plot out
  const applyHash = useCallback((h: HashState, fly: boolean) => {
    setType(h.type ?? 'condo');
    setNearStation(h.station ?? false);
    setRelief(h.relief ?? true);
    setFloorH(h.floorH ?? null);
    setHotelRooms(h.hotelRooms ?? null);
    ovNext.current = h.edges ?? {};
    setLinkNotice(h.bad.length ? `Part of the link could not be read (${h.bad.join(', ')}); defaults are used for it.` : null);
    mapRef.current?.setPlot(h.ring ?? DEMOS[0]!.ring, fly);
  }, []);

  useEffect(() => {
    if (!mapReady || !zones.length) return;
    applyHash(readHash(), true);
  }, [mapReady, zones.length > 0]);

  // a link pasted into this tab, or Back / Forward through earlier plots
  useEffect(() => {
    const on = () => applyHash(readHash(), true);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [applyHash]);

  const onRing = useCallback((r: LL[] | null, external: boolean) => {
    if (external) setPlotSeq((s) => s + 1);
    setRing(r);
  }, []);

  // ---- zone of the plot: majority over all city zones
  const drawnArea = useMemo(() => (ring && ring.length >= 3 ? areaM2(ring) : 0), [ring]);
  const tooLarge = drawnArea > MAX_PLOT_M2;
  const ringOk = !!ring && ring.length >= 3 && !tooLarge && !selfIntersects(ring);
  const zs = useMemo(() => (ring && ringOk && zones.length ? zoneState(ring, zones, zonesAll) : null), [ring, ringOk, zones, zonesAll]);
  const zoneHit = zs?.kind === 'y9' ? zs.hit : null;
  const plotArea = useMemo(() => areas.find((a) => a.id === zoneHit?.zone.id) ?? null, [areas, zoneHit]);
  const activeArea = plotArea ?? viewArea;

  useEffect(() => {
    if (!activeArea) return;
    let live = true;
    setSiteError(null);
    loadRow(activeArea).then((r) => {
      if (!live) return;
      if (!r) {
        setSiteError(`Could not load the roads for ${activeArea.labelLatin}.`);
        return;
      }
      setRows(r);
      setRowsFor(activeArea.id);
      setRowFc({
        type: 'FeatureCollection',
        features: r.map((f) => ({ type: 'Feature', id: f.id, properties: { kind: f.kind, name: f.name }, geometry: { type: 'MultiPolygon', coordinates: f.polys } })),
      });
    });
    loadBuildings(activeArea).then((b) => {
      if (!live) return;
      if (!b) {
        setSiteError(`Could not load the buildings for ${activeArea.labelLatin}.`);
        return;
      }
      setBuildings(b);
      setBldFor(activeArea.id);
      // names only after the geometry: they are a nicety
      loadRoadNames(activeArea).then((m) => live && setEnNames(m));
    });
    return () => {
      live = false;
    };
  }, [activeArea?.id, retry]);

  // ---- the buildable plot: snapped to the road, right-of-way cut away
  const rowsReady = !plotArea || rowsFor === plotArea.id;
  const plotRows = useMemo(() => (plotArea && rowsFor === plotArea.id ? rows : NONE), [plotArea, rowsFor, rows]);
  const prep = useMemo(() => (ring && ringOk && zoneHit && rowsReady ? preparePlot(ring, plotRows) : null), [ring, ringOk, zoneHit, rowsReady, plotRows]);
  const eRing = prep && prep.ring.length >= 3 ? prep.ring : null;
  // English labels for Thai road names where OSM has one (the Thai name stays the engine's key)
  const detected = useMemo(() => {
    const d = eRing && prep ? prep.edges : [];
    if (!enNames.size) return d;
    return d.map((e) => {
      if (!e.label || /[a-z]/i.test(e.label)) return e;
      const en = enNames.get(nameKey(e.label));
      return en ? { ...e, label: en } : e;
    });
  }, [eRing, prep, enNames]);

  // edge edits belong to one plot's edges: a new plot or a different corner count starts fresh
  // (or from the share link that brought the plot)
  const ovKey = eRing ? `${plotSeq}:${eRing.length}` : '';
  useEffect(() => {
    if (!ovKey || ov.key === ovKey) return;
    const fromLink = ov.key.split(':')[0] !== String(plotSeq) ? ovNext.current : null;
    ovNext.current = null;
    setOv({ key: ovKey, map: fromLink ?? {} });
  }, [ovKey]);
  const overrides = ov.key === ovKey ? ov.map : null;
  const edges = useMemo(() => mergeEdges(detected, overrides ?? {}), [detected, overrides]);

  // frame a plot set from outside once its roads are known: camera across the main road
  const fitPending = useRef(false);
  const frame = useCallback(() => {
    const r = eRing ?? ring;
    if (r) mapRef.current?.fitRing(r, viewBearing(r, detected));
  }, [eRing, ring, detected]);
  useEffect(() => {
    if (!fitPending.current || !ring) return;
    if (zs?.kind === 'loading' || (plotArea && rowsFor !== plotArea.id)) return;
    fitPending.current = false;
    frame();
  }, [frame, ring, plotArea, rowsFor, zs?.kind]);

  // ---- engine input
  const input: EngineInput | null = useMemo(() => {
    if (!eRing || !zoneHit || !overrides || edges.length !== eRing.length) return null;
    return {
      ring: eRing,
      edges: edges.map(toEngineEdge),
      zone: { code: zoneHit.zone.sub, far: zoneHit.zone.far, osrPct: zoneHit.zone.osr },
      type,
      nearStation,
      widerRoadRelief: relief,
      ...(floorH ? { floorH } : {}),
      ...(type === 'hotel' && hotelRooms ? { hotelRooms } : {}),
    };
  }, [eRing, zoneHit, overrides, edges, type, nearStation, relief, floorH, hotelRooms]);
  inputRef.current = input;

  useEffect(() => {
    if (!input) {
      setResult(null);
      setEngineError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    clientRef.current?.run(input);
  }, [input]);

  // share link, written once edits settle (not on every drag frame); each settled plot is a
  // history entry, so Back returns to the previous one
  useEffect(() => {
    // nothing is written while the zone or roads load: the link's edge edits are not applied yet
    const settling = !!ring && ringOk && (!zs || zs.kind === 'loading' || (!!zoneHit && !rowsReady));
    if (drawing || !mapReady || settling || (eRing && !overrides)) return;
    const t = setTimeout(() => writeHash({ ring, type, edges: overrides ?? {}, station: nearStation, relief, floorH, hotelRooms }), 600);
    return () => clearTimeout(t);
  }, [ring, eRing, type, overrides, nearStation, relief, floorH, hotelRooms, drawing, mapReady, zs, zoneHit, rowsReady, ringOk]);

  // before the user replaces the plot (demo, new drawing), make sure the current one is in the
  // history, so Back returns to it even if its debounced write had not happened yet
  const shareRef = useRef({ ring, type, edges: overrides ?? {}, station: nearStation, relief, floorH, hotelRooms });
  shareRef.current = { ring, type, edges: overrides ?? {}, station: nearStation, relief, floorH, hotelRooms };
  const flushHash = useCallback(() => {
    if (shareRef.current.ring) writeHash(shareRef.current);
  }, []);

  // keep the selected design valid
  useEffect(() => {
    if (result && design >= result.designs.length) setDesign(0);
  }, [result, design]);

  // ---- neighbours: within 600 m, minus anything standing on the plot (it gets demolished)
  const near = useMemo(() => {
    const r = eRing ?? ring;
    if (!r || !buildings.length) return buildings.length && !r ? buildings : [];
    const c = centroidLL(r);
    const f = makeFrame(c[0], c[1]);
    const dLon = NEAR_M / f.kx;
    const dLat = NEAR_M / f.ky;
    const box: [number, number, number, number] = [c[0] - dLon, c[1] - dLat, c[0] + dLon, c[1] + dLat];
    const pb = bboxOf(r);
    return buildings.filter((b) => {
      if (!bboxHit(b.bbox, box)) return false;
      const [x, y] = toXY(f, b.centroid);
      if (x * x + y * y > NEAR_M * NEAR_M) return false;
      if (bboxHit(b.bbox, pb) && (pointInRing(b.centroid, r) || b.ring.some((p) => pointInRing(p, r)))) return false;
      return true;
    });
  }, [buildings, eRing, ring]);

  const setOverride = useCallback((i: number, o: EdgeOverride | null) => {
    setOv((prev) => {
      const map = { ...prev.map };
      if (o === null) delete map[i];
      else map[i] = { ...prev.map[i], ...o };
      return { key: prev.key, map };
    });
  }, []);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const layers = useMemo(
    () =>
      buildLayers({
        result: input ? result : null,
        buildings: near,
        ring: eRing ?? ring,
        roles: eRing ? edges.map((e) => e.role) : [],
        design,
        showEnvelope: view.envelope,
        showGhost: view.ghost,
        show2x: view.twoX,
        showBuildings: view.buildings,
        hoverEdge,
        hoverFloor,
        onEdgeClick: (i) => {
          const order = ['road', 'canal', 'private'] as const;
          const cur = edgesRef.current[i]?.role ?? 'private';
          setOverride(i, { role: order[(order.indexOf(cur) + 1) % 3], width: undefined, gap: undefined });
        },
        onEdgeHover: setHoverEdge,
      }),
    [result, input, near, ring, eRing, edges, design, view, hoverEdge, hoverFloor, setOverride],
  );

  const status: PlotStatus = !ring
    ? 'none'
    : tooLarge
      ? 'too-large'
      : !ringOk
      ? 'invalid'
      : !zs
        ? 'loading-zone'
        : zs.kind === 'loading'
          ? 'loading-zone'
          : zs.kind === 'outside'
            ? 'outside'
            : !rowsReady
              ? 'loading-roads'
              : !eRing
                ? 'no-land'
                : 'ready';

  const siteLoading = !!activeArea && !siteError && (rowsFor !== activeArea.id || bldFor !== activeArea.id);

  return (
    <div className="app">
      <div className="map-wrap">
        <MapView
          ref={mapRef}
          layers={layers}
          zonesData={zonesFc}
          rowData={rowFc}
          showRow={view.row}
          onRing={onRing}
          onDrawingChange={setDrawing}
          onReady={() => setMapReady(true)}
          onFailure={setMapFailure}
          onBasemapDown={() => setBasemapDown(true)}
          onWantFit={() => {
            fitPending.current = true;
          }}
        />
        {mapFailure && <div className="map-fail"><b>Map unavailable.</b> {mapFailure} <button className="btn" onClick={() => location.reload()}>Reload</button></div>}
        {basemapDown && !siteLoading && !siteError && <div className="map-note">Street map unavailable (OpenFreeMap did not answer); plot, roads and buildings still work.</div>}
        {siteLoading && <div className="map-status">Loading roads and buildings for {activeArea!.labelLatin}…</div>}
        {siteError && (
          <div className="map-note err">
            {siteError} <button className="link" onClick={() => setRetry((n) => n + 1)}>Retry</button>
          </div>
        )}
        {!drawing && input && result && <ResultChip r={result} design={design} busy={busy} />}
        {drawing && <div className="map-hint">Click to place corners; click the first corner to close. Corners cannot cross the outline. Esc cancels.</div>}
        {!drawing && !ring && mapReady && (
          <div className="map-hint">No plot. Press <b>Draw plot</b> in the panel, or pick a demo.</div>
        )}
        <Legend view={view} setView={setView} hasGhost={!!result && result.regimes[result.regimes.chosen === 'low' ? 'high' : 'low'].allowed} />
      </div>
      <Panel
        areas={areas}
        ring={ring}
        status={status}
        drawnAreaM2={drawnArea}
        buildableAreaM2={eRing ? areaM2(eRing) : 0}
        prep={prep}
        zone={zs}
        edges={eRing ? edges : []}
        setOverride={setOverride}
        hoverEdge={hoverEdge}
        setHoverFloor={setHoverFloor}
        setHoverEdge={setHoverEdge}
        type={type}
        setType={setType}
        nearStation={nearStation}
        setNearStation={setNearStation}
        relief={relief}
        setRelief={setRelief}
        floorH={floorH}
        setFloorH={setFloorH}
        hotelRooms={hotelRooms}
        setHotelRooms={setHotelRooms}
        result={input ? result : null}
        engineError={input ? engineError : null}
        ms={ms}
        busy={busy}
        design={design}
        setDesign={setDesign}
        drawing={drawing}
        dataError={dataError}
        linkNotice={linkNotice}
        roadArea={plotArea?.labelLatin ?? null}
        hasRowData={plotRows.length > 0}
        onDraw={() => {
          flushHash();
          mapRef.current?.startDrawing();
        }}
        onDemo={(r) => {
          flushHash();
          ovNext.current = {};
          mapRef.current?.setPlot(r, true);
        }}
        onArea={(a) => {
          setViewArea(a);
          mapRef.current?.flyTo(a.labelPoint, 16);
        }}
        onFit={frame}
        onSearch={(p, zoom, areaId) => {
          const a = areas.find((x) => x.id === areaId);
          if (a) setViewArea(a);
          mapRef.current?.flyTo(p, zoom);
        }}
      />
    </div>
  );
}

/**
 * Camera bearing that looks at the plot from across its longest road edge, turned 30 degrees
 * for a three-quarter view (so the 2:1 plane and the setbacks read). -18 when there is no road.
 */
function viewBearing(ring: LL[], det: DetectedEdge[]): number {
  let best = -1;
  let len = 0;
  det.forEach((e, i) => {
    if (e.role === 'road' && e.length > len) [best, len] = [i, e.length];
  });
  if (best < 0 || det.length !== ring.length) return -18;
  const f = makeFrame(ring[0]![0], ring[0]![1]);
  const xy = ring.map((p) => toXY(f, p));
  const a = xy[best]!;
  const b = xy[(best + 1) % xy.length]!;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let nx = (b[1] - a[1]) / L;
  let ny = -(b[0] - a[0]) / L;
  const m = [(a[0] + b[0]) / 2 + nx * 0.3, (a[1] + b[1]) / 2 + ny * 0.3];
  if (pointInRing(m, xy)) [nx, ny] = [-nx, -ny];
  // camera on the road side, looking into the plot (direction -n)
  return (Math.atan2(-nx, -ny) * 180) / Math.PI + 30;
}

/** The headline result over the map (on a phone the panel is below the fold). */
function ResultChip({ r, design, busy }: { r: EngineResult; design: number; busy: boolean }) {
  const env = r.regimes[r.regimes.chosen];
  const d = r.designs[design];
  const n = (v: number, dp = 0) => v.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp });
  if (!env.plates.length) return <div className={`map-kpi${busy ? ' busy' : ''}`}>Nothing can be built on this plot</div>;
  return (
    <div className={`map-kpi${busy ? ' busy' : ''}`}>
      <span><b>{n(env.permittedGfa)} m²</b> allowed</span>
      <span>FAR {n(env.farReached, 2)}</span>
      <span>{env.floors} floors · {n(env.height, 1)} m</span>
      <span>{env.regime === 'high' ? 'High-rise' : 'Low-rise'}</span>
      {d && <span className={d.passes ? 'ok' : 'bad'}>{d.name}: {d.passes ? 'passes' : 'fails'}</span>}
    </div>
  );
}

function Legend({ view, setView, hasGhost }: { view: ViewToggles; setView: (v: ViewToggles) => void; hasGhost: boolean }) {
  const item = (k: keyof ViewToggles, label: string, sw: string, disabled = false) => (
    <label className={`lg-item${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={view[k] && !disabled} disabled={disabled} onChange={(e) => setView({ ...view, [k]: e.target.checked })} />
      <span className="sw" style={{ background: sw }} />
      {label}
    </label>
  );
  return (
    <details className="legend" open={window.innerWidth > 860}>
      <summary>Layers</summary>
      {item('envelope', 'Allowed envelope', 'rgba(60,128,246,.35)')}
      {item('ghost', 'Other regime (outline)', 'transparent', !hasGhost)}
      {item('twoX', '2:1 road plane', 'rgba(255,104,56,.4)')}
      {item('buildings', 'Neighbour buildings (lighter: height estimated)', '#c4c6ce')}
      {item('row', 'City right-of-way', 'rgba(245,158,11,.35)')}
      <div className="lg-roles">
        <span><i style={{ background: 'rgb(234,120,32)' }} />road</span>
        <span><i style={{ background: 'rgb(36,132,220)' }} />canal</span>
        <span><i style={{ background: 'rgb(120,124,132)' }} />neighbour</span>
      </div>
    </details>
  );
}
