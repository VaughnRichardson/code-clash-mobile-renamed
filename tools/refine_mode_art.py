from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
MODE_DIR = ROOT / "client" / "public" / "art" / "ui" / "modes"
CARD_SIZE = (1536, 1216)
CARD_RATIO = CARD_SIZE[0] / CARD_SIZE[1]


def save_crop(image: Image.Image, box: tuple[int, int, int, int], target_name: str) -> None:
    crop = image.crop(box).convert("RGB")
    output = crop.resize(CARD_SIZE, Image.Resampling.LANCZOS)
    output = output.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=2))
    output.save(MODE_DIR / target_name, optimize=True)


def deity_cards() -> None:
    sheet = Image.open(MODE_DIR / "deity-reference-sheet.png")
    # Natural-aspect crops: air above the crown, face, shoulders, and torso.
    save_crop(sheet, (0, 561, 350, 838), "campaign-deity-card-hd.png")
    save_crop(sheet, (351, 0, 701, 277), "compete-deity-card-hd.png")


def collection_card() -> None:
    image = Image.open(ROOT / "client" / "public" / "art" / "cards" / "guardian.png").convert("RGB")
    crop_height = round(image.width / CARD_RATIO)
    top = 155
    save_crop(image, (0, top, image.width, top + crop_height), "collection-hedgehog-card-hd.png")


if __name__ == "__main__":
    deity_cards()
    collection_card()
