"""Motion measurements of the showcase export window (the pacing review's metric). Scratch only.

Usage: python3 motion.py FINAL_DIR OUT.json
Per frame: pixels whose largest channel changed by more than 2 levels since the previous frame. From that:
- each move: when visible change starts and ends, and the 10 to 90% span of its cumulative change;
- every fully frozen span (no pixel changes) of 0.5 s or more, and the share of the loop that is frozen;
- the jumps across static u bands during the holds (mode.js `jump`): the change they cause, which must be none;
- the largest single-frame change after the build-in, outside the dissolve.
"""
import json, os, subprocess, sys
import cv2, numpy as np
from concurrent.futures import ThreadPoolExecutor

F, OUT = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
TL = json.loads(subprocess.run(['node', os.path.join(here, 'timeline.js')], capture_output=True, text=True, check=True).stdout)['TL']
lts = json.load(open(os.path.join(F, 'looptime.json')))['lt']
N = len(lts)

def load(i):
    return cv2.imread(os.path.join(F, '%05d.png' % i), cv2.IMREAD_COLOR)

def diff(i):
    a, b = load(i - 1), load(i)
    d = cv2.absdiff(a, b).max(axis=2)
    return int((d > 2).sum()), int(d.max())

with ThreadPoolExecutor(4) as ex:
    res = [(0, 0)] + list(ex.map(diff, range(1, N)))
ch = np.array([r[0] for r in res], dtype=np.int64)
mx = np.array([r[1] for r in res])
t = np.array(lts)
fr = lambda x: int(np.argmin(np.abs(t - x)))

moves = []
nxt = [m['jump'] for m in TL['moves'][1:]] + [TL['restJump']]
for k, m in enumerate(TL['moves']):
    s, e = m['keys'][0][0], m['keys'][-1][0]
    a, b = fr(s), fr(nxt[k]) - 1  # the move, and its hold up to the next jump
    seg = ch[a:b + 1]
    nz = np.nonzero(seg)[0]
    cum = np.cumsum(seg) / max(1, seg.sum())
    p10, p90 = int(np.searchsorted(cum, 0.1)), int(np.searchsorted(cum, 0.9))
    first, last = (a + nz[0], a + nz[-1]) if len(nz) else (None, None)
    moves.append({
        'move': k + 1, 'planned_s': [s, e], 'planned_len': round(e - s, 2),
        'visible_change_s': [round(t[first], 3), round(t[last], 3)] if first is not None else None,
        'span_10_90_s': round(t[a + p90] - t[a + p10], 3),
        'u_marks': m['keys'],
    })

frozen, run = [], None
B = fr(TL['build'])
for i in range(1, N):
    if ch[i] == 0:
        run = run if run is not None else i
    else:
        if run is not None and t[i - 1] - t[run - 1] >= 0.5:
            frozen.append([round(t[run - 1], 3), round(t[i - 1], 3), round(t[i - 1] - t[run - 1], 3)])
        run = None
if run is not None:
    frozen.append([round(t[run - 1], 3), round(t[N - 1], 3), round(t[N - 1] - t[run - 1], 3)])
D0, D1 = TL['dissolve']
before = [f for f in frozen if f[1] <= D0 + 1e-6 or f[0] < D0]
jumps = []
for m in TL['moves'] + [{'jump': TL['restJump']}]:
    j = fr(m['jump'])
    # the jump frame and the half second after it, against the half second before (the crowd's drift runs on time)
    base = int(np.median(ch[j - 30:j])) if j >= 30 else 0
    jumps.append({'t': m['jump'], 'frames': [j, j + 30], 'max_changed_px': int(ch[j:j + 31].max()), 'max_level': int(mx[j:j + 31].max()),
                  'median_px_before': base, 'median_px_after': int(np.median(ch[j:j + 31]))})
story = [i for i in range(B + 1, N) if t[i] < D0]
big = sorted(story, key=lambda i: -ch[i])[:5]
R = {
    'moves': moves,
    'frozen_spans_ge_0.5s': frozen,
    'frozen_share_of_loop_before_dissolve': round(sum(min(f[1], D0) - f[0] for f in before if f[0] < D0) / D0, 3),
    'jumps': jumps,
    'largest_frame_changes_in_story': [{'frame': int(i), 't': round(t[i], 3), 'px': int(ch[i]), 'max': int(mx[i])} for i in big],
    'per_frame_changed_px': ch.tolist(),
}
json.dump(R, open(OUT, 'w'))
R.pop('per_frame_changed_px')
print(json.dumps(R, indent=1))
