/**
 * bind/devices.js — Command → Devices screen, wired to the real device mesh.
 *
 * The artifact (index.html) draws this screen as two `.lcard`s (This PC /
 * Phone) inside `.live-cards`, a `.card > .capgrid` of 8 `.cap` cells that
 * explain kernel policy for a paired phone, a "Pair a phone" trigger
 * (`[data-pair]`, one in the `.phead`, one on the Phone card), and a
 * `#pair-sheet` modal with a code (`#pair-code`), an "expires in" line
 * (`#pair-exp` inside `.pcm`) and a "New code" button (`#pair-new`).
 *
 * Source of truth: mesh.js (the app's real, previously-wired mesh panel,
 * no longer mounted by index.html) and its daemon routes, confirmed against
 * packages/daemon/src/server.ts:
 *   GET  /mesh/devices        -> { thisDevice, paired, pairing|null, phoneClient }
 *   POST /mesh/pairing        -> { pairing }               (owner-only; 409 if one is open)
 *   POST /mesh/pairing/cancel -> { cancelled, pairing:null } (owner-only)
 * `paired` is TrustStore.devices() — an array of remote device ids, honestly
 * empty on every machine today, because THE ZENO PHONE CLIENT DOES NOT EXIST
 * (server.ts's phoneClient.built is always false right now). A pairing
 * started here is real — a real invite, a real 6-digit CSPRNG code — but
 * nothing can currently answer it, and the real pairing has NO expiry: it
 * stays open until cancelled. Both of those facts contradict the artifact's
 * mock copy ("expires in 2:00", "one use", "this LAN only", a scanning
 * phone), so this binder rewrites that copy rather than feed real numbers
 * into a wrapper sentence that would then be lying around them.
 *
 * ui.js's own `startPair()` (triggered off `[data-pair]`) shows a RANDOM mock
 * code and runs a ticking mock countdown into these same ids forever — there
 * is no way to stop its `setInterval` from here (its handle is a private
 * closure variable), so instead of letting it fire and racing it, this
 * binder replaces every `[data-pair]` trigger with a fresh node before
 * wiring its own click handler. ui.js's `startPair` is consequently never
 * invoked; the sheet's open/close mechanics it wired for Escape and
 * `[data-close]` (scrim + the X button) are untouched and still work, since
 * those act on `#pair-sheet` itself, which this binder never replaces.
 *
 * Honesty rules applied here:
 *   - the Phone card and the pair sheet only ever show a device or a code
 *     that the daemon actually reported;
 *   - "paired" is drawn from the real list, never invented, and a truly
 *     empty list says "not paired yet" plus the real reason (no phone
 *     client), never a bare 0 dressed up as an empty state;
 *   - while no phone client exists, the sheet's subtitle and its three
 *     numbered steps are rewritten too: they narrated a pairing that
 *     completes ("scan this", "confirm the fingerprint on both", "the phone
 *     becomes an owner device"), which contradicted the very footnote below
 *     them saying nothing can answer. One sheet, one story;
 *   - if GET /mesh/devices itself fails, both cards say the mesh could not
 *     be read and every pairing trigger is disabled — no pairing UI is
 *     shown that could not possibly work;
 *   - the capgrid is left untouched: its 8 cells are a static policy
 *     explainer (not a reading of live state) and its own wording — "Approve
 *     T0–T2 on the go" / "T3 egress · T4" — already matches the kernel's
 *     policy (packages/kernel/src/policy.ts DEFAULT_POLICY) and this app's
 *     own established convention for a cloud-model call elsewhere in the UI
 *     (forge.js, sections.js, ui.js all say "T3 egress" the same way).
 */

import { getJSON, $, $$, el, fill, setText, authHeaders, token } from '../bind.js';

const SCREEN_SEL = 'section.screen[data-screen="devices"]';

