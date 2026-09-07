#!/usr/bin/env node
/**
 * `com.zeno.chrome_bridge` — the native-messaging host Chrome spawns.
 *
 * WHAT THIS PROCESS IS. Chrome starts it when the Zeno extension calls
 * `chrome.runtime.connectNative`, keeps it alive for the life of that port, and
 * kills it when the port closes. Zeno never spawns it and cannot: that is the
 * whole shape of native messaging, and it is why the transport in `desk.ts` is
 * inverted — this process reaches OUT to the daemon and asks for work.
 *
 * IT OPENS NO LISTENING PORT, and the README's "no inbound surface at all"
 * depends on that being true here rather than merely intended. Two connections
 * exist and both are ones this process makes or inherits:
 *
 *   · stdin/stdout, held by Chrome. Chrome's framing: a 4-byte little-endian
 *     length followed by that many bytes of UTF-8 JSON.
 *   · an outbound HTTP long-poll to the loopback address the daemon ALREADY
 *     binds for its own window. A client connection. No `listen` anywhere.
 *
 * ON STDIO, AND THE FAILURE THAT KILLED IT ONCE BEFORE. `browse/src/host-node.ts`
 * records that a newline-JSON protocol over stdin silently did not work for the
 * embedded window: an Electron binary on Windows is a GUI-subsystem executable
 * whose stdin ends the instant it starts, so the window came up and quit. It was
 * fixed there with Node IPC. That failure does NOT transfer here and it was
 * checked rather than assumed — this is a plain `node` console process, Chrome
 * holds its stdin open for the life of the port, and framed stdio is the only
 * transport Chrome offers a native host at all. If stdin closes, the port is
 * gone and so is the reason for this process to exist, so it exits.
 *
 * IT DECIDES NOTHING. It carries an operation the daemon has already put through
 * the kernel — classified, previewed, read by the owner on a capsule naming the
 * origin and the profile, approved once, receipted — and it carries the answer
 * back. It holds a token that opens exactly two routes and can approve nothing.
 *
 * IT FAILS CLOSED. A daemon that is not there, a config it cannot read, a body
 * it cannot parse: every one of them ends in nothing happening.
 */
'use strict';
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/** stderr only — stdout is Chrome's framed pipe and must carry nothing else. */
function log(line) {
  process.stderr.write('zeno-chrome-host · ' + line + '\n');
}

/** Where the daemon is and what credential opens its two Chrome routes. */
function config() {
  // `host-config.json` sits beside this file and is written by
  // `install/register-host.mjs` when the OWNER registers the host. It names the
  // workspace and nothing else — the live credential is in the workspace, whose
  // permissions the owner already relies on for `proposer.token`.
  let workspace;
  try {
    workspace = JSON.parse(readFileSync(join(__dirname, 'host-config.json'), 'utf8')).workspace;
  } catch {
    log('no host-config.json beside me — run install/register-host.mjs. Nothing will be relayed.');
    return null;
  }
  try {
    const doc = JSON.parse(readFileSync(join(workspace, 'chrome-host.json'), 'utf8'));
    if (typeof doc.url !== 'string' || typeof doc.token !== 'string' || doc.url === '' || doc.token === '') return null;
    return { url: doc.url.replace(/\/+$/, ''), token: doc.token };
  } catch {
    log('Zeno is not running, or its workspace holds no chrome-host.json. Nothing will be relayed.');
    return null;
  }
}

// ---- Chrome's framing ------------------------------------------------------

function writeToChrome(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

let buffered = Buffer.alloc(0);
/** Pull whole messages out of the stream. A partial frame is left for the next chunk. */
function readFrames(chunk, onMessage) {
  buffered = Buffer.concat([buffered, chunk]);
  for (;;) {
    if (buffered.length < 4) return;
    const size = buffered.readUInt32LE(0);
    if (buffered.length < 4 + size) return;
    const body = buffered.subarray(4, 4 + size);
    buffered = buffered.subarray(4 + size);
    try {
      onMessage(JSON.parse(body.toString('utf8')));
    } catch {
      log('a message from the extension could not be parsed. Ignored.');
    }
  }
}

// ---- the relay -------------------------------------------------------------

/** The operation currently out with the extension, so a stray answer is not believed. */
let inFlight = null;

async function post(cfg, path, body) {
  const res = await fetch(cfg.url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zeno-chrome': cfg.token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

async function loop() {
  for (;;) {
    const cfg = config();
    if (cfg === null) {
      // Zeno is not up. Wait and look again — the owner's browser outlives the
      // daemon, and a host that gave up would need the extension reloaded.
      await new Promise((ok) => setTimeout(ok, 5_000));
      continue;
    }
    let answer;
    try {
      answer = await post(cfg, '/chrome/attach', {});
    } catch {
      await new Promise((ok) => setTimeout(ok, 3_000));
      continue;
    }
    const request = answer && answer.request;
    if (!request || typeof request.id !== 'number') continue;
    inFlight = request.id;
    writeToChrome(request);
  }
}

function main() {
  process.stdin.on('data', (chunk) => {
    readFrames(chunk, (msg) => {
      // Only ever an ANSWER to something this host handed over. The extension
      // cannot originate work: there is no shape of message here that reaches
      // the daemon without an outstanding request the daemon itself created.
      if (typeof msg?.id !== 'number' || msg.id !== inFlight) return;
      inFlight = null;
      const cfg = config();
      if (cfg === null) return;
      post(cfg, '/chrome/result', msg).catch(() => log('the answer could not be delivered; the operation will time out.'));
    });
  });
  // Chrome closed the port: the extension is gone, unloaded or disabled. There
  // is nothing left for this process to relay.
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('error', () => process.exit(0));
  loop().catch((err) => {
    log('the relay stopped — ' + err.message);
    process.exit(1);
  });
}

main();
