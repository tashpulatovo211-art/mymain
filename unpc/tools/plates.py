#!/usr/bin/env python3
"""UNPC photo plates: grade a master once, cut its art-directed crops, export AVIF, WebP and JPEG, and print the
<figure> markup for the page. This is the one export path for every photo plate (README, "Photo plates").

Usage, from this folder (needs Python 3 with numpy, and a Pillow recent enough to write AVIF):
  python3 plates.py plates.json              # every plate in the manifest
  python3 plates.py plates.json winners      # only the plate named "winners"
  python3 plates.py plates.json --preview    # also writes before and after previews to preview/

The manifest (plates.json) has one entry per photo. Every coordinate is a fraction of the master (0 to 1), so a master
of any size works:
  {
    "out": "../photos/sundays",          the folder the files are written to, relative to the manifest
    "web": "photos/sundays",             the same folder as the page refers to it
    "plates": [
      { "name": "winners",               file names start with it: winners-wide-1440.avif
        "src": "masters/winners-graded.png",
        "alt": "...",                      true of every crop: the page's alt until a crop has loaded, and without script
        "caption": { "title": "Winning team and best speaker.", "text": "..." },
        "grade": { "wall": {...}, "light": {...}, "shadows": {...}, "rolloff": 0.06 },
        "crops": {
          "wide":   { "box": [x0, y0, x1, y1], "over": 0.04, "focus": [x, y], "widths": [960, 1440, 1920],
                      "jpeg": [960, 1440], "alt": "..." },
          "square": { "box": [...], "over": 0.03, "focus": [x, y], "media": "(max-width: 560px)",
                      "widths": [480, 720, 1080], "jpeg": [480, 720], "alt": "...", "caption": "..." } } } ] }

  box     the visible crop. The page shows exactly this box at rest.
  over    extra height above and below the box, as a fraction of its height, which the page spends on a slow drift.
  focus   where the faces are, as a fraction of the visible box (x across, y down). The plate settles toward it.
  media   marks the closer crop for phones. The stylesheet switches the frame's shape at 560px, so keep that value.
  alt     what the crop shows, plainly: how many people, what they hold, what is behind them. No names, no date.
          The plate's own alt (above the crops) must be true of every crop: a browser without the script shows it
          with whichever crop the screen gets, and the script swaps in the crop's own alt once that crop has loaded.
  caption (phone crop only, optional) the caption's text for the phone crop, when the closer crop cuts off something
          the main text mentions. The title stays the same. The page shows one or the other at 560px, as the frame.

The grade is small on purpose, and it never edits content: a tone-down of one saturated colour (a painted wall), soft
light (a broad lift where the faces are, a gentle falloff toward the edges and the top), a small warm shift in the
deepest shadows, a highlight roll-off so white paper does not clip, and last the site's own photo treatment ("finish",
the light theme's --img-filter), so the page shows the file as it is. Nothing is removed and no face is retouched.
"""
import base64
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

PHONE_MEDIA = "(max-width: 560px)"
# The width the wide crop is drawn at, as the stylesheet lays the plate out (README, "Photo plates").
WIDE_SIZES = "(max-width: 760px) 100vw, (max-width: 1350px) 92vw, 1240px"
PHONE_SIZES = "100vw"


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def rgb_to_hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    h = h * 60.0
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(a, frac):
    w = a.shape[1]
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(max(1, int(frac * w))))).astype(np.float32) / 255.0


