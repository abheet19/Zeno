// Browser-shaped adapter over the installed Windows engine. The preload grants
// only start/stop and transcript events; renderer code never receives Node APIs.
const bridge = window.zenoLocalSpeech;
let sequence = 0;
export const localSpeech = Boolean(bridge);
export async function waitForSpeechIdle() {
  if (!bridge || typeof bridge.idle !== 'function') return;
  try { await bridge.idle(); } catch { /* closing a window already ends its capture */ }
}
class WindowsRecognition {
  constructor() {
    this.lang = 'en-US'; this.continuous = false; this.interimResults = false;
    this.active = false; this.id = 0; this.unsubscribe = null; this.results = [];
  }
  start() {
    if (this.active) throw new DOMException('Recognition has already started', 'InvalidStateError');
    this.active = true; this.id = ++sequence; this.results = [];
    const id = this.id;
    this.unsubscribe = bridge.onEvent(event => {
      if (!this.active || event.id !== id) return;
      if (event.type === 'start') this.onstart?.({});
      else if (event.type === 'error') this.onerror?.({ error: event.error });
      else if (event.type === 'end') this.finish();
      else if (event.type === 'result' && (event.final || this.interimResults)) {
        const result = [{ transcript: event.text, confidence: event.confidence }];
        result.isFinal = event.final;
        const pending = this.results.findIndex(item => !item.isFinal);
        const index = pending === -1 ? this.results.length : pending;
        this.results[index] = result;
        this.onresult?.({ resultIndex: index, results: this.results.slice() });
      }
    });
    bridge.start(id, this.lang || 'en-US').then(ok => {
      if (!ok && this.active && this.id === id) { this.onerror?.({ error: 'audio-capture' }); this.finish(); }
    }).catch(() => {
      if (this.active && this.id === id) { this.onerror?.({ error: 'audio-capture' }); this.finish(); }
    });
  }
  stop() { if (this.active) bridge.stop(this.id); }
  abort() { if (this.active) { bridge.abort(this.id); this.finish(); } }
  clearResults() { this.results = []; }
  finish() {
    if (!this.active) return;
    this.active = false; this.unsubscribe?.(); this.unsubscribe = null;
    this.clearResults();
    queueMicrotask(() => this.onend?.({}));
  }
}
export const SpeechRecognition = localSpeech
  ? WindowsRecognition
  : window.SpeechRecognition || window.webkitSpeechRecognition || null;
