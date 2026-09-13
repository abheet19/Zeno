/*
 * bind/settings.js — Command → the floating Settings modal (`#settings-modal`).
 *
 * ui.js already gives this modal its chrome for free: opening/closing
 * ([data-open-settings], [data-close], Escape), category switching
 * ([data-setcat] <-> `.set-pane[data-setpane]`), and a GENERIC `.toggle`
 * click handler that flips `aria-checked` for every `.toggle` except
 * `#rm-toggle` (which gets its own handler, wired to the Home orb's canvas
 * loop — see ui.js ~line 577). None of that reaches a daemon or a stored
 * preference; every row is the artifact's mock. This binder repoints each
 * row at the real thing, or — where the app genuinely has no such thing —
 * disables the row and says so, rather than let a switch keep looking live.
 *
 * Real state this file is grounded in, confirmed against
 * packages/daemon/src/server.ts and the app's original modules:
 *   - Reduce motion / Reduce transparency: field.js's own device preferences
 *     (localStorage `zeno-mo` / `zeno-fl`, `data-reduce` / `data-flat` on
 *     <html>, which glass/tokens.css and glass/vendor/glass-base.css already
 *     style for). field.js itself is not mounted any more, so nothing else
 *     applies these at load — this binder does, using the exact same keys,
 *     so a preference set here would survive field.js coming back.
 *   - Theme: same scheme, key `zeno-th`, attribute `data-theme`.
 *   - Density: real, key `zeno-dn`, attribute `data-density`, resolved by
 *     theme-boot.js before CSS. It had no preference behind it and was
 *     disabled; rather than ship a switch that means nothing, it now means
 *     what its label says.
 *   - Launch-to-surface: no persisted preference exists ANYWHERE in this
 *     codebase (field.js's boot() comment: "Command is the always-present
 *     surface"). Disabled, not wired.
 *   - Models: GET /forge/agents?passive=1 (the `?passive=1` matches field.js's
 *     own call — this read must never be the thing that starts a local
 *     Ollama runtime). agents[] + localModels[] decide what Forge would
 *     actually run right now; there is no separate "default model" setting.
 *   - Spoken replies: no persisted, app-wide setting exists — ask.js's
 *     `voiceModeOn` is a plain in-memory flag on the Ask screen only, never
 *     saved. Disabled, not wired.
 *   - Wake word: real and persisted (voice.js's own `zeno.voice.wake` key).
 *     Turning it OFF needs no consent and is honoured here. Turning it ON
 *     needs the microphone disclosure voice.js shows before opening the mic
 *     — this build has no disclosure surface in Settings, so Settings can
 *     only ever turn it off.
 *   - Connectors: GET /skills, GET /forge/mcp/servers (names only — the
 *     daemon itself never returns env var values, only names).
 *   - Owner token / policy: `token()` (the meta-tag bind.js already reads)
 *     and GET /state (receipts[].policyHash off the newest receipt — /state
 *     has no dedicated policy field; sections.js's real dialog reads it the
 *     same way).
 *   - Device key AND the account identity: GET /mesh/devices ->
 *     thisDevice.{label,host,publicKey}. Zeno has no account, no sign-in and no
 *     identity endpoint, so the artifact's hardcoded name and email were a
 *     fetched-looking value that was false on every machine but one. The
 *     machine is the only identity there is; the pane names it.
 *   - Default model: read-only. `defaultModel` does not exist anywhere in
 *     packages/daemon/src — there is no preference to write — so the pill is
 *     disabled and says so rather than keep a caret that opens nothing.
 *   - Sign out: there is no client-side action that can revoke the owner
 *     capability. The daemon hands it out as an HttpOnly session cookie
 *     (server.ts ~line 1878) that a page script cannot read or clear, and
 *     that cookie — not the meta-tag copy `token()` reads — is what
 *     authenticates future requests. The only real way to end it is closing
 *     the window. So the button is disabled rather than left to claim (as
 *     ui.js's own toast does) that a click "released" anything.
 */

import { getJSON, $, $$, el, fill, setText, token } from '../bind.js';

const root = document.documentElement;

/* ---- small local helpers -------------------------------------------------- */