def grade(img, g):
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    H, W = a.shape[:2]

    # 1. Tone down one saturated hue (the painted wall). Skin is far less saturated than the paint (HSV saturation about
    #    0.5 against 0.8), so the saturation ramp alone keeps faces and hands out of it, with no boxes that would leave a
    #    halo of untouched wall around a head. The mix toward grey is done in gamma space, so the hue holds.
    wall = g.get("wall")
    if wall:
        h, s, v = rgb_to_hsv(a)
        hlo, hhi = wall["hue"]
        hue_in = smoothstep(h, hlo - 6, hlo) * (1 - smoothstep(h, hhi, hhi + 6))
        m = hue_in * smoothstep(s, wall["sat"][0], wall["sat"][1])
        m = blur(m, 0.0015)
        luma = (a * np.array([0.299, 0.587, 0.114])).sum(-1, keepdims=True)
        toned = luma + (a - luma) * (1 - wall["desaturate"])
        toned = lin_to_srgb(srgb_to_lin(toned) * (2 ** wall.get("ev", 0.0)))
        a = a + (toned - a) * m[..., None]

    lin = srgb_to_lin(a)

    # 2. Light, in linear light and in fractions of a stop: a broad, soft lift where the faces are (as a key light
    #    would fall), a gentle falloff toward the edges, and a little less light toward the top, so the eye goes to the
    #    people and a white surface at the top of the frame does not melt into the white page.
    light = g.get("light")
    if light:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        xn, yn = xx / W, yy / H
        ev = np.zeros((H, W), np.float32)
        key = light.get("key")
        if key:
            (cx, cy), (rx, ry) = key["at"], key["size"]
            ev += key["ev"] * np.exp(-(((xn - cx) / rx) ** 2 + ((yn - cy) / ry) ** 2) / 2)
        edges = light.get("edges")
        if edges:
            (cx, cy), (rx, ry) = edges["at"], edges["size"]
            rr = np.sqrt(((xn - cx) / rx) ** 2 + ((yn - cy) / ry) ** 2)
            ev += edges["ev"] * smoothstep(rr, edges.get("from", 0.62), edges.get("to", 1.15))
        top = light.get("top")
        if top:
            ev += top["ev"] * (1 - smoothstep(yn, top["from"], top["to"]))
        lin = lin * (2.0 ** ev)[..., None]

    # 3. A small warm shift in the deepest shadows only, to undo the cyan cast of a phone camera on dark cloth.
    sh = g.get("shadows")
    if sh and sh.get("warm"):
        k = sh["warm"] * (1 - smoothstep(lin.mean(-1), 0.02, 0.12))
        lin[..., 0] *= 1 + k
        lin[..., 2] *= 1 - k

    # 4. Global exposure and a highlight roll-off (keeps white paper from clipping on screens).
    lin = lin * (2 ** g.get("ev", 0.0))
    k = g.get("rolloff", 0.0)
    if k:
        lin = lin / (1 + k * lin) * (1 + k)
    a = lin_to_srgb(lin)

    # 5. The site's photo treatment (style.css, --img-filter in the light theme), done here instead of by the browser, so
    #    a plate needs no CSS filter while it moves. Same maths as CSS saturate() and contrast(), in sRGB.
    fin = g.get("finish")
    if fin:
        s = fin.get("saturate", 1.0)
        m = np.array([
            [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
            [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
            [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
        ], np.float32)
        a = np.clip(a @ m.T, 0, 1)
        c = fin.get("contrast", 1.0)
        a = (a - 0.5) * c + 0.5

    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def swatch_uri(img, width=24):
    """A tiny copy of the visible crop, inline, that the frame shows while the photo loads. It is blurred here, at 4x its
    size, so the page needs no blur filter and its edges stay clean."""
    sw = img.resize((width, max(1, round(width * img.height / img.width))), Image.BOX)
    sw = sw.resize((sw.width * 4, sw.height * 4), Image.BICUBIC).filter(ImageFilter.GaussianBlur(3))
    buf = io.BytesIO()
    sw.save(buf, "WEBP", quality=80, method=6, use_sharp_yuv=True)  # sharp YUV keeps dark blues from turning purple
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def export(img, name, cname, crop, out):
    w, h = img.size
    x0, y0, x1, y1 = crop["box"]
    over = crop.get("over", 0.0)
    vh = (y1 - y0) * h
    box = (round(x0 * w), round(y0 * h - over * vh), round(x1 * w), round(y1 * h + over * vh))
    if box[1] < 0 or box[3] > h:
        raise SystemExit(f"{name}-{cname}: the extra height runs past the master; move the box or lower over")
    c = img.crop(box)
    visible = img.crop((box[0], round(y0 * h), box[2], round(y1 * h)))
    sharpen = crop.get("sharpen", 0.35)
    written = []
    widths = list(crop["widths"])
    jpeg = set(crop.get("jpeg", []))
    if not crop.get("upscale") and any(tw > c.width for tw in widths):
        # Never make a file wider than the crop really is: the widths above it become one file at the crop's own width.
        too_wide = [tw for tw in widths if tw > c.width]
        widths = [tw for tw in widths if tw <= c.width] + [c.width]
        if jpeg & set(too_wide):
            jpeg.add(c.width)
        print(f"  {name}-{cname}: the crop is {c.width} px wide, so {', '.join(map(str, too_wide))} became {c.width} (set \"upscale\": true to allow wider files)")
    for tw in widths:
        th = round(c.height * tw / c.width)
        r = c.resize((tw, th), Image.LANCZOS) if tw != c.width else c.copy()
        if sharpen:
            r = r.filter(ImageFilter.UnsharpMask(radius=0.8, percent=int(sharpen * 100), threshold=2))
        base = os.path.join(out, f"{name}-{cname}-{tw}")
        # AVIF at this quality is about a fifth lighter than the WebP and holds fine detail (certificate type) as well.
        r.save(base + ".avif", quality=crop.get("avif_q", 55), speed=crop.get("avif_speed", 2), subsampling="4:2:0")
        r.save(base + ".webp", quality=crop.get("webp_q", 78), method=6)
        files = {"avif": base + ".avif", "webp": base + ".webp"}
        if tw in jpeg:
            r.save(base + ".jpg", quality=crop.get("jpeg_q", 80), optimize=True, progressive=True)
            files["jpg"] = base + ".jpg"
        written.append((tw, th, files))
    if not written:
        raise SystemExit(f"{name}-{cname}: no width fits the master")
    vis_ratio = (box[2] - box[0]) / (vh)
    fx, fy = crop.get("focus", [0.5, 0.5])
    # The settle scales the whole file (visible box plus its extra height) about this point.
    origin = (fx * 100, (over + fy) / (1 + 2 * over) * 100)
    return {"box": box, "ratio": vis_ratio, "over": over, "origin": origin, "files": written, "swatch": swatch_uri(visible)}


def srcset(web, name, cname, rows, ext):
    return ", ".join(f"{web}/{name}-{cname}-{tw}.{ext} {tw}w" for tw, th, files in rows if ext in files)


def markup(p, res, web):
    """The <figure> for the page, with every size that was really written."""
    name = p["name"]
    crops = p["crops"]
    narrow = next((k for k, c in crops.items() if c.get("media")), None)
    wide = next(k for k in crops if k != narrow)
    W, N = res[wide], res[narrow] if narrow else None
    style = [f"--pp-ratio: {W['ratio']:.3f}", f"--pp-over: {W['over']:g}", f"--pp-focus: {W['origin'][0]:.0f}% {W['origin'][1]:.0f}%"]
    if N:
        style += [f"--pp-ratio-n: {N['ratio']:.3f}", f"--pp-over-n: {N['over']:g}", f"--pp-focus-n: {N['origin'][0]:.0f}% {N['origin'][1]:.0f}%"]
    style += [f"--pp-swatch: url({W['swatch']})"]
    if N:
        style += [f"--pp-swatch-n: url({N['swatch']})"]
    esc = lambda s: s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    walt = crops[wide].get("alt", "")
    palt = p.get("alt") or walt  # true of every crop; the script sets the loaded crop's own alt
    lines = ['<figure class="photo-plate" data-photo-plate>', f'  <div class="pp-frame" style="{"; ".join(style)}">', "    <picture>"]
    if N:
        media = crops[narrow]["media"]
        nalt = esc(crops[narrow].get("alt", ""))
        for ext, typ in (("avif", "image/avif"), ("webp", "image/webp"), ("jpg", "image/jpeg")):
            ss = srcset(web, name, narrow, N["files"], ext)
            if ss:
                lines.append(f'      <source media="{media}" type="{typ}" sizes="{PHONE_SIZES}" srcset="{ss}" data-alt="{nalt}">')
    for ext, typ in (("avif", "image/avif"), ("webp", "image/webp")):
        lines.append(f'      <source type="{typ}" sizes="{WIDE_SIZES}" srcset="{srcset(web, name, wide, W["files"], ext)}">')
    jp = [r for r in W["files"] if "jpg" in r[2]]
    mid = jp[-1] if jp else W["files"][-1]
    lines.append(
        f'      <img class="pp-img" src="{web}/{name}-{wide}-{mid[0]}.jpg" srcset="{srcset(web, name, wide, W["files"], "jpg")}" '
        f'sizes="{WIDE_SIZES}" width="{mid[0]}" height="{mid[1]}" loading="lazy" decoding="async" alt="{esc(palt)}"'
        + (f' data-alt="{esc(walt)}"' if palt != walt else "") + ">"
    )
    lines += ["    </picture>", "  </div>"]
    cap = p.get("caption")
    if cap:
        ntext = crops[narrow].get("caption") if narrow else None
        text = esc(cap["text"])
        if ntext:
            # One caption line for each crop; the stylesheet shows the one whose crop is on screen.
            text = f'<span class="pp-cap-w">{text}</span><span class="pp-cap-n">{esc(ntext)}</span>'
        lines += ['  <figcaption class="pp-cap">', f'    <p class="pp-cap-text"><b>{esc(cap["title"])}</b> {text}</p>', "  </figcaption>"]
    lines.append("</figure>")
    return "\n".join(lines)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    from PIL import features
    if not features.check("avif"):
        raise SystemExit("This Pillow cannot write AVIF. Update it with: python3 -m pip install -U pillow")
    man_path, only = args[0], set(args[1:])
    preview = "--preview" in sys.argv
    man = json.load(open(man_path))
    root = os.path.dirname(os.path.abspath(man_path))
    out = os.path.normpath(os.path.join(root, man["out"]))
    web = man.get("web", "photos/sundays")
    os.makedirs(out, exist_ok=True)
    for p in man["plates"]:
        if only and p["name"] not in only:
            continue
        src_path = os.path.join(root, p["src"])
        if not os.path.exists(src_path):
            raise SystemExit(f"{p['name']}: the master is missing. Put the full-size photo at {src_path}")
        src = Image.open(src_path).convert("RGB")
        graded = grade(src, p.get("grade", {}))
        if preview:
            pd = os.path.join(root, "preview")
            os.makedirs(pd, exist_ok=True)
            a = src.resize((1280, round(1280 * src.height / src.width)), Image.LANCZOS)
            b = graded.resize(a.size, Image.LANCZOS)
            both = Image.new("RGB", (a.width * 2 + 12, a.height), "#888")
            both.paste(a, (0, 0))
            both.paste(b, (a.width + 12, 0))
            both.save(os.path.join(pd, f"{p['name']}-before-after.jpg"), quality=86)
            b.save(os.path.join(pd, f"{p['name']}-graded.jpg"), quality=90)
        res = {}
        for cname, crop in p["crops"].items():
            r = export(graded, p["name"], cname, crop, out)
            res[cname] = r
            print(f"{p['name']} {cname}: master box {r['box']}, visible shape {r['ratio']:.3f}, extra height {r['over']:g}, settle origin {r['origin'][0]:.0f}% {r['origin'][1]:.0f}%")
            for tw, th, files in r["files"]:
                print("   " + "   ".join(f"{os.path.basename(f)} {os.path.getsize(f) / 1024:.1f} KB" for f in files.values()))
        print("\nMarkup for the page (paste it after the article's text):\n")
        print(markup(p, res, web))
        print()


if __name__ == "__main__":
    main()
