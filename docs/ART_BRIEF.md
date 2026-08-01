# Art brief — generating the real artwork

The game currently ships **placeholder art**: 41 flat, obviously stand-in files
made by `tools/gen_placeholder_art.py`. They exist so the layout could be
designed against real images in the real loading path, and they are meant to be
deleted.

This document is what you need to replace them. It is written to be pasted into
an image generator (ChatGPT / DALL·E, Midjourney, whatever you use) a piece at a
time.

**Dropping art in requires no code change.** Save a file at the same path, at
the same aspect ratio, and the client picks it up. `data/art.json` is the
manifest of every path and its safe area.

---

## 1. The house style

Everything below assumes one look. Paste this block *ahead of* any individual
prompt so the set holds together — a card game where each card was generated in
isolation reads as a bag of stickers.

> **Style:** painted digital illustration, warm and slightly worn, in the manner
> of a hand-painted trading card. Muted earthy palette — tobacco browns, warm
> parchment cream, brass and old gold, moss green, brick red. Deep warm-black
> shadows, never neutral grey or pure black. A single warm light source from
> the upper left, as if from a lamp or a fire just off frame. Soft painterly
> edges, visible brush character, gentle grain. Slightly desaturated, cosy
> rather than heroic. No hard rim-lighting, no chrome, no neon, no modern
> rendering gloss.
>
> **Composition:** the subject occupies the upper half of the frame and is
> centred horizontally. The lower third falls away into shadow or haze. No
> important detail below 80% of the height.
>
> **Absolutely not:** no text, no letters, no numbers, no logos, no watermark,
> no border, no frame, no card template — the game draws its own frame over
> this image. No white or light background.

Why the composition rule matters: the client lays a **name strip across the
bottom 18%** of every card and can lay a translucent **ability band over
45–75%**. Anything you put there is covered or fighting for legibility.

---

## 2. What to generate

| Set | Path | Size | Aspect | Notes |
|---|---|---|---|---|
| Units | `client/public/art/cards/<name>.png` | 512×704 | 8:11 | 14 files, lowercase names |
| Leaders | `client/public/art/leaders/<id>.png` | 320×320 | 1:1 | 10 files, **cropped to a circle** |
| Scenes | `client/public/art/scenes/<id>.jpg` | 1080×1920 | 9:16 | 3 files, wash only, no subject |
| Icons | `client/public/art/icons/<kind>.png` | 128×128 | 1:1 | 14 files, transparent, single colour |

8:11 is not arbitrary — it is the proportion the Godot game's `CardDisplay.gd`
already uses (160×220), which is within a hair of a real 63×88mm trading card.

---

## 3. The units

Fourteen cards. Each line gives you the stats (power/stamina), the ability, and
the flavour text already written for it — the flavour is the best steer on the
character, so keep it in the prompt.

Prompt template:

> [HOUSE STYLE BLOCK]
> Subject: **{description}**. {flavour}

| File | Stats | Prompt subject |
|---|---|---|
| `berserker.png` | 7/4 Warcry | A wild-eyed axe-fighter mid-roar, furs and war-paint, braced to swing. *"Each fallen ally fuels the frenzy."* |
| `brute.png` | 9/3 | An enormous slab-shouldered brawler hefting a stone maul, more mass than skill. *"Hits like a landslide. Falls like one too."* |
| `champion.png` | 8/5 unique | A single peerless duellist in fine battered plate, sword lowered, utterly composed. *"There can be only one."* |
| `duelist.png` | 5/4 Resolve | A lean fencer in a torn coat, rapier raised, bleeding but unbowed. *"When both blades fall, only resolve keeps you standing."* |
| `fortress.png` | 3/9 | A colossal armoured figure planted behind a tower shield, immovable. *"They built a wall. It punched back."* |
| `grunt.png` | 7/5 | A plain infantry soldier with a worn spear and dented helm, tired and dependable. *"The backbone of every army."* |
| `guardian.png` | 3/6 Guardian | A shield-bearer taking a blow meant for someone else, teeth gritted. *"One moment of defiance can change a battle."* |
| `martyr.png` | 4/6 Martyr | A robed figure falling with arms outspread, light spilling from the wound. *"Their sacrifice becomes the next warrior's strength."* |
| `rallier.png` | 6/5 Rallier | A standard-bearer turning to shout the line forward, banner snapping. *"Victory is contagious when the right voice leads the charge."* |
| `soldier.png` | 6/6 | A disciplined swordsman in a steady guard, unremarkable and completely reliable. *"Balanced in all things."* |
| `vanguard.png` | 6/4 Vanguard | The first through the breach, shoulder down, helm scarred. *"First in. Last standing."* |
| `warden.png` | 2/7 Steal | A hooded figure palming a key that was not theirs, half-smiling. *"What's yours is mine. For now."* |
| `wraith.png` | 4/5 Ambush | A half-there figure of smoke and cloth, blade already withdrawn. *"You never see the first strike."* |
| `warlord.png` | 10/8 **boss** | A towering crowned commander on a rise, cloak heavy, the field behind them. Grander and more lit than any other card. |

