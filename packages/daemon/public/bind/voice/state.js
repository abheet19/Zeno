/**
 * bind/voice/state.js — the shared state object voice.js's split modules pass
 * around, following the same pattern as bind/forge/state.js: plain data any
 * module can read or write directly (`vstate.wakeOn`), plus a small function
 * registry for the handful of calls that would otherwise need an import
 * cycle. bind/voice.js keeps the capture-ownership check/claim/release and
 * the Outcome dispatcher (runOutcome) — voice/ptt.js and voice/wake.js both
 * need to call them, but bind/voice.js already imports voice/ptt.js and
 * voice/wake.js (for wireMicButton, abortPttNow, restoreWakeMode, disarmWake,
 * wireWakeSettingsToggle), so those two files reaching back into
 * bind/voice.js with a static `import` would be a cycle. Registering the
 * functions here once, from bind()'s own body, before anything that could
 * call one of them (a click, a wake word) is possible, lets every module
 * call `vstate.someFn(...)` instead.
 */
export const vstate = {
  // ---- the 8-state pill + mirrored mic buttons; set once in bind() ----
  pillEl: null,
  micButtons: [],
  engineNote: '',

  // ---- true when window.zenoLocalSpeech exists (the desktop bridge) but the
  // local Whisper runtime files are not actually on disk yet; owned by
  // voice/pill.js's refreshLocalRuntimeStatus(), read by its own paintState().
  // The bridge itself is always present on Windows regardless of whether
  // anything was ever installed, so without this flag a missing runtime would
  // paint as a live, idle engine instead of a disabled one. ----
  localRuntimeMissing: false,

  // ---- wake mode's one on/off flag; owned by voice/wake.js, read by
  // voice/ptt.js (one recogniser at a time) and voice/pill.js (what
  // "settled" means while wake mode is still on) ----
  wakeOn: false,

  // ---- cross-module function registry (see file comment above); each is
  // assigned exactly once, by bind/voice.js's bind() ----
  externalCaptureOwner: null, // () => string|null — bind/voice.js
  claimCapture: null,         // () => void — bind/voice.js
  releaseCapture: null,       // () => void — bind/voice.js
  runOutcome: null,           // (result) => Promise<void> — bind/voice.js
};
