"""Building footprints with heights per area: public/data/buildings/<OBJECTID>.json.

Footprints: Overture buildings (release in common.py; OSM + Google + Microsoft footprints), cached parquet.
Height priority (source code in brackets):
  0 osm_height  Overture `height` (from OSM tags)
  1 osm_floors  Overture `num_floors` x 3.3 m
  2 ob          Google Open Buildings 2.5D Temporal 2023: max of the 0.5 m height raster inside the footprint
  3 default     median Open Buildings height of buildings in the same footprint-area bin (computed here)
Footprints < 12 m2 are dropped. Kept: buildings whose centroid is within 250 m of the area polygon.

Open Buildings raster: public GCS bucket, read by range requests in 1024 m blocks; per-block results cached in
sources/data/pipeline/ob_blocks/. A block that fails to read is recorded and its buildings fall back to default.

File format (compact, columnar; decode in the app):
  {"v":1, "origin":[lon0,lat0], "q":1e-6, "src":[...names by code...],
   "h":[height_dm,...], "s":[source_code,...], "r":[[x0,y0,dx1,dy1,...],...]}
  Ring i: x0,y0 are integer offsets from origin in units of q degrees; following pairs are deltas from the
  previous vertex. Outer ring only, not closed (first vertex not repeated). lon = origin[0] + x*q.
"""
import json
import math
import os
import sys
import time

import duckdb
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.windows import from_bounds, Window
from shapely import wkb as swkb
from shapely.geometry import box, Polygon
from shapely.strtree import STRtree
import shapely

from common import (CACHE, OUT, OVERTURE_RELEASE, BLD_MARGIN_M, load_areas, select_areas, to_utm, write_json, r6)

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

PARQ = os.path.join(CACHE, f"overture_buildings_{OVERTURE_RELEASE}.parquet")
BLK = os.path.join(CACHE, "ob_blocks")
os.makedirs(BLK, exist_ok=True)
MANIFESTS = [os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scratch", "heights", f"m{t}.json")
             for t in (31, 37)]
SRC_NAMES = ["osm_height", "osm_floors", "ob", "default"]
MIN_AREA = 12.0
BLOCK_M = 1024.0
RES = 0.5
Q = 1e-6
DEFAULT_BINS = [0, 40, 80, 150, 300, 600, 1200, 2500, 1e12]


# ---------- footprints ----------

def load_buildings(areas):
    """All Overture footprints (exploded, >= 12 m2) whose centroid is within 250 m of any ย.9 polygon."""
    con = duckdb.connect()
    rows = con.execute(f"select id, height, num_floors, src, wkb from read_parquet('{PARQ.replace(os.sep, '/')}')").fetchall()
    geoms = swkb.loads(np.array([bytes(r[4]) for r in rows], dtype=object))
    from common import _to_utm
    keep_zone = shapely.unary_union([a["utm"].buffer(BLD_MARGIN_M) for a in areas])
    shapely.prepare(keep_zone)
    ids, hs, fs, srcs, polys = [], [], [], [], []
    for r, g in zip(rows, geoms):
        parts = list(g.geoms) if g.geom_type == "MultiPolygon" else [g] if g.geom_type == "Polygon" else []
        for p in parts:
            pu = shapely.transform(Polygon(p.exterior), lambda xy: np.column_stack(_to_utm(xy[:, 0], xy[:, 1])))
            if pu.area < MIN_AREA:
                continue
            ids.append(r[0]); hs.append(r[1]); fs.append(r[2]); srcs.append(r[3]); polys.append(pu)
    polys = np.array(polys, dtype=object)
    cent = shapely.centroid(polys)
    inside = shapely.contains_xy(keep_zone, shapely.get_x(cent), shapely.get_y(cent))
    sel = np.nonzero(inside)[0]
    print(f"overture rows {len(rows)}, exploded >=12m2 {len(polys)}, near ย.9 {len(sel)}")
    return {"id": [ids[i] for i in sel], "height": [hs[i] for i in sel], "floors": [fs[i] for i in sel],
            "src": [srcs[i] for i in sel], "utm": polys[sel], "cent": cent[sel]}


# ---------- Open Buildings raster ----------

def tiles():
    out = []
    for mp in MANIFESTS:
        m = json.load(open(mp))
        pref = m["uriPrefix"].replace("gs://", "https://storage.googleapis.com/")
        for ts in m["tilesets"]:
            for s in ts["sources"]:
                a = s["affineTransform"]
                w, h = s["dimensions"]["width"], s["dimensions"]["height"]
                x0, y1 = a["translateX"], a["translateY"]
                x1, y0 = x0 + w * a["scaleX"], y1 + h * a["scaleY"]
                out.append((pref + s["uris"][0], box(x0, y0, x1, y1)))
    return out


_TILES = None
_DS = {}


