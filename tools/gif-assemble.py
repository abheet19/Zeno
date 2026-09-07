#!/usr/bin/env python3
"""
Assemble a manifest of real PNG captures into an animated GIF.

Deliberately Pillow-only: ffmpeg is not a dependency of this repo and never
becomes one. Every frame that goes in came out of a real browser screenshot of
the real daemon; this script only scales, quantises and times them.

    python tools/gif-assemble.py <manifest.json>

The manifest is written by tools/record-demos.mjs:

    { "out": "docs/demos/gate.gif",
      "width": 1280,
      "colors": 128,
      "frames": [ { "file": "...png", "ms": 1200 }, ... ] }

Per-frame durations are what keep these small. A three-second hold on the
receipt is ONE frame with ms=3000, not thirty identical ones.
"""
import json
import os
import sys

from PIL import Image


def load(path, width):
    im = Image.open(path).convert("RGB")
    if im.width != width:
        h = round(im.height * width / im.width)
        im = im.resize((width, h), Image.LANCZOS)
    return im


def main():
    manifest = json.load(open(sys.argv[1], encoding="utf8"))
    width = int(manifest.get("width", 1280))
    colors = int(manifest.get("colors", 256))
    out = manifest["out"]
    entries = manifest["frames"]
    if not entries:
        raise SystemExit("manifest has no frames")

    frames = [load(e["file"], width) for e in entries]
    durations = [int(e["ms"]) for e in entries]

    # One shared palette for the whole animation. Quantising each frame on its
    # own gives every frame a different palette, which both bloats the file and
    # makes flat backgrounds shimmer between frames. Sample every frame into one
    # tall strip, quantise THAT, and hand the result to each frame.
    # Sampled at FULL resolution and WEIGHTED BY DURATION, both deliberately.
    #
    # Full resolution because downscaling first averages the small coloured chips
    # — the amber "approval owed", the green verified seal — into their dark
    # backgrounds, and they then never make it into the palette at all.
    #
    # Weighted because a demo's frames are not equally important. A dozen 130ms
    # frames of an animated background outvote the one three-second hold on the
    # capsule, and median cut then spends the palette on gradients nobody looks
    # at while the chip that carries the meaning goes grey. Counting each frame
    # in proportion to how long it is actually on screen fixes that.
    weights = [max(1, min(8, round(ms / 500))) for ms in durations]
    strip = Image.new("RGB", (width, sum(f.height * w for f, w in zip(frames, weights))))
    y = 0
    for f, w in zip(frames, weights):
        for _ in range(w):
            strip.paste(f, (0, y))
            y += f.height
    # MAXCOVERAGE, not the usual MEDIANCUT. Median cut optimises for the colours
    # that occupy the most PIXELS, and this UI is overwhelmingly one near-black —
    # so the palette went to shades of background and the amber "approval owed"
    # chip came out olive. Max coverage keeps outliers, which is exactly what the
    # semantic accents are, and it happens to compress about 30% smaller here too.
    palette = strip.quantize(colors=colors, method=Image.MAXCOVERAGE)

    # No dithering. These are screenshots of flat UI, not photographs: Floyd
    # Steinberg speckles every run of solid colour, which both doubles the file
    # and puts noise on top of the small type this whole exercise exists to keep
    # readable.
    quantised = [f.quantize(palette=palette, dither=Image.NONE) for f in frames]

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    quantised[0].save(
        out,
        save_all=True,
        append_images=quantised[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    size = os.path.getsize(out)
    print(
        f"{out}  {quantised[0].width}x{quantised[0].height}  "
        f"{len(frames)} frames  {size / 1024 / 1024:.2f} MB  "
        f"{sum(durations) / 1000:.1f}s"
    )


if __name__ == "__main__":
    main()