function txt(s) { return document.createTextNode(s); }
function dot() { return el('span', 'd'); }

/** Same tiny toast ui.js defines, kept local so this file never reaches into
 *  ui.js's closure — it only reuses the `#toast` element/CSS ui.js already
 *  ships (screens/artifact.css `#toast` / `#toast.on`). */
function toast(msg) {
  try {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._zenoTimer);
    t._zenoTimer = setTimeout(() => t.classList.remove('on'), 2400);
  } catch { /* a toast is a nicety, never worth failing over */ }
}

/** field.js's own localStorage scheme (`zeno-<key>`), reused verbatim so a
 *  preference set from here is exactly what field.js would read if it were
 *  mounted again. */
function zget(key) { try { return localStorage.getItem('zeno-' + key); } catch { return null; } }
function zset(key, value) { try { localStorage.setItem('zeno-' + key, value); } catch { /* storage off */ } }

function mono(hex, head = 4, tail = 4) {
  const s = String(hex || '');
  return s.length > head + tail + 1 ? s.slice(0, head) + '…' + s.slice(-tail) : s;
}

/** Find the `.setrow` in `pane` whose visible `.lab` text matches exactly. */
function rowByLabel(pane, label) {
  if (!pane) return null;
  return $$('.setrow', pane).find((r) => {
    const lab = $('.lab', r);
    return lab && lab.textContent.trim() === label;
  }) || null;
}

/** Drop ui.js's directly-attached listeners on a `.toggle`/button without
 *  touching ui.js's file — the same clone+replaceWith trick bind/counsel.js
 *  and bind/devices.js already use. Returns the fresh, listener-free node. */
function detach(elm) {
  if (!elm) return null;
  const clone = elm.cloneNode(true);
  elm.replaceWith(clone);
  return clone;
}

function markDisabled(node, note) {
  if (!node) return;
  node.setAttribute('aria-disabled', 'true');
  node.style.opacity = '.5';
  node.style.pointerEvents = 'none';
  node.style.cursor = 'not-allowed';
  if (note) node.title = note;
}

function disableButtons(row, note) {
  if (!row) return;
  $$('button', row).forEach((b) => {
    b.disabled = true;
    b.style.opacity = '.5';
    b.style.cursor = 'not-allowed';
    if (note) b.title = note;
  });
}

const TONE = { good: 'gr', bad: 'rd', warn: 'am', cyan: 'cy', flat: 'wt' };
function setPill(pillEl, tone, text, withDot) {
  if (!pillEl) return;
  pillEl.className = 'pill ' + (TONE[tone] || tone);
  if (withDot) fill(pillEl, dot(), txt(text));
  else setText(pillEl, text);
}

/* ============================================================ *
 * General — Reduce motion, Reduce transparency, Launch-to       *
 * ============================================================ */

function readReduceMotionPref() {
  const v = zget('mo');
  if (v === '0') return true;  // stored: motion OFF -> reduced
  if (v === '1') return false; // stored: motion ON -> not reduced
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function bindGeneral(modal) {
  const pane = $('.set-pane[data-setpane="general"]', modal);
  if (!pane) return;

  try {
    const row = rowByLabel(pane, 'Reduce motion');
    const rm = row && $('.toggle', row);
    if (rm) {
      // Persist every future change under field.js's own key, and apply the
      // real, sitewide CSS effect tokens.css already defines for
      // :root[data-reduce="1"] — independent of whether field.js is mounted.
      const observer = new MutationObserver(() => {
        const on = rm.getAttribute('aria-checked') === 'true';
        zset('mo', on ? '0' : '1');
        root.setAttribute('data-reduce', on ? '1' : '0');
      });
      observer.observe(rm, { attributes: true, attributeFilter: ['aria-checked'] });

      const wantReduced = readReduceMotionPref();
      const isChecked = rm.getAttribute('aria-checked') === 'true';
      if (wantReduced !== isChecked) {
        // ui.js's own #rm-toggle handler also owns the Home orb's ORB.motion
        // flag, which lives in ui.js's closure and cannot be reached from
        // here. A real click runs that handler for real (so the orb honours
        // this boot-time preference too, not only ones made after boot) —
        // our observer above then persists whatever it lands on.
        rm.click();
      } else {
        root.setAttribute('data-reduce', wantReduced ? '1' : '0');
      }
    }
  } catch { /* one row's failure should not blank the pane */ }

  try {
    const row = rowByLabel(pane, 'Reduce transparency');
    const flat = row && $('.toggle', row);
    if (flat) {
      const on = zget('fl') === '1';
      flat.setAttribute('aria-checked', on ? 'true' : 'false');
      root.setAttribute('data-flat', on ? '1' : '0');
      const observer = new MutationObserver(() => {
        const checked = flat.getAttribute('aria-checked') === 'true';
        zset('fl', checked ? '1' : '0');
        root.setAttribute('data-flat', checked ? '1' : '0');
      });
      observer.observe(flat, { attributes: true, attributeFilter: ['aria-checked'] });
    }
  } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Launch to');
    if (row) {
      disableButtons(row, 'Zeno always opens to Command — there is no stored launch preference in this build.');
      setText($('.sub', row), 'Zeno always opens to Command. Nothing in this app remembers a different launch surface yet.');
    }
  } catch { /* skip quietly */ }
}

