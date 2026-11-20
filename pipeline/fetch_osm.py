"""Download OSM highways (with geometry) and rail/metro stations for the ย.9 extent via Overpass, cached.

Outputs (sources/data/pipeline/): osm_highways.json, osm_stations.json
"""
import json
import os
import sys

from common import CACHE, overpass, y9_extent

HW = os.path.join(CACHE, "osm_highways.json")
ST = os.path.join(CACHE, "osm_stations.json")


def main(force=False):
    w, s, e, n = y9_extent(0.004)
    bb = f"{s},{w},{n},{e}"
    if force or not os.path.exists(HW):
        q = f'[out:json][timeout:300];way["highway"]["highway"!~"^(footway|path|steps|cycleway|pedestrian|bridleway|corridor|proposed|platform|elevator|via_ferrata)$"]({bb});out geom tags;'
        d = overpass(q)
        json.dump(d, open(HW, "w", encoding="utf-8"), ensure_ascii=False)
        print("highways", len(d["elements"]))
    else:
        print("cached", HW)
    if force or not os.path.exists(ST):
        # wider box for stations: a plot near the zone edge may be near a station outside it
        sb = f"{s-0.01},{w-0.01},{n+0.01},{e+0.01}"
        q = (f'[out:json][timeout:180];('
             f'node["railway"="station"]({sb});'
             f'node["public_transport"="station"]({sb});'
             f'way["railway"="station"]({sb});'
             f');out center tags;')
        d = overpass(q)
        json.dump(d, open(ST, "w", encoding="utf-8"), ensure_ascii=False)
        print("stations", len(d["elements"]))
    else:
        print("cached", ST)


if __name__ == "__main__":
    main(force="--force" in sys.argv)
