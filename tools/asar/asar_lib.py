"""Minimal read-only ASAR reader (header parse + entry walk + file extraction).

The target archive is selected with the ASAR_PATH environment variable, e.g.
    ASAR_PATH="<DSH install dir>/resources/app.asar"  (Windows default install
    is  <Drive>:\\DeepSeek Harness\\resources\\app.asar  — find yours with
    "where" from the DeepSeek Harness shortcut location).
"""

import json
import os
import struct


def _asar_path() -> str:
    path = os.environ.get("ASAR_PATH")
    if not path:
        raise SystemExit("请设置 ASAR_PATH 指向 app.asar（例如 <DSH 安装目录>\\resources\\app.asar）")
    return path


class _LazyAsar:
    """Keeps `ASAR` usable as a module attribute while resolving it lazily."""

    def __str__(self) -> str:
        return _asar_path()

    def __fspath__(self) -> str:
        return _asar_path()


ASAR = _LazyAsar()


def read_header(path=None):
    with open(path or _asar_path(), "rb") as fh:
        head = fh.read(16)
        size0, header_size, _pickle_payload, json_len = struct.unpack("<IIII", head)
        fh.seek(16)
        raw = fh.read(json_len)
    header = json.loads(raw.decode("utf-8"))
    return header, 8 + header_size


def walk(node, prefix=""):
    """Yield (path, entry) for every file entry."""
    for name, entry in node.get("files", {}).items():
        path = f"{prefix}/{name}" if prefix else name
        if "files" in entry:
            yield from walk(entry, path)
        else:
            yield path, entry


def read_file(path, data_start, size):
    with open(_asar_path(), "rb") as fh:
        fh.seek(data_start + int(path))
        return fh.read(size)
