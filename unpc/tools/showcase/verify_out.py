"""Checks the encoded files against the export window. Scratch only.
Usage: python3 verify_out.py FINAL_DIR MEDIA_DIR NAME"""
import sys, os, json, subprocess, tempfile, glob
import numpy as np
from PIL import Image
F, M, NAME = sys.argv[1:4]
here = os.path.dirname(os.path.abspath(__file__))
lts = json.load(open(os.path.join(F, 'looptime.json')))['lt']
ground = np.asarray(Image.open(os.path.join(F, '00000.png')).convert('RGB'))[2, 2].astype(int)
res = {}
# GIFs: decode in order, map each moment to the frame on screen; compare with the source scaled by the same box filter
for g, W, H in ((NAME + '-loop.gif', 960, 600), (NAME + '-800x500.gif', 800, 500)):
    p = os.path.join(M, g)
    tmp = tempfile.mkdtemp(dir=os.path.join(here, 'tmp'))
    subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-vsync', '0', os.path.join(tmp, '%05d.png')], check=True)
    fr = sorted(glob.glob(os.path.join(tmp, '*.png')))
    pts = [float(x) for x in subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout.split()]
    info = subprocess.run(['gifsicle', '-I', p], capture_output=True, text=True).stdout if subprocess.run(['which', 'gifsicle'], capture_output=True).returncode == 0 else ''
    first = np.asarray(Image.open(fr[0]).convert('RGB')).astype(int)
    last = np.asarray(Image.open(fr[-1]).convert('RGB')).astype(int)
    holds = {}
    for t in (2.3, 6.9, 10.7, 14.7, 20.6, 25.4):  # the middle of each hold
        n = max(j for j in range(len(pts)) if pts[j] <= t + 1e-3)
        k = min(range(len(lts)), key=lambda j: abs(lts[j] - pts[n]))  # the 60 fps frame this GIF frame was made from
        # the reference is scaled by the same filter as the GIF (ffmpeg area), so only the palette is measured
        rp = os.path.join(tmp, 'ref-%d.png' % k)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(F, '%05d.png' % k), '-vf', 'scale=%d:%d:flags=area' % (W, H), rp], check=True)
        ref = np.asarray(Image.open(rp).convert('RGB')).astype(float)
        out = np.asarray(Image.open(fr[n]).convert('RGB')).astype(float)
        mse = ((ref - out) ** 2).mean()
        gm = np.all(np.abs(ref - ground) < 0.5, axis=2)
        holds[t] = {'psnr': round(10 * np.log10(255 ** 2 / mse), 1) if mse else 'inf', 'ground_px_off': int((np.abs(out - ground).max(axis=2) > 0)[gm].sum())}
    res[g] = {
        'bytes': os.path.getsize(p), 'size': list(first.shape[1::-1]), 'frames': len(fr), 'duration': round(sum(np.diff(pts + [27.2])), 3),
        'loops_forever': 'loop forever' in info,
        'first_is_bare_ground': bool(np.all(first == ground)), 'last_is_bare_ground': bool(np.all(last == ground)),
        'holds_vs_source': holds,
    }
# MP4: first and last frames are the empty state (the seam), the rest frame matches
mp4 = os.path.join(M, NAME + '-x.mp4')
tmp = tempfile.mkdtemp(dir=os.path.join(here, 'tmp'))
for name, sel in (('first', 'eq(n\\,0)'), ('last', 'eq(n\\,1631)'), ('rest', 'eq(n\\,1500)')):
    subprocess.run(['ffmpeg', '-v', 'error', '-i', mp4, '-vf', 'select=%s,scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24' % sel, '-vsync', '0', '-frames:v', '1', os.path.join(tmp, name + '.png')], check=True)
a = {n: np.asarray(Image.open(os.path.join(tmp, n + '.png')).convert('RGB')).astype(int) for n in ('first', 'last', 'rest')}
src_rest = np.asarray(Image.open(os.path.join(F, '01500.png')).convert('RGB')).astype(float)
mse = ((a['rest'] - src_rest) ** 2).mean()
res[NAME + '-x.mp4'] = {
    'first_vs_last_max': int(np.abs(a['first'] - a['last']).max()),
    'first_ground_rgb': a['first'][10, 10].tolist(), 'first_ground_uniform': bool(np.all(a['first'] == a['first'][10, 10])),
    'rest_psnr_vs_png': round(10 * np.log10(255 ** 2 / mse), 2),
}
print(json.dumps(res, indent=1))
json.dump(res, open(os.path.join(here, 'verify-%s.json' % NAME), 'w'), indent=1)