/* ============================================================ *
 * Appearance — Theme (real), Density (not real anywhere)        *
 * ============================================================ */

function bindAppearance(modal) {
  const pane = $('.set-pane[data-setpane="appearance"]', modal);
  if (!pane) return;

  try {
    const row = rowByLabel(pane, 'Theme');
    const seg = row && $('.segsm', row);
    if (seg) {
      // Reconcile ONLY against a real saved choice. The bare `else` here used to
      // strip data-theme whenever nothing was stored, which silently turned every
      // first run into "follow the OS" — on a light desktop the documented
      // Graphite default never appeared, and it contradicted theme-boot.js, which
      // correctly leaves the default alone when there is nothing saved.
      const stored = zget('th');
      if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
      else if (stored === 'system') root.removeAttribute('data-theme');

      const buttons = $$('button', seg);
      const wanted = (label) => (label === 'Light' ? 'light' : label === 'Dark' ? 'dark' : null);
      const markCurrent = () => {
        const current = root.getAttribute('data-theme'); // 'dark' | 'light' | null
        buttons.forEach((b) => {
          const w = wanted(b.textContent.trim());
          if (w === current) b.setAttribute('aria-current', 'page');
          else b.removeAttribute('aria-current');
        });
      };
      markCurrent();
      buttons.forEach((b) => b.addEventListener('click', () => {
        const w = wanted(b.textContent.trim());
        if (w) { root.setAttribute('data-theme', w); zset('th', w); }
        else { root.removeAttribute('data-theme'); zset('th', 'system'); }
        markCurrent(); // ui.js's own click handler already moves aria-current
      }));       // to whichever button was clicked; this just keeps it honest
    }             // if that ever disagrees with what we just applied.
  } catch { /* skip quietly */ }

  /* Density is REAL now. It was disabled because no preference existed; a
     switch that looks live and is not is the thing this surface refuses to
     ship, and the honest options were to remove the row or to mean it. It
     stores `zeno-dn` and sets data-density on <html>, the same scheme as the
     theme — and theme-boot.js resolves it before CSS so it never arrives as a
     visible reflow. */
  try {
    const row = rowByLabel(pane, 'Density');
    const seg = row && $('.segsm', row);
    if (seg) {
      const compact = () => root.getAttribute('data-density') === 'compact';
      const buttons = $$('button', seg);
      const wanted = (label) => (label === 'Compact' ? 'compact' : 'comfortable');
      const markCurrent = () => buttons.forEach((b) => {
        const is = wanted(b.textContent.trim()) === (compact() ? 'compact' : 'comfortable');
        if (is) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      markCurrent();
      buttons.forEach((b) => b.addEventListener('click', () => {
        if (wanted(b.textContent.trim()) === 'compact') { root.setAttribute('data-density', 'compact'); zset('dn', 'compact'); }
        else { root.removeAttribute('data-density'); zset('dn', 'comfortable'); }
        markCurrent();
      }));
    }
  } catch { /* skip quietly */ }
}

/* ============================================================ *
 * Models — GET /forge/agents?passive=1                          *
 * ============================================================ */

function pickAgent(agents) {
  const priority = ['local', 'codex', 'claude-code'];
  return priority.map((id) => agents.find((a) => a && a.id === id && a.available !== false)).find(Boolean)
    || agents.find((a) => a && a.available !== false)
    || null;
}

async function bindModels(modal) {
  const pane = $('.set-pane[data-setpane="models"]', modal);
  if (!pane) return;

  /* This row claimed "Anthropic · set", as though Zeno held an API key and
     billed against it. It does not, and saying so was the costly kind of wrong:
     Zeno's hosted rungs SPAWN the installed `claude` and `codex` binaries
     (packages/forge/src/runner.ts — CLAUDE_BINARY / CODEX_BINARY) with the
     inherited environment. No key is injected anywhere in forge or daemon —
     grep for ANTHROPIC_API_KEY finds nothing. So a hosted run uses whatever
     sign-in those CLIs already have, i.e. the owner's existing subscription,
     and consumes no separate API credit. The row says that instead. */
  try {
    const row = rowByLabel(pane, 'Cloud API keys');
    const pill = row && $('.pill', row);
    if (pill) setPill(pill, 'flat', 'not used — hosted runs use your CLI sign-in', false);
    setText($('.lab', row), 'Hosted agent sign-in');
    setText($('.sub', row),
      'Zeno stores no API key. A hosted run launches your installed claude or codex CLI, '
      + 'so it uses the subscription those are already signed in to and bills nothing separately. '
      + 'A cloud call is still a T3 egress effect and asks you every time.');
  } catch { /* skip quietly */ }

  /* Removing data-model-pill stopped ui.js's mock picker, but the row still
     shipped a <button> with a caret that looked exactly like a chooser and did
     nothing when clicked — the one thing this surface must never be. There is
     no "default model" preference anywhere in the daemon (grep defaultModel in
     packages/daemon/src: nothing), so the honest shape is a read-only status,
     said out loud. */
  const modelRow = rowByLabel(pane, 'Default model');
  try {
    const pill = modelRow && $('[data-model-pill]', modelRow);
    if (pill) {
      pill.removeAttribute('data-model-pill');
      pill.style.cursor = 'default';
      pill.disabled = true;
      pill.setAttribute('aria-disabled', 'true');
      pill.title = 'Read-only. Zeno stores no "default model" preference — this names what this machine would actually run right now. Local models are pulled and removed in Forge.';
    }
  } catch { /* skip quietly */ }

  const manageRow = rowByLabel(pane, 'Manage models');

  /**
   * Paint both model rows from ONE passive read.
   *
   * `?passive=1` is load-bearing: this read must never be the thing that starts
   * a local Ollama runtime. The cost of that is a cold machine answering with an
   * empty localModels[] — so at first paint these rows could say "no local model
   * is pulled yet" and name a cloud CLI as first choice while three local models
   * sat on disk, and nothing ever read again, so that stayed on screen for the
   * life of the window. bind.js's own rail-badge pass DOES call /forge/agents
   * without `passive`, which awaits ensureOllama(); it is awaited before
   * `zeno:bound` fires. Re-reading once on that event therefore reports the
   * runtime as it actually ended up, without this file ever being what woke it.
   */
  async function paintModelRows() {
    const res = await getJSON('/forge/agents?passive=1');
    const locals = Array.isArray(res.data && res.data.localModels) ? res.data.localModels : [];

    try {
      const pill = modelRow && $('.pill', modelRow);
      if (pill) {
        if (!res.ok) setPill(pill, 'bad', 'could not be read', true);
        else {
          const agents = Array.isArray(res.data.agents) ? res.data.agents : [];
          const picked = pickAgent(agents);
          if (!picked) setPill(pill, 'warn', 'no agent is available on this machine', true);
          else if (picked.id === 'local') {
            setPill(pill, 'cyan', locals.length
              ? `${locals[0]}${locals.length > 1 ? ` +${locals.length - 1} more` : ''} · local`
              : 'local runtime · no model pulled yet', true);
          } else {
            setPill(pill, 'flat', `${picked.label || picked.id} · cloud CLI`, true);
          }
        }
      }
    } catch { /* skip quietly */ }

    try {
      const sub = manageRow && $('.sub', manageRow);
      if (sub) {
        if (!res.ok) setText(sub, `Local models could not be read: ${res.error}`);
        else setText(sub, locals.length
          ? `${locals.length} local model${locals.length === 1 ? '' : 's'} installed: ${locals.join(', ')}. Pulled or removed in Forge.`
          : 'No local model is pulled yet. Forge pulls and removes local models for you.');
      }
    } catch { /* skip quietly */ }
  }

  await paintModelRows();
  document.addEventListener('zeno:bound', () => { void paintModelRows(); }, { once: true });

  try {
    const row = manageRow;
    if (row) {
      const btn = $('[data-set-managemodels]', row);
      if (btn) btn.addEventListener('click', () => {
        // ui.js's own handler for this button already hides the modal and
        // shows a toast; this reuses the app's REAL Command<->Forge switch
        // (the same [data-product-go] delegated handler every "Open in
        // Forge" control elsewhere in the artifact relies on) so the click
        // actually goes somewhere, rather than just naming where models live.
        const go = document.querySelector('[data-product-go="forge"]');
        if (go) go.click();
      });
    }
  } catch { /* skip quietly */ }
}

/* ============================================================ *
 * Voice — Spoken replies (not real), Wake word (real)            *
 * ============================================================ */

/* Must stay in step with bind/voice.js's DISCLOSURE_VERSION. Bumping it there
   is how voice.js re-asks consent from anyone who accepted an older, weaker
   description of what the microphone does — so a pref carrying an older version
   is NOT an accepted consent, and voice.js boots with the wake word off. */
const WAKE_DISCLOSURE_VERSION = 4;

/* Read it the way bind/voice.js reads it. This used to accept any `{on:true}`,
   which is a strictly weaker test than voice.js's: the moment the disclosure
   version was bumped, voice.js correctly treated the stored consent as expired
   and stayed OFF while this row painted the switch ON. The owner would have
   been told the machine was listening for "Zeno" when it was not. */
function readWakeWordPref() {
  try {
    const raw = localStorage.getItem('zeno.voice.wake');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.on === true && parsed.disclosure === WAKE_DISCLOSURE_VERSION);
  } catch { return false; }
}

function bindVoice(modal) {
  const pane = $('.set-pane[data-setpane="voice"]', modal);
  if (!pane) return;

  try {
    const row = rowByLabel(pane, 'Spoken replies');
    if (row) {
      const original = $('.toggle', row);
      const clone = detach(original);
      if (clone) {
        clone.setAttribute('aria-checked', 'false');
        markDisabled(clone, 'No global switch exists yet — voice mode is turned on and off per conversation, on the Ask screen.');
      }
      setText($('.sub', row), 'There is no app-wide switch for this yet — voice mode is turned on and off per conversation, on the Ask screen itself.');
    }
  } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Wake word');
    if (row) {
      const original = $('.toggle', row);
      const clone = detach(original);
      if (clone) {
        const on = readWakeWordPref();
        clone.setAttribute('aria-checked', on ? 'true' : 'false');
        const flip = () => {
          const isOn = clone.getAttribute('aria-checked') === 'true';
          if (isOn) {
            // Turning OFF needs no consent and is always safe to honour here.
            try { localStorage.removeItem('zeno.voice.wake'); } catch { /* storage off */ }
            clone.setAttribute('aria-checked', 'false');
            toast('Wake word turned off.');
          } else {
            // Turning ON needs the microphone disclosure voice.js shows
            // before it opens the mic. That disclosure has no surface in
            // this Settings build, so this cannot honestly turn it on.
            toast('Turning wake word on needs the microphone disclosure — that lives with the mic control, not in Settings yet.');
          }
        };
        clone.addEventListener('click', flip);
        clone.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
        });
      }
    }
  } catch { /* skip quietly */ }
}

