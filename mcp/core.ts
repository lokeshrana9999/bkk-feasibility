// Tool logic of the MCP server, free of MCP types so it can be tested directly. Every function
// returns plain JSON: { ok: true, ... } or a typed { ok: false, code, message }. The plot pipeline
// is the web app's (src/App.tsx): zone by majority -> right-of-way snap and cut (preparePlot) ->
// road detection -> edge overrides (mergeEdges) -> evaluate(). No rule lives here.

import { evaluate } from '../src/engine/evaluate.js';
import { LIMITS, RULES, RULE_ORDER, TYPE_PARAMS } from '../src/engine/rules.js';
import type { BuildingType, EdgeRole, EngineInput, EngineResult, Envelope } from '../src/engine/types.js';
import type { Area, ZonePoly } from '../src/site/data';
import { areaM2, openRing, pointInPoly, selfIntersects, signedArea, type LL } from '../src/site/geo';
import { nameKey } from '../src/site/parse';
import { preparePlot, type Prepared } from '../src/site/prep';
import type { DetectedEdge } from '../src/site/roads';
import { zoneState } from '../src/site/zone';
import { hashOf, mergeEdges, toEngineEdge, type EdgeOverride } from '../src/ui/state';
import { DataUnavailable, type SiteData } from './data';

export const APP_URL = 'https://bkk-feasibility.vercel.app';
export const REPO_URL = 'https://github.com/lokeshrana9999/bkk-feasibility';
export const DISCLAIMER =
  'Feasibility aid, not a legal opinion. Figures come from a deterministic reading of the cited Bangkok rules on city map data; confirm with a licensed Thai architect or the district office before relying on them.';

export const TYPES = ['condo', 'apartment', 'office', 'hotel'] as const;
export const MAX_VERTICES = LIMITS.maxVertices; // 500
export const MAX_AREA = LIMITS.maxArea; // 200,000 m2

export type ErrorCode =
  | 'invalid-input'
  | 'too-few-points'
  | 'too-many-vertices'
  | 'too-large'
  | 'zero-area'
  | 'self-intersection'
  | 'invalid-override'
  | 'unknown-zone'
  | 'outside-scope'
  | 'no-land'
  | 'data-unavailable'
  | 'engine-error';

export interface ToolError {
  ok: false;
  code: ErrorCode;
  message: string;
  /** Vertex or edge index the error refers to, when there is one. */
  index?: number;
  /** For outside-scope: the zone the plot or point is in. */
  zone?: ZoneOut | null;
  /** For engine-error: the engine's own error code. */
  engineCode?: string;
}

export interface Ctx {
  data: SiteData;
  /** Origin of the web app, for share links (the deployment that serves this server). */
  appUrl: string;
}

const fail = (code: ErrorCode, message: string, extra: Partial<ToolError> = {}): ToolError => ({ ok: false, code, message, ...extra });
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

interface ZoneOut {
  code: string;
  codeLatin: string;
  family: string;
  far: number;
  osrPct: number;
  inScope: boolean;
  use?: string;
}
const zoneOut = (z: ZonePoly): ZoneOut => ({
  code: z.sub,
  codeLatin: z.subLatin,
  family: z.zone,
  far: z.far,
  osrPct: z.osr,
  inScope: z.isY9,
  ...(z.use ? { use: z.use } : {}),
});

