"""Scan every asar file entry for byte patterns (unique-edit verification)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar_lib import ASAR, read_header, walk

patterns = [p.encode() for p in (sys.argv[1:] or ["wCInkW_panel{", "width:800px"])]

header, data_start = read_header()
entries = list(walk(header))
print("scanning", len(entries), "entries for", patterns)

with open(ASAR, "rb") as fh:
    fh.seek(data_start)
    for path, entry in entries:
        size = entry.get("size", 0)
        blob = fh.read(size)
        counts = [blob.count(p) for p in patterns]
        if any(counts):
            print(f"{path}: " + ", ".join(f"{p.decode()}={c}" for p, c in zip(patterns, counts) if c))
