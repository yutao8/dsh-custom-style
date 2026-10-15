import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar_lib import ASAR, read_header, walk

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extracted")

header, data_start = read_header()
index = {p: e for p, e in walk(header)}

targets = sys.argv[1:]
if not targets:
    print("usage: extract.py <asar-path> [more...]")
    raise SystemExit(2)

with open(ASAR, "rb") as fh:
    for path in targets:
        entry = index.get(path)
        if entry is None:
            print("MISSING", path)
            continue
        fh.seek(data_start + int(entry["offset"]))
        blob = fh.read(entry["size"])
        dest = os.path.join(OUT, path.replace("/", os.sep))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as out:
            out.write(blob)
        print(f"{len(blob):>10}  {dest}")