/** Runs a tool body, turning missing site data into a typed error. */
async function guard<T>(f: () => Promise<T | ToolError>): Promise<T | ToolError> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof DataUnavailable) return fail('data-unavailable', `${e.message}; try again shortly`);
    return fail('engine-error', `internal error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------- input checks

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Plot ring: [x, y] pairs (lon/lat degrees or metres), open or closed, 3..500 corners, simple. */
export function readRing(raw: unknown, units: 'lonlat' | 'm'): { ok: true; ring: LL[] } | ToolError {
  if (!Array.isArray(raw)) return fail('invalid-input', 'ring must be an array of [lon, lat] pairs');
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) {
      return fail('invalid-input', `ring[${i}] must be a pair of finite numbers`, { index: i });
    }
    if (units === 'lonlat' && (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) {
      return fail('invalid-input', `ring[${i}] is not a [lon, lat] pair in degrees (lon first)`, { index: i });
    }
  }
  const ring = openRing(raw as LL[]);
  if (ring.length < 3) return fail('too-few-points', `a plot needs at least 3 corners (got ${ring.length})`);
  if (ring.length > MAX_VERTICES) return fail('too-many-vertices', `plot has ${ring.length} corners; the limit is ${MAX_VERTICES}`);
  if (selfIntersects(ring)) return fail('self-intersection', 'the plot outline crosses itself');
  const area = units === 'lonlat' ? areaM2(ring) : Math.abs(signedArea(ring));
  if (area > MAX_AREA) return fail('too-large', `plot is ${Math.round(area).toLocaleString('en-US')} m2; the limit is ${MAX_AREA.toLocaleString('en-US')} m2`);
  if (area < LIMITS.minArea) return fail('zero-area', 'plot has (almost) no area');
  return { ok: true, ring };
}

export interface EdgeOverrideIn {
  index: number;
  role: EdgeRole;
  width?: number;
  gap?: number;
  name?: string;
}

function readOverrides(raw: EdgeOverrideIn[] | undefined, n: number): { ok: true; map: Record<number, EdgeOverride>; names: Record<number, string> } | ToolError {
  const map: Record<number, EdgeOverride> = {};
  const names: Record<number, string> = {};
  for (const o of raw ?? []) {
    const i = o.index;
    if (!Number.isInteger(i) || i < 0 || i >= n) return fail('invalid-override', `edge index ${i} is out of range: this plot has edges 0..${n - 1}`, { index: i });
    if (map[i]) return fail('invalid-override', `edge ${i} is given twice`, { index: i });
    if (!['road', 'canal', 'private'].includes(o.role)) return fail('invalid-override', `edge ${i}: role must be road, canal or private`, { index: i });
    const e: EdgeOverride = { role: o.role };
    if (o.role === 'private' && (o.width !== undefined || o.gap !== undefined)) {
      return fail('invalid-override', `edge ${i}: a private (neighbour) edge takes no width or gap`, { index: i });
    }
    if (o.width !== undefined) {
      if (!isNum(o.width) || o.width < LIMITS.minWidth || o.width > LIMITS.maxWidth) return fail('invalid-override', `edge ${i}: width must be ${LIMITS.minWidth}-${LIMITS.maxWidth} m`, { index: i });
      e.width = o.width;
    }
    if (o.gap !== undefined) {
      if (!isNum(o.gap) || o.gap < 0 || o.gap > LIMITS.maxGap) return fail('invalid-override', `edge ${i}: gap must be 0-${LIMITS.maxGap} m`, { index: i });
      e.gap = o.gap;
    }
    if (o.name !== undefined && o.role !== 'private') names[i] = String(o.name).slice(0, 80);
    map[i] = e;
  }
  return { ok: true, map, names };
}

// ---------------------------------------------------------------------------- site step

interface Site {
  drawn: LL[];
  zone: ZonePoly;
  share: number;
  others: { zone: ZonePoly; share: number }[];
  area: Area | null;
  prep: Prepared;
  edges: DetectedEdge[];
}

/** The app's site pipeline for a drawn lon/lat ring. */
async function site(ctx: Ctx, drawn: LL[]): Promise<Site | ToolError> {
  const [y9, other, areas] = await Promise.all([ctx.data.zonesY9(), ctx.data.zonesOther(), ctx.data.areas()]);
  const zs = zoneState(drawn, y9, other);
  if (zs.kind !== 'y9') {
    const hit = zs.kind === 'outside' ? zs.hit : null;
    return fail(
      'outside-scope',
      hit
        ? `most of this plot is in zone ${hit.zone.sub} (${hit.zone.subLatin}, FAR ${hit.zone.far}); this tool covers zone ย.9 (Y9) of the Bangkok plan only`
        : 'this plot is outside the Bangkok comprehensive plan data; this tool covers zone ย.9 (Y9) only',
      { zone: hit ? zoneOut(hit.zone) : null },
    );
  }
  const area = areas.find((a) => a.id === zs.hit.zone.id) ?? null;
  const rows = area ? await ctx.data.rowsOf(area) : [];
  const prep = preparePlot(drawn, rows);
  if (prep.ring.length < 3) return fail('no-land', 'the whole plot lies on public right-of-way (road, canal or rail); nothing is left to build on');
  // English labels where OpenStreetMap has one (the Thai name stays the engine's key), as the app does
  const en = area ? await ctx.data.roadNamesOf(area) : new Map<string, string>();
  const edges = prep.edges.map((e) => {
    if (!e.label || /[a-z]/i.test(e.label)) return e;
    const l = en.get(nameKey(e.label));
    return l ? { ...e, label: l } : e;
  });
  return { drawn, zone: zs.hit.zone, share: zs.hit.share, others: zs.others, area, prep, edges };
}

const edgeRows = (ring: LL[], edges: { role: EdgeRole; width?: number; gap?: number; label?: string; source: string; length: number }[]) =>
  edges.map((e, i) => ({
    index: i,
    from: ring[i],
    to: ring[(i + 1) % ring.length],
    lengthM: r2(e.length),
    role: e.role,
    ...(e.role !== 'private' ? { widthM: e.width, gapM: e.gap ?? 0 } : {}),
    ...(e.label ? { label: e.label } : {}),
    source: e.source,
  }));

// ---------------------------------------------------------------------------- tools

export function about(ctx: Ctx) {
  return {
    ok: true as const,
    name: 'Bangkok ย.9 feasibility engine',
    what: 'Given a plot in Bangkok zone ย.9 (Y9, high-density residential), returns the rules that apply with their cited Thai articles, the buildable envelope under both the low-rise and the high-rise regime (floors, height, permitted floor area, binding rule) and three massing designs checked rule by rule. Same deterministic engine as the web app; no LLM, no keys, read-only.',
    scope: {
      zone: 'ย.9 (Y9) of the Bangkok Comprehensive Plan, Ministerial Regulation B.E. 2556 (2013): 31 sub-zone polygons, FAR 7 (ย.๙-๔: FAR 6) and OSR 4.5-5%',
      buildingTypes: [...TYPES],
      limits: { maxVertices: MAX_VERTICES, maxAreaM2: MAX_AREA, maxEdgeWidthM: LIMITS.maxWidth, maxGapM: LIMITS.maxGap },
      notCovered: 'Other zones, basements, parapets, FAR bonuses, parking, EIA, unit layouts, fire lanes and landscape (shown as not assessed).',
    },
    sources: {
      rules: [
        'Bangkok Comprehensive Plan MR B.E. 2556 (Royal Gazette 130/41 ก): zoning arts. 16, 36',
        'Bangkok Building Control Ordinance B.E. 2544: arts. 49-55',
        'Ministerial Regulation 55 (B.E. 2543): arts. 33, 41-46, 50',
        'Ministerial Regulation 33 (B.E. 2535, as amended by MR 50): arts. 1-6 (high-rise / extra-large)',
      ],
      data: [
        { data: 'Zoning polygons, FAR / OSR', source: 'Bangkok Metropolitan Administration, City Planning GIS (plan 2556)', licence: 'no licence text published; used with credit to BMA' },
        { data: 'Right-of-way polygons (road widths)', source: 'BMA, public ways on Department of Lands map sheets', licence: 'no licence text published; used with credit to BMA and DOL' },
        { data: 'Road names (English)', source: 'OpenStreetMap contributors via Overpass', licence: 'ODbL 1.0' },
        { data: 'Neighbour buildings (web app 3D only)', source: 'Overture Maps (OSM, Google Open Buildings, Microsoft), Google Open Buildings 2.5D heights', licence: 'ODbL 1.0 / CDLA-Permissive-2.0 / CC BY 4.0' },
      ],
    },
    decisionsToTake: [
      'Abutting: a road counts as frontage only when the plot touches it (gap <= 1 mm).',
      'Hotel rooms: the given hotel_rooms, else 50 m2 of floor area per room, for the 80-room gate.',
      'One side: frontage is one straight side (edges within 5 degrees); bent or curved frontages do not add up.',
      'Wider-road relief (MR 55 arts. 45-46) is applied to corner and two-road plots.',
      'Same road: chains that do not meet are two roads only when both are named and the names differ.',
      'Commercial within 20 m of a road: a declared dwelling keeps the road setback in the checker.',
      'Gap strip between plot and road is road reserve unless the edge is marked otherwise.',
    ],
    stricterReadings: 'Where the ordinance and a ministerial regulation differ, or the text leaves room, the engine applies the stricter reading (eg the 2x height rule on every road, not only the nearest).',
    tools: {
      about: 'this summary',
      find_zone: 'lat, lng -> zone code, FAR, OSR, in scope or not',
      get_rules: 'zone code or lat/lng + building type -> cited rule rows',
      detect_roads: 'plot ring (lon/lat) -> each edge: road / canal / neighbour, measured right-of-way width and gap',
      evaluate_plot: 'plot ring + building type (+ edge overrides, floor heights) -> rules applied, both regimes, designs with checklists, share link to the 3D app',
    },
    workflow: 'find_zone (is it ย.9?) -> detect_roads (check the road widths; correct them with edge overrides if the map is wrong) -> evaluate_plot -> open shareLink to see it in 3D.',
    links: { app: ctx.appUrl, repo: REPO_URL, mcp: `${ctx.appUrl}/mcp` },
    disclaimer: DISCLAIMER,
  };
}

export function findZone(ctx: Ctx, lat: number, lng: number) {
  return guard(async () => {
    if (!isNum(lat) || !isNum(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail('invalid-input', 'lat must be -90..90 and lng -180..180 (decimal degrees)');
    const p: LL = [lng, lat];
    const [y9, other, areas] = await Promise.all([ctx.data.zonesY9(), ctx.data.zonesOther(), ctx.data.areas()]);
    const inZ = (z: ZonePoly) => z.bbox[0] <= lng && lng <= z.bbox[2] && z.bbox[1] <= lat && lat <= z.bbox[3] && z.polys.some((q) => pointInPoly(p, q));
    const z = y9.find(inZ) ?? other.find(inZ) ?? null;
    const area = z?.isY9 ? areas.find((a) => a.id === z.id) : undefined;
    return {
      ok: true as const,
      point: { lat, lng },
      inScope: !!z?.isY9,
      zone: z ? zoneOut(z) : null,
      ...(area ? { area: { id: area.id, label: area.labelLatin, areaM2: area.areaM2 } } : {}),
      note: z
        ? z.isY9
          ? 'In scope. A plot is assigned the zone that holds most of it; call evaluate_plot with the plot outline.'
          : `Zone ${z.sub} is outside this tool's scope (ย.9 only); FAR and OSR are from the city plan data, but no rules are evaluated here.`
        : 'Not inside any zone of the Bangkok comprehensive plan data.',
      disclaimer: DISCLAIMER,
    };
  });
}

