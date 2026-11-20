// MapLibre map (flat layers: basemap, zones, right-of-way, the editable plot via terra-draw)
// with a deck.gl overlay for everything that has height.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its tile worker from a URL next to its own module, which Vite's dependency
// bundling moves; hand it a Vite-built worker instead.
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import {
  TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, ValidateNotSelfIntersecting,
  type GeoJSONStoreFeatures,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { LL } from '../site/geo';
import { openRing } from '../site/geo';

maplibregl.setWorkerUrl(mlWorkerUrl);

type MLMap = maplibregl.Map;
type IControl = maplibregl.IControl;

export interface MapHandle {
  setPlot(ring: LL[], fly?: boolean): void;
  startDrawing(): void;
  flyTo(center: LL, zoom?: number): void;
  fitRing(ring: LL[]): void;
}

interface Props {
  layers: Layer[];
  zonesData: unknown | null;
  rowData: unknown | null;
  showRow: boolean;
  onRing: (ring: LL[] | null) => void;
  onDrawingChange: (drawing: boolean) => void;
  onReady: () => void;
}

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const START: LL = [100.5765, 13.7195];

const plotStyle = {
  fillColor: '#2f6fed' as const,
  fillOpacity: 0.08,
  outlineColor: '#1d4ed8' as const,
  outlineWidth: 2,
};

export const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const div = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const plotId = useRef<string | number | null>(null);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: div.current!,
      center: START,
      zoom: 16.4,
      pitch: 55,
      bearing: -18,
      maxPitch: 75,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    });
    // drop the basemap's US highway-shield layers (filters that warn on Bangkok data) and its
    // flat buildings (deck.gl draws the real ones in 3D)
    map.setStyle(STYLE, {
      transformStyle: (_prev, next) => ({ ...next, layers: next.layers.filter((l) => !/shield|building/i.test(l.id)) }),
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'BMA planning GIS · © OpenStreetMap · Overture Maps · Google Open Buildings (CC BY 4.0)',
      }),
      'bottom-right',
    );

    map.on('load', () => {
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#a0522d', 'fill-opacity': 0.07 } });
      map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': '#8b4513', 'line-width': 1.4, 'line-opacity': 0.7, 'line-dasharray': [3, 2] } });
      map.addLayer({
        id: 'zones-label', type: 'symbol', source: 'zones', minzoom: 12,
        layout: { 'text-field': ['get', 'subLatin'], 'text-size': 12, 'text-font': ['Noto Sans Regular'], 'symbol-placement': 'point' },
        paint: { 'text-color': '#7a3d12', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      });
      map.addSource('row', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'row-fill', type: 'fill', source: 'row',
        paint: { 'fill-color': ['match', ['get', 'kind'], 'canal', '#3b82f6', 'rail', '#6b7280', '#f59e0b'], 'fill-opacity': 0.22 },
      });

      // overlaid (own canvas, camera synced): deck 9.4's interleaved mode does not yet match
      // MapLibre 6's custom-layer render arguments
      const overlay = new MapboxOverlay({ interleaved: false, layers: cb.current.layers });
      overlayRef.current = overlay;
      map.addControl(overlay as unknown as IControl);

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({ styles: plotStyle, validation: (f) => ValidateNotSelfIntersecting(f) }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: { midpoints: true, draggable: true, deletable: true },
                },
              },
            },
            styles: {
              selectedPolygonColor: '#2f6fed',
              selectedPolygonFillOpacity: 0.08,
              selectedPolygonOutlineColor: '#1d4ed8',
              selectedPolygonOutlineWidth: 2,
              selectionPointColor: '#ffffff',
              selectionPointOutlineColor: '#1d4ed8',
              selectionPointOutlineWidth: 2,
              selectionPointWidth: 5,
              midPointColor: '#1d4ed8',
              midPointOutlineColor: '#ffffff',
              midPointWidth: 3,
            },
            validation: (f) => ValidateNotSelfIntersecting(f),
          }),
        ],
      });
      draw.start();
      draw.setMode('select');
      drawRef.current = draw;

      const emit = () => {
        const id = plotId.current;
        if (id === null) return;
        const f = draw.getSnapshotFeature(id);
        if (!f || f.geometry.type !== 'Polygon') return;
        cb.current.onRing(openRing((f.geometry.coordinates as LL[][])[0]!).map((p) => [p[0], p[1]] as LL));
      };
      let raf = 0;
      draw.on('change', (ids, type) => {
        if (draw.getMode() !== 'select' || plotId.current === null) return;
        if (type === 'delete' && ids.includes(plotId.current)) {
          plotId.current = null;
          cb.current.onRing(null);
          return;
        }
        if (!ids.includes(plotId.current)) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(emit);
      });
      draw.on('finish', (id, ctx) => {
        if (draw.getMode() === 'polygon' && ctx.action === 'draw') {
          plotId.current = id;
          draw.setMode('select');
          draw.selectFeature(id);
          cb.current.onDrawingChange(false);
          emit();
        } else if (ctx.action === 'dragFeature' || ctx.action === 'dragCoordinate') {
          emit();
        }
      });
      // keep the plot selected so its vertices stay editable
      draw.on('deselect', () => {
        const id = plotId.current;
        if (id !== null && draw.getMode() === 'select' && draw.hasFeature(id)) {
          setTimeout(() => {
            if (plotId.current === id && draw.getMode() === 'select' && draw.hasFeature(id)) draw.selectFeature(id);
          }, 0);
        }
      });
      cb.current.onReady();
    });
    map.on('error', (e) => {
      // tile / glyph hiccups should not take the app down; keep them out of the user's way
      console.warn('map:', e.error?.message ?? e);
    });
    return () => {
      drawRef.current?.stop();
      map.remove();
    };
  }, []);

  useEffect(() => {
    overlayRef.current?.setProps({ layers: props.layers });
  }, [props.layers]);

  useEffect(() => {
    const src = mapRef.current?.getSource('zones') as maplibregl.GeoJSONSource | undefined;
    if (src && props.zonesData) src.setData(props.zonesData as GeoJSON.FeatureCollection);
  }, [props.zonesData, overlayRef.current]);

  useEffect(() => {
    const map = mapRef.current;
    const src = map?.getSource('row') as maplibregl.GeoJSONSource | undefined;
    if (src && props.rowData) src.setData(props.rowData as GeoJSON.FeatureCollection);
    if (map?.getLayer('row-fill')) map.setLayoutProperty('row-fill', 'visibility', props.showRow ? 'visible' : 'none');
  }, [props.rowData, props.showRow, overlayRef.current]);

  useImperativeHandle(ref, () => ({
    setPlot(ring, fly = true) {
      const draw = drawRef.current;
      if (!draw) return;
      draw.setMode('select');
      if (plotId.current !== null && draw.hasFeature(plotId.current)) draw.removeFeatures([plotId.current]);
      const closed = [...ring, ring[0]!];
      const f: GeoJSONStoreFeatures = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [closed] },
        properties: { mode: 'polygon' },
      };
      const res = draw.addFeatures([f]);
      const id = res[0]?.valid ? res[0].id : null;
      plotId.current = id ?? null;
      if (id !== null && id !== undefined) draw.selectFeature(id);
      cb.current.onRing(ring);
      if (fly) this.fitRing(ring);
    },
    startDrawing() {
      const draw = drawRef.current;
      if (!draw) return;
      if (plotId.current !== null && draw.hasFeature(plotId.current)) {
        draw.setMode('select');
        draw.removeFeatures([plotId.current]);
      }
      plotId.current = null;
      cb.current.onRing(null);
      draw.setMode('polygon');
      cb.current.onDrawingChange(true);
    },
    flyTo(center, zoom = 16.4) {
      mapRef.current?.flyTo({ center, zoom, pitch: 55, duration: 1200 });
    },
    fitRing(ring) {
      const map = mapRef.current;
      if (!map) return;
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const c: LL = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.03);
      const zoom = Math.min(18, Math.max(15, Math.log2(360 / Math.max(span, 1e-5)) - 2.2));
      map.flyTo({ center: c, zoom, pitch: 58, bearing: map.getBearing() || -18, duration: 1000 });
    },
  }));

  return <div ref={div} className="map" />;
});
