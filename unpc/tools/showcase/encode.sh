#!/usr/bin/env bash
# Encodes the showcase from the post-processed export window (design-to-motion C2). Scratch only.
# Usage: encode.sh FINAL_DIR OUT_DIR NAME [mp4|gif|small|all|draft]
# FINAL_DIR holds 00000.png .. 01631.png (27.2 s at 60 fps, loop time 0 first), from post.py.
#
# MP4: the skill's recipe (H.264, yuv420p, 60 fps, CRF 15, preset slow, +faststart, even crop), plus an accurate
#   BT.709 conversion and BT.709 tags: with the bare recipe the ground decodes 2 levels dark (244,246,246 for
#   246,248,248), with these it decodes exactly, so the video sits on the page's own ground with no visible edge.
# GIFs: the skill's palettegen and paletteuse recipe with three changes, all lossless, to reach about 3 MB:
#   - scale with flags=area instead of lanczos: 1920 to 960 is an exact 2x, so area is a clean box average with no
#     ringing halo around the seats and the type, and the GIF comes out about 40% smaller;
#   - the plan's steps for weight: 15 fps for the 960px loop, then fewer colours (64; at 2x zoom the holds are
#     indistinguishable from 128). The re-timed loop has about twice as much time in motion, so at 20 fps the
#     800x500 came to 4.2 MB: it takes the skill's "12fps if heavy" (2.6 MB). The loop stays at 15 fps and 64 colours
#     (3.6 MB): 48 colours saves only 0.14 MB and 32 colours (3.0 MB) merges the six sector shades (score hold PSNR
#     45.8 dB to 37.8 dB); gifsicle --lossy 8 to 25 saves 0.35 to 0.65 MB but specks the flat ground by 8 to 24 levels;
#   - dither off, since no photo is in frame (the skill keeps bayer for photos); stats_mode=full so the flat ground is
#     an exact palette entry (with stats_mode=diff at 128 colours the ground itself was dithered).
#   Then gifsicle -O3 (lossless re-optimisation). gifsicle's --lossy was tried and dropped: it leaves specks of 8 to 19
#   levels on the flat ground.
set -euo pipefail
F=$1; O=$2; NAME=$3; WHAT=${4:-all}
HERE=$(cd "$(dirname "$0")" && pwd)
N=1632; A=0; BG=0xf6f8f8
case "$NAME" in *dark*) BG=0x0d1519;; esac
LOOP_FPS=${LOOP_FPS:-15}; SMALL_FPS=${SMALL_FPS:-12}; COLOURS=${COLOURS:-64}
opt() { if command -v gifsicle >/dev/null; then gifsicle -O3 "$1" -o "$2"; else cp "$1" "$2"; fi; }
# GIF delays are whole centiseconds and ffmpeg gives the last frame a single frame's delay, so the loop came out 27.15 s.
# Lengthen the last frame (the empty beat) so the delays add up to exactly $2 centiseconds and the GIF loops at 27.2 s.
fixlen() {
  command -v gifsicle >/dev/null || return 0
  local f=$1 want=$2 n sum last
  n=$(gifsicle -I "$f" | awk 'NR == 1 { for (i = 2; i <= NF; i++) if ($i == "images") print $(i - 1) }')
  sum=$(gifsicle -I "$f" | grep -o "delay [0-9.]*s" | awk '{s+=substr($2,1,length($2)-1)*100} END {printf "%d", s+0.5}')
  last=$(gifsicle -I "$f" | grep -o "delay [0-9.]*s" | tail -1 | awk '{printf "%d", substr($2,1,length($2)-1)*100+0.5}')
  (( sum == want )) || gifsicle -b -O3 "$f" "#0-$((n - 2))" -d$((last + want - sum)) "#$((n - 1))"
}
# GIF frame rates are exact decimations of the 60 fps frames (every 4th for 15 fps, 5th for 12, 3rd for 20), so the
# first GIF frame is frame 0, the empty state (the fps filter's rounding picked frame 2, where the first seats start)
dec() { local k=$((60 / $1)); (( k * $1 == 60 )) || { echo "fps must divide 60" >&2; exit 1; }; echo "select='not(mod(n\,$k))',setpts=N/($1*TB)"; }
mkdir -p "$O" "$HERE/tmp"

if [[ $WHAT == mp4 || $WHAT == all ]]; then
  ffmpeg -v error -y -start_number $A -framerate 60 -i "$F/%05d.png" -frames:v $N \
    -vf "crop=trunc(iw/2)*2:trunc(ih/2)*2,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int" \
    -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
    -movflags +faststart "$O/$NAME-x.mp4"
fi

if [[ $WHAT == gif || $WHAT == all ]]; then
  T=$HERE/tmp/$NAME-loop-lossless.gif
  ffmpeg -v error -y -start_number $A -framerate 60 -i "$F/%05d.png" -filter_complex \
    "trim=end_frame=$N,$(dec $LOOP_FPS),scale=960:-2:flags=area,split[a][b];\
     [a]palettegen=max_colors=$COLOURS:stats_mode=full[p];\
     [b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 "$T"
  opt "$T" "$O/$NAME-loop.gif"; fixlen "$O/$NAME-loop.gif" 2720
fi

if [[ $WHAT == small || $WHAT == all ]]; then
  # 1920x1200 is exactly 1.6:1, so the fit is exact: no crop and no pad band (the pad is a no-op kept from the recipe)
  T=$HERE/tmp/$NAME-800x500-lossless.gif
  ffmpeg -v error -y -start_number $A -framerate 60 -i "$F/%05d.png" -filter_complex \
    "trim=end_frame=$N,$(dec $SMALL_FPS),scale=800:500:force_original_aspect_ratio=decrease:flags=area,pad=800:500:(ow-iw)/2:(oh-ih)/2:color=$BG,split[a][b];\
     [a]palettegen=max_colors=$COLOURS:stats_mode=full[p];\
     [b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 "$T"
  opt "$T" "$O/$NAME-800x500.gif"; fixlen "$O/$NAME-800x500.gif" 2720
fi
if [[ $WHAT == draft ]]; then
  # the 10 s draft for the client: the website GIF's recipe on the first 600 frames (empty, build-in, hero, move 1, crowd)
  T=$HERE/tmp/$NAME-draft-lossless.gif
  ffmpeg -v error -y -start_number $A -framerate 60 -i "$F/%05d.png" -filter_complex \
    "trim=end_frame=600,$(dec $LOOP_FPS),scale=960:-2:flags=area,split[a][b];\
     [a]palettegen=max_colors=$COLOURS:stats_mode=full[p];\
     [b][p]paletteuse=dither=none:diff_mode=rectangle" -loop 0 "$T"
  opt "$T" "$O/$NAME-draft-10s.gif"; fixlen "$O/$NAME-draft-10s.gif" 1000
fi
ls -l "$O" | grep "$NAME" || true
