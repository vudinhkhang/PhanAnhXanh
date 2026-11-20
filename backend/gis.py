"""Resolve WGS84 report pins against bundled TP. Hồ Chí Minh commune boundaries."""

import gzip
import json
from functools import lru_cache
from pathlib import Path

from shapely import STRtree
from shapely.geometry import Point, shape


@lru_cache(maxsize=1)
def boundaries():
    with gzip.open(
        Path(__file__).parent / "data/wards.json.gz", "rt", encoding="utf-8"
    ) as source:
        rows = [r for r in json.load(source) if "Hồ Chí Minh" in r[0]]
    return [r[0] for r in rows], STRtree([shape(r[1]) for r in rows])


def ward_at(lat, lng):
    names, index = boundaries()
    matches = index.query(Point(lng, lat), predicate="intersects")
    return names[int(matches[0])] if len(matches) else None
