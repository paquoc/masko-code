#!/usr/bin/env python3
"""Generate branded DMG installer background for Masko Code.

Uses Pillow. Output: 1280x840 PNG (2x Retina for a 640x420 Finder window).
"""
import sys
from PIL import Image, ImageDraw

W, H = 1280, 840

# Brand palette
BG = (250, 249, 247)  # #faf9f7 warm cream
ARROW = (209, 204, 199)  # subtle warm gray


def main(output_path):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Dashed arrow between icon positions
    # Finder icon positions at 1x: app (160, 200), Applications (480, 200)
    # At 2x pixels: centers at (320, 400) and (960, 400)
    # PIL origin is top-left, so y = 200*2 = 400
    y = 400
    x_start = 440
    x_end = 840

    # Dashed line
    dash_len, gap_len = 12, 8
    x = x_start
    while x < x_end:
        x2 = min(x + dash_len, x_end)
        draw.line([(x, y), (x2, y)], fill=ARROW, width=3)
        x += dash_len + gap_len

    # Arrowhead
    draw.polygon(
        [(x_end, y), (x_end - 16, y - 9), (x_end - 16, y + 9)],
        fill=ARROW,
    )

    img.save(output_path, "PNG")


if __name__ == "__main__":
    main(sys.argv[1])
