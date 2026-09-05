/**
 * Zeno Mesh — the Devices panel on the Command surface.
 * =====================================================
 * A small ES module that fills <div data-mount="devices"> inside Command. It is
 * not a fourth product and not a fourth nav item: Command, Forge and Counsel are
 * the three, and devices are part of the control plane.
 *
 * WHAT IS TRUE, AND WHAT THIS PANEL THEREFORE SAYS
 *
 *   Zeno Mesh — the protocol that pairs a second device to this PC and keeps a
 *   little state converged between them — is BUILT and TESTED on this side:
 *   X25519 identities whose id is a hash of the public key, a short code the
 *   owner carries by hand, a verification string both screens show for the eye
 *   to compare, AES-256-GCM sealed envelopes with a replay window, and a
 *   last-writer-wins log that converges over a lossy, reordering wire.
 *
 *   The PHONE CLIENT DOES NOT EXIST. Nothing has ever paired with this machine
 *   and nothing can until that app is built. So this panel:
 *
 *     · shows exactly one device — this PC — and never invents another;
 *     · will start a REAL pairing (a real invite, a real short code) and then
 *       says plainly, in the same breath, that no device can answer it;
 *     · shows an empty paired list as "none are possible yet", never as a
 *       device that dropped off;
 *     · never renders sync activity, a last-synced time, or a phone.
 *
 *   The one demonstration it offers is honest about being one: a self-check that
 *   runs the real handshake against a peer SIMULATED inside the daemon, to show
 *   that both sides derive the same verification string and that a wrong code
 *   derives a different one. It pairs nothing and stores nothing, and the panel
 *   says so on the result itself.
 *
 * THE ROUTES (all authenticated; the page sends the meta-tag owner token and the
 * owner cookie from an authorised launch):
 *
 *   GET  /mesh/devices        -> { thisDevice, paired, pairing|null, phoneClient }
 *   POST /mesh/pairing        -> { pairing }            (owner-only; 409 if one is open)
 *   POST /mesh/pairing/cancel -> { cancelled, pairing:null }   (owner-only)
 *   POST /mesh/selfcheck      -> { selfCheck }                 (owner-only)
 *
 * DESIGN. Devices is Command content, so it is OPAQUE graphite — no glass, which
 * is nav-adjacent chrome only. Status is glyph + label + fill, never colour
 * alone. A control that cannot act is disabled WITH its reason. Every colour is
 * a token from /glass/tokens.css; the literals are the approved palette used as
 * var() fallbacks. Nothing loops, nothing animates.
 *
 * No framework, no bundler, no CDN, no build step, and no network call that
 * leaves this machine. Plain DOM APIs, textContent only.
 */

/* ================================================================== *
 * 0 · tiny DOM helpers and the owner token                            *
 * ================================================================== */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}

/** The owner token the daemon injected into the shell, or '' on a read-only page. */
const OWNER_TOKEN = (() => {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' && v.trim() ? v.trim() : '';
})();

function authHeaders(extra) {
  const h = Object.assign({ accept: 'application/json' }, extra || {});
  if (OWNER_TOKEN) h['x-zeno-token'] = OWNER_TOKEN;
  return h;
}

/** One shape for every daemon call, same as Forge's. Returns {ok,status,data,error}. */
async function api(path, init) {
  const opts = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init || {});
  opts.headers = authHeaders(opts.headers);
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    return { ok: false, status: 0, data: null, error: { message: (err && err.message) || 'network error' } };
  }
  const data = await res.json().catch(() => null);
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: !res.ok ? (data && data.error) || { message: `The daemon answered ${res.status}.` } : null,
  };
}

/** A long hex key, shown in readable groups without changing what it is. */
function groupHex(hex, size = 8) {
  const s = String(hex ?? '');
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.join(' ');
}

function fmtWhen(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso ?? '');
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ================================================================== *
 * 1 · this panel's styles — tokens only, approved palette as fallback *
 * ================================================================== */

const STYLE_ID = 'zeno-mesh-styles';

