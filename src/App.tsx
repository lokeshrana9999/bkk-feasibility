import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuildingType, EngineError, EngineInput, EngineResult } from './engine/types';
import { MapView, type MapHandle } from './scene/MapView';
import { buildLayers } from './scene/layers';
import {
  loadAreas, loadBuildings, loadRow, loadZonesAll, loadZonesY9, type Area, type Building, type RowFeature, type ZonePoly,
} from './site/data';
import { areaM2, bboxHit, bboxOf, centroidLL, makeFrame, pointInRing, selfIntersects, toXY, type LL } from './site/geo';
import { detectEdges, type DetectedEdge } from './site/roads';
import { lookupZone, type ZoneHit } from './site/zone';
import { EngineClient } from './worker/client';
import { Panel } from './ui/Panel';
import { DEMOS, mergeEdges, readHash, toEngineEdge, writeHash, type EdgeOverride } from './ui/state';

export interface ViewToggles {
  envelope: boolean;
  ghost: boolean;
  twoX: boolean;
  buildings: boolean;
  row: boolean;
}

const NEAR_M = 600;

export default function App() {
  const mapRef = useRef<MapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [zones, setZones] = useState<ZonePoly[]>([]);
  const [zonesFc, setZonesFc] = useState<unknown>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  const initial = useMemo(readHash, []);
  const [ring, setRing] = useState<LL[] | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [type, setType] = useState<BuildingType>(initial.type ?? 'condo');
  const [nearStation, setNearStation] = useState(false);
  const [relief, setRelief] = useState(true);
  const [floorH, setFloorH] = useState<{ ground: number; typical: number } | null>(null);
  const [overrides, setOverrides] = useState<Record<number, EdgeOverride>>({});
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [design, setDesign] = useState(0);
  const [view, setView] = useState<ViewToggles>({ envelope: true, ghost: false, twoX: false, buildings: true, row: true });

  const [viewArea, setViewArea] = useState<Area | null>(null);
  const [rows, setRows] = useState<RowFeature[]>([]);
  const [rowsFor, setRowsFor] = useState<number | null>(null);
  const [rowFc, setRowFc] = useState<unknown>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [outside, setOutside] = useState<ZoneHit | null>(null);

  const [result, setResult] = useState<EngineResult | null>(null);
  const [engineError, setEngineError] = useState<EngineError | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- static data
  useEffect(() => {
    Promise.all([loadAreas(), loadZonesY9()]).then(([a, z]) => {
      if (!a.length || !z.zones.length) setDataError('Could not load the zoning data. Check your connection and reload.');
      setAreas(a);
      setZones(z.zones);
      setZonesFc(z.fc);
    });
  }, []);

  // ---- engine worker
  const clientRef = useRef<EngineClient | null>(null);
  useEffect(() => {
    const c = new EngineClient(
      (out, t) => {
        setBusy(false);
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

  // ---- first plot: share link, else the demo
  useEffect(() => {
    if (!mapReady || !zones.length) return;
    mapRef.current?.setPlot(initial.ring ?? DEMOS[0]!.ring, true);
  }, [mapReady, zones.length > 0]);

  // a share link pasted into this tab (replaceState writes do not fire hashchange)
  useEffect(() => {
    const on = () => {
      const h = readHash();
      if (h.type) setType(h.type);
      if (h.ring) mapRef.current?.setPlot(h.ring, true);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // overrides belong to edges; a different vertex count means different edges
  const prevN = useRef(0);
  const onRing = useCallback((r: LL[] | null) => {
    const n = r?.length ?? 0;
    if (n !== prevN.current) setOverrides({});
    prevN.current = n;
    setRing(r);
  }, []);

  // ---- zone + area of the plot
  const zoneHit = useMemo(() => (ring && zones.length ? lookupZone(ring, zones) : null), [ring, zones]);
  const plotArea = useMemo(() => areas.find((a) => a.id === zoneHit?.zone.id) ?? null, [areas, zoneHit]);
  const activeArea = plotArea ?? viewArea;

  useEffect(() => {
    setOutside(null);
    if (!ring || zoneHit || !zones.length) return;
    let live = true;
    loadZonesAll().then((all) => {
      if (live) setOutside(lookupZone(ring, all));
    });
    return () => {
      live = false;
    };
  }, [ring, zoneHit, zones.length]);

  useEffect(() => {
    if (!activeArea) return;
    let live = true;
    loadRow(activeArea).then((r) => {
      if (!live) return;
      setRows(r);
      setRowsFor(activeArea.id);
      setRowFc({
        type: 'FeatureCollection',
        features: r.map((f) => ({ type: 'Feature', id: f.id, properties: { kind: f.kind, name: f.name }, geometry: { type: 'MultiPolygon', coordinates: f.polys } })),
      });
    });
    loadBuildings(activeArea).then((b) => live && setBuildings(b));
    return () => {
      live = false;
    };
  }, [activeArea?.id]);

  // ---- edges
  const ringOk = !!ring && ring.length >= 3 && !selfIntersects(ring);
  const detected = useMemo(() => (ring && ringOk ? detectEdges(ring, plotArea ? rows : []) : []), [ring, ringOk, rows, plotArea]);
  const edges = useMemo(() => mergeEdges(detected, overrides), [detected, overrides]);

  // frame a plot set from outside once its roads are known: camera across the main road
  const fitPending = useRef(false);
  const frame = useCallback(() => {
    if (ring) mapRef.current?.fitRing(ring, viewBearing(ring, detected));
  }, [ring, detected]);
  useEffect(() => {
    if (!fitPending.current || !ring) return;
    if (plotArea && rowsFor !== plotArea.id) return;
    fitPending.current = false;
    frame();
  }, [frame, ring, plotArea, rowsFor]);

  // ---- engine input
  const input: EngineInput | null = useMemo(() => {
    if (!ring || !ringOk || !zoneHit || edges.length !== ring.length) return null;
    return {
      ring,
      edges: edges.map(toEngineEdge),
      zone: { code: zoneHit.zone.sub, far: zoneHit.zone.far, osrPct: zoneHit.zone.osr },
      type,
      nearStation,
      widerRoadRelief: relief,
      ...(floorH ? { floorH } : {}),
    };
  }, [ring, ringOk, zoneHit, edges, type, nearStation, relief, floorH]);

  useEffect(() => {
    if (!input) {
      setResult(null);
      setEngineError(null);
      return;
    }
    setBusy(true);
    clientRef.current?.run(input);
  }, [input]);

  // share link, written once edits settle (not on every drag frame)
  useEffect(() => {
    if (drawing) return;
    const t = setTimeout(() => writeHash(ring, type), 600);
    return () => clearTimeout(t);
  }, [ring, type, drawing]);

  // keep the selected design valid
  useEffect(() => {
    if (result && design >= result.designs.length) setDesign(0);
  }, [result, design]);

  // ---- neighbours: within 600 m, minus anything standing on the plot (it gets demolished)
  const near = useMemo(() => {
    if (!ring || !buildings.length) return buildings.length && !ring ? buildings : [];
    const c = centroidLL(ring);
    const f = makeFrame(c[0], c[1]);
    const dLon = NEAR_M / f.kx;
    const dLat = NEAR_M / f.ky;
    const box: [number, number, number, number] = [c[0] - dLon, c[1] - dLat, c[0] + dLon, c[1] + dLat];
    const pb = bboxOf(ring);
    return buildings.filter((b) => {
      if (!bboxHit(b.bbox, box)) return false;
      const [x, y] = toXY(f, b.centroid);
      if (x * x + y * y > NEAR_M * NEAR_M) return false;
      if (bboxHit(b.bbox, pb) && (pointInRing(b.centroid, ring) || b.ring.some((p) => pointInRing(p, ring)))) return false;
      return true;
    });
  }, [buildings, ring]);

  const layers = useMemo(
    () =>
      buildLayers({
        result: input ? result : null,
        buildings: near,
        ring,
        roles: edges.map((e) => e.role),
        design,
        showEnvelope: view.envelope,
        showGhost: view.ghost,
        show2x: view.twoX,
        showBuildings: view.buildings,
        hoverEdge,
        onEdgeClick: (i) => {
          const order = ['road', 'canal', 'private'] as const;
          const cur = edgesRef.current[i]?.role ?? 'private';
          setOverride(i, { role: order[(order.indexOf(cur) + 1) % 3], width: undefined, gap: undefined });
        },
        onEdgeHover: setHoverEdge,
      }),
    [result, input, near, ring, edges, design, view, hoverEdge],
  );
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const setOverride = useCallback((i: number, o: EdgeOverride | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (o === null) delete next[i];
      else next[i] = { ...prev[i], ...o };
      return next;
    });
  }, []);

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
          onWantFit={() => {
            fitPending.current = true;
          }}
        />
        {drawing && <div className="map-hint">Click to place corners. Click the first corner to close the plot.</div>}
        {!drawing && !ring && mapReady && (
          <div className="map-hint">No plot. Press <b>Draw plot</b> in the panel, or pick a demo.</div>
        )}
        <Legend view={view} setView={setView} hasGhost={!!result && result.regimes[result.regimes.chosen === 'low' ? 'high' : 'low'].allowed} />
      </div>
      <Panel
        areas={areas}
        ring={ring}
        ringOk={ringOk}
        plotAreaM2={ring && ring.length >= 3 ? areaM2(ring) : 0}
        zoneHit={zoneHit}
        outside={outside}
        edges={edges}
        setOverride={setOverride}
        hoverEdge={hoverEdge}
        setHoverEdge={setHoverEdge}
        type={type}
        setType={setType}
        nearStation={nearStation}
        setNearStation={setNearStation}
        relief={relief}
        setRelief={setRelief}
        floorH={floorH}
        setFloorH={setFloorH}
        result={input ? result : null}
        engineError={input ? engineError : null}
        ms={ms}
        busy={busy}
        design={design}
        setDesign={setDesign}
        drawing={drawing}
        dataError={dataError}
        hasRowData={!!plotArea && rows.length > 0}
        onDraw={() => mapRef.current?.startDrawing()}
        onDemo={(r) => mapRef.current?.setPlot(r, true)}
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
  if (best < 0) return -18;
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
      {item('buildings', 'Neighbour buildings', '#c4c6ce')}
      {item('row', 'City right-of-way', 'rgba(245,158,11,.35)')}
      <div className="lg-roles">
        <span><i style={{ background: 'rgb(234,120,32)' }} />road</span>
        <span><i style={{ background: 'rgb(36,132,220)' }} />canal</span>
        <span><i style={{ background: 'rgb(120,124,132)' }} />private</span>
      </div>
    </details>
  );
}
