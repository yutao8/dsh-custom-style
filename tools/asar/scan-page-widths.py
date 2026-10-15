"""扫描所有设置页 bundle 里带 max-width 的 CSS 规则，找出「右边空白」的钩子。"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar_lib import read_header, walk  # noqa: E402

RULE = re.compile(r"\.[A-Za-z0-9_-]+\{[^{}]*max-width[^{}]*\}")
TARGETS = re.compile(r"dsh-client-ui-settings-[a-z-]+/lib/client\.js$")

header, data_start = read_header()
entries = [(p, e) for p, e in walk(header) if TARGETS.search(p)]
print(f"{len(entries)} settings bundles\n")

with open(os.environ["ASAR_PATH"], "rb") as fh:
    fh.seek(data_start)
    for path, entry in entries:
        blob = fh.read(entry.get("size", 0))
        try:
            text = blob.decode("utf-8", "replace")
        except Exception:
            continue
        name = path.split("/")[-3]
        hits = set()
        for match in RULE.finditer(text):
            rule = match.group(0)
            hits.add(rule[:220])
        if hits:
            print(f"--- {name} ({len(hits)} rules) ---")
            for rule in sorted(hits):
                print("   ", rule)
