"""Road centrelines with right-of-way width stats per area: public/data/roads/<OBJECTID>.json.

Centrelines: OSM highways (Overpass, cached), clipped to the area buffered 150 m.
Width: every 8 m along each way, an 80 m cross-section perpendicular to the way is cut by the BMA
right-of-way polygon that contains the sample point; the piece through the point is one width sample.
Per way: median / p10 / p90 / n samples (null when < 3 samples). Per name: the same over all ways.
Samples at junctions (merged ROW polygons) read long; p10/median are the robust numbers.
"""
import collections
import json
import math
import os
import sys

import numpy as np
from shapely.geometry import LineString, Point, shape, mapping
from shapely.strtree import STRtree

from common import (CACHE, OUT, ROAD_MARGIN_M, select_areas, area_buffer_ll, to_utm, to_ll,
                    round_coords, write_json)

HW = os.path.join(CACHE, "osm_highways.json")
RAW_ROW = os.path.join(CACHE, "row_raw")
CAR = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
       "living_street", "service", "road", "motorway_link", "trunk_link", "primary_link",
       "secondary_link", "tertiary_link"}
STEP = 8.0
HALF = 50.0

_ways_utm = None


def ways_utm():
    global _ways_utm
    if _ways_utm is None:
        d = json.load(open(HW, encoding="utf-8"))
        res = []
        for e in d["elements"]:
            t = e.get("tags", {})
            hw = t.get("highway")
            if hw not in CAR or "geometry" not in e or len(e["geometry"]) < 2:
                continue
            if hw == "service" and t.get("service") in ("parking_aisle", "driveway", "drive-through"):
                continue
            if t.get("area") == "yes":
                continue
            ln = LineString([(p["lon"], p["lat"]) for p in e["geometry"]])
            res.append((e["id"], t, to_utm(ln)))
        _ways_utm = res
        print("car ways", len(res))
    return _ways_utm


def stats(v):
    if len(v) < 3:
        return None
    a = np.array(v)
    return {"med": round(float(np.median(a)), 1), "p10": round(float(np.percentile(a, 10)), 1),
            "p90": round(float(np.percentile(a, 90)), 1), "n": int(len(a))}


def tofloat(x):
    try:
        return float(str(x).replace("m", "").strip())
    except Exception:
        return None


def build(area):
    rawp = os.path.join(RAW_ROW, f"{area['id']}.geojson")
    row_ok = os.path.exists(rawp)
    polys = []
    if row_ok:
        for f in json.load(open(rawp, encoding="utf-8"))["features"]:
            if not f.get("geometry"):
                continue
            n = f["properties"].get("PBW_NAME") or ""
            if "คลอง" in n or "ลำราง" in n or f["properties"].get("PBW_TYPE") == "2":
                continue
            if "รถไฟ" in n and not n.startswith("ถนน"):
                continue
            g = to_utm(shape(f["geometry"]))
            polys.append(g if g.is_valid else g.buffer(0))
    tree = STRtree(polys) if polys else None

    buf_u = area["utm"].buffer(ROAD_MARGIN_M)
    feats = []
    by_name = collections.defaultdict(list)
    nsamp = 0
    for wid, t, ln in ways_utm():
        if not ln.intersects(buf_u):
            continue
        samples = []
        if tree is not None:
            L = ln.length
            for d in np.arange(STEP / 2, max(L - 1, STEP / 2 + 0.1), STEP):
                if d > L:
                    break
                p = ln.interpolate(d)
                a = ln.interpolate(max(d - 2, 0))
                b = ln.interpolate(min(d + 2, L))
                dx, dy = b.x - a.x, b.y - a.y
                nn = math.hypot(dx, dy)
                if nn == 0:
                    continue
                nx, ny = -dy / nn, dx / nn
                for i in tree.query(p):
                    pg = polys[i]
                    if not pg.contains(p):
                        continue
                    cut = LineString([(p.x - HALF * nx, p.y - HALF * ny), (p.x + HALF * nx, p.y + HALF * ny)])
                    inter = pg.intersection(cut)
                    pieces = [inter] if inter.geom_type == "LineString" else [
                        x for x in getattr(inter, "geoms", []) if x.geom_type == "LineString"]
                    for pc in pieces:
                        if pc.distance(p) < 0.5 and pc.length < 2 * HALF - 1:  # touching both ends = open junction
                            samples.append(pc.length)
                    break
        nsamp += len(samples)
        name = t.get("name") or ""
        if name:
            by_name[name].extend(samples)
        clip = ln.intersection(buf_u)
        if clip.is_empty:
            continue
        clip = clip.simplify(0.3)
        props = {"id": wid, "name": name or None, "nameEn": t.get("name:en"), "hw": t["highway"],
                 "lanes": int(t["lanes"]) if str(t.get("lanes", "")).isdigit() else None,
                 "osmWidth": tofloat(t.get("width")) if t.get("width") else None,
                 "oneway": t.get("oneway") == "yes",
                 "w": stats(samples)}
        feats.append({"type": "Feature", "id": wid, "properties": props, "geometry": round_coords(mapping(to_ll(clip)))})
    names = {k: s for k, v in by_name.items() if (s := stats(v))}
    size = write_json(os.path.join(OUT, "roads", f"{area['id']}.json"),
                      {"type": "FeatureCollection", "features": feats, "byName": names, "rowAvailable": row_ok})
    withw = sum(1 for f in feats if f["properties"]["w"])
    return len(feats), withw, nsamp, size, row_ok


def main():
    status = {}
    for a in select_areas(sys.argv[1:]):
        try:
            n, withw, ns, size, row_ok = build(a)
            status[a["id"]] = {"ok": row_ok, "ways": n, "waysWithWidth": withw, "samples": ns, "bytes": size,
                               **({} if row_ok else {"error": "no ROW data; widths missing"})}
            print(a["id"], a["labelLatin"], "ways", n, "with width", withw, "samples", ns, f"{size/1e3:.0f} kB")
        except Exception as e:
            status[a["id"]] = {"ok": False, "error": str(e)[:300]}
            print(a["id"], "FAILED", e)
    p = os.path.join(CACHE, "status_roads.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update({str(k): v for k, v in status.items()})
    json.dump(old, open(p, "w"), indent=1)


if __name__ == "__main__":
    main()
