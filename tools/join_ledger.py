#!/usr/bin/env python3
"""Join ffmpeg/ffprobe outputs into a machine-readable per-frame ledger (VIDEO-AC-02 technical layer).

Inputs in <dir>: framehash.txt (ffmpeg framehash, sha256), frames.csv (ffprobe pts_time per frame),
scene.txt (lavfi metadata=print scene scores). Outputs: frame-ledger.csv + summary.md with assertions.
"""
import csv, re, sys
from datetime import datetime, timezone
from pathlib import Path

d = Path(sys.argv[1]); expect = int(sys.argv[2]); tag = sys.argv[3]

pts = []
for line in open(d / "frames.csv"):
    line = line.strip()
    if not line:
        continue
    tok = line.split(",")[0]
    try:
        float(tok)
    except ValueError:
        continue  # skip side-data/non-frame lines
    pts.append(tok)

hashes = []
for line in open(d / "framehash.txt"):
    if line.startswith("#") or not line.strip():
        continue
    hashes.append(line.split(",")[-1].strip())

scene = {}
cur = None
for line in open(d / "scene.txt"):
    m = re.match(r"frame:(\d+)\b", line)
    if m:
        cur = int(m.group(1))
        continue
    m = re.search(r"lavfi\.scene_score=([\d.]+)", line)
    if m and cur is not None:
        scene[cur] = m.group(1)

n = len(pts)
errs = []
if n != expect:
    errs.append(f"pts rows {n} != expected {expect}")
if len(hashes) != n:
    errs.append(f"hash rows {len(hashes)} != pts rows {n}")
fpts = [float(p) for p in pts]
if any(fpts[i] >= fpts[i + 1] for i in range(n - 1)):
    errs.append("PTS not strictly monotonic increasing")

rows, runs = [], []
dups = run = 0
prev = None
for i in range(n):
    dup = prev is not None and i < len(hashes) and hashes[i] == prev
    if dup:
        dups += 1
        run += 1
    elif run:
        runs.append(run)
        run = 0
    prev = hashes[i] if i < len(hashes) else prev
    rows.append([i, pts[i], hashes[i] if i < len(hashes) else "", int(dup), scene.get(i, "")])
if run:
    runs.append(run)

deltas = [round(fpts[i + 1] - fpts[i], 6) for i in range(n - 1)]
big = [x for x in deltas if x > 0.020]

with open(d / "frame-ledger.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["frame_index", "pts_time", "sha256", "exact_dup_of_prev", "scene_score"])
    w.writerows(rows)

status = "PASS" if not errs else "FAIL"
with open(d / "summary.md", "w") as f:
    f.write(f"""# Frame ledger summary — {tag}

Generated {datetime.now(timezone.utc).isoformat()} by join_ledger.py.
Method: ffmpeg framehash (SHA-256 of each decoded frame) + ffprobe per-frame pts_time + lavfi scene filter.

| Check | Result |
|---|---|
| Assertion status | **{status}** {'; '.join(errs) if errs else ''} |
| Decoded frames | {n} (expected {expect}) |
| Frame index coverage | 0–{n-1}, exactly-once (row per index by construction) |
| PTS monotonic strictly increasing | {'yes' if 'PTS not strictly monotonic increasing' not in errs else 'NO'} |
| First / last PTS | {pts[0] if pts else '-'} / {pts[-1] if pts else '-'} |
| Exact duplicate frames | {dups} in {len(runs)} runs (max run {max(runs) if runs else 0}) |
| PTS gaps > 20 ms | {len(big)} (max {max(big) if big else 0}) |

Scope note: this is the **technical decode ledger**. Semantic-range IDs, reviewer status/confidence, and
contact-sheet pointers are joined in a separate pass before Gate 2 (columns to append per VIDEO-AC-02).
""")
print(f"{tag}: {status}; frames={n}/{expect}; dups={dups}; runs={len(runs)}")
sys.exit(0 if not errs else 1)