/* ============================================================ *
 * Connectors — GET /skills, GET /forge/mcp/servers               *
 * ============================================================ */

async function bindConnectors(modal) {
  const pane = $('.set-pane[data-setpane="connectors"]', modal);
  if (!pane) return;

  const customizeRow = rowByLabel(pane, 'Customize hub');
  try {
    const btn = customizeRow && $('[data-set-customize]', customizeRow);
    if (btn) btn.addEventListener('click', () => {
      // ui.js's own handler hides the modal and shows a toast; this also
      // drives the app's real left-nav switch to the Customize screen.
      const nav = document.querySelector('.nav-i[data-screen="customize"]');
      if (nav) nav.click();
    });
  } catch { /* skip quietly */ }

  const [skillsRes, mcpRes] = await Promise.all([
    getJSON('/skills'),
    getJSON('/forge/mcp/servers'),
  ]);

  try {
    const row = rowByLabel(pane, 'MCP servers');
    const pill = row && $('.pill', row);
    if (pill) {
      if (!mcpRes.ok) setPill(pill, 'bad', 'could not be read', false);
      else {
        const servers = Array.isArray(mcpRes.data && mcpRes.data.servers) ? mcpRes.data.servers : [];
        setPill(pill, 'flat', `${servers.length} configured`, false);
      }
    }
  } catch { /* skip quietly */ }

  try {
    if (customizeRow) {
      const sub = $('.sub', customizeRow);
      if (sub) {
        const parts = [];
        if (skillsRes.ok) {
          const skills = Array.isArray(skillsRes.data && skillsRes.data.skills) ? skillsRes.data.skills : [];
          parts.push(`${skills.length} skill${skills.length === 1 ? '' : 's'} catalogued`);
        } else parts.push('skills could not be read');
        if (mcpRes.ok) {
          const servers = Array.isArray(mcpRes.data && mcpRes.data.servers) ? mcpRes.data.servers : [];
          const names = servers.map((s) => s && s.name).filter(Boolean);
          parts.push(names.length ? `MCP: ${names.join(', ')}` : '0 MCP servers recorded');
        } else parts.push('MCP servers could not be read');
        setText(sub, `${parts.join(' · ')}. Each one is added by you and stays behind the approval gate — nothing is loaded ambiently.`);
      }
    }
  } catch { /* skip quietly */ }
}

