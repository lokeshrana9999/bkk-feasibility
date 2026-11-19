// Metamorphic tests (fv-architecture section 3, M1-M6). Each transformation needs no
// legal reading: the same plot moved, renumbered, split, re-zoned or shrunk must keep
// its verdicts. Comparisons are on verdicts and totals, never on design identity
// (equal frontages are a legitimate tie under rigid motion; see M1).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/engine/index.js';
import type { Chain, CheckRow, EdgeInfo, EngineInput, EngineResult, FloorPlate, Polygon, XY } from '../src/engine/index.js';
import { buildChains } from '../src/engine/chains.js';
import { checkDesign, type CheckSite } from '../src/engine/checker.js';
import * as evaluateModule from '../src/engine/evaluate.js';
import { and, area, dropSmall, inset, openSlivers, toPath, toPolygons } from '../src/engine/geom.js';
import { polygonsArea, polylineDist, ringArea } from '../src/engine/measure.js';
import { PARAMS } from '../src/engine/rules.js';
import { engineInput, engineInputWideZone } from './arbitraries.js';

const RUNS = Number(process.env.PROP_RUNS ?? 80);
/** Properties that evaluate twice or check many stacks per case. */
const MEDIUM = Math.max(20, Math.floor(RUNS / 2));
const HEAVY = Math.max(20, Math.floor(RUNS / 4));
/** Densified (500+ vertex) plots cost ~10x a normal plot. */
const VERY_HEAVY = Math.max(8, Math.floor(RUNS / 10));
/** Highest acceptable share of cases skipped as near a discrete threshold. */
const MAX_SKIP = 0.3;

type Pt = [number, number];
const P: EdgeInfo = { role: 'private', source: 'user' };
const road = (width: number, extra: Partial<EdgeInfo> = {}): EdgeInfo => ({ role: 'road', width, gap: 0, source: 'user', ...extra });
const BASE: EngineInput = {
  units: 'm', ring: [[0, 0], [50, 0], [50, 40], [0, 40]], edges: [road(12), P, P, P],
  zone: { code: 'Y9', far: 7, osrPct: 4.5 }, type: 'condo', nearStation: false,
};

function run(i: EngineInput): EngineResult | null {
  const out = evaluate(i);
  return out.ok ? out : null;
}

/**
 * Relief pairs for a hand-built check site: the engine's own definition when it exports
 * one, else (engines before Codex #3 kept it private) every wider road within 60 m.
 */
function partnersFor(chains: Chain[]): number[][] {
  const engine = (evaluateModule as { reliefPartners?: (c: Chain[], on: boolean) => number[][] }).reliefPartners;
  if (typeof engine === 'function') return engine(chains, true);
  return chains.map((n) =>
    n.role !== 'road'
      ? []
      : chains
        .filter((w) => w.role === 'road' && w.id !== n.id && (w.width ?? 0) > (n.width ?? 0) && polylineDist(n.points, w.points) <= 60)
        .map((w) => w.id),
  );
}

function siteOf(r: EngineResult, i: EngineInput): CheckSite {
  return { ring: r.plot.ring, chains: r.chains, reliefPartners: partnersFor(r.chains), zone: i.zone!, type: i.type, nearStation: i.nearStation };
}

const fails = (rows: CheckRow[]) => rows.filter((c) => c.status === 'fail').map((c) => `${c.id}: need ${c.required}, got ${c.actual}`);

// ---------------------------------------------------------------------------
// transformations

function rigid(i: EngineInput, angle: number, dx: number, dy: number, mirror: boolean): EngineInput {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // mirroring keeps edge j on ring[j] -> ring[j+1], so the edge list is unchanged
  const ring = i.ring.map(([x0, y]) => {
    const x = mirror ? -x0 : x0;
    return [x * c - y * s + dx, x * s + y * c + dy] as Pt;
  });
  return { ...i, ring };
}

function cyclic(i: EngineInput, k: number): EngineInput {
  const n = i.ring.length;
  return { ...i, ring: i.ring.map((_, j) => i.ring[(j + k) % n]!), edges: i.edges.map((_, j) => i.edges[(j + k) % n]!) };
}

