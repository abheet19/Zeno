/*
 * e2e/run.mjs — execute flow files against real isolated daemons.
 *
 *   node packages/daemon/e2e/run.mjs              # every flow
 *   node packages/daemon/e2e/run.mjs governed-loop voice
 *
 * Each flow exports { id, title, criteria, run({daemon, page, ok, ...}) }.
 * A flow that cannot run because the environment lacks a prerequisite must
 * throw a Blocked(reason) — it is then reported BLOCKED with the exact thing
 * that is missing, never as a pass and never as a silent skip.
 */

import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { startDaemon, openWindow, checker, evidenceDir, writeEvidence, cleanup, REPO } from './harness.mjs';

export class Blocked extends Error {
  constructor(prerequisite) { super(prerequisite); this.name = 'Blocked'; this.prerequisite = prerequisite; }
}

const FLOW_DIR = fileURLToPath(new URL('./flows/', import.meta.url));

function sha() {
  try { return execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim(); }
  catch { return 'unstamped'; }
}

async function main() {
  const want = process.argv.slice(2);
  const files = readdirSync(FLOW_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const flows = [];
  for (const f of files) {
    // A Windows absolute path is not a valid ESM specifier — it must be a file:// URL.
    const mod = await import(pathToFileURL(resolve(FLOW_DIR, f)).href);
    if (!mod.id || typeof mod.run !== 'function') continue;
    if (want.length && !want.includes(mod.id)) continue;
    flows.push(mod);
  }
  if (!flows.length) { console.log('no flows matched'); process.exit(1); }

  const dir = evidenceDir(sha());
  const browser = await chromium.launch();
  const summary = [];

  for (const [i, flow] of flows.entries()) {
    const started = Date.now();
    let daemon = null; let win = null; let status = 'FAIL'; let error = null;
    const ok = checker();
    try {
      daemon = await startDaemon(flow.id, i);
      win = await openWindow(browser, daemon);
      // A window that never received an owner token cannot approve anything, so
      // every flow below it would fail for one misleading reason. Say it once.
      ok('the window holds an owner token', !!win.ownerToken, 'the page was served without a zeno-token meta');
      await flow.run({ daemon, page: win.page, ok, network: win.network, Blocked });
      status = ok.passed() ? 'PASS' : 'FAIL';
    } catch (err) {
      if (err && err.name === 'Blocked') { status = 'BLOCKED'; error = err.prerequisite; }
      else { status = 'FAIL'; error = String((err && err.stack) || err).slice(0, 1500); }
    }

    // A flow that throws in the console has not passed, whatever it asserted.
    const consoleErrors = win ? win.consoleErrors : [];
    const pageErrors = win ? win.pageErrors : [];
    if (status === 'PASS' && pageErrors.length) { status = 'FAIL'; error = `uncaught page errors: ${pageErrors.join(' | ')}`; }

    const record = {
      id: flow.id,
      title: flow.title,
      criteria: flow.criteria || [],
      status,
      error,
      durationMs: Date.now() - started,
      checks: ok.checks,
      network: win ? [...new Set(win.network)] : [],
      consoleErrors,
      pageErrors,
      at: new Date().toISOString(),
      commit: sha(),
    };
    writeEvidence(dir, flow.id, record);
    summary.push(record);

    const mark = status === 'PASS' ? 'PASS ' : status === 'BLOCKED' ? 'BLOCK' : 'FAIL ';
    console.log(`${mark} ${flow.id.padEnd(26)} ${ok.checks.filter((c) => c.pass).length}/${ok.checks.length} checks  ${record.durationMs}ms`);
    for (const c of ok.checks) if (!c.pass) console.log(`        x ${c.name} — ${c.detail}`);
    if (error) console.log(`        ! ${String(error).split('\n')[0]}`);

    if (win) await win.context.close();
    if (daemon) { await daemon.stop(); cleanup(daemon); }
  }

  await browser.close();
  const pass = summary.filter((s) => s.status === 'PASS').length;
  const blocked = summary.filter((s) => s.status === 'BLOCKED').length;
  const fail = summary.filter((s) => s.status === 'FAIL').length;
  console.log(`\n${pass} passed · ${fail} failed · ${blocked} blocked   evidence: ${dir}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