def read_block(bx, by):
    """Max-mosaic of the Open Buildings height band over one block; returns (array, transform)."""
    global _TILES
    if _TILES is None:
        _TILES = tiles()
    x0, y0 = bx * BLOCK_M, by * BLOCK_M
    x1, y1 = x0 + BLOCK_M, y0 + BLOCK_M
    n = int(BLOCK_M / RES)
    arr = np.full((n, n), -1.0, dtype=np.float32)
    T = Affine(RES, 0, x0, 0, -RES, y1)
    bb = box(x0, y0, x1, y1)
    hit = False
    for url, tb in _TILES:
        if not tb.intersects(bb) or tb.intersection(bb).area < 1:
            continue
        hit = True
        ds = _DS.get(url) or _DS.setdefault(url, rasterio.open(url))
        ix0, iy0, ix1, iy1 = tb.intersection(bb).bounds
        win = from_bounds(ix0, iy0, ix1, iy1, ds.transform).round_offsets().round_lengths()
        a = ds.read(2, window=win).astype(np.float32)
        r0 = int(round((y1 - iy1) / RES)); c0 = int(round((ix0 - x0) / RES))
        a = a[: n - r0, : n - c0]
        sub = arr[r0:r0 + a.shape[0], c0:c0 + a.shape[1]]
        np.maximum(sub, a, out=sub)
    if not hit:
        raise RuntimeError(f"no Open Buildings tile covers block {bx},{by}")
    return arr, T


def ob_block(bx, by, polys, idx):
    """{building index: max height m} for buildings idx intersecting block (bx,by); cached by Overture id."""
    try:
        arr, T = read_block(bx, by)
    except Exception as e:
        return None, str(e)[:300]
    n = arr.shape[0]
    lab = rasterize([(polys[i], k + 1) for k, i in enumerate(idx)], out_shape=(n, n), transform=T,
                    fill=0, dtype="int32")
    res = np.full(len(idx) + 1, -1.0, dtype=np.float32)
    ok = (lab > 0) & (arr >= 0)
    np.maximum.at(res, lab[ok], arr[ok])
    return {"_lab": res.tolist()}, None


def ob_heights(B, block_keys):
    """Per-building OB max height (m) or NaN. Returns (array, failed block list)."""
    polys = B["utm"]
    tree = STRtree(polys)
    out = np.full(len(polys), np.nan)
    failed = []
    t = time.time()
    for k, (bx, by) in enumerate(sorted(block_keys)):
        bb = box(bx * BLOCK_M, by * BLOCK_M, (bx + 1) * BLOCK_M, (by + 1) * BLOCK_M)
        idx = tree.query(bb, predicate="intersects")
        if len(idx) == 0:
            continue
        path = os.path.join(BLK, f"{bx}_{by}.json")
        if os.path.exists(path):
            cached = json.load(open(path))
            vals = [cached.get(B["id"][i]) for i in idx]
        else:
            r, err = ob_block(bx, by, polys, idx)
            if err:
                failed.append({"block": [bx, by], "error": err})
                print("block failed", bx, by, err)
                continue
            lab = r["_lab"]
            vals = [lab[j + 1] if lab[j + 1] >= 0 else None for j in range(len(idx))]
            json.dump({B["id"][i]: v for i, v in zip(idx, vals)}, open(path, "w"))
        for i, v in zip(idx, vals):
            if v is not None and (np.isnan(out[i]) or v > out[i]):
                out[i] = v
        if k % 5 == 0:
            print(f"  block {k+1}/{len(block_keys)} ({bx},{by}) {len(idx)} bldgs {time.time()-t:.0f}s", flush=True)
    return out, failed


def blocks_for(geom_utm):
    x0, y0, x1, y1 = geom_utm.bounds
    keys = set()
    for bx in range(int(math.floor(x0 / BLOCK_M)), int(math.floor(x1 / BLOCK_M)) + 1):
        for by in range(int(math.floor(y0 / BLOCK_M)), int(math.floor(y1 / BLOCK_M)) + 1):
            if box(bx * BLOCK_M, by * BLOCK_M, (bx + 1) * BLOCK_M, (by + 1) * BLOCK_M).intersects(geom_utm):
                keys.add((bx, by))
    return keys


# ---------- heights ----------

def assign_heights(B, ob, failed_blocks_any):
    n = len(B["id"])
    h = np.full(n, np.nan)
    s = np.full(n, 3, dtype=np.int8)
    areas = shapely.area(B["utm"])
    for i in range(n):
        hh, ff = B["height"][i], B["floors"][i]
        if hh is not None and 2 <= hh <= 400:
            h[i], s[i] = hh, 0
        elif ff is not None and 1 <= ff <= 120:
            h[i], s[i] = ff * 3.3, 1
        elif not np.isnan(ob[i]) and ob[i] >= 2.0:
            h[i], s[i] = ob[i], 2
    # default: median OB height per footprint-area bin
    bins = np.digitize(areas, DEFAULT_BINS) - 1
    med = {}
    for b in range(len(DEFAULT_BINS) - 1):
        m = (bins == b) & (s == 2)
        med[b] = float(np.median(h[m])) if m.sum() >= 20 else [4, 6, 7, 9, 12, 15, 18, 20][b]
    for i in np.nonzero(s == 3)[0]:
        h[i] = med[bins[i]]
    return h, s, {f"{DEFAULT_BINS[b]:g}-{DEFAULT_BINS[b+1]:g}": round(v, 1) for b, v in med.items()}


