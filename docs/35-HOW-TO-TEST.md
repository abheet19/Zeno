# How to test Zeno

This is the operational test guide for the current Windows desktop implementation. Use a disposable
repository for Forge and retain evidence for every live claim. The automated suite is necessary, but
it cannot prove a microphone, GPU, external meeting window, hosted provider or clean installer.

For the implementation map and concept explanations, read [the study pack](44-STUDY-PACK.md).
For the acceptance boundary, read [the evidence map](43-ACCEPTANCE-EVIDENCE.md).

## 1. Record the test context

Before running a check, capture:

```text
Date/time and timezone:
Git commit plus `git status --short`:
Windows version and hardware:
Node and npm versions:
Selected disposable repository:
Ollama version and installed models:
Whisper executable and model paths, if present:
Claude Code/Codex CLI versions, if used:
Network state:
Exact command or UI journey:
Expected result:
Observed result:
Artifact paths (log, screenshot, receipt, recording):
Skips, warnings or deviations:
```

Do not replace a dirty-tree identifier with a branch name alone. A passing result applies to the
exact working tree, dependencies, model, hardware and external-service state that produced it.

## 2. Preflight

From PowerShell in the repository root:

```powershell
node --version
npm --version
git --version
npm install
```

Node must satisfy the version in the root `package.json`. `npm install` may use the lockfile and
network. Record any dependency change instead of silently treating a changed lockfile as the same
build.

Optional providers are tested only when their own command reports available:

```powershell
ollama --version
ollama list
claude --version
codex --version
```

The preferred local speech paths are under
`%LOCALAPPDATA%\Zeno\speech\v1.9.2\`: a `whisper-server.exe` in the GPU or CPU build directory and
`ggml-large-v3-turbo-q5_0.bin` at the version root. `ZENO_WHISPER_SERVER` and
`ZENO_WHISPER_MODEL` can override them. The repository and installer do not provision those files.

## 3. Automated gate

```powershell
npm run check
npm run build
```

Every command must exit zero. The root check covers every npm workspace, including the desktop
shell. A package test count is evidence only for that exact run, so this guide does not freeze a
total.

The automated suite does not prove that the Electron window launches, a microphone works, a local
or hosted model is available, a browser extension is connected, or an installer works on a clean
machine. Continue with the live checks.

## 4. Launch and lifecycle

```powershell
npm run app
```

Pass criteria:

- one native Zeno window opens and the loopback daemon becomes reachable;
- a second launch focuses the existing window instead of starting a competing daemon;
- the window can switch among Command, Forge and Counsel without losing an active microphone bar;
- closing the last window ends the child daemon and speech process without an Electron error dialog;
- if Ollama is installed but stopped, launch either starts the supported local path or reports the
  unavailable runtime honestly; it must not claim a local model is ready before loopback answers.

`npm run up` is the daemon-only path. It does not open a desktop window. Open the exact nonce-bearing
`http://127.0.0.1:.../?k=...` URL printed by that process; a plain URL is intentionally read-only.

## 5. Command and the Standing Field

| Check | Procedure | Pass condition |
|---|---|---|
| Navigation | Open every Command rail item, then use keyboard focus to repeat the journey. | Each control changes to a real surface or an explicit unavailable state; focus remains visible. |
| Live state | Create a disposable proposal and watch pending approvals and receipts. | Counts and lists update without a page refresh. A verified seal appears only after its receipt exists. |
| Read failure | Stop the daemon while the window is open. | The surface reports unread/unknown rather than rendering a healthy zero or quiet field. |
| Field parity | Toggle the full list, 2D view, reduced motion, masking and each theme. Inspect every node. | Canvas and list describe the same live objects; controls do not fabricate objects or activity. |
| Node actions | Open a pending action, receipt, Vault note, meeting and repository node when each exists. | The card links to its owning surface; opening a card never approves or executes. |
| Local models | Start Ollama and pull a model; then stop Ollama. | A runtime/model node appears only after `/forge/agents` reports installed models and disappears or becomes honestly unavailable after loss. |
| Ask Zeno | Ask a question answerable from current state or Vault, then ask an unsupported one. | Grounded answers cite the source; unsupported claims are labelled ungrounded. |

