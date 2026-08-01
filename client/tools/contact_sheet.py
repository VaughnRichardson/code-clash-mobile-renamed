#!/usr/bin/env python3
"""Tile the review screenshots into one contact sheet.

    python3 tools/contact_sheet.py [outfile]

The review captures are one screen per file at a phone viewport, which is the
right shape for judging a screen and the wrong shape for judging the game. This
puts them side by side so the whole app reads at a glance — useful for spotting
that two screens disagree about a colour or a rhythm, which is exactly the class
of defect a single-screen review keeps missing.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REVIEW = Path(__file__).resolve().parents[2] / ".review"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REVIEW / "contact-sheet.png"

BG = (18, 16, 12)
GOLD = (200, 168, 75)
TEXT = (236, 230, 216)
MUTED = (154, 146, 132)

THUMB_W = 300
PAD = 22
LABEL_H = 46
TITLE_H = 96
COLS = 5

CAPTIONS = {
    "01-home": ("Home", "name, deck, opponent or room code"),
    "02-deckbuilder-top": ("Deck builder", "10 leaders, each with its payoff"),
    "03-deckbuilder-order": ("Battle order", "build order IS play order, 1-30"),
    "04-lobby-waiting": ("Room", "four-letter code, waiting for a second seat"),
    "05-battle-first-pick": ("Duel 1", "forced pick — both offers the same unit"),
    "05b-battle-two-card-pick": ("The blind commit", "the central interaction"),
    "06-battle-shop": ("Shop", "between duels, purse and stock"),
    "07-battle-midgame": ("Midgame", "gate and unit races, both seats"),
    "08-battle-midgame-full": ("Midgame, full page", "same state, unclipped"),
    "09-battle-result": ("Result", "reason, final tally, log"),
}


def _font(size: int, bold: bool = False):
    for name in (
        f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def main() -> int:
    shots = sorted(p for p in REVIEW.glob("*.png") if p.stem in CAPTIONS)
    if not shots:
        print(f"no screenshots in {REVIEW}", file=sys.stderr)
        return 1

    thumbs = []
    for path in shots:
        img = Image.open(path).convert("RGB")
        height = round(img.height * THUMB_W / img.width)
        thumbs.append((path.stem, img.resize((THUMB_W, height), Image.LANCZOS)))

    cell_h = max(t.height for _, t in thumbs) + LABEL_H
    rows = (len(thumbs) + COLS - 1) // COLS
    sheet = Image.new(
        "RGB",
        (COLS * THUMB_W + (COLS + 1) * PAD,
         TITLE_H + rows * (cell_h + PAD) + PAD),
        BG)
    draw = ImageDraw.Draw(sheet)

    draw.text((PAD, 26), "Card Clash", font=_font(38, True), fill=GOLD)
    draw.text((PAD + 250, 40),
              f"{len(thumbs)} screens · 390x844 phone viewport · "
              "every one captured from the running game",
              font=_font(17), fill=MUTED)

    for index, (stem, thumb) in enumerate(thumbs):
        col, row = index % COLS, index // COLS
        x = PAD + col * (THUMB_W + PAD)
        y = TITLE_H + row * (cell_h + PAD)
        sheet.paste(thumb, (x, y))
        draw.rectangle([x, y, x + THUMB_W - 1, y + thumb.height - 1],
                       outline=(58, 53, 43))
        title, sub = CAPTIONS[stem]
        draw.text((x, y + thumb.height + 9), title, font=_font(19, True),
                  fill=TEXT)
        draw.text((x, y + thumb.height + 30), sub, font=_font(15), fill=MUTED)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(f"wrote {OUT} ({sheet.width}x{sheet.height}, {len(thumbs)} screens)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
