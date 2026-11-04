#!/usr/bin/env python3
"""Generates the PWA icons (ember/flame on a dark cave background). Run from game/: python3 tools/make-icons.py"""
from PIL import Image, ImageDraw, ImageFilter
import math

def flame_poly(cx, cy, w, h, n=60, lean=0.0):
    pts = []
    for i in range(n + 1):
        t = i / n  # 0..1 around: left side up to tip, right side down
        a = t * math.pi * 2
        # teardrop: x = sin(a) * (1-cos(a))/2 style
        x = math.sin(a) * (0.5 - 0.5 * math.cos(a)) ** 0.9
        y = math.cos(a)
        pts.append((cx + x * w + lean * (1 - (y + 1) / 2) * w * 0.3, cy - (y * 0.5 + 0.5) * h + h * 0.18))
    return pts

def make(size, maskable=False):
    S = size * 4
    img = Image.new('RGBA', (S, S), (14, 17, 23, 255))
    d = ImageDraw.Draw(img)
    # radial warm glow
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(int(S * 0.48), 0, -int(S * 0.01) or -1):
        k = 1 - r / (S * 0.48)
        gd.ellipse([S / 2 - r, S * 0.58 - r, S / 2 + r, S * 0.58 + r], fill=(int(60 + 120 * k), int(30 + 50 * k), int(14 + 6 * k), int(255 * min(1, k * 1.4))))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(S * 0.02)))
    d = ImageDraw.Draw(img)
    scale = 0.62 if maskable else 0.82
    cx, base, H = S / 2, S * (0.5 + 0.36 * scale), S * 0.78 * scale
    # stones
    for i, dx in enumerate([-0.28, -0.1, 0.1, 0.28]):
        x = cx + dx * S * scale
        d.ellipse([x - S * 0.07 * scale, base - S * 0.04 * scale, x + S * 0.07 * scale, base + S * 0.05 * scale], fill=(62, 74, 87, 255))
    # logs
    d.line([(cx - S * 0.22 * scale, base), (cx + S * 0.18 * scale, base - S * 0.1 * scale)], fill=(107, 74, 47, 255), width=int(S * 0.05 * scale))
    d.line([(cx + S * 0.22 * scale, base), (cx - S * 0.18 * scale, base - S * 0.1 * scale)], fill=(138, 100, 64, 255), width=int(S * 0.05 * scale))
    # flames (outer → inner)
    for (w, h, col) in [(0.34, 1.0, (255, 122, 26)), (0.24, 0.78, (255, 179, 71)), (0.13, 0.5, (255, 210, 122))]:
        d.polygon(flame_poly(cx, base - S * 0.07 * scale, S * w * scale, H * h), fill=col + (255,))
    # embers
    for (ex, ey, r) in [(-0.2, -0.62, 0.018), (0.17, -0.72, 0.014), (0.05, -0.85, 0.012), (-0.08, -0.95, 0.01)]:
        x, y = cx + ex * S * scale, base + ey * S * scale
        d.ellipse([x - r * S, y - r * S, x + r * S, y + r * S], fill=(255, 200, 110, 255))
    return img.resize((size, size), Image.LANCZOS)

make(192).save('icons/icon-192.png')
make(512).save('icons/icon-512.png')
make(512, maskable=True).save('icons/icon-maskable-512.png')
make(180).convert('RGB').save('icons/apple-touch-icon.png')
make(32).save('icons/favicon-32.png')
print('icons written')
