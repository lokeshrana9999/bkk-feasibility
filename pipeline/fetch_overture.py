"""Download Overture buildings for the whole ย.9 extent (+ margin) once into a local parquet cache.

Output: sources/data/pipeline/overture_buildings_<release>.parquet
Columns: id, height (m), num_floors, src (first source dataset), wkb (geometry).
"""
import os
import time

import duckdb

from common import CACHE, OVERTURE_RELEASE, y9_extent

OUTF = os.path.join(CACHE, f"overture_buildings_{OVERTURE_RELEASE}.parquet")


def main():
    if os.path.exists(OUTF):
        print("cached", OUTF)
        return
    w, s, e, n = y9_extent(0.004)
    print("extent", w, s, e, n)
    t = time.time()
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    src = (f"read_parquet('s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*',"
           " filename=true, hive_partitioning=1)")
    tmp = OUTF + ".tmp"
    con.execute(f"""COPY (
        SELECT id, height, num_floors, sources[1].dataset AS src, ST_AsWKB(geometry) AS wkb
        FROM {src}
        WHERE bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}
    ) TO '{tmp.replace(os.sep, '/')}' (FORMAT PARQUET)""")
    os.replace(tmp, OUTF)
    print(con.execute(f"select count(*), count(height), count(num_floors) from read_parquet('{OUTF.replace(os.sep, '/')}')").fetchall())
    print(con.execute(f"select src, count(*) from read_parquet('{OUTF.replace(os.sep, '/')}') group by 1").fetchall())
    print("done in", round(time.time() - t), "s", os.path.getsize(OUTF) / 1e6, "MB")


if __name__ == "__main__":
    main()