function ruleRow(id: string) {
  const r = RULES[id]!;
  return { id: r.id, kind: r.kind, source: r.source, article: r.article, quoteTh: r.quoteTh, text: r.text };
}

/** Rows that only concern some building types (zoning art. 16 gates, the rear walkway). */
const ONLY_FOR: Record<string, BuildingType[]> = { 'Z16-HOTEL': ['hotel'], 'Z16-OFFICE': ['office'], 'ORD52-7-REAR': ['office', 'hotel'] };

/** The full cited rule table (resource rules://y9). */
export function ruleTable() {
  return {
    scope: 'Bangkok zone ย.9 (Y9), Comprehensive Plan B.E. 2556; building control ordinance B.E. 2544; MR 33, MR 55',
    rules: RULE_ORDER.map((id) => ({ ...ruleRow(id), ...(ONLY_FOR[id] ? { onlyFor: ONLY_FOR[id] } : {}) })),
    typeParams: TYPE_PARAMS,
    disclaimer: DISCLAIMER,
  };
}

export function resolveZoneCode(zones: ZonePoly[], code: string): ZonePoly | null {
  const k = code.trim().toLowerCase().replace(/\s+/g, '');
  return zones.find((z) => z.sub.toLowerCase() === k || z.subLatin.toLowerCase() === k) ?? null;
}