The Field's glow is state, edges are relationships, and size/pulse express attention. Dashed amber
edges marked with a lightning glyph are off-machine egress. Ollama is loopback and must use an
ordinary local edge.

## 6. Forge

Use a disposable Git repository with at least one source file and a package script such as `test` or
`check`. Confirm the selected path and branch before every mutation.

### Workspace and panels

1. Switch between **Agent** and **Editor**.
2. Toggle and resize Explorer, the bottom drawer and Session panel.
3. Open Explorer, Search, Source control, Extensions & themes, Rules & skills, MCP servers, Tests,
   Debug and Task board.
4. Open and edit a tracked file, use search, switch themes and toggle rainbow brackets.

Pass only when real data comes from the selected repository and missing capabilities say they are
missing. Current honest boundaries are: no VSIX/Marketplace extension host, no injected snippets,
no CI runner, no debugger, and syntax-level editor diagnostics for TypeScript/JavaScript.

### Terminal and test runner

1. Run `node --version`, `git status --short` and a deliberately failing harmless command in separate
   terminal tabs.
2. Verify exit code, duration, stdout/stderr and spawn failures are distinct.
3. Run every discovered safe package script from Tests, including one passing and one failing case.

Pass only when terminal commands are one-shot, non-interactive, limited to 30 seconds and bounded in
output. Tabs retain history for the window session but are independent records, not persistent PTYs.
The test picker may run only repository-declared `test`, `test:*`, `check`, `typecheck` and `lint`
scripts; browser-supplied arbitrary commands must be rejected.

### Agent, context and approval journey

Run this matrix with automatic routing and then with a manual route:

| Route | Suggested harmless task | Required evidence |
|---|---|---|
| Local Ollama | `Write a JavaScript for loop from 0 through 4 and explain it. Do not edit files.` | Visible local provider/model/effort and route reason; valid chat/code result or an honest parse/timeout failure; no repository change. |
| Local edit | `Add one uniquely named line to hello.txt.` | Throwaway-worktree run, exact diff, held file capsule, selected repo unchanged before owner approval, then one applied file and receipt after approval. |
| Claude Code | Same disposable edit. | Exact hosted disclosure and owner confirmation before egress; selected model/effort; isolated diff and held capsule. |
| Codex | Same disposable edit. | Exact hosted disclosure and owner confirmation before egress; selected model/effort; isolated diff and held capsule. |

For each run:

1. Open **Lens** before execution. Record the task, selected repository skills, per-session memory
   choice, project `ZENO.md`, cited Vault memories and context hash.
2. Change the task or context inputs after preview. The stale context must be refused and rebuilt;
   the provider must not receive the superseded context.
3. Start, cancel and retry separate runs. Partial files must be labelled partial and remain reviewable;
   cancellation must never be rendered as success.
4. Create multiple Agent sessions. Verify their task, route, chat and history do not overwrite each
   other. Record the current daemon concurrency boundary instead of inferring parallel execution from
   multiple visible sessions.
5. Inspect every proposed file. Before approval, `git status --short` in the selected repository must
   remain unchanged. After the owner approves, verify the base binding, resulting file and receipt.
6. Ask the model for no file operation and confirm a valid answer is not mislabeled as a failed edit.
   If a task requested an edit but produced no valid edit record, Forge must say so plainly.

## 7. Voice

Test local Whisper and browser Web Speech as separate products; never merge their results.

### Push-to-talk

1. Hold the microphone control, say a navigation command, then release.
2. Repeat with a proposal command and a delegation command.
3. Release early, cancel, deny microphone permission and unplug/switch the input device.

Pass criteria: the microphone is open only while held, the active recognizer is named, recognized
text is shown for correction, and every consequential result is a proposal. The voice module has no
approval route. A spoken file request currently creates a reviewable scaffold rather than finished
implementation; `add_task` is explicitly not wired.

### Wake mode

1. Read the disclosure and opt in to **Listen for “Zeno”**.
2. Speak room noise and speech without the wake phrase, then multiple phonetic variants of “Zeno”.
3. Give a command inside and outside the open command window, stop wake mode, and close the window.

Pass criteria: the persistent listening bar is visible, only a recognized wake phrase opens the
command window, retained untriggered transcript is visible and dropped on switch-off, and closure
releases the microphone. Record false accepts, false rejects, word error rate and end-to-result
latency from a fixed corpus. The current implementation does not identify the owner's voice, learn a
voiceprint or acoustically separate the owner from calls/background speakers. Its wake decision is
made after transcription.