function reversed(i: EngineInput): EngineInput {
  const n = i.ring.length;
  const ring = i.ring.slice().reverse();
  // reversed edge j runs old ring[n-1-j] -> ring[n-2-j], which is old edge n-2-j
  return { ...i, ring, edges: ring.map((_, j) => i.edges[(n - 2 - j + n) % n]!) };
}

/** Insert a collinear vertex at fraction t of edge k; both halves keep edge k's data. */
function splitEdge(i: EngineInput, k: number, t: number): EngineInput {
  const n = i.ring.length;
  const a = i.ring[k]!;
  const b = i.ring[(k + 1) % n]!;
  const m: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { ...i, ring: [...i.ring.slice(0, k + 1), m, ...i.ring.slice(k + 1)], edges: [...i.edges.slice(0, k + 1), i.edges[k]!, ...i.edges.slice(k + 1)] };
}

/**
 * Densify every edge with an inward sawtooth of amplitude amp (teeth on alternate points),
 * about `target` vertices in all, every piece keeping its edge's data.
 */
function densify(i: EngineInput, amp: number, target: number): EngineInput {
  const ring = i.ring as Pt[];
  const n = ring.length;
  const sgn = ringArea(ring as XY[]) > 0 ? 1 : -1; // CCW: the left normal points inside
  const len = (k: number) => Math.hypot(ring[(k + 1) % n]![0] - ring[k]![0], ring[(k + 1) % n]![1] - ring[k]![1]);
  const perim = ring.reduce((s, _, k) => s + len(k), 0);
  const out: Pt[] = [];
  const edges: EdgeInfo[] = [];
  for (let k = 0; k < n; k++) {
    const a = ring[k]!;
    const b = ring[(k + 1) % n]!;
    const L = len(k);
    const nx = (-sgn * (b[1] - a[1])) / L;
    const ny = (sgn * (b[0] - a[0])) / L;
    const m = Math.max(2, Math.round((target * L) / perim));
    for (let j = 0; j < m; j++) {
      const t = j / m;
      const off = j % 2 === 1 ? amp : 0;
      out.push([a[0] + t * (b[0] - a[0]) + off * nx, a[1] + t * (b[1] - a[1]) + off * ny]);
      edges.push(i.edges[k]!);
    }
  }
  return { ...i, ring: out, edges };
}

// ---------------------------------------------------------------------------
// summaries, tolerances and discrete thresholds

const edgeLens = (r: XY[]) => r.map((p, k) => Math.hypot(r[(k + 1) % r.length]![0] - p[0], r[(k + 1) % r.length]![1] - p[1]));
const polyPerim = (poly: Polygon) => poly.reduce((s, ring) => s + edgeLens(ring).reduce((a, b) => a + b, 0), 0);
/** Edges under 3 m: arc chords (a 60 m arc at 10 mm sagitta has 2.2 m chords) and short straight edges. */
const ARC_EDGE = 3;
/**
 * How far the integer-millimetre geometry can move a stack's area between two placements of
 * the same plot. Per plate: 3 mm x perimeter (the plot outline, each setback buffer and each
 * intersection point are rounded to the grid separately, up to 0.71 mm each, in both runs)
 * plus arcTol (10 mm) x arc length (round-join chords can sit anywhere within their sagitta).
 * The architecture note asked for 1 mm x perimeter; measured differences reach 1.5-2.2 mm per
 * metre of perimeter on plates with round joins, so 1 mm made M1 fail on correct output.
 */
const plateTol = (plates: FloorPlate[]) =>
  plates.reduce((s, p) => s + p.polygons.reduce((t, poly) => {
    const lens = poly.flatMap(edgeLens);
    const per = lens.reduce((a, b) => a + b, 0);
    const arc = lens.filter((l) => l < ARC_EDGE).reduce((a, b) => a + b, 0);
    return t + 0.003 * per + PARAMS.arcTol * arc;
  }, 0), 0);

/**
 * Area that sits within 0.1 m of the 1.5 m sliver opening on floor 1: what a 1.6 m opening
 * (plus the 40 m2 part drop) would remove from the floor-1 plate. The grid can move a
 * neck or a tapering tip across the opening width, and every upper floor is clipped to
 * floor 1, so that area may flip on every floor (seen: a 20 m2 lobe behind a 1.5 m neck
 * kept in one placement and dropped in the mirror image).
 */
