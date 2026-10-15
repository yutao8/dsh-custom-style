"""修正版扫描器：逐条 seek 后列出官方设置页 bundle 里所有含 max-width 的 CSS 规则。

旧版 scan-page-widths.py 的 bug：只 seek 到 data_start 一次，然后按「过滤后的条目」顺序连续 read——
但过滤后的条目在数据区里并不相邻，于是每次读到的都是别的文件（甚至越界读到空字节），
导致它报告「10 个官方设置页都没有 max-width」。那是**假阴性**，本脚本每条都重新 seek。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar_lib import ASAR, read_header, walk  # noqa: E402

RULE = re.compile(r"(\.[A-Za-z0-9_-]+)\{([^{}]*max-width[^{}]*)\}")

header, data_start = read_header()
entries = [(p, e) for p, e in walk(header) if re.search(r"dsh-client-ui-settings-[a-z-]+/lib/client\.js$", p)]

total = 0
with open(ASAR, "rb") as fh:
    for path, entry in sorted(entries, key=lambda item: int(item[1]["offset"])):
        fh.seek(data_start + int(entry["offset"]))
        text = fh.read(entry.get("size", 0)).decode("utf-8", "replace")
        package = path.split("/")[-3]
        found = []
        for match in RULE.finditer(text):
            width = re.search(r"max-width:\s*([^;}]+)", match.group(2))
            found.append((match.group(1), width.group(1).strip() if width else "?"))
        total += len(found)
        print(f"{package:<44} {len(found)} 条")
        for cls, width in found[:16]:
            print(f"    {width:<12} {cls}")
print(f"\n合计 {total} 条")