/* ============================================================ *
 * Privacy & Security — token(), GET /state                       *
 * ============================================================ */

async function bindSecurity(modal) {
  const pane = $('.set-pane[data-setpane="security"]', modal);
  if (!pane) return;

  const hasOwner = token() !== '';
  try {
    const row = rowByLabel(pane, 'Owner token');
    const pill = row && $('.pill', row);
    if (pill) setPill(pill, hasOwner ? 'good' : 'bad', hasOwner ? 'held' : 'absent — read-only window', true);
  } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Policy');
    const pill = row && $('.pill', row);
    if (pill) {
      const state = await getJSON('/state');
      if (!state.ok) setPill(pill, 'bad', 'could not be read', false);
      else {
        const receipts = Array.isArray(state.data && state.data.receipts) ? state.data.receipts : [];
        const newest = receipts.length ? receipts[receipts.length - 1] : null;
        const hash = newest && newest.policyHash ? String(newest.policyHash) : '';
        if (hash) setPill(pill, 'flat', `${mono(hash)} · from the newest receipt`, false);
        else setPill(pill, 'warn', 'not recorded yet — no receipt to read it from', false);
      }
    }
  } catch { /* skip quietly */ }
  // Telemetry and Tier-4 rows are guarantees the kernel enforces in code
  // (no telemetry code path exists at all; Tier 4 has no approval route),
  // not values any daemon endpoint reports — left as the shipped copy.
}

