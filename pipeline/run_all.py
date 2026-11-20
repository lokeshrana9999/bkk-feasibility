"""Run every pipeline stage in order. Optional args: OBJECTIDs to rebuild only those areas."""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ids = [a for a in sys.argv[1:] if a.isdigit()]
stages = [("fetch_overture.py", []), ("fetch_osm.py", []), ("01_zones.py", []), ("02_row.py", ids),
          ("03_road_widths.py", ids), ("04_buildings.py", ids), ("05_gazetteer.py", []), ("06_validate.py", [])]
for script, args in stages:
    print(f"== {script} {' '.join(args)}", flush=True)
    r = subprocess.run([sys.executable, os.path.join(HERE, script), *args])
    if r.returncode != 0:
        sys.exit(f"stage {script} failed ({r.returncode})")
