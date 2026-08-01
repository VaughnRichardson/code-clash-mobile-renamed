#!/usr/bin/env python3
"""Generate placeholder artwork so the design can be judged WITH images in it.

    python3 tools/gen_placeholder_art.py [--out client/public/art]

Why this exists
---------------
Every review of this screen so far has judged a layout made of typography, and
every one of them said the same thing: nothing on it is drawn. But you cannot
design an image-forward screen against empty boxes — the composition, the
crops, the contrast of text over art and the loading path are all invisible
until real image FILES are in the DOM.

So these are real PNGs on disk, loaded through `<img>`/`background-image` like
the final art will be. They are deliberately *placeholders*: flat, graphic,
obviously stand-in. They are NOT trying to be good art. They exist to make the
layout honest, and to be deleted.

Each piece is deterministic from its own id, so a unit looks the same on every
run and every machine, and no two units look alike — the failure mode of the
earlier attempt was one generic emblem repeated fourteen times, which taught
the layout nothing.

Replacing them with real art
----------------------------
`data/art.json` maps every id to a path and records the size and safe-area the
layout needs. Drop a real file at the same path, same aspect, and nothing in
the client changes. See `docs/ART_BRIEF.md` for the generation prompts.
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]

# ── sizes ────────────────────────────────────────────────────────────────────
# Card art is 8:11, the proportion `CardDisplay.gd` already uses (160x220), which
# is within a hair of a real 63x88mm TCG card. Generated at 4x the on-screen
# size so it survives a 3x DPR phone.
CARD = (512, 704)
PORTRAIT = (320, 320)      # leader — square, cropped to a circle by the client
SCENE = (1080, 1920)       # background — portrait phone
ICON = (128, 128)

# ── the cast ─────────────────────────────────────────────────────────────────
# `motif` picks the silhouette vocabulary; `hue` seeds the palette. Kept in one
# table so a new unit is one row.
UNITS = {
    "Berserker": ("axe", 18),
    "Brute": ("maul", 8),
    "Champion": ("crown", 44),
    "Duelist": ("rapier", 205),
    "Fortress": ("tower", 30),
    "Grunt": ("spear", 96),
    "Guardian": ("shield", 150),
    "Martyr": ("chalice", 320),
    "Rallier": ("banner", 265),
    "Soldier": ("sword", 110),
    "Vanguard": ("helm", 52),
    "Warden": ("key", 175),
    "Wraith": ("wisp", 285),
    "Warlord": ("crown", 355),
}

LEADERS = {
    "second_wind": 130, "momentum": 95, "giant_slayer": 25, "blitz": 12,
    "doomsayer": 300, "sentinel": 200, "reaper": 340, "gravekeeper": 270,
    "oracle": 190, "ritualist": 315,
}

ICONS = ["units", "gold", "charge", "power", "stamina", "curse",
         "ward", "scout", "fog", "boss", "leader", "clash"]

SCENES = {"table": 32, "home": 40, "result": 210}


def _seed(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


def _rgb(hue: float, sat: float, val: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb((hue % 360) / 360.0, sat, val)
    return int(r * 255), int(g * 255), int(b * 255)


def _ground(size: tuple[int, int], hue: float, *, lift: float = 0.0) -> Image.Image:
    """A warm-to-dark vertical wash with a soft radial pool, matching the
    lamp-lit page the client draws behind everything."""
    w, h = size
    img = Image.new("RGB", size, _rgb(hue, 0.55, 0.10 + lift))
    draw = ImageDraw.Draw(img)
    top = _rgb(hue, 0.42, 0.30 + lift)
    bot = _rgb(hue, 0.62, 0.07 + lift)
    for y in range(h):
        t = y / max(h - 1, 1)
        draw.line([(0, y), (w, y)],
                  fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))

    glow = Image.new("L", size, 0)
    gd = ImageDraw.Draw(glow)
    cx, cy, rad = w * 0.5, h * 0.34, max(w, h) * 0.52
    for step in range(26):
        t = step / 25
        gd.ellipse([cx - rad * (1 - t), cy - rad * (1 - t),
                    cx + rad * (1 - t), cy + rad * (1 - t)], fill=int(90 * t))
    glow = glow.filter(ImageFilter.GaussianBlur(max(w, h) * 0.06))
    img.paste(Image.new("RGB", size, _rgb(hue + 12, 0.34, 0.52 + lift)), (0, 0), glow)
    return img


def _vignette(img: Image.Image, strength: float = 0.55) -> Image.Image:
    """The elliptical falloff from the parent game's `vignette.gdshader`."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    for step in range(30):
        t = step / 29
        rw, rh = w * (0.52 + 0.62 * t), h * (0.40 + 0.62 * t)
        md.ellipse([w / 2 - rw, h / 2 - rh, w / 2 + rw, h / 2 + rh],
                   outline=int(255 * strength * t), width=max(int(h * 0.05), 2))
    mask = mask.filter(ImageFilter.GaussianBlur(max(w, h) * 0.05))
    img.paste(Image.new("RGB", img.size, (0, 0, 0)), (0, 0), mask)
    return img