function openingSlack(plates: FloorPlate[]): number {
  const p = plates[0];
  if (!p) return 0;
  const src = p.polygons.flatMap((poly) => poly.map((ring) => toPath(ring)));
  const loss = area(src) - area(dropSmall(openSlivers(src, PARAMS.slivers + 0.1), PARAMS.minPlateArea).paths);
  return Math.max(0, loss) * plates.length;
}

/** Multiset of rule:status per design kind (row ids carry chain ids, which renumber). */
function statuses(r: EngineResult): Map<string, string[]> {
  return new Map(r.designs.map((d) => [d.kind, d.checks.map((c) => `${c.rule}:${c.status}`).sort()]));
}

/**
 * The slab is built along the longest frontage; when two frontages are within a couple of
 * millimetres (or tie exactly, as on a rectangle), a rigid motion may legitimately pick the
 * other one. Returns true when such a tie exists, for M1 only.
 */
function frontageTie(r: EngineResult): boolean {
  const NEAR = 0.002;
  const roads = r.chains.filter((c) => c.role === 'road');
  let runs: XY[][];
  if (roads.length > 0) {
    const maxLen = Math.max(...roads.map((c) => c.length));
    const long = roads.filter((c) => c.length >= maxLen - NEAR);
    if (long.length > 1) return true;
    runs = long.map((c) => c.points);
  } else runs = [[...r.plot.ring, r.plot.ring[0]!]];
  const segs = runs.flatMap((pts) => pts.slice(1).map((q, k) => Math.hypot(q[0] - pts[k]![0], q[1] - pts[k]![1])));
  const maxL = Math.max(...segs);
  return segs.filter((l) => l >= maxL - NEAR).length > 1;
}

/**
 * Reasons this result sits near a discrete threshold, where the millimetre grid can flip a
 * decision after a rigid motion: a plate part near the 40 m2 minimum, a part above floor 1
 * near the 1.5 m thickness test, the two regimes' permitted GFA within grid noise of each
 * other, a design GFA near a class or gate threshold (1,000 / 2,000 / 4,000 / 10,000 /
 * 30,000 m2), a design stopping with about 40 m2 left to place, and a touching road near
 * the 11.999 m frontage test.
 */
function thresholds(r: EngineResult): string[] {
  const out = new Set<string>();
  const { low, high } = r.regimes;
  for (const env of [low, high]) {
    for (const p of env.plates) {
      for (const poly of p.polygons) {
        const a = polygonsArea([poly]);
        if (a >= 39 && a <= 41) out.add('part-area-40');
        // upper floors drop parts thinner than 1.5 m (2 x area / perimeter); floor 1's
        // opening is covered by openingSlack in the GFA tolerance instead
        if (p.level > 1) {
          const t = (2 * a) / polyPerim(poly);
          if (t >= 1.4 && t <= 1.6) out.add('thickness-1.5');
        }
      }
    }
  }
  const band = 2 * (plateTol(low.plates) + plateTol(high.plates)) + 1e-3;
  const diff = Math.abs(high.permittedGfa - low.permittedGfa);
  if (high.allowed && diff > 0 && diff <= band) out.add('regime-tie');
  for (const d of r.designs) {
    const tol = plateTol(d.plates) + 0.01;
    for (const p of d.plates) for (const poly of p.polygons) {
      const a = polygonsArea([poly]);
      if (a >= 39 && a <= 41) out.add('part-area-40');
    }
    // a design that reached its target never exceeds it (the top floor is shaved to <= target),
    // so a threshold at or above the target cannot be crossed (eg 9,999 m2 vs 10,000 m2)
    const capped = d.gfa <= d.targetGfa + 1e-9 && d.targetGfa - d.gfa <= 1;
    for (const t of [1000, 2000, 4000, 10_000, 30_000]) {
      if (capped && d.targetGfa <= t) continue;
      if (Math.abs(d.gfa - t) <= tol) out.add('design-gfa');
    }
    if (Math.abs(d.targetGfa - d.gfa - 40) <= 1 + tol) out.add('design-last-40');
  }
  for (const c of r.chains) if (c.role === 'road' && Math.abs(c.length - 11.999) < 1e-6) out.add('frontage-12');
  // the courtyard design exists only if, with 6 m wings, the courtyard is >= 100 m2 and the
  // footprint within the open-space limit; near either edge it can appear or vanish
  // (nightly seeds -420666221 and -1064604905: margins of a few hundredths of a m2)
  for (const w of r.warnings) {
    if (w.code !== 'courtyard-skipped' || !w.data) continue;
    const { courtM2, minCourtM2, footM2, footLimitM2 } = w.data as Record<string, number>;
    if (Math.abs(courtM2! - minCourtM2!) <= 1 || Math.abs(footM2! - footLimitM2!) <= 1) out.add('courtyard-edge');
  }
  return [...out];
}

