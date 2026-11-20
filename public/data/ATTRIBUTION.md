# Data attribution

Data files in this folder are built by `pipeline/` from these sources:

| Data | Source | Licence |
|---|---|---|
| Zoning (ย.9 polygons, all 607 zones, FAR/OSR) | Bangkok Metropolitan Administration (BMA), City Planning GIS, comprehensive plan 2556 (`GI_Platform/BMAGI_Planing` layer 1) | No licence text published; used with credit to BMA |
| Right-of-way polygons (`row/`) | BMA, public ways on Department of Lands map sheets (`BMA_Property2566` layer 7) | No licence text published; used with credit to BMA and DOL |
| Building footprints (`buildings/`) | Overture Maps Foundation, buildings theme, release 2026-11-18.0 (includes OpenStreetMap, Google Open Buildings and Microsoft ML footprints) | ODbL 1.0 (OSM-derived data: © OpenStreetMap contributors); CDLA-Permissive-2.0 / CC BY 4.0 for the ML layers |
| Building heights (source `ob`) | Google Open Buildings 2.5D Temporal, 2023 | CC BY 4.0 |
| Building heights (sources `osm_height`, `osm_floors`), road centrelines (`roads/`), roads, sois and stations (`gazetteer.json`) | © OpenStreetMap contributors, via Overpass API | ODbL 1.0 |
| Basemap (runtime) | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors | see openfreemap.org |

Derived values (road widths from right-of-way cross-sections, default heights by footprint size) are computed by
this project; see `pipeline/DATA_REPORT.md` for the method and coverage.
