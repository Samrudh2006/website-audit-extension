#!/usr/bin/env python3
"""pixel-diff.py - compare two screenshots (e.g. approved concept vs build).

  python3 tools/pixel-diff.py approved.png build.png [--tolerance 16] [--out diff.png]

Reports the share of pixels that differ beyond --tolerance and the bounding box
of the changed region, and optionally writes a diff heat image.

Tolerance is PER-CHANNEL: a pixel counts as changed when any single RGB channel
differs by more than the tolerance (max-channel absolute difference). A large
change confined to one channel (e.g. a blue-only recolor) is caught; it is not
softened by luminance weighting.

What this proves: the build drifted (or did not drift) from the approved pixels
by more than the tolerance. What it does NOT prove: that matching pixels mean
matching quality. Rendering differences (fonts, antialiasing, device pixel
ratios) move pixels without changing the design, and a 100% match says nothing
about whether the design is good. Use it as a drift alarm with a threshold you
set per project, then look at the changed regions by eye. Requires both images
at the same size - capture them at the same viewport and scale factor.
"""
import argparse
import sys
from PIL import Image, ImageChops


def max_channel_diff(a, b):
    """Per-pixel maximum absolute difference across R, G, B channels."""
    d = ImageChops.difference(a, b)
    r, g, bl = d.split()
    return ImageChops.lighter(ImageChops.lighter(r, g), bl)


def main():
    parser = argparse.ArgumentParser(description='Per-channel pixel drift check between two same-size screenshots.')
    parser.add_argument('image_a')
    parser.add_argument('image_b')
    parser.add_argument('--tolerance', type=int, default=16,
                        help='per-channel absolute difference threshold 0-255 (default 16)')
    parser.add_argument('--out', default=None, help='optional path for a diff heat image')
    args = parser.parse_args()
    if not 0 <= args.tolerance <= 255:
        parser.error('--tolerance must be between 0 and 255')

    a = Image.open(args.image_a).convert('RGB')
    b = Image.open(args.image_b).convert('RGB')
    if a.size != b.size:
        print(f'SIZE MISMATCH: {a.size} vs {b.size} - recapture at the same viewport/scale; comparison refused.')
        sys.exit(1)
    tol = args.tolerance
    diff = max_channel_diff(a, b)
    hist = diff.histogram()
    total = a.size[0] * a.size[1]
    changed = sum(hist[tol + 1:])
    pct = 100.0 * changed / total
    bbox = diff.point(lambda p: 255 if p > tol else 0).getbbox()
    print(f'changed pixels beyond per-channel tolerance {tol}: {changed} of {total} ({pct:.2f}%)')
    print(f'changed region: {bbox if bbox else "none"}')
    if args.out:
        diff.point(lambda p: min(255, p * 4)).save(args.out)
        print(f'diff image written to {args.out}')
    sys.exit(0)


if __name__ == '__main__':
    main()