# ── silhouette vocabulary ────────────────────────────────────────────────────
# Normalised to a unit square; the caller scales. Enough distinct shapes that a
# player could tell two cards apart across a table, which is the whole point.

def _motif(name: str) -> list[list[tuple[float, float]]]:
    m = {
        "sword":   [[(.5, .05), (.57, .22), (.55, .66), (.45, .66), (.43, .22)],
                    [(.30, .66), (.70, .66), (.70, .73), (.30, .73)],
                    [(.46, .73), (.54, .73), (.54, .95), (.46, .95)]],
        "axe":     [[(.47, .08), (.53, .08), (.53, .95), (.47, .95)],
                    [(.53, .16), (.86, .28), (.86, .52), (.53, .46)],
                    [(.47, .16), (.16, .28), (.16, .52), (.47, .46)]],
        "maul":    [[(.46, .18), (.54, .18), (.54, .95), (.46, .95)],
                    [(.22, .06), (.78, .06), (.78, .34), (.22, .34)]],
        "rapier":  [[(.5, .04), (.54, .30), (.52, .70), (.48, .70), (.46, .30)],
                    [(.36, .70), (.64, .70), (.62, .77), (.38, .77)],
                    [(.47, .77), (.53, .77), (.53, .96), (.47, .96)]],
        "spear":   [[(.5, .04), (.60, .24), (.53, .30), (.53, .96),
                     (.47, .96), (.47, .30), (.40, .24)]],
        "shield":  [[(.16, .10), (.84, .10), (.80, .58), (.5, .94),
                     (.20, .58)]],
        "tower":   [[(.20, .34), (.80, .34), (.74, .95), (.26, .95)],
                    [(.16, .16), (.30, .16), (.30, .34), (.16, .34)],
                    [(.43, .16), (.57, .16), (.57, .34), (.43, .34)],
                    [(.70, .16), (.84, .16), (.84, .34), (.70, .34)]],
        "helm":    [[(.20, .46), (.26, .18), (.74, .18), (.80, .46),
                     (.76, .82), (.5, .94), (.24, .82)]],
        "crown":   [[(.14, .74), (.86, .74), (.86, .88), (.14, .88)],
                    [(.14, .74), (.24, .26), (.36, .56), (.5, .16),
                     (.64, .56), (.76, .26), (.86, .74)]],
        "banner":  [[(.46, .06), (.52, .06), (.52, .96), (.46, .96)],
                    [(.52, .12), (.88, .20), (.80, .40), (.88, .60),
                     (.52, .52)]],
        "chalice": [[(.26, .16), (.74, .16), (.66, .52), (.34, .52)],
                    [(.46, .52), (.54, .52), (.54, .82), (.46, .82)],
                    [(.30, .82), (.70, .82), (.70, .93), (.30, .93)]],
        "key":     [[(.5, .10), (.66, .24), (.60, .42), (.40, .42), (.34, .24)],
                    [(.47, .42), (.53, .42), (.53, .94), (.47, .94)],
                    [(.53, .68), (.72, .68), (.72, .77), (.53, .77)],
                    [(.53, .82), (.66, .82), (.66, .90), (.53, .90)]],
        "wisp":    [[(.5, .08), (.68, .30), (.70, .58), (.5, .92),
                     (.30, .58), (.32, .30)],
                    [(.42, .34), (.58, .34), (.56, .50), (.44, .50)]],
    }
    return m.get(name, m["sword"])


