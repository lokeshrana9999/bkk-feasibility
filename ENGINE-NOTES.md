# Engine notes (phase 1)

The pure TypeScript engine in `src/engine/`. One entry point, `evaluate(input)`, returns either `{ ok: true, ... }` or a typed `{ ok: false, code, message, index? }`, and never throws. It has no DOM, fetch, Date or random calls: the same input always gives a deep-equal output that survives `structuredClone` and a JSON round trip. Run `npm test` for the suite and `npx tsx scripts/demo.ts` for the G1 printout.

## Rule questions

Places where `assumptions.md` or `engine-plan.md` and the source text disagree, or where the text leaves room. In each case the engine applies the stricter reading and goes on.

1. **Private-boundary setback: the larger of two readings.** MR 55 art. 50 sets the distance by the *building's* height: (1) up to 9 m, walls with openings 2 m from the boundary; (2) over 9 m and under 23 m, 3 m (`mr55-update.txt` 513-517). Ordinance art. 54 reads per floor: floors 1-2 up to 9 m at 2 m, floor 3 up or above 9 m at 3 m. Neither is always stricter (MR 55 for a tall building's lower floors, the ordinance for floor 3 of a building under 9 m), so the engine takes the larger per floor. G2 tests MR 55 (3 m on all seven floors); regression #2 tests the ordinance. Earlier versions applied only MR 55 and wrongly called it the stricter reading; the Codex review caught it. Verify with a Thai practitioner.
1a. **The road setback (ord. art. 50 para. 2 / MR 55 art. 41) applies at any height to commercial and public buildings and to large buildings.** Offices are commercial buildings (ord. art. 5(106): trade or business services); hotels are public buildings (5(109) names them); large buildings are over 2,000 m2, or 15 m tall and over 1,000 m2 (5(101)). The ordinance's small-dwelling exemption is not in MR 55, so it is not applied. The envelope always applies the setback.
1b. **Frontage means the plot touches the road.** MR 33 art. 2 ("ติดถนนสาธารณะ") and the zoning art. 16 road gates ("ตั้งอยู่ริมถนน") count a road chain only when its gap is at most 0.5 m (`PARAMS.frontageGapTol`, written call for map noise). The 12 m length test has a 1 mm float tolerance, so rotation cannot close the gate.
2. **Clear space around the building (ord. art. 55) also applies on road edges.** The article says "ที่ว่างโดยรอบอาคาร" (space all round the building) without excluding roads, so 1 m (<= 15 m) or 2 m (> 15 m) also applies on road edges. On 10-20 m roads this beats W/10 (e.g. 2 m instead of 1.2 m on a 12 m road for a 22.5 m building).
3. **Extra-large means 10,000 m2 or more.** MR 33 art. 1 says "ตั้งแต่ 10,000 ตารางเมตรขึ้นไป", in total or on any single floor. The low regime is therefore capped at 9,999 m2. High-rise means 23.00 m or more to the roof deck (พื้นดาดฟ้า), modelled as the top of the last floor.
4. **The 2x rule is applied to every road**, not only the nearest (ord. art. 49 / MR 55 art. 44 say the nearest). Distances are taken to the road chain's segments with round ends, so points beyond the end of a frontage are still covered. The law says perpendicular, so this is stricter.
5. **Wider-road relief (MR 55 arts. 45-46) is approximated.** The law's conditions are on the building: the corner case limits building length along the narrower road to <= 60 m, and the two-road case needs the roads <= 60 m apart and a building width along the wider road <= 60 m. The engine instead lifts the narrower road's 2x cut only inside a region within 60 m of the wider road (built 15 mm short of 60 m) and keeps its plain setback everywhere. It does not check the building-length condition. Relief applies only between different roads: two named chains are the same road when their names match; two unnamed chains meeting at a turn under 30° (`PARAMS.cornerTurnDeg`) are one road changing width. It can be switched off with `widerRoadRelief: false`. Ord. art. 49 para. 2 (within 100 m of an 80 m road) is not applied.
6. **Zoning art. 16 bans: business area is taken as total GFA.** The text says "พื้นที่ประกอบการ" (business area); using the whole GFA is stricter. Hotel rooms are estimated as GFA / 50 m2 (written call, `PARAMS.hotelGfaPerRoom`).
7. **Canal edges in the high regime get 6 m.** MR 33 art. 4 names only "other owners' land or public roads", so max(canal setback, 6 m) is a call (architecture F14).
8. **Hotels count as non-dwelling** for open space (10% of plot, ord. art. 52(2) / MR 33 art. 6(2)). This is the plan's call; a hotel is arguably residential use, which would mean 30%.
9. **MR 33 art. 2 frontage is the length of one road chain**: consecutive edges with the same road, width, gap and name. Two adjacent edges of the same road with different widths count separately. The "continues to another >= 10 m road" condition is shown as not assessed.

