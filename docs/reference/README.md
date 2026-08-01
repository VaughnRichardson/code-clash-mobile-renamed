# What the original Card Clash actually looks like

Captured from the running Godot game, not described from its source:

```sh
cd testproject && godot --headless --import
xvfb-run -a godot --rendering-driver opengl3 --resolution 720x1280 \
  res://tools/map_pipeline/capture_scene.tscn -- \
  res://scenes/card_game/battle/Battle.tscn /tmp/godot-battle.png 60
```

Nobody had done this before. Every earlier decision about "the original's
feeling" was inferred from palette constants in `Battle.gd`, and inferring was
wrong in three ways that mattered.

## `godot-battle.png` — the battle scene

**A horizontal card table.** Left to right: your deck as a visible face-down
*stack*, your active card, `VS`, the foe's active card, their deck stack. The
board owns the centre of the screen and the cards are large. A narrow log slab
is pinned to the left *edge*; it does not compete for the middle.

**The card object**: gold frame, a dark art window filling most of it, and a
footer bar carrying a **red circular power badge** and a **green circular
stamina badge** flanking a `PWR · STA` caption. `You` sits under your card in
warm ink, `Foe` under theirs in red.

**The deck stacks are the strongest card-game signal in the whole scene** and
the web build has no equivalent — you can see how many cards you have left as a
physical pile, with a gold diamond ornament on the back.

## `godot-menu.png` — the main menu

A **plum-violet night sky** with drifting specks, not the warm tavern brown the
`Battle.gd` constants imply. The game's overall key is cooler and more purple
than the battle palette alone suggests.

## Measured colours

| | |
|---|---|
| table ground | `#241c1c` — **luminance 29.7**, hue 0°, sat 0.22 |
| menu sky | `#1c1424` — luminance 22.9, hue **270°**, sat 0.44 |
| card art interior | `#1c1019` |
| deck back gold | `#b48a4a` |
| log slab | `#271c2a` |

## "Very dark" is not about brightness — corrected

An earlier version of this file said the web build's `--bg` was luminance 17
against the original's 28, and called that gap the owner's "it is very dark"
note quantified. **That comparison was invalid** and it briefed two agents in
the wrong direction. It read a CSS *token* on one side and a rendered *pixel*
on the other; a `--bg` value says nothing about the screen once a background
image, a vignette and several translucent overlays are stacked on it.

Measured like for like with `client/tools/frame_key.py`, on composited PNGs:

| | median | ground | hex | hue | sat | p90 | ground share |
|---|---|---|---|---|---|---|---|
| godot battle | 28.9 | 29.7 | `#241c1c` | 0° | 0.22 | 31 | **0.83** |
| godot menu | 18.6 | 22.9 | `#1c1424` | 270° | 0.44 | 20 | 0.46 |
| web battle | 32.0 | 36.6 | `#2c2414` | **40°** | **0.55** | 49 | **0.21** |

The web build is **lighter** than the original, not darker, and its highlight
tail is considerably wider. Three real differences:

1. **Hue.** Web ground is amber at 40°. The original table is neutral-warm at
   0° and its menu sky is violet at 270°. The original's key is cooler and
   more purple, never warmer.
2. **Chroma.** Web ground is sat 0.55 — more saturated than either reference.
   A heavily-amber surface at low value is what reads as muddy.
3. **Calm.** The Godot battle frame is 83% one colour: one large quiet surface
   with every highlight spent on the cards. The web build is 21% — many
   surfaces competing at similar value.

So the fix is to re-hue and de-saturate the ground, consolidate it into one
calm surface, and move the contrast into the card objects. Raising luminance
is the overshoot and would cost the cosy key.

Note also that the Godot frame's 83% single colour makes its *aggregate*
statistics nearly meaningless — median, mean and p90 all just re-report the
background. Only `ground` is a usable calibration target from that capture.

`client/tools/scene-weight.mjs` gates all of this, and self-tests both ways:
the bands must accept this reference and reject the build the owner turned
down.
