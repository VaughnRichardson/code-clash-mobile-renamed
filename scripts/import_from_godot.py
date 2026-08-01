#!/usr/bin/env python3
"""One-shot importer: Godot `.tres` card/ability resources -> `data/cards.json`.

Card Clash was hard-forked out of the Godot RPG (`testproject/`). This script
ran once to lift the authored card data across; `data/cards.json` is the source
of truth from here on. It is kept so the import is reproducible and auditable,
not because the game reads `.tres` at runtime — it never does.

Usage:  python3 card-clash-mobile/scripts/import_from_godot.py [--check]

    --check  re-import and diff against the committed cards.json instead of
             rewriting it (exit 1 on drift).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GODOT_ROOT = REPO_ROOT / "testproject"
CARDS_DIR = GODOT_ROOT / "resources" / "cards"
ABILITIES_DIR = GODOT_ROOT / "resources" / "card_abilities"
OUT_PATH = REPO_ROOT / "card-clash-mobile" / "data" / "cards.json"

# CardAbilityData.ability_type enum -> the engine's ability id.
# Read off scripts/card_resources/CardAbilityData.gd.
ABILITY_TYPE_TO_ID = {
    1: "ambush",
    2: "steal",
    3: "warcry",
    4: "guardian",
    5: "resolve",
    6: "rallier",
    7: "martyr",
    8: "vanguard",
}

_ASSIGN = re.compile(r"^(\w+)\s*=\s*(.+)$", re.MULTILINE)
_EXT = re.compile(
    r'\[ext_resource type="(\w+)" path="([^"]+)" id="([^"]+)"\]')


def _parse_tres(path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Returns (assignments, ext_resource_id -> path). Values stay raw strings."""
    text = path.read_text()
    ext = {rid: rpath for _rtype, rpath, rid in _EXT.findall(text)}
    body = text.split("[resource]", 1)[1] if "[resource]" in text else ""
    return dict(_ASSIGN.findall(body)), ext


def _unquote(value: str) -> str:
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    return value


def _ext_id(value: str) -> str | None:
    match = re.match(r'ExtResource\("([^"]+)"\)', value.strip())
    return match.group(1) if match else None


def load_abilities() -> dict[str, dict]:
    """Maps `res://` ability path -> ability record."""
    out: dict[str, dict] = {}
    for path in sorted(ABILITIES_DIR.glob("*.tres")):
        fields, _ = _parse_tres(path)
        type_index = int(fields.get("ability_type", "-1"))
        ability_id = ABILITY_TYPE_TO_ID.get(type_index)
        if ability_id is None:
            raise SystemExit(
                f"{path.name}: unmapped ability_type {type_index} — update "
                "ABILITY_TYPE_TO_ID against CardAbilityData.gd")
        res_path = f"res://resources/card_abilities/{path.name}"
        out[res_path] = {
            "id": ability_id,
            "name": _unquote(fields.get("ability_name", "")),
            "description": _unquote(fields.get("description", "")),
        }
    return out


def load_cards(abilities: dict[str, dict]) -> list[dict]:
    out: list[dict] = []
    for path in sorted(CARDS_DIR.glob("*.tres")):
        fields, ext = _parse_tres(path)
        ability_id = None
        slot1 = fields.get("ability_slot_1")
        if slot1:
            ref = _ext_id(slot1)
            if ref is None or ref not in ext:
                raise SystemExit(f"{path.name}: unresolved ability_slot_1")
            ability_id = abilities[ext[ref]]["id"]
        out.append({
            "name": _unquote(fields["card_name"]),
            "power": int(fields["power"]),
            "stamina": int(fields["stamina"]),
            "ability": ability_id,
            "deck_limit": int(fields.get("deck_limit", "3")),
            "unique": _unquote(fields.get("is_unique", "false")) == "true",
            "flavor": _unquote(fields.get("flavor_text", "")),
        })
    return out


def build() -> dict:
    abilities = load_abilities()
    cards = load_cards(abilities)
    return {
        "_source": "imported from testproject/resources/{cards,card_abilities}",
        "abilities": sorted(abilities.values(), key=lambda a: a["id"]),
        "cards": cards,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if not CARDS_DIR.is_dir():
        print(f"godot source not found at {CARDS_DIR}", file=sys.stderr)
        return 1

    built = build()
    text = json.dumps(built, indent=2) + "\n"

    if args.check:
        if not OUT_PATH.exists():
            print("cards.json missing", file=sys.stderr)
            return 1
        if OUT_PATH.read_text() != text:
            print("cards.json differs from a fresh import of the .tres files",
                  file=sys.stderr)
            return 1
        print(f"cards.json matches the Godot source "
              f"({len(built['cards'])} cards)")
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text)
    print(f"wrote {OUT_PATH.relative_to(REPO_ROOT)} "
          f"({len(built['cards'])} cards, {len(built['abilities'])} abilities)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
