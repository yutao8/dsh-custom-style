import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar_lib import read_header, walk

header, data_start = read_header()
entries = list(walk(header))
print("total entries:", len(entries))

pat = re.compile(sys.argv[1] if len(sys.argv) > 1 else r"settings", re.I)
hits = [(p, e) for p, e in entries if pat.search(p)]
print("matches:", len(hits))
for p, e in hits[:120]:
    print(f"{e.get('size', 0):>12}  {p}")

print("\n--- top-level dirs ---")
top = Counter()
for p, _ in entries:
    top[p.split("/")[0]] += 1
for k, v in top.most_common(40):
    print(f"{v:>8}  {k}")
