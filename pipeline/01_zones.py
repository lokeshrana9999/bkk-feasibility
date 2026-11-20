"""Zones: zones_y9.json (31 ย.9 polygons), zones_all.json (607 BMA 2556 zones, ~3 m simplified), areas.json.

Source: BMA comprehensive plan 2556 (GI_Platform/BMAGI_Planing layer 1), cached in sources/data/zoning/.
"""
import json
import os

from shapely.geometry import shape, mapping

from common import (ZONES_ALL, OUT, load_areas, latin_label, to_utm, to_ll,
                    round_coords, write_json, r6)


def zone_props(p):
    return {
        "id": int(p["OBJECTID"]),
        "zone": p["LUP_ZONE"],
        "sub": p["LUP_SUBZON"],
        "subLatin": latin_label(p["LUP_SUBZON"] or ""),
        "far": p["LUP_FAR"],
        "osr": p["LUP_OSR"],
        "colour": p["LUP_COLOUR"],
        "use": p["LUP_DEST"],
    }


def main():
    areas = load_areas()
    assert len(areas) == 31, len(areas)

    y9 = []
    for a in areas:
        y9.append({"type": "Feature", "id": a["id"],
                   "properties": {"id": a["id"], "zone": "ย.๙", "sub": a["label"], "subLatin": a["labelLatin"],
                                  "far": a["far"], "osr": a["osr"]},
                   "geometry": round_coords(mapping(a["geom"]))})
    s1 = write_json(os.path.join(OUT, "zones_y9.json"), {"type": "FeatureCollection", "features": y9})

    d = json.load(open(ZONES_ALL, encoding="utf-8"))
    allf = []
    for f in d["features"]:
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        gs = to_ll(to_utm(g).simplify(3.0, preserve_topology=True))
        if gs.is_empty:
            continue
        allf.append({"type": "Feature", "id": int(f["properties"]["OBJECTID"]),
                     "properties": zone_props(f["properties"]),
                     "geometry": round_coords(mapping(gs))})
    s2 = write_json(os.path.join(OUT, "zones_all.json"), {"type": "FeatureCollection", "features": allf})

    idx = []
    for a in areas:
        w, s, e, n = a["geom"].bounds
        c = a["geom"].representative_point()
        idx.append({
            "id": a["id"], "label": a["label"], "labelLatin": a["labelLatin"],
            "far": a["far"], "osr": a["osr"],
            "areaM2": round(a["utm"].area),
            "bbox": [r6(w), r6(s), r6(e), r6(n)],
            "labelPoint": [r6(c.x), r6(c.y)],
            "files": {"row": f"row/{a['id']}.json", "roads": f"roads/{a['id']}.json",
                      "buildings": f"buildings/{a['id']}.json"},
        })
    s3 = write_json(os.path.join(OUT, "areas.json"),
                    {"version": 1, "zoneSource": "BMA comprehensive plan 2556", "areas": idx})
    print(f"zones_y9 {len(y9)} {s1/1e6:.2f} MB; zones_all {len(allf)} {s2/1e6:.2f} MB; areas {len(idx)} {s3/1e3:.1f} kB")


if __name__ == "__main__":
    main()
