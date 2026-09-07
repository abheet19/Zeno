/**
 * The window itself — a Chromium Zeno started, and can therefore bound.
 *
 * This is the process that makes Forge's browser tools honest. `forge/src/
 * tools.ts` rates a call to an ordinary MCP server as egress because it is "a
 * process outside the worktree that Zeno neither started nor bounds"; this one
 * Zeno spawns, hands a fresh in-memory session, drives one operation at a time,
 * and kills when the run ends. That difference is the entire architectural
 * argument for embedding a browser instead of pointing at an external driver,
 * and everything below exists to make it a fact rather than a claim.
 *
 * WHAT AN AGENT-DRIVEN PAGE CAN REACH:
 *   - http(s) URLs the owner approved on a capsule, one navigation at a time,
 *     and whatever those pages themselves load (a page's own subresources).
 *   - its own DOM, via the five operations in `protocol.ts` and no others.
 *
 * WHAT IT CANNOT REACH, and why each is closed:
 *   - THE OWNER'S REAL BROWSER. Electron is not Chrome and shares nothing with
 *     it, and beyond that this process is given its own `userData` directory in
 *     the OS temp area, so it does not even share state with the Zeno desktop
 *     app. No Chrome profile, no saved passwords, no extensions.
 *   - ANY EARLIER RUN'S STATE. The session partition is named per run and has no
 *     `persist:` prefix, so Chromium keeps it in memory only: cookies, storage,
 *     caches and logins die with the run. A run starts logged into nothing.
 *   - NODE. `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
 *     no preload script, no `@electron/remote`. The page is a web page. It has
 *     no `require`, no `process`, no filesystem — the same posture, and for the
 *     same reason, as `desktop/main.cjs`.
 *   - THE LOCAL FILESYSTEM AND THE LOOPBACK DAEMON, by scheme and by origin: a
 *     request whose scheme is not http(s) is cancelled outright, so `file:` is
 *     not reachable even by redirect, by iframe or by a link the page clicks
 *     itself. A browser that could open `file:///` would be a second, ungoverned
 *     `Read` with a root the worktree jail does not cover.
 *   - THE DISK, by download. Downloads are cancelled; a page cannot write a file.
 *   - THE MICROPHONE, CAMERA, LOCATION, NOTIFICATIONS, CLIPBOARD. Every
 *     permission request is denied without asking anyone: an approval capsule
 *     said "open this URL", and a device grant is not something it authorised.
 *   - A SECOND WINDOW. `window.open` and target=_blank are denied, so there is
 *     exactly one page per run and "the page it has open" is never ambiguous.
 *
 * HOW IT IS DRIVEN, and why it is not stdio. The permission bridge speaks
 * newline-delimited JSON on stdin; this process cannot. An Electron binary on
 * Windows is a GUI-subsystem executable and its stdin ends the instant it starts
 * even when the parent handed it a pipe — found by running it rather than by
 * reading about it, and the symptom was a window that came up and quit 200ms
 * later. So it is driven over the Node IPC channel the parent opens with it
 * (`stdio: [..., 'ipc']`): structured, no parsing, and — the part that matters —
 * NO LISTENING SOCKET. Zeno's claim to have no inbound surface at all stays
 * exactly as true as it was.
 *
 * Like the other real edges in this repo it holds no logic worth unit testing:
 * every decision it makes was made in `protocol.ts`, which is pure and tested.
 */
const { app, BrowserWindow, session } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

/** Which run this window belongs to. The probe checks it comes back. */
const RUN_ID = process.argv[2] || '';

/** Ceilings for the two operations that wait on the network. */
const LOAD_TIMEOUT_MS = 30_000;
/** Kept in step with `protocol.ts`; duplicated because a .cjs cannot import the ESM build. */
const MAX_PAGE_CHARS = 20_000;
const SCREENSHOT_WIDTH = 900;

// A profile directory of this run's own, in the OS temp area. Set BEFORE the app
// is ready, which is the only time Electron accepts it.
const profile = mkdtempSync(join(tmpdir(), 'zeno-browse-'));
app.setPath('userData', profile);
app.setName('Zeno Browse');
// No GPU process on a machine that may have no display at all. A browser that
// refuses to start on a headless box would fail the liveness probe and cost the
// run its tools for a reason that has nothing to do with governance.
app.disableHardwareAcceleration();

/** @type {BrowserWindow | null} */
let win = null;

function reply(message) {
  if (process.send) process.send(message);
}

/** stderr only. Nothing this process writes to a stream is part of the protocol. */
function log(line) {
  process.stderr.write(line + '\n');
}