## Numeric guarantees

| Item | Value | Why |
|---|---|---|
| Integer grid | 1 mm | clipper2-ts works in integer millimetres |
| Arc chord tolerance | 10 mm (`PARAMS.arcTol`) | round joins are polygons; chords sit inside the true arc |
| Safety margin | 15 mm (`PARAMS.safety`) | every setback buffer is cut this much wider than the law, so chords plus rounding can never bring a plate closer than the legal distance |
| Checker distance tolerance | 1e-6 m (`PARAMS.checkTol`) | float noise only: a distance 0.5 mm short fails (rule-claims test) |
| Containment tolerance | 2 mm (`PARAMS.geomTol`) | "inside the plot" and "inside the floor below" (`containsPolygons`: vertices, edge pieces, courtyards of the floor below); boolean output can move a vertex about 1 mm |

`FloorPlate.dByChain` reports the *legal* distance; the geometry is cut 15 mm wider. A 28 x 38 m plate therefore reads 1,062 m2, not 1,064 m2 (`test/golden.test.ts` writes both figures). `test/deficit.local.ts` measures the worst shortfall of any envelope vertex against its required distance: after the fixes it found none over 300 random plots (before the fixes: 6.6 mm from compounding rounding, plus false alarms at the 60 m relief edge).

## How the envelope is built

- Chains: runs of consecutive edges with the same role (and, for roads and canals, the same width, gap and name).
- Each run computes `base = plot - union(buffer(chain, base distance))` once. Floor k is `base - (2x buffers at z_k, minus the relief region for relieved chains)`, clipped to floor k-1. Each floor is computed fresh, never from floor k-1's output, which would compound rounding. A floor whose 2x cut does not grow shares the floor below's geometry (the same `polygons` array: **do not mutate plates**).
- Slivers: the first floor of each run gets a full 1.5 m morphological opening. Above it only 2x fronts move, so parts are dropped when 2 x area / perimeter < 1.5 m or area < 40 m2. A thin tail attached to a wide part can survive above floor 1.
- Low regime: height bands 8 / 9 / 15 / < 23 m (arts. 50, 54, 55 depend on building height). Each band uses the top of its last floor as the building height. Bands that fit the same number of floors are skipped; the band that permits the most GFA wins.
- High regime: gated by MR 33 art. 2. It uses 6 m on every edge at every floor plus the 2x rule, up to 60 floors or an empty plate.
- `chosen` = the regime with the larger permitted GFA. Permitted GFA = min(envelope GFA, FAR x area, gate caps, plates clipped to the footprint the open-space rules allow).

## Designs and checker

- Three generators, all built by intersecting or insetting envelope plates: tower on podium (3 podium floors, tower plate up to 900 m2 for residential), slab along the main frontage (18 m deep for residential, 22 m for office), and a courtyard block (fixed courtyard of at least 100 m2 cut from the ground plate). Each stacks floors to the target GFA and shaves the top floor, then names its binding constraint. A design with no floors is not returned.
- The checker (`checker.ts`) re-measures each design from its output polygons with point-to-segment distances and shoelace areas (`measure.ts`, no clipper). It classifies the building (high-rise / extra-large) from the design itself and returns pass / fail / not-assessed rows. A design `passes` only if no row fails. Rules it cannot compute (permeable planting, fire lane, front open space, road link) are always "not-assessed", never "pass".
- Known weakness: where wider-road relief applies, the 2x check samples plate edges every 0.25 m, so on hand-made designs it can miss a violation narrower than that. Engine designs are safe because they sit inside the envelope.

## Performance (measured, `test/perf.test.ts`, this laptop, Node 24)

| Plot | median | p95 |
|---|---|---|
| 20-vertex, one road (the done criterion) | ~13 ms | ~15-19 ms |
| 20-vertex corner, two roads with relief | ~24 ms | ~26-28 ms |
| G1, 4 vertices | ~4 ms | ~5-7 ms |

Random "role soup" plots with 8-10 road chains of different widths take a few hundred ms (every floor has several relieved 2x fronts). Real plots rarely have more than two roads.

## Not done / cut

- No L-shaped design (courtyard instead). No basements, parapet allowance (0 m), FAR bonus, parking, EIA or unit layouts.
- Ord. art. 50 small-dwelling exemption not modelled (stricter).
- One building per plot; MR 55 art. 48 spacing between buildings not used.
- `zone: null` is a typed error (`invalid-zone`); the site layer decides what to do outside ย.9.

## Adversarial review (Codex, 2026-11-19)

Codex (read-only, extra-high reasoning) found 13 failures; 12 were reproduced here. Fixed, each with a test in `test/regressions.test.ts`:

