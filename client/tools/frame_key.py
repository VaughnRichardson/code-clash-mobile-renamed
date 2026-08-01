#!/usr/bin/env python3
"""Measure a rendered frame's key — how dark the screen actually is.

    python3 tools/frame_key.py shot.png [shot.png ...]      # -> JSON on stdout

Reads the COMPOSITED PNG, never the stylesheet. That distinction is the whole
point of this file: an earlier harness in this project read ink from CSS and
ground from the render, and scored a darker vignette as an improvement. A
build's `--bg` token says nothing about the screen once four translucent
overlays, a vignette and a background image are stacked on top of it.

Reports three numbers per frame:

  median   the middle of the whole frame — catches a light ground buried
           under black ink, which a ground-only reading calls fine
  ground   luminance of the modal colour, quantised to 5 bits per channel:
           the thing you are looking at when you say "the table is dark"
  p90      the bright tail. A screen can hit a healthy median by being evenly
           grey with no highlight at all, and that reads as flat, not cosy.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

# Rec.709, the same weights the client's contrast harness uses.
W = np.array([0.2126, 0.7152, 0.0722])


def measure(path: Path) -> dict:
    img = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    lum = img @ W
    quant = (img.astype(np.uint8) >> 3)
    keys = (quant[..., 0].astype(np.int32) << 10
            | quant[..., 1].astype(np.int32) << 5
            | quant[..., 2].astype(np.int32))
    mode, count = Counter(keys.ravel()).most_common(1)[0]
    rgb = [((mode >> 10) & 31) * 8 + 4, ((mode >> 5) & 31) * 8 + 4,
           (mode & 31) * 8 + 4]
    return {
        "file": path.name,
        "pixels": int(lum.size),
        "median": round(float(np.median(lum)), 2),
        "mean": round(float(lum.mean()), 2),
        "p90": round(float(np.percentile(lum, 90)), 2),
        "ground": round(float(np.dot(rgb, W)), 2),
        "ground_hex": "#%02x%02x%02x" % tuple(rgb),
        "ground_share": round(count / lum.size, 4),
    }


def main() -> int:
    paths = [Path(a) for a in sys.argv[1:]]
    if not paths:
        print(__doc__, file=sys.stderr)
        return 1
    print(json.dumps([measure(p) for p in paths], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
