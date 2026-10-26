"""20-moment contact sheet of the showcase (skill B9). Scratch only.

Usage: python3 contact.py FINAL_DIR OUT.png TILE_W TILE_H [--gif GIF]
FINAL_DIR holds the export window as %05d.png (0..1631) and looptime.json. With --gif, the tiles are taken from the
GIF itself (decoded by ffmpeg at the same moments), so the sheet shows exactly what the GIF shows, palette included.
"""
import json, os, sys, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

FINAL, OUT, TW, TH = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
gif = sys.argv[sys.argv.index('--gif') + 1] if '--gif' in sys.argv else None
lts = json.load(open(os.path.join(FINAL, 'looptime.json')))['lt']
MOMENTS = [
    (0.0, 'empty'), (0.6, 'roll call'), (1.0, 'headline arrives'), (2.3, 'hero landed'),
    (3.7, 'hero copy fading'), (4.5, 'chamber glides, stepper in'), (5.45, 'crowd forming'), (6.9, 'crowd'),
    (8.9, 'rooms forming'), (10.7, 'two teams to a room'), (12.8, 'sectors forming'), (14.7, 'scored out of 100'),
    (16.3, 'the sheet arrives'), (18.4, 'handwriting'), (20.6, 'the written page'), (22.2, 'folding'),
    (23.2, 'flight'), (25.4, 'Oliy Majlis'), (26.45, 'mid dissolve'), (27.15, 'end (empty)'),
]
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', max(12, TW // 50))
except Exception:
    font = ImageFont.load_default()


def frame_at(t):
    return min(range(len(lts)), key=lambda k: abs(lts[k] - t))


tiles = []
tmp = tempfile.mkdtemp(dir=os.path.join(os.path.dirname(os.path.abspath(__file__)), "tmp"))
if gif:
    # decode in order (seeking into an optimised GIF skips the frames it builds on), with each frame's start time
    subprocess.run(['ffmpeg', '-v', 'error', '-i', gif, '-vsync', '0', os.path.join(tmp, '%05d.png')], check=True)
    gfr = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))
    gpts = [float(x) for x in subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', gif], capture_output=True, text=True).stdout.split()]
for t, name in MOMENTS:
    k = frame_at(t)
    if gif:
        n = max(j for j in range(len(gpts)) if gpts[j] <= lts[k] + 1e-3)
        im = Image.open(os.path.join(tmp, gfr[n])).convert('RGB')
        if im.size != (TW, TH):
            im = im.resize((TW, TH), Image.LANCZOS)
    else:
        im = Image.open(os.path.join(FINAL, '%05d.png' % k)).convert('RGB').resize((TW, TH), Image.LANCZOS)
    tiles.append((im, '%s  ·  %.2f s  ·  frame %d' % (name, lts[k], k)))

cols, gap, lab = 4, 12, max(22, TW // 30)
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * TW + (cols + 1) * gap, rows * (TH + lab) + (rows + 1) * gap), '#c9d0d3')
d = ImageDraw.Draw(sheet)
for n, (im, text) in enumerate(tiles):
    x = gap + (n % cols) * (TW + gap)
    y = gap + (n // cols) * (TH + lab + gap)
    sheet.paste(im, (x, y))
    d.text((x + 2, y + TH + 4), text.replace('  ·  ', '   '), fill='#13212a', font=font)
sheet.save(OUT)
print('contact sheet', OUT, sheet.size)
