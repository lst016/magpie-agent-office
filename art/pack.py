# Packs Blender renders into the page's sprites.
#   python3 -I art/pack.py <render dir> server/public/sprites
# Creature sprites are cropped to their silhouette (one box per kind, shared by both agents).
# meta.json tells the page where everything goes, as % of the room picture:
#   desks[i].box   where seat_<agent> goes at desk i      desks[i].screen  the monitor's screen
#   desks[i].tag   the label's anchor above the monitor   desks[i].head    top of the creature
#   zones[i].box   where stand_<agent> goes in a side room (kind: tea | run | wc)
# With an orthographic camera, moving a creature in the world moves it the same in the picture,
# so a sprite rendered at desk 0 / the first tea spot fits every other spot by shifting it.
import hashlib, json, sys
from pathlib import Path
from PIL import Image

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
slots = json.loads((src / "slots.json").read_text())


def clean(im, floor=10):
    """Shadow-catcher passes leave a faint veil of noise; anything fainter than this is nothing."""
    a = im.getchannel("A").point(lambda v: 0 if v < floor else v)
    im.putalpha(a)
    return im


def save(im, name):
    im.save(dst / (name + ".webp"), "WEBP", quality=88, method=6, alpha_quality=100)


def bbox(ims, pad=4):
    boxes = [im.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox() for im in ims]
    w, h = ims[0].size
    return (max(0, min(b[0] for b in boxes) - pad), max(0, min(b[1] for b in boxes) - pad),
            min(w, max(b[2] for b in boxes) + pad), min(h, max(b[3] for b in boxes) + pad))


pct = lambda v: round(v * 100, 3)
meta = {}
for theme in ("light", "dark"):
    im = Image.open(src / f"room_{theme}.png").convert("RGBA")
    meta["room"] = list(im.size)
    save(im, f"room_{theme}")

agents = sorted(p.stem.split("_", 1)[1] for p in src.glob("seat_*.png"))
ref = {"seat": slots["desks"][0]["feet"], "stand": slots["zones"][0]["feet"]}
crop = {}
for kind in ("seat", "stand"):
    ims = {a: clean(Image.open(src / f"{kind}_{a}.png").convert("RGBA")) for a in agents}
    W, H = next(iter(ims.values())).size
    x0, y0, x1, y1 = bbox(list(ims.values()))
    crop[kind] = (x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H)
    for a, im in ims.items():
        save(im.crop((x0, y0, x1, y1)), f"{kind}_{a}")


def place(kind, feet):
    l, t, w, h = crop[kind]
    return [pct(l + feet[0] - ref[kind][0]), pct(t + feet[1] - ref[kind][1]), pct(w), pct(h)]


meta["desks"] = [{"box": place("seat", d["feet"]), "screen": [pct(v) for v in d["screen"]],
                  "tag": [pct(v) for v in d["tag"]], "head": [pct(v) for v in d["head"]]} for d in slots["desks"]]
meta["zones"] = [{"kind": z["kind"], "box": place("stand", z["feet"]), "head": [pct(v) for v in z["head"]]}
                 for z in slots["zones"]]
for a in agents:  # avatars: the creature alone, cropped tight
    im = Image.open(src / f"solo_{a}.png").convert("RGBA")
    save(im.crop(bbox([im], 6)), f"solo_{a}")

# Content hash: the page appends ?v=<hash> to sprite URLs, so a re-render is never hidden by caches.
h = hashlib.sha1()
for f in sorted(dst.glob("*.webp")):
    h.update(f.name.encode() + f.read_bytes())
meta["v"] = h.hexdigest()[:10]
(dst / "meta.json").write_text(json.dumps(meta, indent=1))
print(json.dumps({"room": meta["room"], "v": meta["v"], "desk0": meta["desks"][0], "zone0": meta["zones"][0]}))
