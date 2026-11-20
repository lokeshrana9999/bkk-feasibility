"""Validate public/data/, add per-area counts to areas.json, write ATTRIBUTION.md and pipeline/DATA_REPORT.md."""
import json
import os
import sys

from common import CACHE, OUT, ROOT, OVERTURE_RELEASE, load_areas, write_json

REPORT = os.path.join(ROOT, "pipeline", "DATA_REPORT.md")

ATTRIBUTION = f"""# Data attribution

Data files in this folder are built by `pipeline/` from these sources:

| Data | Source | Licence |
|---|---|---|
| Zoning (ย.9 polygons, all 607 zones, FAR/OSR) | Bangkok Metropolitan Administration (BMA), City Planning GIS, comprehensive plan 2556 (`GI_Platform/BMAGI_Planing` layer 1) | No licence text published; used with credit to BMA |
| Right-of-way polygons (`row/`) | BMA, public ways on Department of Lands map sheets (`BMA_Property2566` layer 7) | No licence text published; used with credit to BMA and DOL |
| Building footprints (`buildings/`) | Overture Maps Foundation, buildings theme, release {OVERTURE_RELEASE} (includes OpenStreetMap, Google Open Buildings and Microsoft ML footprints) | ODbL 1.0 (OSM-derived data: © OpenStreetMap contributors); CDLA-Permissive-2.0 / CC BY 4.0 for the ML layers |
| Building heights (source `ob`) | Google Open Buildings 2.5D Temporal, 2023 | CC BY 4.0 |
| Building heights (sources `osm_height`, `osm_floors`), road centrelines (`roads/`), roads, sois and stations (`gazetteer.json`) | © OpenStreetMap contributors, via Overpass API | ODbL 1.0 |
| Basemap (runtime) | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors | see openfreemap.org |

Derived values (road widths from right-of-way cross-sections, default heights by footprint size) are computed by
this project; see `pipeline/DATA_REPORT.md` for the method and coverage.
"""


def load(p):
    return json.load(open(p)) if os.path.exists(p) else {}