/* ============================================================ *
 * Account — token(), GET /mesh/devices                          *
 * ============================================================ */

async function bindAccount(modal) {
  const pane = $('.set-pane[data-setpane="account"]', modal);
  if (!pane) return;

  const hasOwner = token() !== '';
  const rows = $$('.setrow', pane);
  const mesh = await getJSON('/mesh/devices');
  const dev = (mesh.ok && mesh.data && mesh.data.thisDevice) || null;

  /* The artifact hardcodes ONE developer's name and email into this pane and
     into the nav's account button, as though Zeno had read them from an
     account. It has not: Zeno has no account, no sign-in and no identity
     endpoint — `grep -n "path === '/"` over server.ts has nothing of the kind.
     So on every machine but that one developer's, this pane stated a false
     identity with the confidence of a fetched value. The only identity the
     daemon actually reports is the machine's: /mesh/devices → thisDevice. Say
     that instead, and where it could not be read, say THAT rather than fall
     back to the fixture. */
  const initials = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '··';
  try {
    const youRow = rows.find((r) => r.querySelector('.avatar-mono'));
    const pill = youRow && $('.pill', youRow);
    if (pill) setPill(pill, hasOwner ? 'good' : 'bad', hasOwner ? 'owner' : 'read-only', true);

    const label = dev && dev.label ? String(dev.label) : '';
    const host = dev && dev.host ? String(dev.host) : '';
    const name = host || label || 'This machine';
    const sub = mesh.ok
      ? `${label ? `${label} · ` : ''}owner of this machine · Zeno has no account and no cloud identity`
      : 'This machine could not be identified — /mesh/devices did not answer. Zeno has no account either way.';
    if (youRow) {
      setText($('.lab', youRow), name);
      setText($('.sub', youRow), sub);
    }
    // The same claim is repeated on the nav's account button.
    for (const av of $$('.avatar-mono', modal)) setText(av, initials(name));
    const who = $('.set-acct .who', modal);
    if (who) {
      const b = $('b', who);
      if (b) setText(b, name);
      const small = [...who.children].find((n) => n.tagName === 'SPAN');
      if (small) setText(small, mesh.ok ? 'local owner · no account' : 'identity unread');
    }
  } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Device key');
    const pill = row && $('.pill', row);
    if (pill) {
      if (!mesh.ok) setPill(pill, 'bad', 'could not be read', true);
      else {
        const host = dev && dev.host ? String(dev.host) : '';
        const key = dev && dev.publicKey ? mono(String(dev.publicKey)) : '';
        setPill(pill, 'cyan', host && key ? `${host} · ${key}` : 'not reported', true);
      }
    }
  } catch { /* skip quietly */ }

  try {
    const signoutBtn = pane.querySelector('[data-set-signout]');
    const row = signoutBtn ? rows.find((r) => r.contains(signoutBtn)) : null;
    if (row) {
      const sub = $('.sub', row);
      if (sub) {
        setText(sub, hasOwner
          ? 'This window holds the owner token — the only thing that can approve an effect. There is no in-page sign-out: the daemon ties it to this browser session, which a page script cannot revoke. Closing this window is what releases it; a fresh launch is needed to approve again.'
          : 'This window has no owner token, so it is already read-only — it can read but cannot approve.');
      }
      if (signoutBtn) {
        signoutBtn.disabled = true;
        signoutBtn.style.opacity = '.5';
        signoutBtn.title = hasOwner
          ? 'Close this window to release the owner token — there is no in-page sign-out.'
          : 'Already read-only.';
      }
    }
  } catch { /* skip quietly */ }

  /* The footer's "Review the security model" link carries `data-set-customize`,
     so ui.js closed the modal and toasted "Customize: Skills · Connectors ·
     Plugins" — a link whose label promises the security model and which instead
     names the connector hub is a control that changes nothing the owner asked
     for. The security model has a real surface two inches away: the Privacy &
     Security pane of this same modal. Point it there. */
  try {
    const link = $('.set-tos a', pane);
    if (link) {
      const fresh = detach(link); // drop ui.js's toast-and-close handler
      fresh.removeAttribute('data-set-customize');
      fresh.title = 'Opens Privacy & Security in this window.';
      fresh.addEventListener('click', (e) => {
        e.preventDefault();
        const nav = modal.querySelector('[data-setcat="security"]');
        if (nav) nav.click();
      });
    }
  } catch { /* skip quietly */ }
}

/* ============================================================ *
 * boot                                                           *
 * ============================================================ */

export async function bind() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  const sections = [bindGeneral, bindAppearance, bindModels, bindVoice, bindConnectors, bindSecurity, bindAccount];
  for (const section of sections) {
    try {
      await section(modal);
    } catch {
      // One category's failure must not blank the rest of the modal, or the
      // categories that have not run yet.
    }
  }
}
