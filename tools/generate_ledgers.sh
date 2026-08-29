#!/bin/bash
# Waits for ffmpeg (brew install in progress), then generates per-frame ledgers for both evidence videos.
set -uo pipefail
OUT="$HOME/Documents/personal-ai-suite-phase0/video-evidence"
LOG="$OUT/run.log"
exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) ledger run start"

for i in $(seq 1 240); do  # up to 60 minutes
  [ -x /opt/homebrew/bin/ffmpeg ] && [ -x /opt/homebrew/bin/ffprobe ] && export PATH="/opt/homebrew/bin:$PATH"
  command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1 && break
  sleep 15
done
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FATAL: ffmpeg did not appear within 60 minutes; rerun this script after install."
  exit 1
fi
echo "using: $(ffmpeg -version 2>/dev/null | head -1)"

process() {
  SRC="$1"; TAG="$2"; EXPECT="$3"
  D="$OUT/$TAG"; mkdir -p "$D"
  echo "--- $TAG start $(date -u +%FT%TZ)"
  ffmpeg -hide_banner -nostdin -loglevel error -i "$SRC" -map 0:v:0 -f framehash -hash sha256 "$D/framehash.txt" || { echo "$TAG framehash FAILED"; return 1; }
  ffprobe -hide_banner -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 "$SRC" > "$D/frames.csv" || { echo "$TAG ffprobe FAILED"; return 1; }
  ffmpeg -hide_banner -nostdin -loglevel error -i "$SRC" -vf "select='gte(scene,0)',metadata=print:file=$D/scene.txt" -f null - || { echo "$TAG scene FAILED"; return 1; }
  python3 "$OUT/join_ledger.py" "$D" "$EXPECT" "$TAG"
}

process "$HOME/Downloads/WhatsApp Video 2026-08-23 at 8.18.12 PM.mp4" "video-2026-08-23" 9530
process "$HOME/Downloads/WhatsApp Video 2026-08-24 at 11.55.02 AM.mp4" "video-2026-08-24" 8065
echo "=== $(date -u +%FT%TZ) ledger run end"