export function getRules(ctx: Ctx, a: { zone?: string; lat?: number; lng?: number; buildingType: BuildingType }) {
  return guard(async () => {
    if (!TYPES.includes(a.buildingType)) return fail('invalid-input', `building_type must be one of ${TYPES.join(', ')}`);
    const y9 = await ctx.data.zonesY9();
    let z: ZonePoly | null;
    if (a.zone !== undefined) {
      z = resolveZoneCode(y9, a.zone);
      if (!z) return fail('unknown-zone', `unknown ย.9 zone code "${a.zone}"; use eg "ย.๙-๒๓" or "Y9-23" (Y9-1 .. Y9-31), or give lat/lng`);
    } else if (a.lat !== undefined && a.lng !== undefined) {
      const fz = await findZone(ctx, a.lat, a.lng);
      if (!fz.ok) return fz;
      if (!fz.inScope) return fail('outside-scope', fz.note, { zone: fz.zone });
      z = y9.find((q) => q.sub === fz.zone!.code) ?? null;
      if (!z) return fail('unknown-zone', 'zone not found');
    } else {
      return fail('invalid-input', 'give either zone (eg "Y9-23") or lat and lng');
    }
    const t = TYPE_PARAMS[a.buildingType];
    const ids = RULE_ORDER.filter((id) => !ONLY_FOR[id] || ONLY_FOR[id]!.includes(a.buildingType));
    return {
      ok: true as const,
      zone: zoneOut(z),
      buildingType: { id: a.buildingType, label: t.label, dwelling: t.dwelling, defaultFloorHeightsM: t.floorH },
      limits: {
        far: `total floor area <= ${z.far} x plot area (Z16-FAR)`,
        osr: `open space >= ${z.osr}% of total floor area (Z16-OSR)`,
        openSpaceOfPlot: `open space >= ${t.dwelling ? 30 : 10}% of the plot (ORD52-OPEN / MR33-6)`,
        highRise: 'high-rise (>= 23 m) or extra-large (>= 10,000 m2) needs >= 12 m frontage on a public road >= 10 m wide (MR33-2) and 6 m from every boundary (MR33-4)',
      },
      rules: ids.map(ruleRow),
      note: 'Setbacks and the 2x height rule depend on the plot outline and its roads; evaluate_plot gives each rule\'s value for a plot.',
      disclaimer: DISCLAIMER,
    };
  });
}