interface CompareOpts {
  /** M2: the same geometry renumbered, so designs must match exactly by kind and GFA. */
  strictDesigns: boolean;
  /**
   * Skip cases near a discrete threshold. Off for M2: renumbering leaves every coordinate
   * as it was, so no threshold can flip and a skip would only hide a real difference.
   */
  skipThresholds: boolean;
}

/** Differences in verdicts and totals between two results for the same plot. */
function compare(a: EngineResult, b: EngineResult, o: CompareOpts): string[] {
  const out: string[] = [];
  const eq = (what: string, x: unknown, y: unknown) => {
    if (x !== y) out.push(`${what}: ${String(x)} vs ${String(y)}`);
  };
  const near = (what: string, x: number, y: number, tol: number) => {
    if (!(Math.abs(x - y) <= tol)) out.push(`${what}: ${x} vs ${y} (tol ${tol.toFixed(4)})`);
  };
  eq('regimes.chosen', a.regimes.chosen, b.regimes.chosen);
  eq('high.allowed', a.regimes.high.allowed, b.regimes.high.allowed);
  for (const reg of ['low', 'high'] as const) {
    const x = a.regimes[reg];
    const y = b.regimes[reg];
    eq(`${reg}.floors`, x.floors, y.floors);
    // where a strip narrows slowly through the 1.5 m sliver width, the opening's cut point moves
    // with sub-cm chord placement (nightly seed -1305305052: a mirror image kept 1.2 m2 more on
    // floor 1, inherited by 4 floors); allow the reported difference on every floor
    const sliverSlack = Math.abs(x.sliverArea - y.sliverArea) * Math.max(x.floors, y.floors);
    const tol = Math.max(plateTol(x.plates) + openingSlack(x.plates), plateTol(y.plates) + openingSlack(y.plates)) + sliverSlack + 1e-6;
    near(`${reg}.gfa`, x.gfa, y.gfa, tol);
    near(`${reg}.permittedGfa`, x.permittedGfa, y.permittedGfa, tol + 1e-3);
  }
  eq('design count', a.designs.length, b.designs.length);
  eq('design kinds', a.designs.map((d) => d.kind).sort().join(','), b.designs.map((d) => d.kind).sort().join(','));
  const sa = statuses(a);
  const sb = statuses(b);
  const tie = !o.strictDesigns && (frontageTie(a) || frontageTie(b));
  for (const [kind, rows] of sa) {
    const other = sb.get(kind);
    if (!other) continue;
    if (kind === 'slab' && tie) continue; // a legitimate tie under rigid motion
    if (rows.join('|') !== other.join('|')) out.push(`${kind} check statuses differ: ${rows.join(' ')} vs ${other.join(' ')}`);
  }
  if (o.strictDesigns) {
    for (const d of a.designs) {
      const e = b.designs.find((x) => x.kind === d.kind);
      if (!e) continue;
      // Grid tolerance, not 1e-3: the slab's band rectangle is built from the frontage
      // segment's start point and direction, so reversing the ring rebuilds the same band
      // from the other end and its corners round differently (seen: 0.01-0.05 m2 on ~1,000
      // m2). A different frontage choice (open item #11) moves GFA by hundreds of m2.
      near(`${d.kind}.gfa`, d.gfa, e.gfa, Math.max(plateTol(d.plates), plateTol(e.plates)) + 1e-3);
      eq(`${d.kind}.floors`, d.floors, e.floors);
    }
  }
  return out;
}

