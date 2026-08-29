# Model & Hardware Note — 2026-08-29 (owner asked "which models / is Mac better")

## The two machines

| | **Windows pilot** (personal) | **This Mac** (work) |
|---|---|---|
| Chip | Ryzen 7 7700X | Apple **M4 Pro** (14-core CPU / 20-core GPU) |
| "GPU memory" | **12 GB** dedicated VRAM (RTX 3080) | **48 GB unified** — GPU can use ~36–40 GB of it |
| Memory bandwidth | ~760 GB/s (but only across 12 GB) | ~273 GB/s (across all 48 GB) |
| System RAM | 32 GB | (shared — it's the 48 GB) |

## Which is better for running local AI models? **The Mac, for anything big.**

- **Capacity wins for the Mac.** 48 GB unified means it can hold much larger models *entirely in fast
  memory*. A 30–32B coder (~18–20 GB) fits comfortably on the Mac; on the 3080 it does not fit in 12 GB
  and must spill to system RAM over PCIe, which is slow. A 70B (~40 GB) can only run on the Mac at all.
- **Speed wins for the 3080 — but only for small models.** For a model that fits inside 12 GB (7–14B),
  the 3080's higher bandwidth makes it faster per token. Above ~14B the advantage flips hard to the Mac,
  because the 3080 starts offloading and the Mac doesn't.
- **Net:** the Mac (M4 Pro / 48 GB) is the more capable inference box for this suite; the 3080 is the
  quicker box only for small models.

## The catch: the Mac is GATED as a runtime

The better machine is the **work** Mac, and it gets **no product runtime** until **Gate 3 + the exact
sentence "Approve work-Mac pilot."** So Phase 1 runs the product on the **Windows pilot** by design (it's
the personal machine, no employer constraints). The Mac's capability is banked for later — when approved,
it would make the stronger primary host, especially for Forge.

## Model candidates per product (provider-neutral; the eval plan decides the final pick)

All **local / open-weight** by default — company code must never leave the machine, so on company repos a
local model is **mandatory** (the sanitizer + data-zone policy enforce it). Cloud models (e.g. Claude) are
allowed only for non-sensitive personal work, opt-in per data zone — never the default, never on company code.

| Product | On Windows 3080 (Phase 1 default) | On Mac M4 Pro (if approved later) | Notes |
|---|---|---|---|
| **Forge** (coding) | **Qwen2.5-Coder-14B** Q4/Q5 (~9–10.5 GB, fully resident, fast) | **Qwen2.5-Coder-32B** fully resident | 32B is a "quality mode" on Windows via partial offload |
| **Assistant / Command** | 8–14B general instruct (Llama-3.1-8B / Qwen2.5-14B) | 32B general | Orchestrator = routing + a small planner, not a big model |
| **Counsel** (Phase 5) | **Whisper large-v3 / distil** for speech; assistant model for Assist answers | same, larger Assist model | ASR is GPU-accelerated on both |

**Not final.** Model choice is measured, not declared: doc `17-evaluation-plan` runs candidates on real
tasks and picks per the eval harness; weights and licences drift between releases (C-028), so every pick is
re-checked. The Forge model popup in the prototype ("Qwen3-Coder 30B") was a placeholder — the real default
on 12 GB is the 14B; 30–32B is the offloaded quality mode.

**This does not affect slice P1-01** (the kernel has no model at all).

---

## eGPU / buying a GPU (owner asked 2026-08-29)

- **Cannot connect an external GPU to the Mac.** Apple Silicon (M-series) dropped eGPU support in 2020;
  the M4 Pro cannot use an external NVIDIA/AMD card for compute. Its 20-core GPU + 48 GB unified memory
  **is** the accelerator, and for LLM inference that unified memory is a genuine strength.
- **Buying a GPU is not needed and not recommended for "bigger models."** Capacity, then bandwidth, is
  the bottleneck. VRAM tiers for local models (Q4): 14B ≈ 9 GB · 32B ≈ 20 GB · 70B ≈ 40 GB.
  Consumer VRAM: 3080 = 12 GB · 5080 = 16 GB · 4090 = 24 GB · 5090 = 32 GB. A "5080 Ti" is unconfirmed
  (likely ~24 GB if it ships). **No single consumer GPU reaches 40 GB**, so 70B needs the Mac's 48 GB, a
  ~48 GB pro card (RTX 6000 Ada / A6000, $4k+), or multi-GPU. Your **Mac already beats every single
  consumer GPU on capacity** — a 5090 (32 GB) would buy *speed*, not *size*, and still holds less than
  the Mac. **Recommendation: buy nothing.** 3080 now (14B default), Mac later (32B+). $0 budget stands.

## Agent memory / context / "learns each task" (owner asked 2026-08-29)

**Memory = Zeno Vault (retrieval), NOT the model's weights.** Three tiers:
1. **Working context** — per task, ephemeral, discarded after.
2. **Sealed Context Pack** — per task, cited, stored in Vault as Markdown with full lineage.
3. **Long-term Vault + NeoSapien** — durable, retrievable, always cited with source + age.

**Does the model see all repos?** No — and it shouldn't. The 4 repos (~24,754 files) are **indexed** for
exact + symbol + reference search. Per task, only the **relevant, cited slices** are retrieved into the
context pack (repo frozen at HEAD, rules keyed per repo). This is the "retrieval and indexing" the scope
record authorised — never dumping whole repos into a prompt.

**Does it learn (retrain) each task?** No — **training eligibility: none.** The *model weights do not
change*. What grows is the *Vault memory* (more packs, receipts, corrections → better retrieval over
time). Weight training is the LAST rung of the adaptation ladder (retrieval → prompt → few-shot →
fine-tune) and is gated: it needs a separate rights review + employer authorisation for company code.
So Zeno "learns" by remembering and retrieving, not by retraining on your data.

## Will we fine-tune on the codebase? (owner asked 2026-08-29)

**Default: NO.** Standing decision (scope record: training eligibility = none). Reasons, in order:

1. **Fine-tuning is the wrong tool for "know my code."** It teaches *style/patterns*, not *facts* — ask a
   fine-tuned model "what does function X do" and it will confidently hallucinate. **Retrieval gives exact,
   current, cited answers** ("here's the function, at this file:line"). For a codebase, retrieval wins on
   correctness.
2. **Your code changes daily.** A fine-tuned model is stale the moment you commit; the index updates
   instantly. Retrieval is always current, fine-tuning always lagging.
3. **Fine-tuning bakes code permanently into weights** — a leak risk, and for the 4 work repos an **IP
   problem**: that's the employer's code, and a fine-tune is a derivative work of it. Hard-gated: needs a
   separate rights review + explicit employer authorisation. **Company code: no fine-tune, full stop,
   without that.**
4. **Models drift** (C-028): weights + licences change between releases, so a fine-tune is a maintenance
   liability that must be re-done and re-licensed each time.

**If we ever did:** only your *personal, non-sensitive* code, only after the adaptation ladder
(retrieval → rules/prompts → few-shot → LoRA) is measured and shown insufficient, and never company code
without employer sign-off. It would be a deliberate, separately-approved delta — never a silent default.
