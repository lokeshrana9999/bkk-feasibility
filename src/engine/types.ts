// Engine contract. Everything the engine returns is plain JSON (no classes),
// so it can cross a Web Worker boundary with structuredClone.

export type EdgeRole = 'road' | 'private' | 'canal';
export type BuildingType = 'condo' | 'apartment' | 'office' | 'hotel';
export type Regime = 'low' | 'high';

/** Local planar point in metres (x east, y north) relative to the frame origin. */
export type XY = [x: number, y: number];
/** One polygon: outer ring first (CCW), then holes (CW). Rings are open (last != first). */
export type Polygon = XY[][];

export interface EdgeInfo {
  role: EdgeRole;
  /** Right-of-way width in metres (road or canal). Required for road and canal. */
  width?: number;
  /** Distance in metres between this plot edge and the road/canal boundary (default 0). */
  gap?: number;
  name?: string;
  source: 'city' | 'user' | 'none';
}

export interface ZoneInfo {
  code: string;
  /** Floor area ratio cap, e.g. 7 for most ย.9 polygons, 6 for ย.๙-๔. */
  far: number;
  /** Open space ratio in percent of total floor area, e.g. 4.5. */
  osrPct: number;
}

export interface EngineInput {
  /** Plot outline. lon/lat degrees by default; metres when units = 'm'. Open or closed ring. */
  ring: [number, number][];
  units?: 'lonlat' | 'm';
  /** edges[i] describes the side from ring[i] to ring[i+1] (last one closes the ring). */
  edges: EdgeInfo[];
  zone: ZoneInfo | null;
  type: BuildingType;
  /** Within 500 m of a mass-transit station (waives zoning art. 16 road gates). */
  nearStation: boolean;
  /** Floor-to-floor heights in metres; defaults per building type (rules.ts). */
  floorH?: { ground: number; typical: number };
  /** Apply MR 55 arts. 45-46 wider-road relief on corner / two-road plots (default true). */
  widerRoadRelief?: boolean;
}

export interface Frame {
  lon0: number;
  lat0: number;
  /** metres per degree of longitude / latitude at lat0. 1 when units = 'm'. */
  mPerDegLon: number;
  mPerDegLat: number;
  units: 'lonlat' | 'm';
}

export interface Chain {
  id: number;
  role: EdgeRole;
  /** Indices into the normalised plot edges. */
  edges: number[];
  /** Open polyline in local metres (closed loop repeats the first point at the end). */
  points: XY[];
  closed: boolean;
  length: number;
  width?: number;
  gap: number;
  name?: string;
}

/** Why a chain sits where it does on a given floor. */
export interface DistancePart {
  rule: string; // rule row id
  d: number;
}

export interface FloorPlate {
  level: number;
  z0: number;
  z1: number;
  polygons: Polygon[];
  area: number;
  /** Required distance per chain id on this floor (metres from the plot edge). */
  dByChain: number[];
}

export interface Cap {
  id: string; // rule row id
  label: string;
  value: number;
}

export interface Envelope {
  regime: Regime;
  allowed: boolean;
  /** Why the regime is not allowed (gate) or why it has no floors. */
  reason?: string;
  plates: FloorPlate[];
  floors: number;
  height: number;
  /** Sum of plate areas (geometric envelope, before FAR or gate caps). */
  gfa: number;
  /** min(envelope GFA, FAR x area, gate caps). */
  permittedGfa: number;
  limitedBy: string;
  caps: Cap[];
  farReached: number;
  /** Ground plate area and plot area minus it. */
  footprint: number;
  openSpace: number;
  stopReason: string;
}

export type CheckStatus = 'pass' | 'fail' | 'not-assessed';

export interface CheckRow {
  id: string;
  rule: string; // rule row id
  label: string;
  required: string;
  actual: string;
  status: CheckStatus;
  reason?: string;
}

export type DesignKind = 'tower-podium' | 'slab' | 'courtyard';

export interface Design {
  id: string;
  kind: DesignKind;
  name: string;
  regime: Regime;
  plates: FloorPlate[];
  floors: number;
  height: number;
  gfa: number;
  footprint: number;
  openSpace: number;
  far: number;
  targetGfa: number;
  binding: string;
  checks: CheckRow[];
  passes: boolean;
}

export interface AppliedRule {
  id: string;
  source: string;
  article: string;
  quoteTh: string;
  text: string;
  kind: 'limit' | 'distance' | 'gate' | 'relief' | 'not-assessed';
  /** The value for this plot, in words. */
  value: string;
  applies: boolean;
}

export interface Warning {
  code: string;
  message: string;
}

export interface EngineResult {
  ok: true;
  frame: Frame;
  plot: { ring: XY[]; area: number; perimeter: number; edges: EdgeInfo[] };
  chains: Chain[];
  rules: AppliedRule[];
  regimes: { low: Envelope; high: Envelope; chosen: Regime };
  designs: Design[];
  warnings: Warning[];
}

export type EngineErrorCode =
  | 'invalid-input'
  | 'too-few-points'
  | 'non-finite'
  | 'edge-mismatch'
  | 'invalid-edge'
  | 'invalid-zone'
  | 'zero-area'
  | 'self-intersection'
  | 'too-large'
  | 'too-many-vertices'
  | 'internal';

export interface EngineError {
  ok: false;
  code: EngineErrorCode;
  message: string;
  /** Edge or vertex index the error refers to, when there is one. */
  index?: number;
}

export type EngineOutput = EngineResult | EngineError;