class SkipStats {
  total = 0;
  skipped = 0;
  invalid = 0;
  reasons = new Map<string, number>();
  note(reasons: string[]): boolean {
    this.total++;
    if (reasons.length === 0) return false;
    this.skipped++;
    for (const r of reasons) this.reasons.set(r, (this.reasons.get(r) ?? 0) + 1);
    return true;
  }
  report(name: string): void {
    const by = [...this.reasons].map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`${name}: ${this.total} cases, ${this.skipped} skipped near a threshold (${((100 * this.skipped) / Math.max(1, this.total)).toFixed(1)}%${by ? `: ${by}` : ''}), ${this.invalid} rejected inputs`);
    expect(this.skipped / Math.max(1, this.total), `${name} skip rate`).toBeLessThan(MAX_SKIP);
  }
}

/** Runs a metamorphic pair: evaluate both, skip near thresholds, compare. */
function pair(stats: SkipStats, i: EngineInput, j: EngineInput, o: CompareOpts): void {
  const ra = evaluate(i);
  const rb = evaluate(j);
  if (!ra.ok || !rb.ok) {
    expect(rb.ok, `one side rejected: ${ra.ok ? '' : ra.code} / ${rb.ok ? '' : rb.code}`).toBe(ra.ok);
    if (!ra.ok && !rb.ok) expect(rb.code).toBe(ra.code);
    stats.invalid++;
    return;
  }
  const skip = stats.note(o.skipThresholds ? [...new Set([...thresholds(ra), ...thresholds(rb)])] : []);
  fc.pre(!skip);
  const diffs = compare(ra, rb, o);
  expect(diffs, diffs.join('\n')).toEqual([]);
}

// ---------------------------------------------------------------------------
// stacks for the checker tests

/** The top plate of an envelope extruded down every level: one shared polygons array. */
function extrude(plates: FloorPlate[]): FloorPlate[] {
  const top = plates[plates.length - 1];
  if (!top) return [];
  return plates.map((p) => ({ ...p, polygons: top.polygons, area: top.area }));
}

function unshare(plates: FloorPlate[]): FloorPlate[] {
  return plates.map((p) => ({ ...p, polygons: JSON.parse(JSON.stringify(p.polygons)) as Polygon[], dByChain: [...p.dByChain] }));
}

/** Deep-equal consecutive floors made to share one polygons array. */
function share(plates: FloorPlate[]): FloorPlate[] {
  const out: FloorPlate[] = [];
  let prevKey = '';
  for (const p of plates) {
    const key = JSON.stringify(p.polygons);
    const below = out[out.length - 1];
    out.push({ ...p, polygons: below && key === prevKey ? below.polygons : (JSON.parse(key) as Polygon[]) });
    prevKey = key;
  }
  return out;
}

