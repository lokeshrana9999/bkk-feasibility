# Data pipeline (build time)

Builds the static files in `public/data/` for the 31 ย.9 polygons (keyed by BMA `OBJECTID`).
Raw downloads are cached in `sources/data/pipeline/` (gitignored), so reruns are offline and fast.

## run

From the repo root, with the project venv (`scratch\venv`: duckdb, shapely 2, pyproj, rasterio, numpy):

```powershell
Set-Location "C:\Users\lokes\Documents\Projects\personal\gm-assignment"; .\scratch\venv\Scripts\python.exe pipeline\run_all.py
```

`run_all.py [OBJECTID ...]` runs every stage; pass ids to rebuild only those areas. Stages, in order:

| Script | Reads | Writes |
|---|---|---|
| `fetch_overture.py` | Overture S3 (buildings, release in `common.py`) | cache parquet, ~51 MB, ~2.5 min |
| `fetch_osm.py` | Overpass: highways with geometry, stations | cache JSON, ~2.5 min |
| `01_zones.py` | `sources/data/zoning/*.geojson` | `zones_y9.json`, `zones_all.json`, `areas.json` |
| `02_row.py` | BMA ArcGIS layer 7 by bbox | `row/<id>.json` |
| `03_road_widths.py` | OSM ways + raw ROW | `roads/<id>.json` |
| `04_buildings.py` | Overture parquet + Open Buildings 2.5D rasters (GCS range reads) | `buildings/<id>.json` |
| `05_gazetteer.py` | OSM ways + stations, zones | `gazetteer.json` |
| `06_validate.py` | stage status files | counts into `areas.json`, `ATTRIBUTION.md`, `pipeline/DATA_REPORT.md` |

## file formats (`public/data/`)

All coordinates are WGS84 lon/lat.

- `areas.json`: `{version, areas: [{id, label, labelLatin, far, osr, areaM2, bbox:[w,s,e,n], labelPoint, files:{row,roads,buildings}, counts, flags, bytes}]}`. `flags` is empty when the area built fully.
- `zones_y9.json`: GeoJSON, 31 features, `properties {id, zone, sub, subLatin, far, osr}`; full precision (6 dp).
- `zones_all.json`: GeoJSON, 607 BMA zones simplified ~3 m, `properties {id, zone, sub, subLatin, far, osr, colour, use}`.
- `row/<id>.json`: GeoJSON polygons within 150 m of the area, `properties {name, kind: road|canal|rail}`. `failed: true` at top level if the BMA fetch failed (then empty).
- `roads/<id>.json`: GeoJSON LineStrings within 150 m, `properties {id (OSM way), name, nameEn, hw, lanes, osmWidth, oneway, w: {med, p10, p90, n} | null}`; top level `byName: {name: {med,p10,p90,n}}` and `rowAvailable`.
- `buildings/<id>.json`: columnar and quantised, buildings whose centroid is within 250 m of the area:

  ```json
  {"v":1, "area":197, "origin":[lon0,lat0], "q":1e-6,
   "src":["osm_height","osm_floors","ob","default"],
   "h":[height_dm, ...], "s":[source_code, ...], "r":[[x0,y0,dx1,dy1,dx2,dy2,...], ...], "obFailed":false}
  ```

  Ring `i` belongs to `h[i]`, `s[i]`. `x0,y0` are integer offsets from `origin` in units of `q` degrees; later pairs are deltas from the previous vertex. Outer ring only, not closed. Decode:

  ```ts
  function ring(r: number[], o: [number, number], q: number): [number, number][] {
    const out: [number, number][] = []; let x = 0, y = 0;
    for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; out.push([o[0] + x * q, o[1] + y * q]); }
    return out;
  }
  ```

  Source codes 2 (`ob`) and 3 (`default`) are estimates; draw them lighter.
- `gazetteer.json`: `{version, source, e: [{t: zone|road|soi|station, name, en, p:[lon,lat], area, bbox? (road/soi), lenM?, far?/osr? (zone), system?/ref? (station: BTS|MRT|ARL|SRT|BRT)}]}`. `area` is the containing ย.9 OBJECTID or null.
- `ATTRIBUTION.md`: sources and licences; show these credits in the app.

Report: `pipeline/DATA_REPORT.md` (per-area counts, height-source shares, failures, sizes).