# ---------- encoding ----------

def encode(polys_utm, origin):
    from common import _to_ll
    lon0, lat0 = origin
    rings = []
    for p in polys_utm:
        p = p.simplify(0.2, preserve_topology=True)
        xs, ys = p.exterior.coords.xy
        lon, lat = _to_ll(np.array(xs), np.array(ys))
        xi = np.round((np.asarray(lon) - lon0) / Q).astype(np.int64)
        yi = np.round((np.asarray(lat) - lat0) / Q).astype(np.int64)
        pts = np.column_stack([xi, yi])[:-1]
        keep = np.ones(len(pts), bool)
        keep[1:] = np.any(np.diff(pts, axis=0) != 0, axis=1)
        pts = pts[keep]
        if len(pts) < 3:
            continue
        d = np.vstack([pts[:1], np.diff(pts, axis=0)])
        rings.append(d.ravel().tolist())
    return rings


def main():
    all_areas = load_areas()
    areas = select_areas(sys.argv[1:])
    t = time.time()
    B = load_buildings(all_areas)
    print(f"loaded in {time.time()-t:.0f}s")

    keys = set()
    for a in areas:
        keys |= blocks_for(a["utm"].buffer(BLD_MARGIN_M))
    print("OB blocks", len(keys))
    ob, failed = ob_heights(B, keys)
    failed_set = {tuple(f["block"]) for f in failed}

    h, s, defaults = assign_heights(B, ob, failed_set)
    cx, cy = shapely.get_x(B["cent"]), shapely.get_y(B["cent"])

    # calibration: OB max vs OSM-tagged height where both exist (checks raster alignment and bias)
    m = (s <= 1) & ~np.isnan(ob) & (shapely.area(B["utm"]) > 150)
    calib = None
    if m.sum() >= 10:
        ref, o = h[m], ob[m]
        calib = {"n": int(m.sum()), "corr": round(float(np.corrcoef(ref, o)[0, 1]), 3),
                 "medianAbsErrM": round(float(np.median(np.abs(o - ref))), 1),
                 "medianBiasM": round(float(np.median(o - ref)), 1)}
    print("calibration OB vs OSM", calib)
    json.dump({"calibration": calib, "defaults": defaults}, open(os.path.join(CACHE, "calib_buildings.json"), "w"))

    status_p = os.path.join(CACHE, "status_buildings.json")
    status = json.load(open(status_p)) if os.path.exists(status_p) else {}
    for a in areas:
        buf = a["utm"].buffer(BLD_MARGIN_M)
        shapely.prepare(buf)
        sel = np.nonzero(shapely.contains_xy(buf, cx, cy))[0]
        ablocks = blocks_for(buf)
        afailed = sorted(list(ablocks & failed_set))
        w, so, e, n = a["geom"].bounds
        origin = [round(w - 0.005, 3), round(so - 0.005, 3)]
        polys = B["utm"][sel]
        # encode per building: degenerate rings are dropped, keeping h/s aligned with r
        keep = []
        enc = []
        for i, p in zip(sel, polys):
            r = encode([p], origin)
            if r:
                keep.append(i); enc.append(r[0])
        keep = np.array(keep, dtype=int)
        doc = {"v": 1, "area": a["id"], "origin": origin, "q": Q, "src": SRC_NAMES,
               "h": [int(round(x * 10)) for x in h[keep]], "s": [int(x) for x in s[keep]], "r": enc,
               "obFailed": bool(afailed)}
        size = write_json(os.path.join(OUT, "buildings", f"{a['id']}.json"), doc)
        counts = {SRC_NAMES[c]: int((s[keep] == c).sum()) for c in range(4)}
        status[str(a["id"])] = {"ok": not afailed, "n": int(len(keep)), "sources": counts, "bytes": size,
                                "maxHeightM": round(float(h[keep].max()), 1) if len(keep) else None,
                                "failedBlocks": afailed, "defaults": defaults}
        print(a["id"], a["labelLatin"], "buildings", len(keep), counts, f"{size/1e6:.2f} MB",
              "FAILED blocks" if afailed else "")
    json.dump(status, open(status_p, "w"), indent=1)
    if failed:
        json.dump(failed, open(os.path.join(CACHE, "ob_failed_blocks.json"), "w"), indent=1)
    print(f"total {time.time()-t:.0f}s")


if __name__ == "__main__":
    main()