/* ---- a POST helper with the same never-throw contract as bind.js's getJSON */
async function postJSON(path) {
  try {
    const res = await fetch(path, { method: 'POST', headers: authHeaders(), cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errObj = data && typeof data === 'object' ? data.error : null;
      const msg = (errObj && errObj.message) || `${path} answered ${res.status}`;
      const resolve = errObj && errObj.resolve;
      return { ok: false, status: res.status, data, error: resolve ? `${msg} ${resolve}` : msg };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: `${path} could not be reached: ${err && err.message}` };
  }
}

/* ---- small formatters ----------------------------------------------------- */

function shortHash(s, head = 8, tail = 6) {
  if (typeof s !== 'string' || !s) return '';
  if (s.length <= head + tail + 1) return s;
  return s.slice(0, head) + '…' + s.slice(-tail);
}

function fmtClock(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The real code is always 6 digits (mesh/src/pairing.ts randomCode()),
 *  grouped the way the artifact's own mock displayed one — never invented
 *  if the shape is ever different than expected. */
function formatCode(code) {
  if (typeof code === 'string' && /^[0-9]{6}$/.test(code)) {
    return `${code[0]} ${code[1]} ${code[2]} · ${code[3]} ${code[4]} ${code[5]}`;
  }
  return typeof code === 'string' && code ? code : '—';
}

/* ---- the shell's own .pill / .laction primitives, built fresh ------------- */

function pillEl(text, cls) {
  const s = el('span', cls ? `pill ${cls}` : 'pill');
  if (cls !== 'wt') s.appendChild(el('span', 'd'));
  s.appendChild(document.createTextNode(text));
  return s;
}

function actionBtn(label, cls, onClick, disabledWhy) {
  const b = el('button', cls ? `laction ${cls}` : 'laction', label);
  b.type = 'button';
  if (disabledWhy) {
    b.disabled = true;
    b.title = disabledWhy;
  } else if (onClick) {
    b.addEventListener('click', onClick);
  }
  return b;
}

export async function bind() {
  try {
    const screen = $(SCREEN_SEL);
    if (!screen) return; // screen not on this page (or being edited elsewhere) — skip quietly

    const headPairBtn = $('.phead [data-pair]', screen);
    const liveCards = $('.live-cards', screen);
    const cardEls = liveCards ? $$('.lcard', liveCards) : [];
    const pcCard = cardEls[0] || null;
    const phoneCard = cardEls[1] || null;

    // The pair sheet is a shared modal outside this screen's section, wired by
    // ui.js for open/close mechanics (Escape, the scrim, the X button). This
    // binder only rewrites its content and re-points what opens it.
    const pairSheet = document.getElementById('pair-sheet');
    const codeEl = pairSheet ? $('#pair-code', pairSheet) : null;
    let pcmEl = pairSheet ? $('.pcm', pairSheet) : null;
    const newBtn = pairSheet ? $('#pair-new', pairSheet) : null;
    const fnoteEl = pairSheet ? $('.fnote', pairSheet) : null;
    // The sheet's subtitle and its three numbered steps are the first words an
    // owner reads, and the artifact writes them as a phone flow that runs end
    // to end. They are rewritten below whenever the daemon says no client
    // exists; the originals are kept so a real one restores them verbatim.
    const mhSubEl = pairSheet ? $('.mh-sub', pairSheet) : null;
    const stepsEl = pairSheet ? $('.pairsteps', pairSheet) : null;
    const mhSubOriginal = mhSubEl ? mhSubEl.textContent : '';
    const stepsOriginal = stepsEl ? [...stepsEl.childNodes] : [];

    const ownerHeld = !!token();
    const daemonHost = typeof location !== 'undefined' && location.host ? location.host : '';
    const noTokenWhy = 'This page holds no owner token, so it cannot act on the mesh.';

    const state = { thisDevice: null, paired: [], pairing: null, phoneClient: null, meshError: null };

    /* ---- sheet content ------------------------------------------------- */

    function setCode(text) {
      if (codeEl) codeEl.textContent = text;
    }
    // The artifact's `.pcm` line reads "expires in <b>…</b> · one use · this
    // LAN only" — none of which is true of the real pairing (no expiry, and
    // no transport exists yet at all, LAN or otherwise), so this replaces the
    // whole line rather than filling a false frame around a real number.
    function setPcm(text) {
      if (!pcmEl) return;
      const b = el('b', null, text);
      b.id = 'pair-exp';
      fill(pcmEl, b);
    }
    function setFnote(text) {
      if (fnoteEl) fnoteEl.textContent = text;
    }

    /* One sheet must tell ONE story.
     *
     * The artifact narrates pairing as something that completes: "Open Zeno on
     * the phone → scan this", "both screens show the same 4-word fingerprint —
     * confirm it on both", "the phone becomes an owner device". While the
     * daemon reports phoneClient.built === false (and the pairing itself
     * reports completable === false), none of those steps can happen — and a
     * truthful footnote underneath does not undo instructions printed above
     * it; it just gives the owner two contradictory stories to pick from.
     * So the narrative is rewritten to what a started pairing ACTUALLY is: a
     * real invite and a real code, minted here, with nothing on the other end.
     */
    function stepEl(n, text) {
      const s = el('span');
      s.appendChild(el('b', null, String(n)));
      s.appendChild(document.createTextNode(' ' + text));
      return s;
    }
    function setSheetNarrative(phoneClient) {
      const noClient = !!(phoneClient && phoneClient.built === false);
      if (mhSubEl) {
        mhSubEl.textContent = noClient
          ? 'This mints a real invite and a real code on this machine. Nothing can answer it yet: the Zeno phone client is not built.'
          : mhSubOriginal;
      }
      if (!stepsEl) return;
      if (noClient) {
        fill(
          stepsEl,
          stepEl(1, 'This machine has minted a real invite and the code above.'),
          stepEl(2, 'A second device would answer it, and both sides would have to derive the same verification code.'),
          stepEl(3, 'Nothing can do that yet, so this pairing stays open until you cancel it. No device is trusted by it.'),
        );
      } else {
        fill(stepsEl, ...stepsOriginal);
      }
    }

    function showSheetLoading(msg) {
      setCode(msg || 'reading pairing code…');
      setPcm('contacting the daemon…');
      setSheetNarrative(state.phoneClient);
      if (newBtn) newBtn.disabled = true;
    }
    function showSheetPairing(pairing, phoneClient) {
      setSheetNarrative(phoneClient);
      setCode(formatCode(pairing && pairing.code));
      const started = pairing && fmtClock(pairing.startedAt);
      setPcm(
        (started ? `open since ${started}` : 'open now') +
          ' · no expiry — real code, cancel below when you’re done',
      );
      if (newBtn) newBtn.disabled = !ownerHeld;
      setFnote(
        phoneClient && phoneClient.built === false
          ? phoneClient.note ||
              'The Zeno phone client is not built yet, so nothing can answer this invite. The code above is real and stays open until you cancel it.'
          : 'Pairing proves the phone is yours; it does not widen what any approval can do.',
      );
    }
    function showSheetNone(reasonText) {
      setSheetNarrative(state.phoneClient);
      setCode('—');
      setPcm(reasonText || 'no pairing open');
      if (newBtn) newBtn.disabled = true;
    }

    /* ---- cards ----------------------------------------------------------- */

    function renderCards() {
      if (pcCard) {
        const lk = $('.lk', pcCard);
        const lr = $('.lr', pcCard);
        const lines = [];
        const headline = `${ownerHeld ? 'owner token held' : 'no owner token — read-only page'}${
          daemonHost ? ' · daemon on ' + daemonHost : ''
        }`;
        if (state.meshError) {
          lines.push(headline, `mesh identity could not be read — ${state.meshError}`);
        } else if (state.thisDevice) {
          lines.push(headline);
          const bits = [];
          if (state.thisDevice.deviceId) bits.push(`device ${shortHash(state.thisDevice.deviceId)}`);
          if (state.thisDevice.publicKey) bits.push(`X25519 ${shortHash(state.thisDevice.publicKey)}`);
          bits.push(
            state.thisDevice.identityPersisted
              ? 'id persisted'
              : 'id in memory only — reissued each restart',
          );
          lines.push(bits.join(' · '));
        } else {
          lines.push(headline, 'mesh identity not read yet');
        }
        fill(pcCard, ...[lk, ...lines.map((t) => el('div', 'lm', t)), lr].filter(Boolean));
      }

      if (phoneCard) {
        const lk = $('.lk', phoneCard);
        const lr = el('div', 'lr');
        const lines = [];
        let pillNode;
        let btn = null;

        if (state.meshError) {
          pillNode = pillEl('unreachable', 'rd');
          lines.push(`mesh could not be read — ${state.meshError}`);
        } else if (state.pairing) {
          pillNode = pillEl('pairing open', 'am');
          const started = fmtClock(state.pairing.startedAt);
          lines.push(started ? `pairing code open · started ${started}` : 'pairing code open');
          lines.push(
            state.phoneClient && state.phoneClient.built === false
              ? 'no phone client exists yet to answer it'
              : 'waiting for a phone to answer',
          );
          btn = actionBtn('Cancel pairing', '', onCancelPairing, ownerHeld ? null : noTokenWhy);
        } else if (state.paired.length > 0) {
          pillNode = pillEl('paired', 'gr');
          lines.push(`paired · device ${shortHash(state.paired[0])}`);
          if (state.paired.length > 1) lines.push(`+${state.paired.length - 1} more paired`);
          btn = actionBtn('Pair another', 'cy', onOpenPairSheet, ownerHeld ? null : noTokenWhy);
        } else {
          pillNode = pillEl('no peer yet', 'wt');
          lines.push('not paired yet');
          lines.push(
            state.phoneClient && state.phoneClient.built === false
              ? state.phoneClient.note || 'the Zeno phone client is not built yet — nothing can answer an invite'
              : 'no phone has paired yet',
          );
          btn = actionBtn('Pair', 'cy', onOpenPairSheet, ownerHeld ? null : noTokenWhy);
        }

        lr.appendChild(pillNode);
        if (btn) lr.appendChild(btn);
        fill(phoneCard, ...[lk, ...lines.map((t) => el('div', 'lm', t)), lr].filter(Boolean));
      }
    }

    /* ---- daemon calls ------------------------------------------------------ */

    async function syncAll() {
      const res = await getJSON('/mesh/devices');
      if (!res.ok) {
        state.meshError = res.error || 'unknown error';
        state.thisDevice = null;
        state.paired = [];
        state.pairing = null;
        state.phoneClient = null;
      } else {
        const d = res.data && typeof res.data === 'object' ? res.data : {};
        state.meshError = null;
        state.thisDevice = d.thisDevice && typeof d.thisDevice === 'object' ? d.thisDevice : null;
        state.paired = Array.isArray(d.paired) ? d.paired : [];
        state.pairing = d.pairing && typeof d.pairing === 'object' ? d.pairing : null;
        state.phoneClient = d.phoneClient && typeof d.phoneClient === 'object' ? d.phoneClient : null;
      }
      renderCards();
      if (pairSheet && !pairSheet.hidden) {
        if (state.meshError) showSheetNone(`mesh could not be read — ${state.meshError}`);
        else if (state.pairing) showSheetPairing(state.pairing, state.phoneClient);
        else showSheetNone('no pairing open');
      }
      return res;
    }

    async function onOpenPairSheet() {
      if (!pairSheet) return;
      pairSheet.hidden = false;
      if (state.pairing) {
        showSheetPairing(state.pairing, state.phoneClient);
        return;
      }
      if (!ownerHeld) {
        showSheetNone(noTokenWhy);
        return;
      }
      showSheetLoading();
      const r = await postJSON('/mesh/pairing');
      await syncAll(); // canonical state — also covers the 409 "already open" case
      if (!r.ok && r.status !== 409 && !state.pairing) {
        showSheetNone(`could not start a pairing — ${r.error}`);
      }
    }

    async function onCancelPairing() {
      if (!ownerHeld) return;
      const r = await postJSON('/mesh/pairing/cancel');
      await syncAll(); // reflects whatever the daemon actually did, success or not
      if (r.ok) {
        if (pairSheet) pairSheet.hidden = true;
      } else if (pairSheet && !pairSheet.hidden) {
        showSheetNone(`could not cancel — ${r.error}`);
      }
    }

    async function onNewCode() {
      if (!ownerHeld || !state.pairing) return;
      showSheetLoading('reading a new pairing code…');
      await postJSON('/mesh/pairing/cancel');
      const r = await postJSON('/mesh/pairing');
      await syncAll();
      if (!r.ok && r.status !== 409 && !state.pairing) {
        showSheetNone(`could not start a new pairing — ${r.error}`);
      }
    }

    // Replace every [data-pair] trigger with a fresh node before wiring it, so
    // ui.js's own startPair() (bound to the ORIGINAL nodes at page load) never
    // fires — see the file header for why that matters.
    if (headPairBtn) {
      const fresh = el('button', headPairBtn.className, headPairBtn.textContent);
      fresh.type = 'button';
      headPairBtn.replaceWith(fresh);
      fresh.addEventListener('click', onOpenPairSheet);
    }
    if (newBtn) newBtn.addEventListener('click', onNewCode);

    // Render once synchronously, before the first await: the Phone card's
    // own [data-pair] button (unlike the head one above) is only replaced as
    // a side effect of renderCards(), and the daemon's real answer is at
    // least one network round trip away — this closes the gap where a click
    // in that window would otherwise still hit ui.js's mock-wired original.
    renderCards();

    await syncAll();
  } catch (err) {
    // Never throw out of bind(): the screen keeps whatever it last had rather
    // than taking the rest of the window down with it.
    console.warn('[zeno] bind/devices.js failed:', err);
  }
}
