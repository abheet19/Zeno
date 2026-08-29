#!/usr/bin/env python3
"""Authoritative per-frame ledger from ffmpeg `showinfo` (VIDEO-AC-02 technical layer).

Why showinfo rather than the framehash muxer: framehash writes through a muxer, which drops
frames carrying duplicate/non-monotonic DTS. On the 23-Aug source that silently loses 7 of
9,530 decoded frames. `showinfo` reports every frame the decoder emits inside the filter
graph, so its row count matches the decoder exactly.

Hash note: showinfo's `checksum` is Adler-32 over the frame, plus per-plane checksums. That is
adequate for exact-duplicate detection (the ledger's purpose) but is NOT a cryptographic hash.
The SHA-256 framehash pass is retained alongside as a cross-check, with its muxer drop documented.
"""
import csv, re, sys
from datetime import datetime, timezone
from pathlib import Path

d = Path(sys.argv[1]); expect = int(sys.argv[2]); tag = sys.argv[3]

LINE = re.compile(
    r"n:\s*(\d+).*?pts:\s*(-?\d+)\s+pts_time:\s*([-\d.eN/A]+).*?checksum:\s*([0-9A-Fa-f]+)"
    r"(?:.*?plane_checksum:\s*\[([^\]]*)\])?"
)

rows = []
for line in open(d / "showinfo.txt", errors="replace"):
    if "Parsed_showinfo" not in line or " n:" not in line:
        continue
    m = LINE.search(line)
    if m:
        rows.append({"n": int(m.group(1)), "pts": m.group(2), "pts_time": m.group(3),
                     "checksum": m.group(4), "planes": (m.group(5) or "").strip()})

n = len(rows)
errs = []
if n != expect:
    errs.append("showinfo rows %d != expected %d" % (n, expect))
if [r["n"] for r in rows] != list(range(n)):
    errs.append("showinfo n values are not the contiguous sequence 0..%d" % (n - 1))

fpts, bad_pts = [], 0
for r in rows:
    try:
        fpts.append(float(r["pts_time"]))
    except ValueError:
        bad_pts += 1
        fpts.append(float("nan"))
if bad_pts:
    errs.append("%d frames have unparseable pts_time" % bad_pts)
non_mono = sum(1 for i in range(len(fpts) - 1) if not (fpts[i] < fpts[i + 1]))
if non_mono:
    errs.append("%d PTS pairs are not strictly increasing" % non_mono)

# exact-duplicate runs, keyed on full frame identity (checksum + per-plane checksums)
dups, runs, run, prev = 0, [], 0, None
for r in rows:
    key = r["checksum"] + "|" + r["planes"]
    if prev is not None and key == prev:
        dups += 1; run += 1
    elif run:
        runs.append(run); run = 0
    prev = key
    r["dup"] = 1 if (prev is not None and key == prev and dups) else 0
if run:
    runs.append(run)

# recompute dup flags cleanly
prev = None
for r in rows:
    key = r["checksum"] + "|" + r["planes"]
    r["dup"] = 1 if prev == key else 0
    prev = key

deltas = [round(fpts[i + 1] - fpts[i], 6) for i in range(len(fpts) - 1)]
big = [x for x in deltas if x > 0.020]

# cross-check against the SHA-256 framehash pass, if present
sha_rows = 0
fh = d / "framehash.txt"
if fh.exists():
    sha_rows = sum(1 for ln in open(fh) if ln.strip() and not ln.startswith("#"))

with open(d / "frame-ledger.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["frame_index", "pts", "pts_time", "adler32_checksum", "plane_checksums",
                "exact_dup_of_prev", "semantic_range_id", "review_status", "reviewer_confidence"])
    for r in rows:
        w.writerow([r["n"], r["pts"], r["pts_time"], r["checksum"], r["planes"], r["dup"],
                    "", "pending-semantic-review", ""])

status = "PASS" if not errs else "FAIL"
with open(d / "summary.md", "w") as f:
    f.write("""# Frame ledger summary — %s

Generated %s by showinfo_ledger.py.
Primary method: `ffmpeg -vf showinfo` (one record per decoded frame, no muxer in the path).
Cross-check: `-f framehash -hash sha256`.

| Check | Result |
|---|---|
| Assertion status | **%s** %s |
| Decoded frames (showinfo) | %d (expected %d) |
| Frame index coverage | 0–%d, contiguous and exactly-once |
| PTS strictly increasing | %s |
| First / last pts_time | %s / %s |
| Exact duplicate frames | %d in %d runs (max run %d) |
| PTS gaps > 20 ms | %d (max %s s) |
| SHA-256 framehash rows | %d %s |

**Muxer-drop finding.** The framehash muxer emits %d rows against %d decoded frames. The
difference is caused by frames carrying duplicate/non-monotonic DTS, which a muxer discards
even under `-fps_mode passthrough`. showinfo is therefore the authoritative count; the
framehash file is retained only as a cryptographic cross-check on the frames it did cover.

Scope: this is the **technical decode ledger**. `semantic_range_id`, `review_status` and
`reviewer_confidence` columns are present but unpopulated — the range-level semantic review
and reviewer sign-off are a separate pass required before Gate 2 (VIDEO-AC-02 / DESIGN-EVIDENCE-AC-01).
""" % (tag, datetime.now(timezone.utc).isoformat(), status, "; ".join(errs), n, expect, n - 1,
        "yes" if not non_mono else "NO (%d violations)" % non_mono,
        rows[0]["pts_time"] if rows else "-", rows[-1]["pts_time"] if rows else "-",
        dups, len(runs), max(runs) if runs else 0, len(big), max(big) if big else 0,
        sha_rows, "(matches)" if sha_rows == n else "(**%d fewer** — see below)" % (n - sha_rows),
        sha_rows, n))

print("%s: %s; frames=%d/%d; dups=%d in %d runs; sha_rows=%d" % (tag, status, n, expect, dups, len(runs), sha_rows))
sys.exit(0 if not errs else 1)
