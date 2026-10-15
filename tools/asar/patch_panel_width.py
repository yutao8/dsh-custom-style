"""Widen (or restore) the DSH Web GUI settings-dialog panel.

The settings panel width is not a user setting: it is a literal in the shipped
client bundle

    dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js

inside the app.asar under your DeepSeek Harness install
(<DSH install dir>\\resources\\app.asar; the ASAR_PATH env var selects it),
rule `.wCInkW_panel{...}`.

This script edits that byte range *in place* with an exactly length-preserving
rewrite, so the asar header (offsets/sizes) stays valid and no repack is needed:

    width:800px        -> width:<N>px          (+1 byte for any 4-digit N)
    "\\n\\t\\t"           -> "\\n\\t"               (-1 byte, plain JS indentation)

Usage:
    set ASAR_PATH=<DSH install dir>\\resources\\app.asar
    python patch_panel_width.py                 # dry run, shows the diff
    python patch_panel_width.py --width 1200 --apply
    python patch_panel_width.py --revert --apply
"""

import argparse
import hashlib
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asar_lib import ASAR, read_header, walk

TARGET = "dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js"
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
BACKUP = os.path.join(WORK, "settings-general-client.orig.js")
CURRENT_W = b"width:800px"
COMP_PAIRS = [(b"\n\t\t", b"\n\t", False)]  # -1 byte each, plain JS indentation
# The compensation must land in real JS whitespace, never inside a template
# literal: the first occurrence sits at the top of the bundle, in code.
SAFE_COMP_OFFSET = 1000


def digest(data):
    return hashlib.sha256(data).hexdigest()[:16]


def load_region():
    header, data_start = read_header()
    index = {p: e for p, e in walk(header)}
    entry = index[TARGET]
    offset = data_start + int(entry["offset"])
    size = entry["size"]
    with open(ASAR, "rb") as fh:
        fh.seek(offset)
        blob = fh.read(size)
    if not blob.startswith(b"window.__ModuleLoader__.load({"):
        raise SystemExit(f"unexpected bundle content at {offset:#x}; refusing to patch")
    return offset, blob


def make_patched(blob, width, pad_bytes):
    """Return (patched, note). pad_bytes = number of bytes that must be removed."""
    if blob.count(CURRENT_W) != 1:
        raise SystemExit(f"expected exactly one {CURRENT_W!r}; found {blob.count(CURRENT_W)}")
    new_w = b"width:%dpx" % width
    delta = len(new_w) - len(CURRENT_W)
    patched = blob.replace(CURRENT_W, new_w)

    notes = [f"width:800px -> width:{width}px ({delta:+d} bytes)"]
    remaining = delta
    for old, new, must_be_unique in COMP_PAIRS:
        while remaining > 0 and patched.count(old):
            at = patched.find(old)
            if at > SAFE_COMP_OFFSET:
                raise SystemExit(
                    f"refusing to trim indentation at offset {at}: outside the verified-safe head"
                )
            patched = patched[:at] + new + patched[at + len(old):]
            remaining -= len(old) - len(new)
            notes.append(f"{old!r} -> {new!r} at offset {at} ({len(new) - len(old):+d} bytes)")
    if remaining != 0:
        raise SystemExit(f"cannot offset {remaining:+d} bytes with the known safe whitespace")

    if len(patched) != len(blob):
        raise SystemExit("internal error: length changed")
    return patched, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--revert", action="store_true")
    args = ap.parse_args()

    os.makedirs(WORK, exist_ok=True)
    offset, blob = load_region()
    print(f"asar          {ASAR}")
    print(f"entry         {TARGET}")
    print(f"file offset   {offset} (0x{offset:x}), size {len(blob)}, sha256:{digest(blob)}")

    if args.revert:
        if not os.path.exists(BACKUP):
            raise SystemExit(f"no backup at {BACKUP}")
        with open(BACKUP, "rb") as fh:
            original = fh.read()
        if len(original) != len(blob):
            raise SystemExit("backup length differs from the archive region; aborting")
        patched, notes = original, ["restore original bytes"]
    else:
        if not os.path.exists(BACKUP):
            with open(BACKUP, "wb") as fh:
                fh.write(blob)
            print(f"backup        {BACKUP}")
        patched, notes = make_patched(blob, args.width, 0)

    for note in notes:
        print("patch         " + note)
    print(f"result        size {len(patched)}, sha256:{digest(patched)}")
    print(f"check         contains width:800px={patched.count(b'width:800px')} "
          f"width:{args.width}px={patched.count(b'width:%dpx' % args.width)}")

    copy = os.path.join(WORK, "settings-general-client.patched.js")
    with open(copy, "wb") as fh:
        fh.write(patched)
    print(f"wrote         {copy}")

    if not args.apply:
        print("\ndry run only; re-run with --apply to write the archive")
        return

    with open(ASAR, "r+b") as fh:
        fh.seek(offset)
        fh.write(patched)
        fh.flush()
        os.fsync(fh.fileno())
    with open(ASAR, "rb") as fh:
        fh.seek(offset)
        check = fh.read(len(patched))
    ok = check == patched
    print(f"\napplied       readback match={ok}")
    if not ok:
        raise SystemExit("readback mismatch after write")


if __name__ == "__main__":
    main()
