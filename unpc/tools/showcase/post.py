"""Showcase post-processing and checks (design-to-motion B5, B9). Scratch only.

Usage: python3 post.py FRAMES_DIR OUT_DIR [--other FRAMES_DIR_B] [--still STILL.png ...]

- Takes the export window (1632 frames from the start frame, loop time 0) from FRAMES_DIR.
- Dissolve, done on the PNG frames: from 26.2 s to 26.7 s each frame becomes
  a * frame + (1 - a) * empty, where empty is the start frame (the bare ground right after __start) and
  a = 1 - e2(k) with e2 = cubic-bezier(0.33, 1, 0.68, 1), the skill's opacity curve. From 26.7 s to 27.2 s the frame is
  the empty frame. The ground is identical in both, so only the contents dissolve and the ground never changes.
- Writes OUT_DIR/%05d.png numbered 0..1631 and OUT_DIR/checks.json.
Checks: seam, empty beat (pre-start frames vs start frame), rest (last frame before the dissolve vs fresh stills),
determinism (vs a second capture), the WebGL box edge (no shadow cut at the canvas edge).
"""
import json, os, sys, shutil, hashlib
import numpy as np
from PIL import Image

args = sys.argv[1:]
SRC, OUT = args[0], args[1]
other = args[args.index('--other') + 1] if '--other' in args else None
stills = []
if '--still' in args:
    k = args.index('--still') + 1
    while k < len(args) and not args[k].startswith('--'):
        stills.append(args[k]); k += 1

meta = json.load(open(os.path.join(SRC, 'frames.json')))
rows = {r['i']: r for r in meta['rows']}
S = meta['START']
N = meta['CYCLE_FRAMES']
fp = lambda d, i: os.path.join(d, '%05d.png' % i)
load = lambda p: np.asarray(Image.open(p).convert('RGB'), dtype=np.int16)


def bez(x1, y1, x2, y2):
    cx = 3 * x1; bx = 3 * (x2 - x1) - cx; ax = 1 - cx - bx
    cy = 3 * y1; by = 3 * (y2 - y1) - cy; ay = 1 - cy - by
    sx = lambda t: ((ax * t + bx) * t + cx) * t
    sy = lambda t: ((ay * t + by) * t + cy) * t
    def f(x):
        if x <= 0: return 0.0
        if x >= 1: return 1.0
        lo, hi = 0.0, 1.0
        for _ in range(80):
            m = (lo + hi) / 2
            if sx(m) < x: lo = m
            else: hi = m
        return sy((lo + hi) / 2)
    return f

e2 = bez(0.33, 1, 0.68, 1)
DA, DB, CYC = 26.2, 26.7, 27.2


def alpha(lt):
    if lt < DA: return 1.0
    if lt >= DB: return 0.0
    return 1 - e2((lt - DA) / (DB - DA))


def psnr(a, b):
    m = np.mean((a.astype(np.float64) - b) ** 2)
    return float('inf') if m == 0 else 10 * np.log10(255 ** 2 / m)


def cmp(a, b):
    d = np.abs(a - b)
    return {'psnr': psnr(a, b), 'max': int(d.max()), 'px_diff': int((d.max(axis=2) > 0).sum()), 'px_gt2': int((d.max(axis=2) > 2).sum())}


os.makedirs(OUT, exist_ok=True)
empty = load(fp(SRC, S))
lts = []
for k in range(N):
    i = S + k
    lt = rows[i]['lt']
    lts.append(lt)
    a = alpha(lt)
    dst = fp(OUT, k)
    if a >= 1:
        shutil.copyfile(fp(SRC, i), dst)
    elif a <= 0:
        shutil.copyfile(fp(SRC, S), dst)
    else:
        f = load(fp(SRC, i)).astype(np.float64)
        o = np.clip(np.rint(a * f + (1 - a) * empty), 0, 255).astype(np.uint8)
        Image.fromarray(o).save(dst, optimize=False, compress_level=1)
json.dump({'S': S, 'N': N, 'lt': lts}, open(os.path.join(OUT, 'looptime.json'), 'w'))

