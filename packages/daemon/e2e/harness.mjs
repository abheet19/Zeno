/*
 * e2e/harness.mjs — the thing that makes "tested end to end" mean something.
 *
 * Every acceptance claim about Zeno has to survive the same question: was it
 * actually executed, against a real daemon, through the real window? A
 * screenshot does not answer that. Reading the source does not answer that.
 * This harness does: it boots a daemon in a THROWAWAY workspace on its own
 * port, opens the real renderer in a real Chromium with the owner nonce, runs
 * a flow, and writes down what happened — including what failed.
 *
 * Isolation is the point. Each flow gets its own ZENO_DIR, so one flow's
 * receipts, held proposals and Vault notes cannot leak into another's
 * assertions, and nothing here can ever touch the owner's real workspace.
 * The port is derived per flow for the same reason.
 *
 * The nonce is parsed from the daemon's stdout and never written to evidence.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = resolve(HERE, '../../..');
const DAEMON_ENTRY = resolve(REPO, 'packages/daemon/dist/src/main.js');

/** Ports well clear of anything a developer or the desktop app would pick. */
const PORT_BASE = 7600;

export class Daemon {
  constructor({ port, dir, proc, url, token }) {
    Object.assign(this, { port, dir, proc, url, token });
  }

  /** Authenticated fetch as the OWNER. Returns {status, body}. */
  async api(path, init = {}) {
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-zeno-token': this.token,
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  }

  /** Authenticated fetch as an AGENT (proposer). Can ask; can approve nothing. */
  async agent(path, init = {}) {
    const { readFileSync } = await import('node:fs');
    const tok = readFileSync(join(this.dir, 'proposer.token'), 'utf8').trim();
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-zeno-token': tok, ...(init.headers || {}) },
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  }

  async stop() {
    if (!this.proc || this.proc.killed) return;
    this.proc.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Boot a daemon nobody else is using.
 *
 * It refuses to start when another Zeno owns the workspace — that guard is
 * real and load-bearing (two daemons on one ledger fork the hash chain), so
 * the temp dir is what keeps this honest rather than a flag that disables it.
 */
export async function startDaemon(flowId, index = 0) {
  const dir = mkdtempSync(join(tmpdir(), `zeno-e2e-${flowId}-`));
  const port = PORT_BASE + (index % 200);
  const proc = spawn(process.execPath, [DAEMON_ENTRY], {
    env: { ...process.env, ZENO_DIR: dir, ZENO_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  const url = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`daemon did not announce a window in 40s:\n${out}`)), 40_000);
    const onData = (chunk) => {
      out += String(chunk);
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?k=[A-Za-z0-9_-]+/);
      if (m) { clearTimeout(timer); resolvePromise(m[0]); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`daemon exited ${code} before listening:\n${out}`)); });
  });

  const token = new URL(url).searchParams.get('k') ?? '';
  return new Daemon({ port, dir, proc, url, token });
}

/**
 * A page that records everything a reviewer would want and the runner cannot
 * see otherwise: every request the renderer made, every console error, every
 * uncaught exception. A flow that "passed" while throwing in the console has
 * not passed.
 */
export async function openWindow(browser, daemon) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    // Voice flows need these to exist rather than prompt. A flow that needs a
    // REAL microphone says so and is marked BLOCKED — this only removes the
    // permission dialog, it does not fake an audio device.
    permissions: ['microphone'],
  });
  const page = await context.newPage();

  const network = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.port === String(daemon.port)) network.push(`${r.method()} ${u.pathname}`);
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message).slice(0, 300)));

  await page.goto(daemon.url, { waitUntil: 'domcontentloaded' });
  // The binders are async; wait for the signal bind.js fires when they settle.
  await page.waitForFunction(() => window.__zenoBind !== undefined, { timeout: 20_000 }).catch(() => {});

  /* Take the OWNER token from the window, the way the window itself got it.
     The `?k=` in the URL is a single-use LAUNCH NONCE, not a credential: the
     daemon trades it for an owner token and stamps that into the page. Calling
     the API with the nonce authenticates as nobody, so /state came back in its
     reduced read-only shape and flows read `undefined.length`. Reading it from
     the page also means these tests exercise exactly the credential the real
     app uses, rather than a side door built for testing. */
  const owner = await page.evaluate(() => document.querySelector('meta[name="zeno-token"]')?.content || '');
  if (owner) daemon.token = owner;

  return { context, page, network, consoleErrors, pageErrors, ownerToken: owner };
}

/** Assertion that records rather than throws, so one failure does not hide the rest. */
export function checker() {
  const checks = [];
  const ok = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 500) }); return !!pass; };
  ok.eq = (name, actual, expected) => ok(name, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  ok.checks = checks;
  ok.passed = () => checks.every((c) => c.pass);
  return ok;
}

export function evidenceDir(sha) {
  const d = resolve(REPO, 'evidence', sha, 'e2e');
  mkdirSync(d, { recursive: true });
  return d;
}

export function writeEvidence(dir, flowId, payload) {
  writeFileSync(join(dir, `${flowId}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

export function cleanup(daemon) {
  try { rmSync(daemon.dir, { recursive: true, force: true }); } catch { /* a locked temp dir is not a test failure */ }
}
