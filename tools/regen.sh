#!/bin/bash
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"
OUT="$HOME/Documents/personal-ai-suite-phase0/video-evidence"
exec >>"$OUT/run.log" 2>&1
echo "=== $(date -u +%FT%TZ) REGEN2 (fps_mode as OUTPUT option)"
run() {
  SRC="$1"; TAG="$2"; EXPECT="$3"; D="$OUT/$TAG"
  ffmpeg -hide_banner -nostdin -loglevel error -i "$SRC" -map 0:v:0 -fps_mode passthrough -f framehash -hash sha256 -y "$D/framehash.txt" || { echo "$TAG framehash FAILED"; return 1; }
  ffmpeg -hide_banner -nostdin -loglevel error -i "$SRC" -vf "select='gte(scene,0)',metadata=print:file=$D/scene.txt" -fps_mode passthrough -f null -y - || echo "$TAG scene warn"
  python3 "$OUT/join_ledger.py" "$D" "$EXPECT" "$TAG"
}
run "$HOME/Downloads/WhatsApp Video 2026-08-23 at 8.18.12 PM.mp4" "video-2026-08-23" 9530
run "$HOME/Downloads/WhatsApp Video 2026-08-24 at 11.55.02 AM.mp4" "video-2026-08-24" 8065
echo "=== $(date -u +%FT%TZ) REGEN2 end"