The current 15-second untriggered transcript retention conflicts with the two-second acceptance
target; see `VOICE-AC-06` in the acceptance evidence map. A green test for 15 seconds proves current
behavior, not acceptance.

## 8. Counsel

1. Open a real Zoom, Teams, Google Meet, Slack, Discord or Webex meeting window.
2. Open Counsel preflight and confirm the matching title appears as an explicit **Attach** choice.
3. Confirm the UI explains that detection is title-based, capture is microphone-only, and manual
   microphone capture remains available.
4. Close the external meeting after selecting it, press **Attach & begin capture**, and verify the
   final presence check refuses the vanished exact window.
5. Reopen the meeting, name the call, select it, confirm consent and start. Leave the Zeno surface and
   return; the capture indicator must persist.
6. Let the external window disappear after capture starts. The 15-second presence check must update
   the attachment state without silently claiming the meeting remains present.
7. End and save the disposable call, open its Markdown record, verify every extracted decision/action
   cites transcript lines, then delete it. Repeat with **Discard** and confirm no meeting file exists.

The detector requests zero-sized thumbnails and returns only recognized window titles. Attachment
does not prove participation. Counsel does not capture remote/system audio or perform automatic
speaker diarization; label speakers manually and test summaries against the saved transcript.

## 9. Vault and memory across chats

1. Create one owner memory of each kind: fact, decision, preference, convention and question.
2. Search for exact and unrelated terms. Record the score and matched terms.
3. Run Forge with memory enabled, disabled and with no Vault attached.
4. Edit a memory Markdown file while Zeno is stopped, restart, and confirm retrieval reflects disk.
5. Propose a memory write as an agent and verify it passes through owner review; then delete it as the
   owner and confirm it is gone.

Pass criteria: raw chat history is not silently persisted. Cross-run context comes only from the
project's root `ZENO.md`, selected repository skills and a bounded set of task-relevant Vault notes.
Memory notes are data and cannot authorize effects. Retrieval is transparent keyword scoring, not an
embedding/vector service, so it requires no OpenAI embedding key.

## 10. MCP, browser and Chrome bridge

- Inspect MCP servers in Forge. Only the bundled, strict, run-scoped Zeno capability set should be
  reported; ambient external MCP servers are not attached.
- Exercise each bundled read/propose tool and confirm the model-facing server has no approval tool.
- Test the isolated Chromium path with a fresh profile and its per-call permission gate.
- Test the owner Chrome bridge only after explicit setup: extension, native host, environment switch,
  origin allowlist and a per-operation owner approval. Confirm it is off by default and never receives
  unrestricted browser control.

## 11. Ledger demonstration

```powershell
npm run demo -- --dir .zeno-demo
npm run ledger:verify -- --dir .zeno-demo
```

The demo should produce one verified write and one drift refusal. Verification checks the hash chain
and Ed25519 signatures. The explicit `.zeno-demo` directory keeps this exercise away from the normal
workspace. Run tamper experiments only there or in a copy; do not edit a real `.zeno/ledger.jsonl`.

## 12. Package and installer

```powershell
npm run build:app
```

Inspect both portable and NSIS outputs in `dist-app/`. A build artifact on the development machine is
not a clean-install result. Test on a fresh supported Windows account or VM: install, launch, project
selection, single-instance behavior, uninstall, no stale daemon, no bundled Whisper claim, and clear
degraded states when Git, provider CLIs, Ollama, network or microphone are absent.

Zeno is a Windows local desktop product in the current scope. There is no public web deployment or
macOS release to mark “live.”

## 13. Acceptance boundary

Green package tests substantiate clauses in the 196-row acceptance ledger; they do not close a row
whose required evidence also names live hardware, manual inspection, external services, another
device, performance measurements or a different platform. Keep statuses in
`docs/ledgers/acceptance-criteria.csv` unchanged until the required artifacts exist.

The scripts under `tools/live-*-probe.mjs` are maintainer probes for a running Electron instance with
a loopback CDP port. They are not part of `npm run check`; record their exact command, environment,
timestamp and output whenever they are used as evidence.
