"""扫描设置页/第三方插件里的内联宽度上限（JSX maxWidth / style 里的 max-width）。

需要两个环境变量：
    ASAR_PATH     指向 app.asar（<DSH install dir>\\resources\\app.asar）
    DSH_HOME      DSH 的用户数据根（默认 ~\\.dsh），插件安装在 <DSH_HOME>\\profiles\\desktop\\node_modules
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar_lib import read_header, walk  # noqa: E402

INLINE = re.compile(r"maxWidth:\s*[\"']([^\"']+)[\"']")
STYLE_ATTR = re.compile(r"style:\s*\{[^{}]{0,400}?maxWidth")
TARGETS = re.compile(r"dsh-client-ui-settings-[a-z-]+/lib/client\.js$")

header, data_start = read_header()
entries = [(p, e) for p, e in walk(header) if TARGETS.search(p)]

with open(os.environ["ASAR_PATH"], "rb") as fh:
    fh.seek(data_start)
    for path, entry in entries:
        text = fh.read(entry.get("size", 0)).decode("utf-8", "replace")
        values = sorted({m.group(1) for m in INLINE.finditer(text)})
        style_count = len(STYLE_ATTR.findall(text))
        name = path.split("/")[-3]
        if values or style_count:
            print(f"{name:<48} inline maxWidth={values or '-'}  style-with-maxWidth={style_count}")

dsh_home = os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")
root = os.path.join(dsh_home, "profiles", "desktop", "node_modules")
print(f"\n=== 已安装第三方插件（真实文件）{root} ===")
for plugin in sorted(os.listdir(root)) if os.path.isdir(root) else []:
    for candidate in (os.path.join(root, plugin, "client.js"), os.path.join(root, plugin, "lib", "client.js")):
        if not os.path.isfile(candidate):
            continue
        text = open(candidate, encoding="utf-8", errors="replace").read()
        values = sorted({m.group(1) for m in INLINE.finditer(text)})
        style_count = len(STYLE_ATTR.findall(text))
        css_caps = sorted({m.group(0)[:80] for m in re.finditer(r"max-width:\s*\d{3,4}px", text)})
        if values or style_count or css_caps:
            print(f"{plugin:<24} inline={values or '-'} style-with-maxWidth={style_count} css={css_caps or '-'}")