| # | Was | Now |
|---|---|---|
| 1 | short hotels and offices got no road setback | road setback at any height for commercial, public and large buildings |
| 2 | floor 3 under 9 m kept 2 m from a neighbour | larger of MR 55 art. 50 and ord. art. 54, per floor |
| 3 | one road changing width got corner relief | relief only between different roads (names, or a turn of 30° or more) |
| 4 | widths under 1 m were enlarged to 1 m | refused (`invalid-edge`); widths over 100 m are clamped down (stricter) |
| 5 | simplifying a 500+ corner plot moved the boundary past the 15 mm margin | setbacks are cut deeper by the measured shift; the checker measures the true outline; FAR uses the true area |
| 6 | a road 50 m away opened the high-rise gate | frontage needs gap <= 0.5 m |
| 7 | OSR could set the high regime's permitted GFA to 0 | footprint and GFA solved together (FAR 20 / OSR 10% case: 0 -> 14,212 m2) |
| 8 | a 4° rotation closed an exact 12 m frontage | 1 mm tolerance on the frontage length |
| 10 | checker verdict depended on shared arrays | relief cache keyed by geometry and requirement |

Also fixed since: #9 (checker containment now tests edges and courtyards, `measure.ts` `containsPolygons`), #11 (slab frontage chosen canonically among tied frontages, by most GFA). Open: #12 (antimeridian plots), #13 (many road edges take seconds; 80 edges ~4-9 s).

## Verification layers (2026-11-19)

Built from `fv-architecture.md` (side-session notes). Run locally: `powershell -File scripts/ci.ps1` (typecheck + suite, ~80 s), `-Nightly` (1,000 runs per property), `node scripts/acceptance.mjs` (runs the new tests against the pre-fix commit `3e2b5be`; a test that passes there is not evidence). No GitHub CI by choice.

| Layer | Files | What it guards |
|---|---|---|
| Independent rule oracle | `oracle/` (74-row clause table, written blind from `sources/*.txt`) | misreadings: the engine may be stricter than the oracle, never laxer (`test/oracle-diff.test.ts`); property tests P2/P3 now take distances from the oracle |
| Independence + citations | `test/independence.test.ts`, `test/oracle-citations.test.ts` | the oracle shares no code with the engine; every quoted Thai fragment is on its cited line |
| Metamorphic | `test/metamorphic.test.ts` (M1-M6) | rotation/mirror, ring start and reversal, checker clone, edge split and 500+ densify, FAR/OSR monotonicity, shrink still passes |
| Rule claims | `test/rule-claims.test.ts` | stricter of readings, monotonicity, low <= high, clamp direction, caps <=> checker, no short distance passes |
| Containment | `test/containment.test.ts`, `test/canonical.test.ts` | #9 and #11 |

Oracle disagreements are logged in `oracle/DISAGREEMENTS.md` (12 rows). The three where the engine was laxer than a clear reading are fixed, and `test/oracle-diff.test.ts` no longer allows them: **D3** the office / hotel road exceptions need a touching road of at least 16 / 12 m with at least 16 / 12 m of frontage (zoning art. 36(2)-(3)); **D6/D7** wider-road relief is granted only when the plot is at most 60 m along the narrower road (corner, art. 46) or along the wider road (two roads, art. 45; both directions for roads that do not meet), so every building on it meets the law's 60 m building condition (stricter where a shorter building on a longer plot would qualify). Deliberate tolerances remain: D1 (0.5 m frontage gap), D2 (1 mm frontage length). The other rows are legal ambiguities, open for a Thai practitioner.

### Nightly findings (1,000 runs per property, 2026-11-19/20)

Each fixed with a regression case (`test/regressions.test.ts`, `test/fixtures/nightly-inset-cases.json`):

| Finding | Cause | Fix |
|---|---|---|
| A 0.97 m neck survived the 1.5 m sliver opening in one mirror image | dilation miter limit 4 grew 3 m spikes from eroded cusps | miter limit just above sqrt(2) (right angles stay exact) |
| Courtyard design present in one image, absent in its mirror / after an edge split | design insets used miter limit 4: spike vs squared tip on sharp corners | round joins when shrinking (exact erosion; convex corners need none), 5 cm arcs for design insets |
| Relief granted although a corner building ran 61.7 m along the narrow road; checker refused relief on a densified outline | 60 m extent measured along the road's longest segment (a sawtooth tooth on the true outline) | extent measured along the road's end-to-end direction |
| Envelope GFA differs between images by a few m2 to 22 m2 | a part exactly at the 1.5 m opening / 1.5 m thickness / 40 m2 line kept in one image, dropped in the other (both legal) | `Envelope.sliverArea` and `droppedArea` reported; M1 allows that difference; `courtyard-skipped` warning carries its margins |

After these fixes the nightly suite passes (139 tests, ~7 min); per-push CI ~40 s.