function createWindow() {
  // No `persist:` prefix: an in-memory partition, discarded with the process.
  const part = session.fromPartition(`zeno-browse-${RUN_ID}`);
  part.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  part.setPermissionCheckHandler(() => false);
  part.setPreloads([]);
  // Scheme jail. Cancelling here covers the page's own navigations, its
  // subresources, its redirects and its iframes — every request the session
  // makes, not merely the ones Zeno asked for.
  part.webRequest.onBeforeRequest((details, callback) => {
    let scheme = '';
    try {
      scheme = new URL(details.url).protocol;
    } catch {
      scheme = '';
    }
    callback({ cancel: scheme !== 'http:' && scheme !== 'https:' });
  });
  part.on('will-download', (event) => event.preventDefault());

  win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    title: `Zeno · agent browser · ${RUN_ID}`,
    autoHideMenuBar: true,
    backgroundColor: '#0A0C0E',
    webPreferences: {
      session: part,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  // The window title says whose it is, permanently. An owner who sees a browser
  // appear should be able to tell at a glance that Zeno started it and for which
  // run — a page is free to set its own title, so Zeno sets it back.
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:$/.test(safeScheme(url))) event.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

function safeScheme(u) {
  try {
    return new URL(u).protocol;
  } catch {
    return '';
  }
}

/** Run a promise with a ceiling, so one hung page cannot hold the run open. */
function within(ms, promise, late) {
  let timer = null;
  const ceiling = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(late)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, ceiling]).finally(() => { if (timer) clearTimeout(timer); });
}

/** Evaluate an expression in the page. The page has no Node; this is DOM only. */
async function inPage(expression) {
  return await win.webContents.executeJavaScript(expression, true);
}

async function perform(req) {
  if (win === null) return { ok: false, detail: 'the browser window is closed' };
  const op = req.op;

  if (op === 'ping') {
    // The liveness proof: the app is ready, the isolated session exists and a
    // real window was created. `title` is the run id, so a probe can tell THIS
    // run's browser from any other.
    return { ok: true, detail: 'the window Zeno started is up', title: RUN_ID };
  }

  if (op === 'navigate') {
    try {
      await within(
        LOAD_TIMEOUT_MS,
        win.webContents.loadURL(req.url),
        `the page did not load within ${LOAD_TIMEOUT_MS}ms`,
      );
    } catch (err) {
      return { ok: false, detail: `the page could not be loaded — ${String(err && err.message ? err.message : err)}` };
    }
    return { ok: true, detail: 'the page loaded', url: win.webContents.getURL(), title: await pageTitle() };
  }

  if (op === 'read') {
    const text = String(await inPage('document.body ? document.body.innerText : ""'));
    const capped = text.length > MAX_PAGE_CHARS;
    return {
      ok: true,
      detail: capped ? `the page's visible text, truncated at ${MAX_PAGE_CHARS} characters` : "the page's visible text",
      url: win.webContents.getURL(),
      title: await pageTitle(),
      text: capped ? text.slice(0, MAX_PAGE_CHARS) : text,
    };
  }

  if (op === 'click' || op === 'type') {
    const sel = JSON.stringify(req.selector);
    const found = await inPage(`!!document.querySelector(${sel})`);
    if (found !== true) return { ok: false, detail: `no element on the page matches ${req.selector}` };
    if (op === 'click') {
      await inPage(`document.querySelector(${sel}).click(), true`);
      return { ok: true, detail: `clicked ${req.selector}`, url: win.webContents.getURL(), title: await pageTitle() };
    }
    const value = JSON.stringify(req.text ?? '');
    // Set the value AND fire the events a real keystroke fires, so a framework
    // that listens for input rather than reading the DOM sees the same thing.
    await inPage(
      `(() => { const el = document.querySelector(${sel}); el.focus();` +
        ` if ('value' in el) { el.value = ${value}; } else { el.textContent = ${value}; }` +
        ` el.dispatchEvent(new Event('input', { bubbles: true }));` +
        ` el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    return { ok: true, detail: `typed into ${req.selector}`, url: win.webContents.getURL(), title: await pageTitle() };
  }

  if (op === 'screenshot') {
    const image = await win.webContents.capturePage();
    const scaled = image.getSize().width > SCREENSHOT_WIDTH ? image.resize({ width: SCREENSHOT_WIDTH }) : image;
    return {
      ok: true,
      detail: 'a picture of the page as it stands',
      url: win.webContents.getURL(),
      title: await pageTitle(),
      png: scaled.toPNG().toString('base64'),
    };
  }

  return { ok: false, detail: `"${String(op)}" is not an operation this window has` };
}

async function pageTitle() {
  try {
    return String(await inPage('document.title || ""'));
  } catch {
    return '';
  }
}

function listen() {
  // Serialized: one operation at a time, so "the page it has open" means one
  // thing and two approvals can never race each other on the same window.
  let tail = Promise.resolve();
  process.on('message', (req) => {
    if (req === null || typeof req !== 'object') return;
    tail = tail
      .then(() => perform(req))
      .then((out) => reply({ id: req.id, ...out }))
      .catch((err) => reply({ id: req.id, ok: false, detail: `the browser failed — ${String(err && err.message ? err.message : err)}` }));
  });
  // The parent going away takes the window with it. A browser outliving the run
  // that opened it would be a page left open, possibly logged in, with nothing
  // left to account for what it did.
  process.on('disconnect', () => app.quit());
}

app.whenReady().then(() => {
  createWindow();
  listen();
  log(`zeno-browse · run ${RUN_ID} · a window Zeno started. Fresh session, no profile, http(s) only.`);
});

// One window, one run. Closing it ends the subsystem rather than leaving a
// process behind that a later run might be handed by accident.
app.on('window-all-closed', () => app.quit());
app.on('quit', () => {
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* best effort — it is a temp directory */
  }
});