export function detectRoads(ctx: Ctx, ringIn: unknown) {
  return guard(async () => {
    const rr = readRing(ringIn, 'lonlat');
    if (!rr.ok) return rr;
    const s = await site(ctx, rr.ring);
    if ('ok' in s) return s;
    const p = s.prep;
    return {
      ok: true as const,
      zone: { ...zoneOut(s.zone), share: r3(s.share) },
      plot: {
        drawnAreaM2: r2(p.drawnArea),
        buildableAreaM2: r2(areaM2(p.ring)),
        removedOnRightOfWayM2: r2(p.removed),
        droppedM2: r2(p.dropped),
        snappedEdges: p.snaps.map((x) => ({ drawnEdge: x.edge, byM: r2(x.by), ...(x.label ? { road: x.label } : {}) })),
        buildableRing: p.ring,
      },
      edges: edgeRows(p.ring, s.edges),
      roads: s.edges
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.role !== 'private')
        .map(({ e, i }) => ({ index: i, role: e.role, widthM: e.width, gapM: e.gap ?? 0, ...(e.label ? { label: e.label } : {}) })),
      note: 'Edges are those of buildableRing: the drawn plot, snapped to a right-of-way within 1.5 m and with any part on the right-of-way cut away. Widths are measured across the city right-of-way polygons. Pass corrections to evaluate_plot as edges: [{ index, role, width, gap }].',
      disclaimer: DISCLAIMER,
    };
  });
}

export interface EvaluateArgs {
  ring: unknown;
  units?: 'lonlat' | 'm';
  buildingType: BuildingType;
  edges?: EdgeOverrideIn[];
  zone?: string;
  nearStation?: boolean;
  widerRoadRelief?: boolean;
  floorHeights?: { ground: number; typical: number };
  hotelRooms?: number;
}

function envOut(e: Envelope) {
  return {
    allowed: e.allowed,
    ...(e.reason ? { reason: e.reason } : {}),
    floors: e.floors,
    heightM: r2(e.height),
    envelopeGfaM2: r2(e.gfa),
    permittedGfaM2: r2(e.permittedGfa),
    farReached: r3(e.farReached),
    limitedBy: e.limitedBy,
    caps: e.caps.map((c) => ({ rule: c.id, label: c.label, valueM2: r2(c.value) })),
    footprintM2: r2(e.footprint),
    openSpaceM2: r2(e.openSpace),
    stopReason: e.stopReason,
    floorPlates: e.plates.map((p) => ({ level: p.level, topM: r2(p.z1), areaM2: r2(p.area) })),
  };
}