C = {}
# seam: the first frame of the window equals the frame one cycle later (live frames, both right after an in-page __start)
C['seam'] = cmp(load(fp(SRC, S)), load(fp(SRC, S + N)))
C['seam_next10'] = [cmp(load(fp(SRC, S + k)), load(fp(SRC, S + N + k)))['max'] for k in range(1, 11) if os.path.exists(fp(SRC, S + N + k))]
# empty beat: the start frame (and so every empty-beat frame) equals the frames before __start (bare ground)
C['empty_vs_prestart'] = [cmp(load(fp(SRC, S - k)), empty)['max'] for k in (1, 2, 5) if os.path.exists(fp(SRC, S - k))]
eb = [k for k in range(N) if lts[k] >= DB]
C['empty_beat_frames'] = [eb[0], eb[-1]] if eb else None
C['empty_beat_max_vs_prestart'] = max(cmp(load(fp(OUT, k)), load(fp(SRC, S - 1)))['max'] for k in eb) if eb else None
# a flat ground: the empty frame is one colour
ef = empty.reshape(-1, 3)
C['empty_colours'] = [list(map(int, c)) for c in np.unique(ef, axis=0)[:4]]
# rest: the last frame before the dissolve equals a fresh still at u 5.92
last = max(k for k in range(N) if lts[k] < DA)
C['rest_frame'] = last
C['rest_lt'] = lts[last]
C['rest'] = {os.path.basename(s): cmp(load(fp(SRC, S + last)), load(s)) for s in stills}
# the last hold is at rest: no pixel changes over its last second
C['last_hold_still'] = cmp(load(fp(SRC, S + last)), load(fp(SRC, S + last - 60)))
# determinism: a second capture
if other:
    om = json.load(open(os.path.join(other, 'frames.json')))
    orow = {r['i']: r for r in om['rows']}
    same_md5 = diff = 0
    worst = (0, None, 0)
    state_diff = []
    for i in sorted(rows):
        a, b = rows[i], orow.get(i)
        if b is None: continue
        for key in ('lt', 'u', 'y', 'h'):
            if a.get(key) != b.get(key):
                state_diff.append((i, key, a.get(key), b.get(key)))
        if a.get('md5') and b.get('md5'):
            if a['md5'] == b['md5']:
                same_md5 += 1
            else:
                diff += 1
                c = cmp(load(fp(SRC, i)), load(fp(other, i)))
                if c['max'] > worst[0] or (c['max'] == worst[0] and c['px_diff'] > worst[2]):
                    worst = (c['max'], i, c['px_diff'])
    C['determinism'] = {'identical_frames': same_md5, 'different_frames': diff, 'worst': {'max': worst[0], 'frame': worst[1], 'px': worst[2]}, 'state_mismatches': state_diff[:10], 'state_mismatch_count': len(state_diff)}

# the WebGL box edge: where the GL canvas ends, the sheet's shadow must have faded out (no hard step).
info = meta.get('info', {})
g = info.get('glRect')
if g:
    sc = meta['DPR']
    x0, y0 = int(round(g['x'] * sc)), int(round(g['y'] * sc))
    x1, y1 = int(round((g['x'] + g['w']) * sc)), int(round((g['y'] + g['h']) * sc))
    ground = empty[5, 5]
    worst_edge = []
    for k in range(0, N, 2):
        lt = lts[k]
        if not (15.9 <= lt <= 23.8):  # the sheet's life: from its arrival (u 3.55, t 15.95) to its fade (u 5.5, t 23.6)
            continue
        im = load(fp(SRC, S + k))
        H, W, _ = im.shape
        def step(inside, outside):
            # darkness just inside vs just outside the edge, only where the outside pixel is bare ground
            m = np.all(outside == ground, axis=1)
            if m.sum() < 20:
                return 0, 0
            d = (outside[m].astype(int) - inside[m].astype(int)).max(axis=1)
            d = d[d < 40]  # seats and ink crossing the edge are not shadow
            return (int(np.percentile(d, 99)) if d.size else 0), int(np.median(d)) if d.size else 0
        res = {}
        if 0 < x0 < W: res['left'] = step(im[y0:y1, x0], im[y0:y1, x0 - 1])
        if 0 < x1 < W: res['right'] = step(im[y0:y1, x1 - 1], im[y0:y1, x1])
        if 0 < y0 < H: res['top'] = step(im[y0, x0:x1], im[y0 - 1, x0:x1])
        if 0 < y1 < H: res['bottom'] = step(im[y1 - 1, x0:x1], im[y1, x0:x1])
        worst_edge.append((max(v[0] for v in res.values()) if res else 0, k, lt, res))
    worst_edge.sort(key=lambda t: -t[0])
    C['gl_edge'] = {'box_device_px': [x0, y0, x1, y1], 'worst': worst_edge[:5]}

json.dump(C, open(os.path.join(OUT, 'checks.json'), 'w'), indent=1, default=str)
print(json.dumps(C, indent=1, default=str))
