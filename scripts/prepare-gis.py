"""Build local search and administrative lookup data from Vietnamese Provinces Database."""

import gzip
import json
import sys
import zipfile
from pathlib import Path

from shapely import to_geojson
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "backend/data"
MAPS = ROOT / "public/maps"


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main(archive):
    DATA.mkdir(exist_ok=True)
    MAPS.mkdir(exist_ok=True)
    wards, places, outlines = [], [], []
    with zipfile.ZipFile(archive) as source:
        names = sorted(n for n in source.namelist() if n.endswith(".geojson"))
        provinces = {}
        for name in names:
            record = json.loads(source.read(name))["features"][0]
            label = record["properties"]["fullName"]
            geom = shape(record["geometry"])
            province = name.split("/")[1]
            center = geom.representative_point()
            if "/wards/" in name:
                label += ", " + provinces[province]
                # Keep approx. 10 m of boundary detail for neighbourhood statistics.
                geometry = json.loads(to_geojson(geom.simplify(0.00009)))
                wards.append([label, geometry])
            else:
                provinces[province] = label
                outlines.append(
                    {
                        "type": "Feature",
                        "properties": {"name": label},
                        "geometry": json.loads(to_geojson(geom.simplify(0.012))),
                    }
                )
            places.append([label, round(center.y, 5), round(center.x, 5)])
    (DATA / "wards.json.gz").write_bytes(gzip.compress(dump(wards).encode(), mtime=0))
    (MAPS / "places.json").write_text(dump(places), encoding="utf-8")
    (MAPS / "vietnam.json").write_text(
        dump({"type": "FeatureCollection", "features": outlines}), encoding="utf-8"
    )
    print(len(wards), "wards;", len(outlines), "provinces")


if __name__ == "__main__":
    main(sys.argv[1])