/** Compact, rounded view of an engine result (no polygons). Shared with the tests. */
export function summarize(r: EngineResult) {
  return {
    plot: { areaM2: r2(r.plot.area), perimeterM: r2(r.plot.perimeter) },
    regimes: { chosen: r.regimes.chosen, low: envOut(r.regimes.low), high: envOut(r.regimes.high) },
    designs: r.designs.map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      regime: d.regime,
      floors: d.floors,
      heightM: r2(d.height),
      gfaM2: r2(d.gfa),
      far: r3(d.far),
      footprintM2: r2(d.footprint),
      openSpaceM2: r2(d.openSpace),
      targetGfaM2: r2(d.targetGfa),
      binding: d.binding,
      passes: d.passes,
      checkCounts: {
        pass: d.checks.filter((c) => c.status === 'pass').length,
        fail: d.checks.filter((c) => c.status === 'fail').length,
        notAssessed: d.checks.filter((c) => c.status === 'not-assessed').length,
      },
      checks: d.checks.map((c) => ({ id: c.id, rule: c.rule, label: c.label, required: c.required, actual: c.actual, status: c.status, ...(c.reason ? { reason: c.reason } : {}) })),
    })),
    rulesApplied: r.rules.filter((x) => x.applies).map((x) => ({ id: x.id, kind: x.kind, article: x.article, source: x.source, value: x.value, text: x.text, quoteTh: x.quoteTh })),
    rulesNotApplied: r.rules.filter((x) => !x.applies).map((x) => x.id),
    warnings: r.warnings.map((w) => ({ code: w.code, message: w.message })),
  };
}

export function evaluatePlot(ctx: Ctx, a: EvaluateArgs) {
  return guard(async () => {
    const units = a.units ?? 'lonlat';
    if (!TYPES.includes(a.buildingType)) return fail('invalid-input', `building_type must be one of ${TYPES.join(', ')}`);
    if (a.floorHeights) {
      const { ground, typical } = a.floorHeights;
      if (!isNum(ground) || !isNum(typical) || ground < 2.4 || ground > 10 || typical < 2.4 || typical > 10) return fail('invalid-input', 'floor heights must be 2.4-10 m');
    }
    if (a.hotelRooms !== undefined && (!Number.isInteger(a.hotelRooms) || a.hotelRooms < 1 || a.hotelRooms > 100_000)) return fail('invalid-input', 'hotel_rooms must be a positive whole number');
    const rr = readRing(a.ring, units);
    if (!rr.ok) return rr;

    let input: EngineInput;
    let zone: ZonePoly;
    let plotInfo: Record<string, unknown> = {};
    let shareLink: string | null = null;
    let edgeList: ReturnType<typeof edgeRows>;
    const station = a.nearStation ?? false;
    const relief = a.widerRoadRelief ?? true;
    const common = {
      type: a.buildingType,
      nearStation: station,
      widerRoadRelief: relief,
      ...(a.floorHeights ? { floorH: { ground: a.floorHeights.ground, typical: a.floorHeights.typical } } : {}),
      ...(a.hotelRooms !== undefined ? { hotelRooms: a.hotelRooms } : {}),
    };

    if (units === 'lonlat') {
      if (a.zone !== undefined) return fail('invalid-input', 'zone is only taken with units "m"; a lon/lat plot gets the zone that holds most of it');
      const s = await site(ctx, rr.ring);
      if ('ok' in s) return s;
      const ov = readOverrides(a.edges, s.edges.length);
      if (!ov.ok) return ov;
      const ui = mergeEdges(s.edges, ov.map);
      zone = s.zone;
      input = {
        ring: s.prep.ring,
        edges: ui.map(toEngineEdge),
        zone: { code: s.zone.sub, far: s.zone.far, osrPct: s.zone.osr },
        ...common,
      };
      edgeList = edgeRows(s.prep.ring, ui);
      plotInfo = {
        zoneShare: r3(s.share),
        drawnAreaM2: r2(s.prep.drawnArea),
        removedOnRightOfWayM2: r2(s.prep.removed),
        ...(s.prep.snaps.length ? { snappedEdges: s.prep.snaps.map((x) => ({ drawnEdge: x.edge, byM: r2(x.by) })) } : {}),
      };
      shareLink = `${ctx.appUrl}/${hashOf({ ring: rr.ring, type: a.buildingType, edges: ov.map, station, relief, floorH: a.floorHeights ?? null })}`;
    } else {
      // abstract plot in metres: no map, so the zone and the roads come from the caller
      if (a.zone === undefined) return fail('invalid-input', 'units "m" needs zone (eg "Y9-23"): a plot in metres has no location');
      const z = resolveZoneCode(await ctx.data.zonesY9(), a.zone);
      if (!z) return fail('unknown-zone', `unknown ย.9 zone code "${a.zone}"; use eg "ย.๙-๒๓" or "Y9-23"`);
      zone = z;
      const n = rr.ring.length;
      const ov = readOverrides(a.edges, n);
      if (!ov.ok) return ov;
      const blank: DetectedEdge[] = rr.ring.map((p, i) => {
        const q = rr.ring[(i + 1) % n]!;
        return { role: 'private', source: 'none', length: Math.hypot(q[0] - p[0], q[1] - p[1]), hitShare: 0, overlap: 0 };
      });
      const ui = mergeEdges(blank, ov.map).map((e) => ({ ...e, source: 'user' as const }));
      input = {
        ring: rr.ring,
        units: 'm',
        edges: ui.map((e, i) => ({ ...toEngineEdge(e), ...(ov.names[i] ? { name: ov.names[i] } : {}) })),
        zone: { code: z.sub, far: z.far, osrPct: z.osr },
        ...common,
      };
      edgeList = edgeRows(rr.ring, ui.map((e, i) => (ov.names[i] ? { ...e, label: ov.names[i] } : e)));
    }

    const out = evaluate(input);
    if (!out.ok) return fail('engine-error', out.message, { engineCode: out.code, ...(out.index !== undefined ? { index: out.index } : {}) });
    const s = summarize(out);
    return {
      ok: true as const,
      disclaimer: DISCLAIMER,
      headline: headline(out),
      inputs: {
        units,
        buildingType: a.buildingType,
        nearStation: station,
        widerRoadRelief: relief,
        floorHeightsM: a.floorHeights ?? TYPE_PARAMS[a.buildingType].floorH,
        ...(a.hotelRooms !== undefined ? { hotelRooms: a.hotelRooms } : {}),
      },
      zone: zoneOut(zone),
      plot: { ...s.plot, ...plotInfo, edges: edgeList },
      regimes: s.regimes,
      designs: s.designs,
      rulesApplied: s.rulesApplied,
      rulesNotApplied: s.rulesNotApplied,
      warnings: s.warnings,
      shareLink,
      ...(shareLink ? {} : { shareLinkNote: 'No share link for a plot in metres (it has no location).' }),
    };
  });
}