def _draw_motif(img: Image.Image, motif: str, hue: float, box) -> None:
    """Fill, rim-light and drop-shadow, so the shape reads as a lit object
    rather than a flat sticker."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    shapes = _motif(motif)

    shadow = Image.new("L", img.size, 0)
    sd = ImageDraw.Draw(shadow)
    for poly in shapes:
        sd.polygon([(x0 + px * w, y0 + py * h + h * 0.02) for px, py in poly],
                   fill=170)
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(img.size) * 0.018))
    img.paste(Image.new("RGB", img.size, (0, 0, 0)), (0, 0), shadow)

    body = ImageDraw.Draw(img)
    fill = _rgb(hue, 0.30, 0.86)
    rim = _rgb(hue + 20, 0.16, 0.99)
    edge = _rgb(hue, 0.66, 0.30)
    for poly in shapes:
        pts = [(x0 + px * w, y0 + py * h) for px, py in poly]
        body.polygon(pts, fill=fill, outline=edge, width=max(int(w * 0.012), 2))
        body.line([pts[0], pts[1]] if len(pts) > 1 else pts,
                  fill=rim, width=max(int(w * 0.016), 2))


def _noise(img: Image.Image, amount: int = 5) -> Image.Image:
    """A little tooth so a flat fill does not read as a UI panel."""
    w, h = img.size
    rnd = Image.effect_noise((w, h), 26).convert("L")
    return Image.blend(img, Image.composite(
        Image.new("RGB", img.size, (255, 255, 255)), img, rnd), amount / 100)


# ── pieces ───────────────────────────────────────────────────────────────────

def card(name: str, motif: str, hue: float) -> Image.Image:
    img = _ground(CARD, hue)
    w, h = CARD
    # Kept clear of the name strip (bottom 18%) and the ability band (45-75%),
    # so the composition survives the overlays the layout puts on top.
    _draw_motif(img, motif, hue, (w * 0.20, h * 0.08, w * 0.80, h * 0.50))
    img = _vignette(img, 0.5)
    return _noise(img)


def portrait(leader_id: str, hue: float) -> Image.Image:
    img = _ground(PORTRAIT, hue, lift=0.04)
    w, h = PORTRAIT
    _draw_motif(img, "helm", hue, (w * 0.24, h * 0.16, w * 0.76, h * 0.84))
    return _noise(_vignette(img, 0.42))


def scene(hue: float) -> Image.Image:
    """A background: bands of warm haze, no subject. It sits under everything,
    so it must never compete — this is why it is only a wash."""
    img = _ground(SCENE, hue)
    w, h = SCENE
    draw = ImageDraw.Draw(img, "RGBA")
    rnd = _seed(str(hue))
    for i in range(7):
        band = h * (0.20 + 0.10 * i)
        alpha = 16 + (rnd >> (i * 3)) % 14
        draw.polygon([(0, band), (w, band - h * 0.03), (w, band + h * 0.08),
                      (0, band + h * 0.11)], fill=(*_rgb(hue + i * 6, 0.4, 0.5), alpha))
    return _noise(_vignette(img, 0.62), 3)


def icon(kind: str, hue: float) -> Image.Image:
    img = Image.new("RGBA", ICON, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    w, h = ICON
    gold = _rgb(45, 0.55, 0.86)
    shape = {
        "units": "shield", "gold": "crown", "charge": "wisp",
        "power": "sword", "stamina": "shield", "curse": "wisp",
        "ward": "shield", "scout": "key", "fog": "wisp", "boss": "crown",
        "leader": "helm", "clash": "axe",
    }[kind]
    for poly in _motif(shape):
        draw.polygon([(px * w, py * h) for px, py in poly],
                     fill=(*gold, 235), outline=(*_rgb(45, 0.7, 0.45), 255),
                     width=3)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "client" / "public" / "art"))
    args = ap.parse_args()
    out = Path(args.out)

    manifest: dict = {
        "_note": "Placeholder art. Replace a file in place, keep the size and "
                 "safe areas, and no client code changes. See docs/ART_BRIEF.md.",
        "cards": {}, "leaders": {}, "scenes": {}, "icons": {},
        "sizes": {
            "card": {"w": CARD[0], "h": CARD[1], "aspect": "8:11",
                     "safe": "keep the subject inside the top 50%; the bottom "
                             "18% carries the name strip and 45-75% can carry "
                             "an ability band"},
            "leader": {"w": PORTRAIT[0], "h": PORTRAIT[1], "aspect": "1:1",
                       "safe": "cropped to a circle — keep the subject inside "
                               "the inscribed circle"},
            "scene": {"w": SCENE[0], "h": SCENE[1], "aspect": "9:16",
                      "safe": "no subject; a wash only. It sits under all text."},
            "icon": {"w": ICON[0], "h": ICON[1], "aspect": "1:1",
                     "safe": "transparent background, single colour, legible at 20px"},
        },
    }

    for folder in ("cards", "leaders", "scenes", "icons"):
        (out / folder).mkdir(parents=True, exist_ok=True)

    for name, (motif, hue) in UNITS.items():
        rel = f"art/cards/{name.lower()}.png"
        card(name, motif, hue).save(out / "cards" / f"{name.lower()}.png")
        manifest["cards"][name] = rel

    for lid, hue in LEADERS.items():
        rel = f"art/leaders/{lid}.png"
        portrait(lid, hue).save(out / "leaders" / f"{lid}.png")
        manifest["leaders"][lid] = rel

    for sid, hue in SCENES.items():
        rel = f"art/scenes/{sid}.jpg"
        scene(hue).convert("RGB").save(out / "scenes" / f"{sid}.jpg",
                                       quality=82, optimize=True)
        manifest["scenes"][sid] = rel

    for kind in ICONS:
        rel = f"art/icons/{kind}.png"
        icon(kind, 45).save(out / "icons" / f"{kind}.png")
        manifest["icons"][kind] = rel

    (ROOT / "data" / "art.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(len(manifest[k]) for k in ("cards", "leaders", "scenes", "icons"))
    print(f"wrote {total} placeholder assets to {out}")
    print(f"manifest: {ROOT / 'data' / 'art.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
