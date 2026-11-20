// Engine output + site data -> deck.gl layers. No number shown in the UI is computed here;
// this file only turns geometry into meshes.

import { PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { toLonLat } from '../engine/frame';
import type { Chain, Design, EdgeRole, EngineResult, FloorPlate, Frame, XY } from '../engine/types';
import type { Building } from '../site/data';
import type { LL } from '../site/geo';
import { pointInRing } from '../site/geo';

export interface SceneState {
  result: EngineResult | null;
  buildings: Building[];
  ring: LL[] | null;
  roles: EdgeRole[];
  design: number; // index into result.designs, -1 = none
  showEnvelope: boolean;
  showGhost: boolean;
  show2x: boolean;
  showBuildings: boolean;
  hoverEdge: number | null;
}

type V3 = [number, number, number];
interface Slab {
  polygon: V3[][];
  h: number;
  level: number;
}

const ROLE_COLOR: Record<EdgeRole, [number, number, number]> = {
  road: [234, 120, 32],
  canal: [36, 132, 220],
  private: [120, 124, 132],
};

function slabs(frame: Frame, plates: FloorPlate[], gap = 0): Slab[] {
  const out: Slab[] = [];
  for (const p of plates) {
    for (const poly of p.polygons) {
      out.push({
        polygon: poly.map((ring) => ring.map((xy) => [...toLonLat(frame, xy), p.z0] as V3)),
        h: Math.max(0.05, p.z1 - p.z0 - gap),
        level: p.level,
      });
    }
  }
  return out;
}

function outlines(frame: Frame, plates: FloorPlate[], top = true): { path: V3[]; level: number }[] {
  const out: { path: V3[]; level: number }[] = [];
  for (const p of plates) {
    const z = top ? p.z1 : p.z0;
    for (const poly of p.polygons) {
      for (const ring of poly) {
        const path = ring.map((xy) => [...toLonLat(frame, xy), z] as V3);
        path.push(path[0]!);
        out.push({ path, level: p.level });
      }
    }
  }
  return out;
}

/**
 * The 2:1 plane of one road chain: a surface rising from the far side of the road (z = 0)
 * at 2 m up per 1 m across, over the plot, up to a bit above the envelope's top.
 */
function twoXPlanes(frame: Frame, plotRing: XY[], chains: Chain[], topZ: number): V3[][][] {
  const out: V3[][][] = [];
  for (const c of chains) {
    if (c.role !== 'road' || c.width === undefined) continue;
    const off = c.width + c.gap;
    const D = Math.max(4, (topZ + 6) / 2 - off);
    for (let i = 0; i + 1 < c.points.length; i++) {
      const a = c.points[i]!;
      const b = c.points[i + 1]!;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.5) continue;
      let nx = -(b[1] - a[1]) / L;
      let ny = (b[0] - a[0]) / L;
      const mid: XY = [(a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + ny * 0.5];
      if (!pointInRing(mid, plotRing)) [nx, ny] = [-nx, -ny];
      const P = (p: XY, s: number): V3 => [...toLonLat(frame, [p[0] + nx * s, p[1] + ny * s]), 2 * (s + off)];
      out.push([[P(a, -off), P(b, -off), P(b, D), P(a, D), P(a, -off)]]);
    }
  }
  return out;
}

const SKIP = import.meta.env.DEV ? new URLSearchParams(location.search).get('skip')?.split(',') ?? [] : [];

export function buildLayers(s: SceneState): Layer[] {
  // an empty extruded layer draws its walls with instanceCount -1 (GL_INVALID_VALUE warnings)
  return build(s).filter((l) => !SKIP.includes(l.id) && !(Array.isArray(l.props.data) && l.props.data.length === 0));
}

function build(s: SceneState): Layer[] {
  const layers: Layer[] = [];
  const r = s.result;

  if (s.showBuildings) {
    layers.push(
      new SolidPolygonLayer<Building>({
        id: 'buildings',
        data: s.buildings,
        extruded: true,
        getPolygon: (b) => b.ring,
        getElevation: (b) => b.height,
        getFillColor: (b) => (b.estimated ? [214, 214, 220, 235] : [196, 198, 206, 255]),
        material: { ambient: 0.55, diffuse: 0.6, shininess: 8, specularColor: [40, 40, 40] },
        pickable: true,
        updateTriggers: { getFillColor: s.buildings.length },
      }),
    );
  }

  if (s.ring && s.ring.length >= 3) {
    const n = s.ring.length;
    const edges = s.ring.map((p, i) => ({ path: [p, s.ring![(i + 1) % n]!], i, role: s.roles[i] ?? 'private' }));
    layers.push(
      new PathLayer<(typeof edges)[number]>({
        id: 'plot-edges',
        data: edges,
        getPath: (e) => e.path,
        getColor: (e) => [...ROLE_COLOR[e.role], 255],
        getWidth: (e) => (e.i === s.hoverEdge ? 7 : 4),
        widthUnits: 'pixels',
        capRounded: true,
        updateTriggers: { getColor: s.roles.join(), getWidth: s.hoverEdge },
        parameters: { depthCompare: 'always' },
      }),
      new TextLayer<(typeof edges)[number]>({
        id: 'edge-labels',
        data: edges,
        getPosition: (e) => [(e.path[0]![0] + e.path[1]![0]) / 2, (e.path[0]![1] + e.path[1]![1]) / 2, 0],
        getText: (e) => String(e.i + 1),
        getSize: 12,
        getColor: [255, 255, 255, 255],
        background: true,
        getBackgroundColor: (e) => [...ROLE_COLOR[e.role], 255],
        backgroundPadding: [5, 2, 5, 2],
        fontWeight: 700,
        fontFamily: 'Inter, system-ui, sans-serif',
        updateTriggers: { getBackgroundColor: s.roles.join() },
        parameters: { depthCompare: 'always' },
      }),
    );
  }

  if (!r) return layers;
  const chosen = r.regimes[r.regimes.chosen];
  const other = r.regimes[r.regimes.chosen === 'low' ? 'high' : 'low'];
  const d0 = r.designs[s.design];

  if (s.showGhost && other.allowed && other.plates.length) {
    layers.push(
      new PathLayer({
        id: 'ghost-outlines',
        data: outlines(r.frame, other.plates),
        getPath: (d: { path: V3[] }) => d.path,
        getColor: [110, 110, 120, 150],
        getWidth: 1.2,
        widthUnits: 'pixels',
      }),
    );
  }

  if (s.showEnvelope && chosen.plates.length) {
    layers.push(
      new SolidPolygonLayer<Slab>({
        id: 'envelope',
        data: slabs(r.frame, chosen.plates),
        extruded: true,
        getPolygon: (d) => d.polygon,
        getElevation: (d) => d.h,
        getFillColor: [60, 128, 246, d0 ? 10 : 22],
        material: false,
        parameters: { depthWriteEnabled: false },
      }),
      new PathLayer({
        id: 'envelope-outlines',
        data: outlines(r.frame, chosen.plates),
        getPath: (d: { path: V3[] }) => d.path,
        getColor: [44, 108, 230, d0 ? 120 : 170],
        getWidth: 1,
        widthUnits: 'pixels',
      }),
    );
  }

  const d: Design | undefined = d0;
  if (d) {
    // floors drawn as slabs with a thin gap, so storeys read; podium / ground floor darker
    layers.push(
      new SolidPolygonLayer<Slab>({
        id: 'design',
        data: slabs(r.frame, d.plates, 0.35),
        extruded: true,
        getPolygon: (x) => x.polygon,
        getElevation: (x) => x.h,
        getFillColor: (x) => (x.level === 1 ? [168, 120, 72, 255] : x.level <= 3 && d.kind === 'tower-podium' ? [222, 186, 140, 255] : [250, 232, 205, 255]),
        material: { ambient: 0.45, diffuse: 0.75, shininess: 32, specularColor: [70, 60, 50] },
        pickable: true,
        updateTriggers: { getFillColor: d.id },
      }),
    );
  }

  if (s.show2x && chosen.plates.length) {
    layers.push(
      new SolidPolygonLayer({
        id: 'two-x',
        data: twoXPlanes(r.frame, r.plot.ring, r.chains, chosen.height),
        getPolygon: (p: V3[][]) => p,
        getFillColor: [255, 104, 56, 46],
        extruded: false,
        _full3d: true,
        material: false,
        parameters: { depthWriteEnabled: false, cullMode: 'none' },
      }),
    );
  }
  return layers;
}
