"""Right-of-way polygons per area: public/data/row/<OBJECTID>.json.

Source: BMA_Property2566 layer 7 (public ways on DOL map sheets), queried by the area bbox + 150 m,
then clipped to the area buffered 150 m. Raw responses cached in sources/data/pipeline/row_raw/.
kind: road | canal | rail.
"""
import json
import os
import sys

from shapely.geometry import shape, mapping

from common import (BMA_ROW, CACHE, OUT, ROW_MARGIN_M, select_areas, area_buffer_ll, arcgis_bbox_geojson,
                    to_utm, to_ll, round_coords, write_json)

RAW = os.path.join(CACHE, "row_raw")
os.makedirs(RAW, exist_ok=True)


def kind_of(name, pbw_type):
    n = name or ""
    if "คลอง" in n or "ลำราง" in n or "ลำกระโดง" in n or n.startswith("คู") or pbw_type == "2":
        return "canal"
    if "รถไฟ" in n and not n.startswith("ถนน") and not n.startswith("ซอย"):
        return "rail"
    return "road"


def fetch(area):
    path = os.path.join(RAW, f"{area['id']}.geojson")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))["features"]
    buf = area_buffer_ll(area, ROW_MARGIN_M)
    feats = arcgis_bbox_geojson(BMA_ROW, buf.bounds)
    json.dump({"type": "FeatureCollection", "features": feats}, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return feats


def build(area):
    feats = fetch(area)
    buf_u = to_utm(area_buffer_ll(area, ROW_MARGIN_M))
    out = []
    for f in feats:
        if not f.get("geometry"):
            continue
        p = f["properties"]
        g = to_utm(shape(f["geometry"]))
        if not g.is_valid:
            g = g.buffer(0)
        if not g.intersects(buf_u):
            continue
        c = g.intersection(buf_u).simplify(0.2, preserve_topology=True)
        if c.is_empty or c.area < 1:
            continue
        if c.geom_type == "GeometryCollection":
            polys = [x for x in c.geoms if x.geom_type in ("Polygon", "MultiPolygon")]
            if not polys:
                continue
            from shapely.ops import unary_union
            c = unary_union(polys)
        name = (p.get("PBW_NAME") or "").strip()
        out.append({"type": "Feature", "id": int(p["OBJECTID"]),
                    "properties": {"name": name, "kind": kind_of(name, p.get("PBW_TYPE"))},
                    "geometry": round_coords(mapping(to_ll(c)))})
    size = write_json(os.path.join(OUT, "row", f"{area['id']}.json"), {"type": "FeatureCollection", "features": out})
    return len(feats), len(out), size


def main():
    status = {}
    for a in select_areas(sys.argv[1:]):
        try:
            nraw, n, size = build(a)
            status[a["id"]] = {"ok": True, "raw": nraw, "n": n, "bytes": size}
            print(a["id"], a["labelLatin"], "raw", nraw, "kept", n, f"{size/1e3:.0f} kB")
        except Exception as e:
            status[a["id"]] = {"ok": False, "error": str(e)[:300]}
            # fallback: empty ROW file so the app falls back to user-assigned edges; flagged in the report
            write_json(os.path.join(OUT, "row", f"{a['id']}.json"), {"type": "FeatureCollection", "features": [], "failed": True})
            print(a["id"], "FAILED", e)
    _merge_status("row", status)


def _merge_status(stage, status):
    p = os.path.join(CACHE, f"status_{stage}.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update({str(k): v for k, v in status.items()})
    json.dump(old, open(p, "w"), indent=1)


if __name__ == "__main__":
    main()
