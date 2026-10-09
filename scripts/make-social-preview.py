#!/usr/bin/env python3
"""Renders the GitHub social preview (1280x640 PNG) from app-icon_gold.png
(looked up in assets/ first, then in the repository root).

Usage: scripts/make-social-preview.py [OUTPUT] [--title GOCO] [--subtitle TEXT] [--note TEXT]
Requires Pillow (pip install pillow) and the macOS system font Avenir Next.
"""
import argparse
import pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = "/System/Library/Fonts/Avenir Next.ttc"
NAVY, CREAM, GOLD, MUTED = (13, 29, 43), (245, 242, 236), (196, 154, 82), (159, 179, 200)
SCALE = 2  # draw at 2x, then downsample for smooth edges
W, H = 1280 * SCALE, 640 * SCALE


def font(size, weight):
    # Avenir Next.ttc face order: 0 Bold, 1 Bold Italic, 2 Demi Bold, ... 5 Medium, 7 Regular
    return ImageFont.truetype(FONT, size * SCALE, index={"bold": 0, "demi": 2, "medium": 5, "regular": 7}[weight])


def draw_subtitle(d, x, y, text, fnt):
    """Draws text; every ' > ' becomes a drawn arrow. Fails loudly if it does not fit."""
    parts = text.split(" > ")
    gap, arrow_w = 22 * SCALE, 40 * SCALE
    cap = fnt.size
    for i, part in enumerate(parts):
        d.text((x, y), part, font=fnt, fill=CREAM)
        x += d.textlength(part, font=fnt)
        if i < len(parts) - 1:
            ay = y + int(cap * 0.62)
            x += gap
            d.line((x, ay, x + arrow_w, ay), fill=GOLD, width=4 * SCALE)
            d.line((x + arrow_w - 12 * SCALE, ay - 11 * SCALE, x + arrow_w, ay), fill=GOLD, width=4 * SCALE)
            d.line((x + arrow_w - 12 * SCALE, ay + 11 * SCALE, x + arrow_w, ay), fill=GOLD, width=4 * SCALE)
            x += arrow_w + gap
    if x > W - 60 * SCALE:
        raise SystemExit("subtitle does not fit; shorten it")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("output", nargs="?", default=str(ROOT / "assets" / "social-preview.png"))
    p.add_argument("--title", default="GOCO")
    p.add_argument("--subtitle", default="Google Kalender > MOCO-Zeiterfassung", help="a '>' is drawn as an arrow (the font has no arrow glyph)")
    p.add_argument("--note", default="Lokale macOS-App · Open Source")
    a = p.parse_args()

    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)

    icon_size = 330 * SCALE
    icon_path = next(c for c in (ROOT / "assets" / "app-icon_gold.png", ROOT / "app-icon_gold.png") if c.exists())
    icon = Image.open(icon_path).convert("RGB").resize((icon_size, icon_size), Image.LANCZOS)
    mask = Image.new("L", (icon_size, icon_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, icon_size - 1, icon_size - 1), radius=int(icon_size * 0.225), fill=255)
    x_icon, y_icon = 100 * SCALE, (H - icon_size) // 2
    img.paste(icon, (x_icon, y_icon), mask)

    x_text = x_icon + icon_size + 70 * SCALE
    d.text((x_text, 190 * SCALE), a.title, font=font(150, "bold"), fill=CREAM)
    d.rectangle((x_text + 4 * SCALE, 372 * SCALE, x_text + 84 * SCALE, 378 * SCALE), fill=GOLD)
    draw_subtitle(d, x_text, 404 * SCALE, a.subtitle, font(34, "medium"))
    d.text((x_text, 468 * SCALE), a.note, font=font(30, "regular"), fill=MUTED)

    out = pathlib.Path(a.output)
    img.resize((1280, 640), Image.LANCZOS).save(out, optimize=True)
    print(out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