const CSS = `
.zm-root{ display:flex; flex-direction:column; gap:16px; }
/* Every block here is spaced by its container's gap, so the UA's paragraph
   margins are removed rather than fought with. Scoped to this panel's own
   classes so the shell's .empty-title/.empty-sub keep their own spacing. */
.zm-nm, .zm-meta, .zm-sub, .zm-k, .zm-note, .zm-digits, .zm-why{ margin:0; }

/* ---- a device row: mark, name, the facts, and what it may do -------------- */
.zm-dev{
  display:flex; gap:12px; align-items:flex-start;
  padding:12px 13px; border:1px solid var(--rule,#242C31); border-radius:var(--r-1,6px);
  background:var(--g3,#151A1D);
}
.zm-mark{
  flex:none; padding:3px 6px; border-radius:4px;
  border:1px solid var(--rule-2,#2C363B); background:var(--g4,#1B2124);
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10px; letter-spacing:.08em; color:var(--ink-2,#9AA1AC);
}
.zm-devbody{ min-width:0; display:flex; flex-direction:column; gap:3px; }
.zm-nm{ font-size:13px; font-weight:600; color:var(--ink,#ECEBE6); }
.zm-meta{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10.5px; line-height:1.55; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere;
}
.zm-sub{ font-size:12px; line-height:1.55; color:var(--ink-2,#9AA1AC); max-width:64ch; overflow-wrap:anywhere; }

/* ---- section headings inside the panel ----------------------------------- */
.zm-k{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-2,#9AA1AC);
}

/* ---- buttons: the shell's graphite, cyan for the one primary act ---------- */
.zm-acts{ display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; }
.zm-btn{
  font:inherit; font-size:12.5px; font-weight:600; cursor:pointer;
  display:inline-flex; align-items:center; gap:8px;
  min-height:var(--target-min,24px);
  padding:9px 15px; border-radius:var(--r-1,6px);
  border:1px solid var(--rule-2,#2C363B); background:var(--g4,#1B2124); color:var(--ink,#ECEBE6);
}
.zm-btn:hover:not(:disabled){ background:var(--g5,#222A2E); }
.zm-btn[data-kind="primary"]{ background:var(--cyan,#38C3D6); color:var(--g1,#0A0C0E); border-color:transparent; }
.zm-btn[data-kind="primary"]:hover:not(:disabled){ background:color-mix(in srgb, var(--cyan,#38C3D6) 88%, var(--ink,#ECEBE6)); }
.zm-btn:disabled{ cursor:not-allowed; color:var(--ink-2,#9AA1AC); background:var(--g3,#151A1D); border-style:dashed; }
.zm-gly{ font-family:var(--font-glyph,"Segoe UI Symbol"),sans-serif; line-height:1; }
/* A disabled control's reason is the most consequential sentence on the row. */
.zm-why{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10.5px; line-height:1.5; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere;
}

/* ---- the code plane: fully opaque --g1, the way payloads are drawn -------- */
.zm-plane{
  background:var(--g1,#0A0C0E); border:1px solid var(--rule-2,#2C363B);
  border-radius:var(--r-1,6px); padding:13px 14px;
  display:flex; flex-direction:column; gap:8px;
}
.zm-digits{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:29px; line-height:1.2; letter-spacing:.20em;
  font-variant-numeric:tabular-nums; color:var(--ink,#ECEBE6);
  overflow-wrap:anywhere;
}
.zm-kv{ display:flex; flex-wrap:wrap; gap:4px 10px; }
.zm-kv .zm-k{ min-width:74px; }

/* ---- notes. Amber warns; cyan states a plain fact; neither is a success. -- */
.zm-note{
  display:flex; gap:8px; align-items:flex-start;
  padding:9px 11px; border-radius:var(--r-1,6px);
  border:1px solid color-mix(in srgb, var(--amber,#E0A128) 46%, var(--rule-2,#2C363B));
  background:color-mix(in srgb, var(--amber,#E0A128) 11%, var(--g2,#0F1214));
  font-size:12px; line-height:1.55; color:var(--ink,#ECEBE6); overflow-wrap:anywhere;
}
.zm-note[data-ch="cyan"]{
  border-color:color-mix(in srgb, var(--cyan,#38C3D6) 40%, var(--rule-2,#2C363B));
  background:color-mix(in srgb, var(--cyan,#38C3D6) 8%, var(--g2,#0F1214));
}
.zm-note[data-ch="plain"]{ border-color:var(--rule,#242C31); background:var(--g3,#151A1D); color:var(--ink-2,#9AA1AC); }
.zm-note-gly{ flex:none; line-height:1.55; color:var(--amber,#E0A128); font-family:var(--font-glyph,"Segoe UI Symbol"),sans-serif; }
.zm-note[data-ch="cyan"] .zm-note-gly{ color:var(--cyan,#38C3D6); }
.zm-note[data-ch="plain"] .zm-note-gly{ color:var(--ink-3,#6C7480); }

.zm-block{ display:flex; flex-direction:column; gap:9px; }
.zm-rule{ height:1px; background:var(--rule,#242C31); border:0; margin:2px 0; }
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ================================================================== *
 * 2 · the words. Every honest sentence this panel can say lives here, *
 *     in one place, so none of them can drift apart.                  *
 * ================================================================== */

const WORDS = {
  /* The standing truth, always on screen. */
  standing:
    'Zeno Mesh is the paired-device protocol. Its core is built and tested on this side: X25519 ' +
    'identities, a short code you carry by hand, a verification code both screens show for you to ' +
    'compare by eye, sealed messages with a replay window, and a log that converges. Two things do ' +
    'NOT exist yet: the Zeno phone client that would be the other end, and any transport to carry ' +
    'bytes to it. So this PC is the only device there is — nothing here stands in for a phone that ' +
    'is connected, and nothing is syncing.',

  /* The paired list, which is empty and will stay empty. */
  emptyTitle: 'No paired devices — and none are possible yet.',
  emptySub:
    'Pairing takes a second device running the Zeno phone client, and that client is not built. ' +
    'This list is empty because there is nothing to pair with, not because a device dropped off.',

  /* The one that matters most: a real pairing, with no possible other end. */
  noPhoneYet:
    'No second device can complete this pairing. The Zeno phone client is not built, so there is ' +
    'nothing on the other end to receive this invite or type this code in. The invite and the code ' +
    'above are real — the pairing is genuinely open on this side and will stay open until you ' +
    'cancel it — but it will not be answered, nothing is connected, and no data has left this machine.',

  codeLabel: 'Pairing code',
  codeHelp:
    'You read this to the other device and it is typed in there. It is folded into the key, so a ' +
    'device given the wrong code derives a different key and simply cannot talk — the failure is ' +
    'silent and total, not a warning anyone can click through.',

  sasPending:
    'The verification code the two screens compare by eye does not exist yet. It is derived from ' +
    'both devices’ keys, so it can only appear after the other device answers — which nothing can ' +
    'do until the phone client is built. The self-check below is where you can see one for real.',

  selfCheckSub:
    'Run the real handshake against a second device SIMULATED inside the daemon. It proves the ' +
    'protocol converges — both sides derive the same verification code, and a peer given the wrong ' +
    'code derives a different one. It is not a device: it pairs nothing and stores nothing.',
};

/* ================================================================== *
 * 3 · state                                                           *
 * ================================================================== */

const mount = document.querySelector('[data-mount="devices"]');

let devices = null; // the last good GET /mesh/devices body
let loadError = null; // why the read failed, if it did
let actionNote = null; // { text, channel } — the outcome of the last click
let selfCheck = null; // the last self-check result
let busy = false;

/* ================================================================== *
 * 4 · rendering                                                       *
 * ================================================================== */

function note(text, channel) {
  const n = el('p', 'zm-note', null);
  n.setAttribute('data-ch', channel || 'amber');
  const gly = el('span', 'zm-note-gly', channel === 'cyan' ? '◈' : channel === 'plain' ? '·' : '⚠');
  gly.setAttribute('aria-hidden', 'true');
  return add(n, gly, el('span', null, text));
}

function kv(label, value) {
  const row = el('div', 'zm-kv');
  add(row, el('span', 'zm-k', label), el('span', 'zm-meta', value));
  return row;
}

function button(label, glyph, kind, onClick, disabledWhy) {
  const b = el('button', 'zm-btn');
  b.type = 'button';
  if (kind) b.setAttribute('data-kind', kind);
  const gly = el('span', 'zm-gly', glyph);
  gly.setAttribute('aria-hidden', 'true');
  add(b, gly, el('span', null, label));
  if (disabledWhy) {
    b.disabled = true;
    b.title = disabledWhy;
  } else {
    b.addEventListener('click', onClick);
  }
  if (busy) b.disabled = true;
  return b;
}

/** This PC, drawn from what the daemon actually reports about its identity. */
function thisDeviceRow(d) {
  const row = el('div', 'zm-dev');
  const body = el('div', 'zm-devbody');
  add(
    body,
    el('p', 'zm-nm', d.host ? `${d.label} · ${d.host}` : d.label),
    el('p', 'zm-meta', `device ${d.deviceId}`),
    el('p', 'zm-meta', `X25519 key ${groupHex(d.publicKey)}`),
    el(
      'p',
      'zm-sub',
      d.identityPersisted
        ? 'The only device on this mesh. Its id is derived from its public key, so it is a commitment to that key rather than a name anything can claim.'
        : 'The only device on this mesh. Its id is derived from its public key — a commitment to that key, not a name anything can claim. The private key is held in memory and never written to disk, so this id is minted fresh every time Zeno starts.',
    ),
  );
  return add(row, el('span', 'zm-mark', 'PC'), body);
}

/** The open pairing: a real code, and the reason it cannot be answered. */
function pairingBlock(p) {
  const wrap = el('div', 'zm-block');
  const plane = el('div', 'zm-plane');
  const code = el('p', 'zm-digits', p.code);
  code.setAttribute('aria-label', `Pairing code ${String(p.code).split('').join(' ')}`);
  add(
    plane,
    el('p', 'zm-k', WORDS.codeLabel),
    code,
    el('p', 'zm-sub', WORDS.codeHelp),
    el('hr', 'zm-rule'),
    el('p', 'zm-k', 'invite · what the other device would receive'),
    kv('device', p.invite.deviceId),
    kv('key', groupHex(p.invite.publicKey)),
    el('p', 'zm-meta', `started ${fmtWhen(p.startedAt)}`),
  );
  add(
    wrap,
    plane,
    // THE sentence. It sits directly under the code, never further away.
    note(WORDS.noPhoneYet, 'amber'),
    note(WORDS.sasPending, 'plain'),
  );
  return wrap;
}

function selfCheckBlock() {
  const wrap = el('div', 'zm-block');
  add(wrap, el('p', 'zm-k', 'protocol self-check'), el('p', 'zm-sub', WORDS.selfCheckSub));

  const acts = el('div', 'zm-acts');
  add(
    acts,
    button(
      'Run the handshake against a simulated peer',
      '◇',
      null,
      runSelfCheck,
      OWNER_TOKEN ? null : 'This page holds no owner token, so it cannot run the self-check.',
    ),
  );
  if (!OWNER_TOKEN) add(acts, el('span', 'zm-why', 'Opened without the launch link — read-only.'));
  add(wrap, acts);

  if (selfCheck) {
    const plane = el('div', 'zm-plane');
    const sas = el('p', 'zm-digits', selfCheck.sas);
    sas.setAttribute('aria-label', `Verification code ${String(selfCheck.sas).split('').join(' ')}`);
    add(
      plane,
      el('p', 'zm-k', 'verification code — derived by BOTH sides'),
      sas,
      kv('this machine', selfCheck.localDeviceId),
      kv('simulated peer', selfCheck.simulatedPeerDeviceId),
      kv('both agree', selfCheck.sasMatch ? 'yes — the handshake converged' : 'NO — the handshake did not converge'),
      kv(
        'wrong code',
        selfCheck.wrongCodeDiverges
          ? 'derives a different code, as designed'
          : 'DID NOT diverge — that would be a real fault',
      ),
    );
    add(wrap, plane, note(selfCheck.note, 'cyan'));
  }
  return wrap;
}

function panel() {
  const section = el('section', 'plane');
  section.setAttribute('aria-labelledby', 'devices-h');

  const head = el('div', 'plane-head');
  const h = el('h2', 'plane-h', 'Devices');
  h.id = 'devices-h';
  add(head, h, el('p', 'plane-sub', 'Trust is per-device and earned, never assumed.'));

  const body = el('div', 'plane-body');
  const root = el('div', 'zm-root');

  if (loadError) {
    add(
      root,
      note(
        `Could not read the device list: ${loadError.message}${loadError.resolve ? ' ' + loadError.resolve : ''}`,
        'amber',
      ),
      el(
        'p',
        'zm-sub',
        'Treat this as unknown, not as empty — this panel has not heard from the daemon, so it cannot tell you which devices exist.',
      ),
    );
    return add(section, head, add(body, root));
  }

  add(root, thisDeviceRow(devices.thisDevice));

  // The paired list. Empty, and the reason is on the page — never left to be
  // read as a device that went away.
  const empty = el('div', 'empty');
  const emptyBody = el('div');
  add(emptyBody, el('p', 'empty-title', WORDS.emptyTitle), el('p', 'empty-sub', WORDS.emptySub));
  const eg = el('span', 'empty-glyph', '○');
  eg.setAttribute('aria-hidden', 'true');
  if (devices.paired.length === 0) {
    add(root, add(empty, eg, emptyBody));
  } else {
    // Unreachable today. If it is ever reached, it is because something really
    // did pair — so it is drawn from the store, never invented.
    const list = el('div', 'zm-block');
    for (const id of devices.paired) {
      const row = el('div', 'zm-dev');
      const b = el('div', 'zm-devbody');
      add(b, el('p', 'zm-nm', 'Paired device'), el('p', 'zm-meta', `device ${id}`));
      add(list, add(row, el('span', 'zm-mark', 'DEV'), b));
    }
    add(root, list);
  }

  // Pairing: start it, or show the open one with the reason it cannot finish.
  const acts = el('div', 'zm-acts');
  if (devices.pairing) {
    add(
      acts,
      button('Cancel pairing', '✕', null, cancelPairing, OWNER_TOKEN ? null : 'This page holds no owner token.'),
    );
  } else {
    add(
      acts,
      button(
        'Start pairing',
        '◇',
        'primary',
        startPairing,
        OWNER_TOKEN ? null : 'This page holds no owner token, so it cannot start a pairing.',
      ),
    );
  }
  if (!OWNER_TOKEN) {
    add(
      acts,
      el('span', 'zm-why', 'Opened without the launch link, so this window is read-only and cannot pair.'),
    );
  }
  add(root, acts);

  if (devices.pairing) add(root, pairingBlock(devices.pairing));
  if (actionNote) add(root, note(actionNote.text, actionNote.channel));

  add(root, el('hr', 'zm-rule'), selfCheckBlock(), el('hr', 'zm-rule'), note(WORDS.standing, 'plain'));

  return add(section, head, add(body, root));
}

function paint() {
  if (!mount) return;
  ensureStyles();
  mount.replaceChildren(panel());
  paintRailCount();
}

/**
 * The rail's Devices badge.
 *
 * It lives in Command's rail, but it belongs to this module: this is the only
 * code on the page that reads GET /mesh/devices, and a count must be written by
 * whatever performed the read that produced it. field.js used to print a literal
 * 1 here without reading the route at all — true on a machine with no pairings
 * and a lie on the first machine that has one.
 *
 * Until the route answers, the badge stays BLANK rather than showing a number.
 * An empty badge says "not counted"; a "1" would claim a device was seen.
 */
function paintRailCount() {
  const e = document.querySelector('[data-mount="rail-devices"]');
  if (!e) return;
  if (!devices || !devices.thisDevice) { e.textContent = ''; return; }
  const paired = Array.isArray(devices.paired) ? devices.paired.length : 0;
  e.textContent = String(1 + paired); // this PC, plus whatever actually paired
}

/* ================================================================== *
 * 5 · the four calls                                                  *
 * ================================================================== */

async function load() {
  const r = await api('/mesh/devices');
  if (!r.ok) {
    loadError = r.error;
    devices = null;
  } else {
    devices = r.data;
    loadError = null;
  }
  paint();
}

async function withBusy(fn) {
  if (busy) return;
  busy = true;
  paint();
  try {
    await fn();
  } finally {
    busy = false;
    paint();
  }
}

function startPairing() {
  return withBusy(async () => {
    const r = await api('/mesh/pairing', { method: 'POST' });
    if (!r.ok) {
      actionNote = {
        text: `Could not start a pairing: ${r.error.message}${r.error.resolve ? ' ' + r.error.resolve : ''}`,
        channel: 'amber',
      };
    } else {
      // A started pairing leaves the self-check result alone: they are separate
      // facts, and clearing one because the other happened would be a lie.
      actionNote = null;
    }
    await load();
  });
}

function cancelPairing() {
  return withBusy(async () => {
    const r = await api('/mesh/pairing/cancel', { method: 'POST' });
    actionNote = r.ok
      ? { text: 'Pairing cancelled. The code is gone; nothing was paired.', channel: 'plain' }
      : { text: `Could not cancel: ${r.error.message}`, channel: 'amber' };
    await load();
  });
}

function runSelfCheck() {
  return withBusy(async () => {
    const r = await api('/mesh/selfcheck', { method: 'POST' });
    if (!r.ok) {
      selfCheck = null;
      actionNote = { text: `Could not run the self-check: ${r.error.message}`, channel: 'amber' };
      return;
    }
    selfCheck = r.data.selfCheck;
    actionNote = null;
  });
}

/* ================================================================== *
 * 6 · boot                                                            *
 * ================================================================== */

/**
 * Nothing is drawn until the daemon has answered. Until then the shell's own
 * "Devices not loaded" block stays on screen — the same discipline the pending
 * list keeps, because a panel that has not read the daemon must not render a
 * device list at all, empty or otherwise.
 */
export function initDevices() {
  if (!mount) return;
  void load();
}

initDevices();

export const init = initDevices;
export default initDevices;