type EvalOk = Extract<Awaited<ReturnType<typeof evaluatePlot>>, { ok: true }>;

/**
 * The default, shorter view for an agent's context: no per-floor tables, Thai quotes dropped from
 * the applied rules (they stay in rules://y9 and get_rules), passing checks counted, not listed.
 */
export function brief(r: EvalOk) {
  const env = (e: EvalOk['regimes']['low']) => {
    const { floorPlates, ...rest } = e;
    return { ...rest, floorPlateCount: floorPlates.length };
  };
  return {
    ...r,
    regimes: { chosen: r.regimes.chosen, low: env(r.regimes.low), high: env(r.regimes.high) },
    designs: r.designs.map((d) => ({ ...d, checks: d.checks.filter((c) => c.status !== 'pass') })),
    rulesApplied: r.rulesApplied.map(({ quoteTh, ...x }) => (void quoteTh, x)),
    detailNote: 'Brief view: per-floor plates, passing checks and Thai quotes left out. Call again with detail "full" for them.',
  };
}

function headline(r: EngineResult): string {
  const e = r.regimes[r.regimes.chosen];
  const n = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  if (!e.plates.length || e.permittedGfa <= 0) return `Nothing can be built on this plot (${e.reason ?? e.stopReason}).`;
  const pass = r.designs.filter((d) => d.passes).length;
  return `${e.regime === 'high' ? 'High-rise' : 'Low-rise'} regime: ${n(e.permittedGfa)} m2 permitted (FAR ${n(e.farReached, 2)}), ${e.floors} floors, ${n(e.height, 1)} m, limited by ${e.limitedBy}. ${r.designs.length} designs, ${pass} pass every assessed rule.`;
}
