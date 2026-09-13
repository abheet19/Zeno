/*
 * run-progress-stream.js — ONE owner-only EventSource to /forge/run-progress,
 * fanned out to every consumer.
 *
 * Three surfaces watch the same run milestones: the Forge session's live
 * progress line (bind/forge-progress.js), Command's orchestrator panel
 * (bind/orchestrator.js), and the Standing Field's run nodes (field/runs.js).
 * Each used to open its OWN EventSource to the same URL. Three long-lived
 * HTTP/1.1 connections to one endpoint, plus bind/live.js's /stream, is four of
 * a browser's ~6-per-origin socket budget spent before a single fetch — so a
 * second window (Settings opened in its own window, a detached panel) had no
 * sockets left and every fetch-on-boot binder hung forever waiting for one.
 *
 * One stream, many subscribers. Each subscriber receives every parsed event and
 * decides what to do with it; the connection, its reconnect/backoff, and the
 * re-open on tab focus live here exactly once.
 */
import { token } from './bind.js';

const subscribers = new Set();
let source = null;
let backoff = 1000;
let wired = false;

function emit(ev) {
  // Every consumer keys on runId; an event without one names no run.
  if (!ev || typeof ev !== 'object' || !ev.runId) return;
  for (const cb of subscribers) {
    try { cb(ev); } catch { /* one bad subscriber must not silence the rest */ }
  }
}

function connect() {
  if (!token()) return; // a read-only page cannot run anything, so it has nothing to show
  if (source) return; // already connected — every subscriber shares this one stream
  try {
    source = new EventSource('/forge/run-progress');
  } catch {
    source = null;
    return; // no EventSource here: subscribers simply receive nothing, honestly
  }
  source.addEventListener('run-progress', (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    emit(ev);
  });
  // Some servers emit the default event type; accept both rather than miss one.
  source.addEventListener('message', (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev && ev.phase) emit(ev);
  });
  source.addEventListener('open', () => { backoff = 1000; });
  source.addEventListener('error', () => {
    if (!source || source.readyState !== 2 /* CLOSED */) return; // EventSource retries transient drops itself
    source = null;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  });
}

/**
 * Subscribe to the shared run-progress stream. Opens the single connection on
 * the first subscriber and returns an unsubscribe function. Safe to call any
 * number of times — a second call never opens a second socket.
 */
export function subscribeRunProgress(cb) {
  if (typeof cb === 'function') subscribers.add(cb);
  if (!wired) {
    wired = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !source) connect();
    });
  }
  connect();
  return () => { subscribers.delete(cb); };
}
