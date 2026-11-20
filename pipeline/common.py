"""Shared paths, area list and geometry helpers for the build-time data pipeline.

Run every script with scratch/venv/Scripts/python.exe from the repo root or anywhere:
paths are absolute from this file.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

from pyproj import Transformer
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "sources", "data")
CACHE = os.path.join(SRC, "pipeline")          # raw downloads (gitignored via sources/data/)
OUT = os.path.join(ROOT, "public", "data")
ZONES_Y9 = os.path.join(SRC, "zoning", "bkk2556_y9.geojson")
ZONES_ALL = os.path.join(SRC, "zoning", "bkk2556_landuse_all.geojson")

OVERTURE_RELEASE = "2026-11-18.0"
BMA_ROW = "https://cpudgiapp.bangkok.go.th/arcgis/rest/services/BMA_Property/BMA_Property2566/MapServer/7"
BMA_ZONING = "https://cpudgiapp.bangkok.go.th/arcgis/rest/services/GI_Platform/BMAGI_Planing/MapServer/1"
UA = "gm-assignment-pipeline/0.1 (static data build)"

ROW_MARGIN_M = 150
ROAD_MARGIN_M = 150
BLD_MARGIN_M = 250

for d in (CACHE, OUT):
    os.makedirs(d, exist_ok=True)

_to_utm = Transformer.from_crs(4326, 32647, always_xy=True).transform
_to_ll = Transformer.from_crs(32647, 4326, always_xy=True).transform


def to_utm(g):
    return transform(_to_utm, g)


def to_ll(g):
    return transform(_to_ll, g)


THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")


def latin_label(sub):
    """'ย.๙-๒๓' -> 'Y9-23'."""
    return sub.translate(THAI_DIGITS).replace("ย.", "Y").replace(" ", "")


def load_areas():
    """The 31 ย.9 polygons keyed by OBJECTID, with UTM geometry and buffers."""
    d = json.load(open(ZONES_Y9, encoding="utf-8"))
    areas = []
    for f in d["features"]:
        p = f["properties"]
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        gu = to_utm(g)
        areas.append({
            "id": int(p["OBJECTID"]),
            "label": p["LUP_SUBZON"],
            "labelLatin": latin_label(p["LUP_SUBZON"]),
            "far": p["LUP_FAR"],
            "osr": p["LUP_OSR"],
            "geom": g,
            "utm": gu,
        })
    areas.sort(key=lambda a: a["id"])
    return areas


def area_buffer_ll(area, m):
    return to_ll(area["utm"].buffer(m))


def select_areas(argv):
    """argv ids (OBJECTID) or all."""
    areas = load_areas()
    ids = [int(x) for x in argv if x.isdigit()]
    return [a for a in areas if not ids or a["id"] in ids]


def r6(x):
    return round(x, 6)


def round_coords(geojson_geom, nd=6):
    def rc(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [rc(x) for x in c]
    g = dict(geojson_geom)
    g["coordinates"] = rc(g["coordinates"])
    return g


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def http_get(url, params=None, data=None, timeout=120, tries=4):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # network flake: back off and retry
            last = e
            time.sleep(2 + 3 * i)
    raise RuntimeError(f"GET failed after {tries} tries: {url[:160]} :: {last}")


def arcgis_bbox_geojson(layer_url, bbox, out_fields="*", page=1000):
    """All features of an ArcGIS layer intersecting bbox (lon/lat), paged, as GeoJSON features."""
    w, s, e, n = bbox
    feats, offset = [], 0
    while True:
        params = {
            "where": "1=1",
            "geometry": f"{w},{s},{e},{n}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "outSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "true",
            "resultOffset": offset,
            "resultRecordCount": page,
            "orderByFields": "OBJECTID",
            "f": "geojson",
        }
        d = json.loads(http_get(layer_url + "/query", params))
        if "error" in d:
            raise RuntimeError(f"ArcGIS error {d['error']}")
        fs = d.get("features", [])
        feats.extend(fs)
        exceeded = d.get("exceededTransferLimit") or d.get("properties", {}).get("exceededTransferLimit")
        if len(fs) < page and not exceeded:
            break
        if not fs:
            break
        offset += len(fs)
    return feats


def overpass(query, timeout=300):
    mirrors = ["https://overpass-api.de/api/interpreter",
               "https://overpass.kumi.systems/api/interpreter",
               "https://overpass.private.coffee/api/interpreter"]
    last = None
    for m in mirrors:
        try:
            raw = http_get(m, data=urllib.parse.urlencode({"data": query}).encode(), timeout=timeout, tries=2)
            return json.loads(raw)
        except Exception as e:
            last = e
            print("overpass mirror failed:", m, str(e)[:200])
    raise RuntimeError(f"all overpass mirrors failed: {last}")


def y9_extent(margin_deg=0.004):
    w, s, e, n = unary_union([a["geom"] for a in load_areas()]).bounds
    return (w - margin_deg, s - margin_deg, e + margin_deg, n + margin_deg)
