# Break-it findings: live site, 2026-11-20

Tested `https://bkk-feasibility.vercel.app` (build of `8e8911b`) with Playwright 1.64 / Chromium, 12:00-14:00 IST. No blockers. The numbers are right wherever the inputs are right: G1, G2 and G3 drawn on the live map match the engine and the hand-derived golden values floor by floor. The wrong numbers come from inputs the app builds wrongly: a plot over a road, a share link, a zone boundary, a drawing gap.

| Severity | Count | Issues |
|---|---|---|
| blocker | 0 | |
| wrong number | 4 | F01-F04 |
| UX | 10 | F05-F12, F15, F19 |
| cosmetic | 5 | F13, F14, F16-F18 |

Run: `npm run test:e2e` (live site). Local build: `npm run build`, then `$env:E2E_URL="http://localhost:4173"; npm run test:e2e` (starts `vite preview`). `e2e/findings.spec.ts` has one test per issue F01-F15, and `e2e/perf.spec.ts` covers F19; they fail on this build and pass once fixed (27 pass, 16 fail on this build). `E2E_EVIDENCE=1` refreshes the screenshots.

## Issues

Hashes go after `https://bkk-feasibility.vercel.app/`. G1 plot = `#p=100.5775848,13.7171633;100.5780471,13.7171633;100.5780471,13.7175248;100.5775848,13.7175248&t=condo` (50 x 40 m in ย.9-23, no right-of-way within 3 m).