def main():
    areas = load_areas()
    st_row = load(os.path.join(CACHE, "status_row.json"))
    st_roads = load(os.path.join(CACHE, "status_roads.json"))
    st_b = load(os.path.join(CACHE, "status_buildings.json"))
    st_g = load(os.path.join(CACHE, "status_gazetteer.json"))
    calib = load(os.path.join(CACHE, "calib_buildings.json"))

    idx_path = os.path.join(OUT, "areas.json")
    idx = json.load(open(idx_path, encoding="utf-8"))
    problems = []
    rows = []
    tot = {"bld": 0, "src": [0, 0, 0, 0]}
    for e in idx["areas"]:
        k = str(e["id"])
        files_ok = all(os.path.exists(os.path.join(OUT, f)) for f in e["files"].values())
        r, rd, b = st_row.get(k, {}), st_roads.get(k, {}), st_b.get(k, {})
        flags = []
        if not files_ok:
            flags.append("missing files")
        if r and not r.get("ok"):
            flags.append("ROW fetch failed")
        if rd and not rd.get("ok"):
            flags.append("road widths missing")
        if b and not b.get("ok"):
            flags.append("Open Buildings read failed (default heights)")
        if not (r and rd and b):
            flags.append("not built")
        src = b.get("sources", {})
        e["counts"] = {"row": r.get("n"), "roads": rd.get("ways"), "roadsWithWidth": rd.get("waysWithWidth"),
                       "buildings": b.get("n")}
        e["flags"] = flags
        e["bytes"] = sum(os.path.getsize(os.path.join(OUT, f)) for f in e["files"].values()
                         if os.path.exists(os.path.join(OUT, f)))
        if flags:
            problems.append((e["id"], e["labelLatin"], flags))
        n = b.get("n") or 0
        tot["bld"] += n
        for i, s in enumerate(["osm_height", "osm_floors", "ob", "default"]):
            tot["src"][i] += src.get(s, 0)
        pct = lambda s: f"{100 * src.get(s, 0) / n:.0f}%" if n else "-"
        rows.append(f"| {e['id']} | {e['label']} | {e['labelLatin']} | {e['far']}/{e['osr']} | {r.get('n', '-')} | "
                    f"{rd.get('ways', '-')} / {rd.get('waysWithWidth', '-')} | {n or '-'} | {pct('osm_height')} | "
                    f"{pct('osm_floors')} | {pct('ob')} | {pct('default')} | {b.get('maxHeightM', '-')} | "
                    f"{e['bytes'] / 1e6:.2f} | {', '.join(flags) or 'ok'} |")
    write_json(idx_path, idx)
    open(os.path.join(OUT, "ATTRIBUTION.md"), "w", encoding="utf-8").write(ATTRIBUTION)

    sizes = {}
    total = 0
    for dp, _, fs in os.walk(OUT):
        for f in fs:
            s = os.path.getsize(os.path.join(dp, f))
            total += s
            top = os.path.relpath(dp, OUT).split(os.sep)[0]
            sizes[top if top != "." else f] = sizes.get(top if top != "." else f, 0) + s

    T = tot["bld"] or 1
    share = ", ".join(f"{n} {100 * c / T:.1f}%" for n, c in zip(["osm_height", "osm_floors", "ob", "default"], tot["src"]))
    cal = calib.get("calibration") or {}
    defaults = calib.get("defaults") or {}
    lines = [
        "# Data report",
        "",
        f"Built by `pipeline/` (run order in `pipeline/README.md`). {len(idx['areas'])} ย.9 polygons keyed by BMA "
        f"OBJECTID. Total `public/data/`: **{total / 1e6:.1f} MB** raw.",
        "",
        f"Buildings: {tot['bld']:,} footprint entries across areas (areas overlap in their 250 m margins). "
        f"Height sources: {share}.",
        "",
        "## failures and flags",
        "",
    ]
    if problems:
        lines += [f"- {i} {l}: {', '.join(f)}" for i, l, f in problems]
    else:
        lines.append("None: every area has ROW, road widths and Open Buildings heights.")
    lines += [
        "",
        "## per area",
        "",
        "| OBJECTID | sub-zone | latin | FAR/OSR | ROW polys | ways / with width | buildings | osm_height | osm_floors | ob | default | max h (m) | MB | flags |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        *rows,
        "",
        "## file sizes (raw)",
        "",
        "| file/folder | MB |",
        "|---|---|",
        *[f"| {k} | {v / 1e6:.2f} |" for k, v in sorted(sizes.items(), key=lambda kv: -kv[1])],
        "",
        "## methods",
        "",
        "- **Heights**: OSM `height` (via Overture) > OSM `building:levels` x 3.3 m > Google Open Buildings 2.5D "
        "2023 max height inside the footprint (0.5 m raster; values cap at 98 m, so the tallest towers read low) > "
        "default = median Open Buildings height of footprints in the same area bin.",
        f"- **Open Buildings vs OSM-tagged heights** (footprints > 150 m2 with both): {cal or 'n/a'}.",
        f"- **Default heights by footprint bin (m2 -> m)**: {defaults or 'n/a'}.",
        "- **Footprints** < 12 m2 dropped; multipolygons split; outer rings only; simplified 0.2 m; coordinates "
        "quantised to 1e-6 degrees (~0.1 m).",
        "- **Road widths**: OSM car ways; every 8 m an 80-100 m cross-section is cut by the BMA right-of-way polygon "
        "containing the point. Ways with < 3 samples get no width (mostly private sois and service roads absent from "
        "the public-way layer). Junction samples read long; use `p10`/`med`.",
        f"- **Gazetteer**: {st_g.get('counts', {})}; stations by system {st_g.get('stationsBySystem', {})}. "
        "Stations under construction (OSM `construction:railway`) excluded.",
        "- **Known gaps**: Overture/OSM footprints miss some new towers; Open Buildings is 2023 imagery; the "
        "existing building on a user's plot is removed at runtime by `src/site/`.",
    ]
    open(REPORT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"total public/data {total / 1e6:.1f} MB; problems {len(problems)}")
    for p in problems:
        print(" ", p)
    for k, v in sorted(sizes.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
