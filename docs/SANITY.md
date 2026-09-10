# Zeno — sanity, acceptance, and release guide

> Snapshot: 10 September 2026 IST. Run this against disposable or synthetic data. Save the branch, commit, complete dirty-path list, command, exit code, environment, and artifact hashes with every result.

## Before running

Use Node 22+, Git, and a disposable `ZENO_DIR` plus disposable project. Do not run a second daemon over the same workspace. Inventory installed Ollama models and local Whisper assets without exposing credentials. A provider listed as available still needs a real bounded run to prove the path.

```powershell
$repo = 'D:\Code\Zeno'
$env:ZENO_DIR = Join-Path $env:TEMP ('zeno-acceptance-' + [guid]::NewGuid().ToString('N'))
$env:ZENO_PROJECT_DIR = Join-Path $env:TEMP ('zeno-project-' + [guid]::NewGuid().ToString('N'))
Set-Location $repo
npm run check
npm run build:app
Get-FileHash .\dist-app\Zeno-0.1.0-x64-portable.exe -Algorithm SHA256
Get-FileHash .\dist-app\Zeno-Setup-0.1.0-x64.exe -Algorithm SHA256
```

## Product sanity checklist

- [ ] Launch the packaged app once; a second launch focuses it instead of sharing the workspace; closing stops owned daemon/Whisper processes without EPIPE.
- [ ] Open each Command rail destination and verify state comes from the daemon; inspect meaningful orb nodes and model/locality/egress explanations.
- [ ] Ask a grounded and an absent-fact question by typing; verify citations versus explicit ungrounded status and optional local TTS interruption.
- [ ] Hold-to-talk, first-utterance wake, ordinary-speech non-trigger, stop, and denial/recovery with a physical microphone on the target PC.
- [ ] Run Counsel preflight/consent/save/citations/post-meeting Ask/delete/discard; verify Command/Ask voice refuses while Counsel owns the microphone.
- [ ] Switch Forge Agent/Editor; create sessions; test explicit/manual and automatic routing with disclosures; cancel only the intended run.
- [ ] Open multiple files, split into two Monaco groups, edit independently, save exact active paths, reject dirty close, restore layout, and verify phone collapse.
- [ ] Run Terminal success/failure/retry tabs and one discovered test; inspect honest Extensions, themes/brackets, skills/rules, MCP connectors, CI, debugger, and process boundaries.
- [ ] Run one local answer-only and one local held-edit fixture. Verify selected repo unchanged before approval, exact capsule hash, one approval/attempt, landed bytes, and receipt.
- [ ] Run hosted Codex/Claude only after their exact in-product egress/allowance confirmation; verify denied and cancelled paths as well as success.
- [ ] Inspect every Codex provider log: ambient MCP/web should remain disabled, while any global Agent Skill discovery must be surfaced as an open isolation boundary rather than described as fully blocked.
- [ ] Verify Vault owner write, agent proposal/refusal to self-approve, keyword recall citations, memory-off behavior, and no raw-chat auto-memory.
- [ ] Test theme, reduced motion, masking, zoom, keyboard focus, and layouts at desktop/tablet/360 px without horizontal page overflow.

## Retained evidence for the current candidate

- `verification-work/zeno-release-db674c0-check.log`: exact post-dark implementation commit, 1,456 tests, 1,454 passed, 2 explicit Windows symlink skips, 0 failed across 16 workspace summaries.
- `verification-work/zeno-packaged-dark-default-report.json`: a fresh profile booted Graphite dark before CSS; saved System, Light, and Dark choices still won; zero page or console errors.
- `verification-work/zeno-packaged-dark-full-output/zeno-packaged-ui-acceptance.json`: 21/21 dark-package Command, Settings, Forge, zoom, and mobile checks with zero page or console errors; the retained URL token is redacted.
- `verification-work/zeno-packaged-dark-answer-only.json`: exact `WRITE A for loop` prompt returned valid JavaScript in 4.376 s with no file proposal or repository/approval change.
- `verification-work/zeno-packaged-dark-local-held-edit.json` plus `zeno-packaged-dark-local-held-edit-receipt.json`: `qwen3:8b` proposed one exact held file in 825 ms, left the fixture unchanged before approval, landed the exact 48 bytes after approval, and recorded a verified signed receipt.
- `verification-work/zeno-packaged-hold-to-talk-f10.json`: the immediately preceding F10 package heard the physical hold-to-talk phrase, routed it, returned to Idle, and released capture. `db674c0` changed theme bootstrap only; a post-dark physical microphone rerun has not been retained.
- `dist-app/Zeno-0.1.0-x64-portable.exe` (`4F23B7C053E8BE63398A564069901B2FE12107787B279D564393912373B0EBE1`) and `dist-app/Zeno-Setup-0.1.0-x64.exe` (`3653BDF41934921985DEF7AB49BBFF40A402D7C79EF880FD185989407266A322`): current dark candidate artifacts.

## Release sequence

1. Start from the exact verified implementation commit and inspect `git status` before changing anything.
2. Rerun `npm run check` and `npm run build:app` after any runtime change; retain hashes for new artifacts.
3. Test install, launch, upgrade and uninstall on a clean Windows profile before public distribution.
4. Repeat local-model answer/edit, wake positive/negative, hold-to-talk, and Counsel save/ask/delete/discard probes when those subsystems change.
5. Run a hosted-provider edit only after the owner authorizes that exact provider egress/cost confirmation.
6. Retain commands, timestamps, logs, screenshots, receipts and the exact commit.

## Claims this guide does not establish

- Automated speech tests do not prove physical microphone, speaker identity, noisy-room accuracy, system-voice quality, or a full wake-quality benchmark.
- A controlled title test does not prove a real meeting join or remote/system-audio capture.
- A local Qwen edit does not prove every Ollama model or task will produce valid edits; no silent fallback is acceptable.
- A package build is not a signed/public release. No macOS, Linux desktop, phone client, updater, or public cloud deployment is established.

A green local run is evidence for the exact tested tree. Call a feature deployed only after recording `source commit -> CI run -> image/release -> post-deploy smoke` for the same bytes.
