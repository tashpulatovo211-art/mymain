#!/usr/bin/env bash
# Remakes the UNPC chamber showcase exports from the real site (design-to-motion, showcase context). Nothing here
# ships with the site: leave tools/ out when you upload it.
# Usage: run.sh [light|dark] [--twice]
#   light: unpc-chamber-x.mp4, unpc-chamber-loop.gif, unpc-chamber-800x500.gif and both contact sheets
#   dark:  unpc-chamber-dark-x.mp4 only
#   --twice: a second capture for the determinism check (another 6 to 7 minutes)
# Needs: the site served at SITE_URL (default http://127.0.0.1:8780/index.html, for example
# `npx http-server -p 8780 -c-1` run in the site folder), MEDIA for the output folder (default tools/showcase/out), Playwright (global), ffmpeg, python3 with
# PIL, numpy and OpenCV, and gifsicle for the final lossless GIF optimisation (apt install gifsicle; without it the
# GIFs are about 10% larger).
# The well's date is baked into every frame. DATE=YYYY-MM-DD (a weekday of the posting week; default 2026-10-26, so
# the well reads "Sunday 1 November") sets the page's clock; WELL=hide leaves the date out (the client decides).
set -euo pipefail
THEME=${1:-light}; TWICE=${2:-}
H=$(cd "$(dirname "$0")" && pwd)
MEDIA=${MEDIA:-$H/out}
mkdir -p "$MEDIA"
export NODE_PATH=$(npm root -g)
NAME=unpc-chamber; [[ $THEME == dark ]] && NAME=unpc-chamber-dark
OPTS=(--date "${DATE:-2026-10-26}" --well "${WELL:-show}")

node "$H/capture.js" --theme "$THEME" --out "$H/frames-$THEME-a" "${OPTS[@]}"
OTHER=()
if [[ $TWICE == --twice ]]; then
  node "$H/capture.js" --theme "$THEME" --out "$H/frames-$THEME-b" "${OPTS[@]}"
  OTHER=(--other "$H/frames-$THEME-b")
fi
node "$H/still.js" --theme "$THEME" --out "$H/stills-$THEME" "${OPTS[@]}"
python3 "$H/post.py" "$H/frames-$THEME-a" "$H/final-$THEME" "${OTHER[@]}" --still "$H/stills-$THEME/still-jump.png" "$H/stills-$THEME/still-reinit.png"
python3 "$H/motion.py" "$H/final-$THEME" "$H/motion-$THEME.json"
if [[ $THEME == dark ]]; then
  "$H/encode.sh" "$H/final-$THEME" "$MEDIA" "$NAME" mp4
  python3 "$H/contact.py" "$H/final-$THEME" "$H/$NAME-contact.png" 960 600
else
  "$H/encode.sh" "$H/final-$THEME" "$MEDIA" "$NAME" all
  "$H/encode.sh" "$H/final-$THEME" "$H" "$NAME" draft
  python3 "$H/verify_out.py" "$H/final-$THEME" "$MEDIA" "$NAME"
  python3 "$H/contact.py" "$H/final-$THEME" "$MEDIA/$NAME-contact-1920.png" 960 600
  python3 "$H/contact.py" "$H/final-$THEME" "$MEDIA/$NAME-contact-800x500.png" 800 500 --gif "$MEDIA/$NAME-800x500.gif"
fi
for f in "$MEDIA/$NAME"*; do echo "$f"; ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames:format=duration,size -of compact "$f" 2>/dev/null | head -2; done
