'use strict';
const { spawn } = require('node:child_process');
const { join } = require('node:path');

/** One speech process per desktop, never a shell accepting renderer code. */
function installSpeech(ipcMain, getWindow, origin, scriptPath, spawnProcess = spawn, platform = process.platform) {
  let active = null;
  function trusted(event) {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
    try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
  }
  function finish(session) {
    if (session.ended) return;
    session.ended = true;
    clearTimeout(session.startTimer);
    clearTimeout(session.stopTimer);
    session.sender.removeListener('did-start-navigation', session.onNavigation);
    session.sender.removeListener('render-process-gone', session.onGone);
    session.sender.removeListener('destroyed', session.onGone);
    if (active === session) active = null;
    if (session.valid && trusted({ sender: session.sender, senderFrame: session.frame })) session.sender.send('zeno:speech:event', { id: session.id, type: 'end' });
    session.resolveClosed();
  }
  function stop(session, graceful) {
    if (!session || session.ended) return Promise.resolve();
    if (session.stopping) return session.closed;
    session.stopping = true;
    if (graceful) {
      session.child.stdin.write('stop\n');
      session.stopTimer = setTimeout(() => session.child.kill(), 1500);
    } else {
      session.child.kill();
    }
    return session.closed;
  }
  ipcMain.handle('zeno:speech:start', async (event, request) => {
    if (!trusted(event) || platform !== 'win32') return false;
    if (!request || !Number.isSafeInteger(request.id) || request.id < 1 || typeof request.lang !== 'string' || !/^[a-z]{2,3}-[A-Z]{2}$/.test(request.lang)) return false;
    // A second surface cannot steal an active microphone or queue a capture
    // that might start after its user has already pressed Stop.
    if (active) return false;
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawnProcess(executable, ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-Language', request.lang], {
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session = { id: request.id, child, sender: event.sender, frame: event.senderFrame, valid: true, ended: false, stopping: false, buffer: '', startTimer: null, stopTimer: null };
    session.closed = new Promise(resolve => { session.resolveClosed = resolve; });
    session.onNavigation = () => { session.valid = false; void stop(session, false); };
    session.onGone = session.onNavigation;
    session.sender.on('did-start-navigation', session.onNavigation);
    session.sender.on('render-process-gone', session.onGone);
    session.sender.on('destroyed', session.onGone);
    active = session;
    function send(value) {
      if (!session.ended && session.valid && trusted({ sender: session.sender, senderFrame: session.frame })) session.sender.send('zeno:speech:event', { ...value, id: session.id });
    }
    session.startTimer = setTimeout(() => {
      send({ type: 'error', error: 'audio-capture' }); stop(session, false);
    }, 10000);
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      session.buffer += chunk;
      if (session.buffer.length > 65536) { send({ type: 'error', error: 'audio-capture' }); stop(session, false); return; }
      let newline;
      while ((newline = session.buffer.indexOf('\n')) >= 0) {
        const line = session.buffer.slice(0, newline); session.buffer = session.buffer.slice(newline + 1);
        let value; try { value = JSON.parse(line); } catch { continue; }
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
        if (value.type === 'start') { clearTimeout(session.startTimer); send({ type: 'start' }); }
        else if (value.type === 'result' && typeof value.text === 'string') send({ type: 'result', text: value.text.slice(0, 16000), final: value.final === true, confidence: Number(value.confidence) || 0 });
        else if (value.type === 'error') send({ type: 'error', error: 'audio-capture' });
        else if (value.type === 'end') {
          clearTimeout(session.startTimer);
          if (!session.stopTimer) session.stopTimer = setTimeout(() => child.kill(), 1500);
        }
      }
    });
    // Diagnostics are not transcripts and are not sent to the renderer or logged.
    child.stderr.resume();
    child.on('error', () => { send({ type: 'error', error: 'audio-capture' }); finish(session); });
    child.on('close', code => { if (code && !session.ended && !session.stopping) send({ type: 'error', error: 'audio-capture' }); finish(session); });
    return true;
  });
  for (const [channel, graceful] of [['zeno:speech:stop', true], ['zeno:speech:abort', false]]) {
    ipcMain.on(channel, (event, id) => { if (trusted(event) && active?.id === id) stop(active, graceful); });
  }
  ipcMain.handle('zeno:speech:idle', async (event) => {
    if (!trusted(event)) return false;
    if (active) await active.closed;
    return true;
  });
  return () => stop(active, false);
}
module.exports = { installSpeech };