/** Shrink every plate inward by d (clipper miter inset, as geom.ts), clipped to the shrunk floor below. */
function shrink(plates: FloorPlate[], d: number): FloorPlate[] {
  const out: FloorPlate[] = [];
  let prevSrc: unknown = null;
  let prevPaths: ReturnType<typeof inset> | null = null;
  for (const p of plates) {
    const below = out[out.length - 1];
    if (below && p.polygons === prevSrc) {
      out.push({ ...p, polygons: below.polygons, area: below.area });
      continue;
    }
    const src = p.polygons.flatMap((poly) => poly.map((ring) => toPath(ring)));
    let paths = inset(src, d);
    if (prevPaths) paths = and(paths, prevPaths);
    const polygons = toPolygons(paths);
    const area = polygonsArea(polygons);
    if (polygons.length === 0 || area <= 0) break;
    out.push({ ...p, polygons, area });
    prevSrc = p.polygons;
    prevPaths = paths;
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('metamorphic tests', () => {
  it('M1 rigid motion (rotate, translate, mirror) keeps verdicts and totals (random plots)', () => {
    const stats = new SkipStats();
    fc.assert(
      fc.property(
        engineInput,
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.boolean(),
        (i, angle, dx, dy, mirror) => pair(stats, i, rigid(i, angle, dx, dy, mirror), { strictDesigns: false, skipThresholds: true }),
      ),
      { numRuns: MEDIUM },
    );
    stats.report('M1');
  });

  it('M1 fixed: an exact 12 m frontage turned by 4 degrees keeps its verdicts (Codex #8)', () => {
    const i: EngineInput = { ...BASE, ring: [[0, 0], [12, 0], [50, 40], [0, 40]] };
    // no threshold skipping: this case must be compared
    pair(new SkipStats(), i, rigid(i, (4 * Math.PI) / 180, 0, 0, false), { strictDesigns: false, skipThresholds: false });
  });

  it('M2 cyclic start and reversal: same verdicts, designs equal by kind and GFA (random plots)', () => {
    const stats = new SkipStats();
    fc.assert(
      fc.property(engineInput, fc.nat(), fc.boolean(), (i, k, rev) => {
        const j = cyclic(i, k % i.ring.length);
        pair(stats, i, rev ? reversed(j) : j, { strictDesigns: true, skipThresholds: false });
      }),
      { numRuns: MEDIUM },
    );
    stats.report('M2');
  });

  it('M2 fixed: two equal, perpendicular frontages on a lopsided plot; the slab ignores ring start and direction (open item #11)', () => {
    // edges 0 and 3 are both 40 m and perpendicular; the plot is not symmetric about the
    // diagonal, so the two possible slabs differ (opposite sides of a rectangle would not:
    // a slab depends only on its direction)
    const ring: Pt[] = [[0, 0], [40, 0], [30, 25], [0, 40]];
    for (const edges of [[road(12, { name: 'A' }), P, P, road(12, { name: 'B' })], [P, P, P, P]]) {
      const i: EngineInput = { ...BASE, ring, edges };
      for (let k = 0; k < ring.length; k++) {
        for (const rev of [false, true]) {
          const j = cyclic(i, k);
          pair(new SkipStats(), i, rev ? reversed(j) : j, { strictDesigns: true, skipThresholds: false });
        }
      }
    }
  });

  it('M3 the checker gives deep-equal rows on cloned, un-shared and re-shared plates (Codex #10)', () => {
    fc.assert(
      fc.property(engineInput, (i) => {
        const r = run(i);
        if (!r) return;
        const site = siteOf(r, i);
        const chosen = r.regimes[r.regimes.chosen];
        const sets = [...r.designs.map((d) => d.plates), chosen.plates, extrude(chosen.plates)].filter((s) => s.length > 0);
        for (const plates of sets) {
          const a = checkDesign(site, plates);
          expect(checkDesign(site, structuredClone(plates))).toEqual(a);
          expect(checkDesign(site, unshare(plates))).toEqual(a);
          expect(checkDesign(site, share(unshare(plates)))).toEqual(a);
        }
      }),
      {
        numRuns: HEAVY,
        // Codex #10: corner of a 30 m and a 1 m road, so the 1 m road's 2x rule is relieved
        examples: [[{ ...BASE, edges: [road(30), P, P, road(1)] }]],
      },
    );
  });

  it('M4a splitting an edge with a collinear vertex keeps verdicts and totals', () => {
    const stats = new SkipStats();
    fc.assert(
      fc.property(engineInput, fc.nat(), fc.double({ min: 0.2, max: 0.8, noNaN: true }), (i, k, t) =>
        pair(stats, i, splitEdge(i, k % i.ring.length, t), { strictDesigns: false, skipThresholds: true })),
      { numRuns: MEDIUM },
    );
    stats.report('M4a');
  });

  it('M4b densified past 500 vertices (sawtooth < 0.1 m): every design keeps its distances from the TRUE outline (Codex #5)', () => {
    let tried = 0;
    let used = 0;
    fc.assert(
      fc.property(engineInput, fc.double({ min: 0.005, max: 0.04, noNaN: true }), fc.integer({ min: 520, max: 600 }), (i0, amp, target) => {
        tried++;
        const i = densify(i0, amp, target);
        const r = run(i);
        fc.pre(r !== null && r.warnings.some((w) => w.code === 'simplified'));
        used++;
        // the true outline in the engine's local frame, CCW like the engine's
        let ring = i.ring.map((p) => [p[0] - r!.frame.lon0, p[1] - r!.frame.lat0] as XY);
        let edges = i.edges;
        if (ringArea(ring) < 0) {
          const rev = reversed({ ...i, ring: ring as Pt[], edges });
          ring = rev.ring as XY[];
          edges = rev.edges;
        }
        const chains = buildChains(ring, edges);
        const site: CheckSite = { ring, chains, reliefPartners: partnersFor(chains), zone: i.zone!, type: i.type, nearStation: i.nearStation };
        for (const d of r!.designs) {
          expect(fails(d.checks), `${d.id} engine verdict`).toEqual([]);
          expect(fails(checkDesign(site, d.plates).checks), `${d.id} against the true outline`).toEqual([]);
        }
      }),
      { numRuns: VERY_HEAVY },
    );
    console.log(`M4b: ${used} of ${tried} densified plots were valid and simplified`);
    expect(used).toBeGreaterThan(tried / 2);
  });

  it('M4b fixed: the Codex #5 3 cm sawtooth (501 corners) keeps 3 m from the true boundary', () => {
    const ring: Pt[] = Array.from({ length: 499 }, (_, k) => [(20 * k) / 498, k % 2 ? 0.03 : 0] as Pt);
    ring.push([20, 20], [0, 20]);
    const i: EngineInput = { ...BASE, ring, edges: ring.map(() => P) };
    const r = run(i);
    expect(r).not.toBeNull();
    const local = ring.map((p) => [p[0] - r!.frame.lon0, p[1] - r!.frame.lat0] as XY);
    const chains = buildChains(local, i.edges);
    const site: CheckSite = { ring: local, chains, reliefPartners: chains.map(() => []), zone: i.zone!, type: i.type, nearStation: false };
    expect(r!.designs.length).toBeGreaterThan(0);
    for (const d of r!.designs) expect(fails(checkDesign(site, d.plates).checks), d.id).toEqual([]);
  });

  it('M5 raising FAR or lowering OSR never lowers either regime\'s permitted GFA (Codex #7)', () => {
    fc.assert(
      fc.property(
        engineInputWideZone,
        fc.double({ min: 0.01, max: 10, noNaN: true }),
        fc.double({ min: 0.01, max: 15, noNaN: true }),
        (i, dFar, dOsr) => {
          const z = i.zone!;
          const base = run(i);
          if (!base) return;
          const moreFar = run({ ...i, zone: { ...z, far: Math.min(20, z.far + dFar) } });
          const lessOsr = run({ ...i, zone: { ...z, osrPct: Math.max(0, z.osrPct - dOsr) } });
          for (const [what, r] of [['FAR raised', moreFar], ['OSR lowered', lessOsr]] as const) {
            expect(r, what).not.toBeNull();
            for (const reg of ['low', 'high'] as const) {
              const before = base.regimes[reg].permittedGfa;
              const after = r!.regimes[reg].permittedGfa;
              expect(after, `${what}: ${reg} permitted GFA ${before} -> ${after}`).toBeGreaterThanOrEqual(before - 1e-3);
            }
          }
        },
      ),
      {
        numRuns: MEDIUM,
        // Codex #7: FAR 7 -> 20 at OSR 10% used to drop the high regime to 0 m2
        examples: [[{ ...BASE, zone: { code: 'Y9', far: 7, osrPct: 10 } }, 13, 0.01]],
      },
    );
  });

  it('M6 shrinking a passing design inward keeps every row passing', () => {
    let designs = 0;
    fc.assert(
      fc.property(engineInput, fc.double({ min: 0.01, max: 0.5, noNaN: true }), (i, d) => {
        const r = run(i);
        if (!r) return;
        const site = siteOf(r, i);
        for (const des of r.designs) {
          const before = checkDesign(site, des.plates);
          if (fails(before.checks).length > 0) continue;
          const small = shrink(des.plates, d);
          if (small.length === 0) continue;
          designs++;
          const after = checkDesign(site, small);
          expect(after.measured.gfa).toBeLessThanOrEqual(before.measured.gfa + 1e-6);
          expect(fails(after.checks), `${des.id} shrunk by ${d} m`).toEqual([]);
        }
      }),
      { numRuns: HEAVY },
    );
    console.log(`M6: ${designs} passing designs shrunk and rechecked`);
    expect(designs).toBeGreaterThan(0);
  });
});
