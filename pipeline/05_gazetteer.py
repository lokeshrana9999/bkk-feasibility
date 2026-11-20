"""Search gazetteer: public/data/gazetteer.json.

Entries (array "e"): {"t": type, "name": Thai/primary name, "en": English or null, "p": [lon, lat],
  "bbox": [w,s,e,n] (roads only), "area": OBJECTID of the ย.9 polygon containing p or null, + type extras}
types: zone (31 sub-zone labels), road (named highways), soi (names with ซอย / Soi), station (BTS/MRT/ARL/SRT/BRT).
Roads/sois limited to ways within 300 m of a ย.9 polygon. Source: OSM via Overpass (cached), BMA zoning.
"""
import collections
import json
import math
import os

import shapely
from shapely.geometry import LineString, Point
from shapely.ops import linemerge, unary_union

from common import CACHE, OUT, load_areas, to_utm, to_ll, write_json, r6

HW = os.path.join(CACHE, "osm_highways.json")
ST = os.path.join(CACHE, "osm_stations.json")
NAMED = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
         "living_street", "service", "road", "motorway_link", "trunk_link", "primary_link",
         "secondary_link", "tertiary_link"}


def system(t):
    s = " ".join(str(t.get(k, "")) for k in ("network", "operator", "operator:en", "name:en", "line"))
    if t.get("railway") in ("construction", "proposed") or t.get("construction") or t.get("construction:railway") \
            or t.get("status") == "inactive" or "Pier" in s or "ท่าเรือ" in t.get("name", "") \
            or t.get("amenity") == "ferry_terminal":
        return None
    ref = str(t.get("ref", ""))
    import re
    if re.fullmatch(r"(CEN|[ENSW]\d{1,2}[A-Z]?|G\d)", ref):
        return "BTS"
    if re.fullmatch(r"(BL|PP|YL|PK)\d{2}", ref):
        return "MRT"
    if re.fullmatch(r"A\d", ref):
        return "ARL"
    if re.fullmatch(r"R[NW]\d{2}", ref):
        return "SRT"
    if "BTS" in s or "ระบบขนส่งมวลชนกรุงเทพ" in s or "Sukhumvit Line" in s or "Silom Line" in s or "Gold Line" in s:
        return "BTS"
    if "ARL" in s or "Airport" in s:
        return "ARL"
    if "MRT" in s or "Metropolitan" in s or "รถไฟฟ้ามหานคร" in s or "BEM" in s or t.get("station") == "monorail" \
            or "Mass Rapid" in s or "รฟม" in s:
        return "MRT"
    if "BRT" in s:
        return "BRT"
    if "การรถไฟ" in s or "สายสีแดง" in s or "Red Line" in s or t.get("railway") == "halt":
        return "SRT"
    if t.get("station") in ("subway", "light_rail"):
        return "MRT"
    return None


def main():
    areas = load_areas()
    zone_union_u = unary_union([a["utm"] for a in areas])
    near = zone_union_u.buffer(300)
    shapely.prepare(near)

    def area_of(lon, lat):
        p = Point(lon, lat)
        for a in areas:
            if a["geom"].contains(p):
                return a["id"]
        return None

    entries = []
    for a in areas:
        c = a["geom"].representative_point()
        entries.append({"t": "zone", "name": a["label"], "en": a["labelLatin"], "p": [r6(c.x), r6(c.y)],
                        "area": a["id"], "far": a["far"], "osr": a["osr"]})

    groups = collections.defaultdict(list)
    en_by = collections.defaultdict(collections.Counter)
    for e in json.load(open(HW, encoding="utf-8"))["elements"]:
        t = e.get("tags", {})
        name = t.get("name")
        if not name or t.get("highway") not in NAMED or "geometry" not in e or len(e["geometry"]) < 2:
            continue
        ln = LineString([(p["lon"], p["lat"]) for p in e["geometry"]])
        lu = to_utm(ln)
        if not near.intersects(lu):
            continue
        groups[name].append(lu)
        if t.get("name:en"):
            en_by[name][t["name:en"]] += 1
    for name, lines in groups.items():
        u = unary_union(lines)
        merged = linemerge(u) if u.geom_type == "MultiLineString" else u
        parts = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
        longest = max(parts, key=lambda g: g.length)
        mid = to_ll(longest.interpolate(0.5, normalized=True))
        allg = to_ll(unary_union(lines))
        en = en_by[name].most_common(1)[0][0] if en_by[name] else None
        is_soi = name.startswith("ซอย") or (en or "").lower().startswith("soi")
        w, s, e_, n = allg.bounds
        entries.append({"t": "soi" if is_soi else "road", "name": name, "en": en, "p": [r6(mid.x), r6(mid.y)],
                        "bbox": [r6(w), r6(s), r6(e_), r6(n)], "lenM": round(sum(l.length for l in lines)),
                        "area": area_of(mid.x, mid.y)})

    st_raw = json.load(open(ST, encoding="utf-8"))["elements"]
    stations = []
    for e in st_raw:
        t = e.get("tags", {})
        sysname = system(t)
        if not sysname or not t.get("name"):
            continue
        lon, lat = (e["lon"], e["lat"]) if e["type"] == "node" else (e["center"]["lon"], e["center"]["lat"])
        pri = 0 if t.get("railway") == "station" else 1
        stations.append((pri, t["name"], t.get("name:en"), sysname, t.get("ref"), lon, lat))
    stations.sort()
    kept = []
    for pri, name, en, sysname, ref, lon, lat in stations:
        dup = False
        for k in kept:
            same = (k["name"] == name or (en and k["en"] == en)) and k["system"] == sysname
            if same and math.hypot((k["p"][0] - lon) * 108000, (k["p"][1] - lat) * 110600) < 400:
                dup = True
                if not k["en"] and en:
                    k["en"] = en
                break
        if not dup:
            kept.append({"t": "station", "name": name, "en": en, "p": [r6(lon), r6(lat)], "system": sysname,
                         "ref": ref, "area": area_of(lon, lat)})
    entries.extend(kept)
    size = write_json(os.path.join(OUT, "gazetteer.json"),
                      {"version": 1, "source": "OpenStreetMap contributors (ODbL); BMA comprehensive plan 2556",
                       "e": entries})
    cnt = collections.Counter(x["t"] for x in entries)
    json.dump({"counts": cnt, "stationsBySystem": collections.Counter(x["system"] for x in kept), "bytes": size},
              open(os.path.join(CACHE, "status_gazetteer.json"), "w"), indent=1)
    print(dict(cnt), dict(collections.Counter(x["system"] for x in kept)), f"{size/1e3:.0f} kB")


if __name__ == "__main__":
    main()
