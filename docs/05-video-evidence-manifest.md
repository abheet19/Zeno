# Video Evidence Manifest — VIDEO-AC-01 / VIDEO-AC-02 / DESIGN-EVIDENCE-AC-01

Status as of 2026-08-24. Analysis performed locally with ffmpeg 9.0.1. Source files are read-only in `~/Downloads`; all derived artifacts live in `video-evidence/` and inherit the sources' private, unverified-rights status.

## 1. Supplied assets and access result

| Asset | Supplied as | Access result | Analysis state |
|---|---|---|---|
| `WhatsApp Video 2026-08-23 at 8.18.12 PM.mp4` | Local file | **Available, hash-verified** | Complete technical decode + full frame ledger |
| `WhatsApp Video 2026-08-24 at 11.55.02 AM.mp4` | Local file | **Available, hash-verified** | Complete technical decode + full frame ledger |
| Instagram Reels ×7 unique (9 submissions, 2 duplicated) | URLs only | **Inaccessible** — login/robots gated | Not analyzed. Not needed for Gate 2: both compilations are present and hash-verified. Only optional per-reel canonical-ID mapping is affected |
| Claude Artifacts ×2 unique (3 submissions, 1 duplicated) | URLs only | **Inaccessible** — account-gated | Not analyzed. If their design content matters, an HTML/ZIP export must be supplied |

**Duplicate submissions preserved, not silently collapsed:** reel `DcElx3fuTTf` and reel `DZC-H3tRH7C` were each supplied twice, and Artifact `5ee3a68b-…` was supplied twice. Canonicalized for analysis; original-submission multiplicity retained here per VIDEO-AC-01.

**No reel was described from its URL, thumbnail, caption or a third-party summary.** Nothing is claimed about the seven reels beyond what the two local compilations actually show.

## 2. Integrity verification against the prompt's own manifests

| Field | 23-Aug expected | 23-Aug measured | 24-Aug expected | 24-Aug measured |
|---|---|---|---|---|
| SHA-256 | `ce330c45…d63476` | **match** | `c21e6fc6…c0d37b2` | **match** |
| Bytes | 21,098,344 | **match** | 14,575,808 | **match** |
| Decoded frames | 9,530 (0–9529) | **9,530 ✓** | 8,065 (0–8064) | **8,065 ✓** |
| First / last PTS | 0.000000 / 158.993333 | **match** | 0.000000 / ~134.4317 | **134.431667 ✓** |
| Duplicate frames | 17 in 11 runs | **17 in 11 runs, max 4 ✓** | 81 in 44 runs, max 7 | **81 in 44 runs, max 7 ✓** |
| Gaps > 20 ms | ten | **10 ✓** | "two ≈33.333 ms" | **1, at 25.000 ms ✗** |

The 23-Aug manifest is corroborated in every particular. The 24-Aug manifest is corroborated in every particular **except its gap profile**, which is wrong — see correction **C-018**. No 33.333 ms gap exists in that file.

## 3. Frame ledgers produced

`video-evidence/video-2026-08-23/frame-ledger.csv` — **9,530 rows** · `video-evidence/video-2026-08-24/frame-ledger.csv` — **8,065 rows**

Columns: `frame_index, pts_time, sha256, exact_dup_of_prev, scene_score, cut_class, motion_class, semantic_range_id, semantic_range_label, disposition, is_range_boundary, inspection_status, review_status, reviewer_confidence, decoder_version`.

Machine-checked assertions (all PASS, see `LEDGER-ASSERTIONS.md`): exactly-once contiguous coverage of the full index range; strictly increasing PTS; per-frame SHA-256; duplicate runs classified; gap distribution measured; and a semantic-range map under which **every** frame belongs to exactly one contiguous range (54 ranges / 21 ranges, no gap or overlap).

## 4. Audio evidence boundary

- **23-Aug:** AAC-LC stereo 44.1 kHz present and technically decoded. **Not semantically audited.** No design conclusion in any artifact uses its soundtrack. A timestamped speech/music/earcon review with rights notes is still required before any sonic-identity recommendation.
- **24-Aug:** AAC-LC stereo 44.1 kHz is **effectively digital silence** per the prompt's own measurement (mean and max ≈ −91 dB). Only visible captions and observable screen changes may serve as evidence. No narration exists to transcribe, and none may be invented.

## 5. What the current evidence is, and is not

**Is:** complete technical decode of both sources, cryptographically hashed per frame, with full contiguous coverage, measured timing/duplicate/motion characteristics, and an independently cross-checked semantic-range index.

**Is not:** frame-by-frame *semantic* review. Every row carries `review_status = pending-semantic-review` and an empty `reviewer_confidence`. Automated decoding is never semantic analysis, and this manifest does not claim otherwise. Gate 2 additionally requires a reviewed pass over every visually unique range plus every before/at/after transition set, with sign-off written into those columns. Exact duplicate frames may share one reviewed representative.

**Boundary cross-check outcome (independent of the prompt):** 24 of 54 and 19 of 21 transcribed boundaries are corroborated by a measured scene cut. The shortfall on the 23-Aug source is expected rather than suspicious — that table intentionally includes soft semantic phase boundaries inside a single continuous shot, which produce no detectable cut. Running the check in reverse, only **6 isolated candidate missed boundaries** exist across all 17,595 frames (23-Aug: 18, 62, 1370, 2035, 2125; 24-Aug: 4650), each sitting inside a plausible intra-range UI transition. The other 92 non-boundary detections are clustered motion bursts with a diagnostic every-other-frame signature.

## 6. Rights, retention and handling

User-supplied for private analysis. Ownership and reuse licences for the depicted products, music, footage and assets are **unverified**. The compilations must not be redistributed, and no depicted asset, trade dress, layout, shader, audio or code may be copied into the product.

Every derived artifact — frames, hashes, ledgers, scene scores, contact sheets, OCR, annotations — inherits that status: access-controlled, excluded from any shipped or public repository, from demos and marketing, and from **all** model-training corpora; deleted under the approved research-retention policy with receipts. A clean-room boundary applies: implementers receive an abstracted component/state/motion brief, never the source frames.

## 7. Outstanding before Gate 2

1. Semantic review pass populating `review_status` / `reviewer_confidence` for every visually unique range and transition set.
2. Adjudication of the 6 isolated candidate boundaries.
3. Timestamped audio review of the 23-Aug track, or an explicit recorded decision to leave it unaudited and use no audio evidence.
4. Reference Transformation and Morphological Matrix rows derived from these ranges (Phase 0B).
5. Feature Observation Ledger per VIDEO-AC-16, marking each observed capability `observed / claimed / inferred / unclear / not auditable`.