| # | Severity | Issue | Repro | Expected | Actual | Cause (where known) | Screenshot |
|---|---|---|---|---|---|---|---|
| F01 | wrong number | A plot drawn over a public road is evaluated as if the road were buildable land, with no warning | `#p=100.5792203,13.7210608;100.5792602,13.7207012;100.5796721,13.7207449;100.5796322,13.7211045&t=condo` (demo plot moved 13 m west; 25% of it is on the Sukhumvit 38 right-of-way, `npx tsx e2e/tools/row-overlap.ts "<hash>"`) | Warn that the plot covers the right-of-way (and clip it, or mark that edge as road) | All 4 edges "Neighbour", no banner or tag; 8,788 m² permitted, FAR on 1,793 m² that includes ~450 m² of road; envelope drawn on the road | `detectEdges` only casts rays outward from edges; nothing checks the plot's interior against the right-of-way | `screenshots/F01-plot-over-road.png` |
| F02 | wrong number | Share link drops road edits, station, relief and floor heights | G1, mark edge 1 Road 20 m, pick Office, copy URL, open it in a new tab | Recipient sees 14,000 m² High-rise | Recipient sees 7,468 m² Low-rise, all edges "Neighbour" | `writeHash` (`src/ui/state.ts`) stores only ring + type | `screenshots/F02-share-sender.png`, `F02-share-recipient.png` |
| F03 | wrong number | Plot mostly in another zone is evaluated with ย.9 rules for the whole plot | `#p=100.5675863,13.7259857;100.5679562,13.7259857;100.5679562,13.7263472;100.5675863,13.7263472&t=condo` (36% ย.9-23 FAR 7, 64% ย.10-7 FAR 8) | Use the majority zone, or refuse below 50% and name the other zone | Zone "ย.๙-๒๓ · FAR 7", full envelope and designs; banner says "the rest is in another zone" without naming it. Same for a plot 43% in institutional zone ส.-๖๒: `#p=100.5757515,13.7123743;100.5761213,13.7123743;100.5761213,13.7127358;100.5757515,13.7127358&t=condo` | `lookupZone` runs over the ย.9 zones only, so any ย.9 share wins | `screenshots/F03-straddle-y10.png` |
| F04 | wrong number | A 0.3-3 m drawing gap to the road removes the high-rise regime (-30% floor area), with the wrong reason | Demo plot moved 0.25 m east: `#p=100.5793426,13.7210608;100.5793825,13.7207012;100.5797944,13.7207449;100.5797545,13.7211045&t=condo` | Keep high-rise for a hand-drawing gap (snap to the right-of-way, or treat sub-metre gaps as abutting), or say "not abutting: gap 0.4 m" | Edge 1 "Sukhumvit 38, 11.2 m, gap 0.4 m"; 8,788 m² Low-rise instead of 12,554 m² High-rise; reason "no road of 10 m or more with 12 m of contiguous frontage (widest 11.2 m)" although it is 11.2 m wide with 40 m frontage. At zoom 18 one pixel is ~0.3 m | `roads.ts` keeps gaps >= 0.3 m; engine frontage needs gap <= 1 mm (`PARAMS.frontageGapTol`, decision D1) | `screenshots/F04-gap-0.4m.png` |
| F05 | UX | Picking a demo (or a share link arriving) while in Draw mode leaves the app stuck | Press Draw plot, then choose a demo plot | Draw mode ends | Button stays "Drawing…" (disabled), hint stays, Esc does not help, share link stops updating; only a reload recovers. Same with a `hashchange` during drawing | `MapView.setPlot` does not call `onDrawingChange(false)` | `screenshots/F05-stuck-drawing.png` |
| F06 | UX | The selected role chip (Road / Canal / Neighbour) is invisible: white text on white | Any plot, Plot edges table | Selected chip filled in its role colour | Blank chip; the user cannot see an edge's current role | `src/ui/styles.css:107` `.chip { background: #fff }` comes after `.r-road` (line 102) at equal specificity | `screenshots/F06-chip-invisible.png` |
| F07 | UX | Out-of-range road width is silently ignored | G1, edge 1 Road, type `0` (also `0.1`, `-5`, empty) | Inline message "1-100 m" | Input shows 0 while the panel keeps computing with 12 m; reverts on blur, no message | `WidthInput` (`Panel.tsx`) drops values outside [1, 100] | `screenshots/F07-width-0-ignored.png` |
| F08 | UX | Browser Back leaves the app | Load, pick another demo, press Back | Previous plot (or stay) | Leaves the site (`about:blank` in a fresh tab) | `writeHash` uses `history.replaceState` only | |
| F09 | UX | Hint says "drag the small midpoints to add a corner"; dragging does nothing, clicking adds one | G1 hash, top-down, drag the bottom midpoint | Corner added (or hint says click) | Corners stay 4 | terra-draw inserts on click | `screenshots/F09-midpoint-drag.png` |
| F10 | UX | Messages number edges from 0, the edge table from 1 | 100 x 3 m strip: `#p=100.5775848,13.7171633;100.5785093,13.7171633;100.5785093,13.7171904;100.5775848,13.7171904&t=condo` | "private boundary 1" | "private boundary #0 needs 2.00 m"; rule values read "road … (12 m) #0" | engine chain ids in messages | `screenshots/F10-edge-number-0.png` |
| F11 | UX | Before the roads load, numbers without roads are shown as "computed", and the edges say "no city road data here" | Load the site on a slow line (or delay `/data/row/*`) | "Loading roads…" in the panel, no KPIs yet | 8,788 m² Low-rise "computed in 262 ms", edges "no city road data here: mark roads by hand"; flips to 12,554 m² High-rise 1-2 s later (12-13 s on 1.6 Mbit/s) | engine runs before `rows` load; `hasRowData` false while loading; `onResult` clears busy even when a newer input is queued | `screenshots/F11-computed-before-roads.png` |
| F12 | UX | Outside-ย.9 panel says "No city-plan zone found here" until `zones_all.json` arrives | `#p=100.5300000,13.7240000;100.5303698,13.7240000;100.5303698,13.7243615;100.5300000,13.7243615&t=condo` | "Looking up the zone…" | "No city-plan zone found here", then "It is in พ.๕-๖ … FAR 10" | `Outside` renders `hit = null` as not found | `screenshots/F12-no-zone-while-loading.png` |
| F15 | UX | Half-typed widths are applied: typing `100.5` sets 100 m | G1, edge 1 Road, type `100.5`, blur | Keep 12 (or refuse 100.5) | Width becomes 100 m (from the keystroke "100") | `WidthInput` applies each keystroke | |
| F19 | UX | On a weaker laptop (CPU throttled x4) edits take 250-960 ms to reach the panel; orbit drops to 25 fps | `npm run test:e2e -- e2e/perf.spec.ts` | Median edit under 300 ms | Two runs: 960 / 365 / 245 / 234 ms and 657 / 276 / 190 / 142 ms (type switches); the first edit after load is slowest | main-thread work around each result (layers rebuild), not the engine (7-50 ms in the worker); unverified which part | |
| F13 | cosmetic | "Go to area" lists `Y9-14 · ย.๙-๑๔` twice (areas 245 and 572) | Open the list | Distinct labels | Two identical entries | `public/data/areas.json` | |
| F14 | cosmetic | Plot area across the 180° meridian reads 1,772,503,838 m² | `#p=179.9998,0;-179.9998,0;-179.9998,0.0004;179.9998,0.0004&t=condo` | ~1,970 m² (it is outside ย.9 anyway) | 1,772,503,838 m² | `areaM2` (`src/site/geo.ts`) does not unwrap longitudes | `screenshots/F14-antimeridian-area.png` |
| F16 | cosmetic | "m wide" label wraps onto two lines next to the width input | Any road edge, 1440 px | One line | "m" / "wide" stacked | `.ew` layout | `screenshots/F06-chip-invisible.png` |
| F17 | cosmetic | Size-limit error is a raw engine string | 600 x 600 m plot | "Plot is 360,000 m²; the limit is 200,000 m²" | "plot is 359997 m2; the limit is 200000 m2" (the panel says 360,001 m²) | engine message shown as is | |
| F18 | cosmetic | Drawing: a click that would cross the outline is dropped without feedback; a repeated vertex shows a "0.0 m" edge | Draw a bow-tie; or hash with a repeated corner | A hint "corners cannot cross" / merge duplicates | Click ignored silently; edge "0.0 m" | terra-draw validation; no dedupe of the hash ring | |