`warlord` is the boss and should read as a step above the rest — more scale,
more light, more ceremony.

---

## 4. The leaders

Ten portraits, **square, and cropped to a circle by the client** — so keep the
face inside the inscribed circle and expect the corners to be thrown away.

> [HOUSE STYLE BLOCK]
> Subject: a head-and-shoulders portrait of **{description}**. Centred, facing
> the viewer, filling the middle of a square frame with clearance on all four
> sides. Shallow depth, background falling to warm shadow.

| File | Genre | Subject |
|---|---|---|
| `second_wind.png` | Survival | A scarred veteran who has clearly been left for dead before and got up |
| `momentum.png` | Sustain | A calm healer-captain with steady eyes and a warm half-smile |
| `giant_slayer.png` | Underdog | A small wiry fighter with an oversized weapon and enormous nerve |
| `blitz.png` | Aggro | A young hot-eyed commander already leaning forward |
| `doomsayer.png` | Destruction | A hollow-cheeked prophet who expects everyone to lose, including themselves |
| `sentinel.png` | Control | A watchful armoured officer, patient, arms folded |
| `reaper.png` | Execution | A cowled executioner, face half in shadow, entirely unhurried |
| `gravekeeper.png` | Recursion | A weathered keeper with a lantern and a spade, kind and tired |
| `oracle.png` | Scout | A blindfolded seer whose attention is clearly elsewhere |
| `ritualist.png` | Sacrifice | A robed celebrant with chalk-marked hands and a fixed devotional stare |

---

## 5. The scenes

Three backgrounds. **These sit under all the text on the screen**, so they are
washes, not pictures — the single most common way to ruin this is to generate a
lovely detailed illustration that makes every label unreadable.

> [HOUSE STYLE BLOCK]
> Subject: an out-of-focus atmospheric background, **no subject, no figures, no
> focal point**. Heavy bokeh, low contrast, dark. Reads as texture rather than
> as a scene. Portrait orientation.

| File | Description |
|---|---|
| `table.jpg` | A worn tavern tabletop under a hanging lamp, seen from above, edges falling into dark. This is the battle ground. |
| `home.jpg` | A dim room with firelight somewhere off frame — warm haze, no detail. |
| `result.jpg` | The same table after the game, lamp lower, colder, quieter. |

If a generated scene has too much contrast, darken it and lower the saturation
before dropping it in — it should look almost empty on its own.

---

## 6. The icons

Fourteen, all **transparent background, single warm-gold colour, legible at
20px**. These are the ones that must survive being tiny, so favour a bold
simple silhouette over detail.

> Subject: a simple flat icon of **{thing}**, single solid warm-gold colour on a
> fully transparent background, bold silhouette, no outline, no gradient, no
> text, centred with even padding, readable at 20 pixels.

`units` (stacked cards) · `gold` (a coin) · `charge` (a diamond) · `power`
(a sword) · `stamina` (a shield) · `curse` (a cracked skull) · `ward` (a
warding sigil) · `scout` (an eye) · `fog` (a cloud bank) · `boss` (a crown) ·
`leader` (a helm) · `clash` (two crossed blades)

---

## 7. After you drop the files in

```sh
cd card-clash-mobile/client
npm run build
node tools/contrast-check.mjs      # every string still passes AA over the new art
npx playwright test                # layout still fits the phone
node tools/capture.mjs && python3 tools/contact_sheet.py /tmp/with-real-art.png
```

`contrast-check.mjs` is the important one. Text over illustration is where
legibility goes to die, and it measures the real composited result rather than a
colour pair — it samples the *lightest* pixel of the actual ground inside each
string's own box. If a card's art is too bright behind the name strip, it will
tell you, and the fix is to darken that region of the art rather than to lighten
the text.

If a piece fails, the usual causes, in order: too much contrast in the bottom
18%, a light background, or a subject that drifts below the halfway line.