## Checked and fine

- Golden plots on the live map (`e2e/accuracy.spec.ts`): G1 14,000 m² High-rise, 29 floors, 88.5 m, floors 1-11 at 1,062 m², floor 12 at 1,033.5 m², low regime 9,800 m²; G2 9,800 m² Low-rise, floor 7 at 33.75 x 44 m; G3 corner (30 m + 12 m) 41 floors, floor 24 at 1,035.5 m², relief off cuts floor 12 to 1,043 m². Every floor within 0.05% of `evaluate()` on the metre plot (`npx tsx scripts/demo.ts`); floors sum to the reported GFA; footprint + open space = plot.
- Road widths 9.99 / 10 / 20 / 20.01 / 100 behave as the golden tests (high regime opens at 10 m; 100 m reaches the 60-floor cap).
- Shapes: triangle, L, 200- and 600-corner round plots (600 corners in < 10 s end to end), thin and tiny plots ("Nothing can be built"), 600 x 600 m (size limit), self-intersecting hash ("crosses itself"), outside ย.9 (names the zone), ocean, malformed hashes (fall back to the demo, no console errors).
- Drawing by clicks (2,000 m² ± 1%), corner drag, midpoint click, right-click delete, whole-plot drag; share link follows the drawn plot.
- Go to area (5 sampled of 31), search (English, Thai, coordinates, junk), layer toggles, Thai quotes in Rules, 400 px (no horizontal scroll), no console errors anywhere; only aborted basemap tiles on camera moves.

## Performance (this laptop: RTX 3060 Laptop GPU, ANGLE D3D11)

| Measure | Result |
|---|---|
| Edit (type, road width) to updated panel | 44-246 ms, typical 30-80 ms |
| Same with CPU throttled x4 (weaker laptop) | 142-960 ms over two runs, first edit after load slowest (F19) |
| Orbit with neighbour buildings | 60 fps, worst frame 23 ms; CPU x4: 26 fps |
| Slow line (1.6 Mbit/s, 400 ms RTT) | map at ~5 s, plot at ~11 s, final numbers at ~13 s |
| Largest downloads | map 295 KB, deck 255 KB, maplibre worker 159 KB, index 126 KB, buildings/197 97 KB |

Headless SwiftShader (no GPU) gives 5 fps and 0.4-1.6 s edits; it is not representative, and `e2e/perf.spec.ts` skips there.
