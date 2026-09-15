/**
 * bind/forge/modelpicker.js — the model / effort pills, the Single/Compare/
 * Route picker popup, and the VRAM meter Compare mode shows.
 *
 * Registers `S.paintModelPills` (session.js repaints the pills whenever it
 * switches sessions). Compare is bound separately by bind/compare.js: it runs
 * each selected provider in an isolated worktree, measures real elapsed time,
 * and leaves every proposed effect behind the normal approval gate.
 */
import {
  $, $$, el, fill, getJSON,
} from '../../bind.js';
import { add, setTrailingText } from './dom.js';

const GB = 1024 * 1024 * 1024;

export function setupModelPicker(S) {
  const ide = S.ide;
  let hostData = null;
  let hostBusy = false;

  async function loadAgents() {
    const r = await getJSON('/forge/agents');
    if (!r.ok) { S.agentsData = null; S.agentsErr = r.error; } else { S.agentsData = r.data; S.agentsErr = null; }
    paintModelPills();
  }
  async function loadHost() {
    if (hostBusy) return;
    hostBusy = true;
    const r = await getJSON('/forge/models/host');
    hostBusy = false;
    hostData = r.ok ? r.data : null;
  }

  function pickerModels() {
    const rows = [];
    const locals = (S.agentsData && Array.isArray(S.agentsData.localModels)) ? S.agentsData.localModels : [];
    for (const name of locals) {
      rows.push({ key: `local::${name}`, agentId: 'local', model: name, name, sub: 'Ollama · on this machine', where: 'local', group: 'On this machine', available: true });
    }
    const list = (S.agentsData && Array.isArray(S.agentsData.agents)) ? S.agentsData.agents : [];
    for (const a of list) {
      if (a.id === 'local') continue;
      const where = a.hosted === false ? 'local' : 'cloud';
      const group = a.label || a.id;
      const avail = a.available !== false;
      const models = Array.isArray(a.models) ? a.models : [];
      if (!models.length) rows.push({ key: `${a.id}::`, agentId: a.id, model: '', name: `${group} · default`, sub: group, where, group, available: avail, reason: a.unavailableReason });
      else for (const m of models) rows.push({ key: `${a.id}::${m}`, agentId: a.id, model: m, name: m, sub: group, where, group, available: avail, reason: a.unavailableReason });
    }
    return rows;
  }

  function approxModelVram(name) {
    const models = (hostData && Array.isArray(hostData.models)) ? hostData.models : null;
    if (!models) return null;
    const hit = models.find((m) => m && m.name === name);
    return hit && Number.isFinite(hit.estVramBytes) && hit.estVramBytes > 0 ? hit.estVramBytes : null;
  }

  // ---- take over the model / effort pills ui.js wired to its mock picker ----
  // Scoped to #ide: [data-model-pill]/[data-effort-pill] also label the
  // top bar chip and the Home/Chats/Settings composer pills (one shared
  // "default model" concept outside Forge). An unscoped query here would
  // steal those buttons — strip ui.js's mock listener off them too and
  // repaint them from Forge's own per-session state, which is wrong for
  // every screen but this one. Only #s-model and the hero pill are Forge's.
  const modelPillEls = $$('[data-model-pill]', ide);
  modelPillEls.forEach((p) => p.removeAttribute('data-model-pill'));
  const effortPillEls = $$('[data-effort-pill]', ide);
  effortPillEls.forEach((p) => p.removeAttribute('data-effort-pill'));

  function modelPillInfo(session) {
    if (!session) return { text: 'Route by policy', cloud: false };
    if (session.autoRoute) return { text: 'Route by policy', cloud: false };
    const local = session.agentId === 'local';
    const label = session.model || (local ? 'default' : session.agentId);
    return { text: `${label} · ${local ? 'local' : 'cloud'}`, cloud: !local };
  }
  function paintModelPills() {
    const session = S.sessions[S.activeIdx] || S.draftSession;
    const info = modelPillInfo(session);
    for (const p of modelPillEls) {
      p.classList.remove('am', 'cy');
      p.classList.add(info.cloud ? 'am' : 'cy');
      fill(p, el('span', 'd'), document.createTextNode(`${info.text} ▾`));
    }
    for (const p of effortPillEls) setTrailingText(p, `effort: ${session.effort || 'medium'} ▾`);
  }
  S.paintModelPills = paintModelPills;
  // The Command orb's model nodes pick a model here without opening the popup
  // (field.js dispatches this after switching to Forge). Same three fields a
  // picker row sets, so the run that follows uses exactly this model. It is
  // written to BOTH the active session and the draft, so whichever one the
  // next repaint reads shows the pick — and remembered on S so a session
  // created afterwards inherits it too.
  function applyPickedModel(agentId, model) {
    if (typeof model !== 'string' || !model) return;
    S.pickedModel = { agentId: agentId || 'local', model };
    for (const session of [S.sessions[S.activeIdx], S.draftSession]) {
      if (!session) continue;
      session.agentId = agentId || 'local'; session.model = model; session.autoRoute = false;
    }
    paintModelPills();
  }
  S.applyPickedModel = applyPickedModel;
  // Exposed on window too: field.js (the Command orb, a different module graph)
  // calls this directly rather than only firing an event, so the pick cannot be
  // lost to listener-registration timing. If a picked model was set before this
  // binder ran, apply it now.
  window.zenoApplyForgeModel = applyPickedModel;
  window.addEventListener('zeno:forge-select-model', (e) => {
    const d = e && e.detail;
    if (d) applyPickedModel(d.agentId, d.model);
  });
  if (window.__zenoPendingForgeModel) {
    const p = window.__zenoPendingForgeModel;
    applyPickedModel(p.agentId, p.model);
  }
  effortPillEls.forEach((p) => {
    p.addEventListener('click', () => {
      const session = S.sessions[S.activeIdx] || S.draftSession;
      const order = ['low', 'medium', 'high'];
      const i = order.indexOf(session.effort || 'medium');
      session.effort = order[(i + 1) % order.length];
      paintModelPills();
    });
  });

  let mpEl = null, mpAnchor = null;
  const CMP = new Set();
  let mpMode = 'single';
  function closeMp() { if (mpEl) { mpEl.remove(); mpEl = null; } mpAnchor = null; }
  document.addEventListener('click', (e) => { if (mpEl && !mpEl.contains(e.target)) closeMp(); });

  /** The one-line verdict under the VRAM bar: whether the locally-selected
   *  models are estimated to fit this GPU's usable budget, and how many
   *  cloud picks (which never touch local VRAM, so they never affect fit)
   *  are also selected. */
  function vramNoteText({ hasGpu, selected, localsSel, cloudN, anyUnknown, fit }) {
    if (!hasGpu) {
      if (!selected.length) return 'Select 2 or 3 models to compare';
      return `${localsSel.length} local · ${cloudN} cloud selected — cloud runs off-GPU`;
    }
    if (!localsSel.length) return cloudN ? 'Cloud models only — no local VRAM used' : 'Select 2 or 3 models to compare';
    if (anyUnknown) return 'Approx VRAM unknown for a selected model — projection unavailable';

    let text;
    if (fit === 'ok') text = 'fits comfortably on this GPU';
    else if (fit === 'tight') text = 'fits — little headroom';
    else text = 'won’t fit at once — locals run one at a time';
    if (cloudN) text += ` · +${cloudN} cloud off-GPU`;
    return text;
  }

  function buildVramFoot(foot, session) {
    fill(foot);
    const rows = pickerModels();
    const selected = [...CMP].map((k) => rows.find((r) => r.key === k)).filter(Boolean);
    const localsSel = selected.filter((r) => r.where === 'local');
    const cloudN = selected.length - localsSel.length;

    const gpu = hostData && hostData.gpu && hostData.gpu.detected ? hostData.gpu : null;
    const hasGpu = Boolean(gpu && typeof gpu.totalVram === 'number' && gpu.totalVram > 0);

    const approxByModel = localsSel.map((r) => approxModelVram(r.model));
    const anyUnknown = approxByModel.some((v) => v == null);
    const sumApprox = approxByModel.reduce((sum, v) => sum + (v || 0), 0);

    const RESERVE = 1.5 * GB;
    const usable = hasGpu ? Math.max(gpu.totalVram - RESERVE, gpu.totalVram * 0.75) : 0;

    // "fit" says whether the locally-selected models' estimated VRAM sits
    // comfortably inside this GPU's usable budget, is tight, or overflows it.
    // It only means anything when there IS a GPU, at least one local model
    // is selected, and every one of their estimates is actually known.
    const canEstimateFit = hasGpu && localsSel.length > 0 && !anyUnknown;
    let fit = 'ok';
    if (canEstimateFit) {
      if (sumApprox <= usable * 0.85) fit = 'ok';
      else if (sumApprox <= usable) fit = 'tight';
      else fit = 'over';
    }

    const vram = el('div', `mp-vram fit-${fit}`);
    const head = el('div', 'mp-vram-head');

    let gpuLabelText;
    if (hasGpu) gpuLabelText = `${gpu.name || 'GPU'} · ${(gpu.totalVram / GB).toFixed(0)} GB VRAM`;
    else if (hostBusy || !hostData) gpuLabelText = 'Reading GPU capability…';
    else gpuLabelText = 'No GPU detected · Ollama uses system RAM';
    add(head, el('span', 'mp-vram-gpu', gpuLabelText));

    if (hasGpu) {
      const haveEstimate = localsSel.length > 0 && !anyUnknown;
      const numText = haveEstimate
        ? `${(sumApprox / GB).toFixed(1)} / ${(gpu.totalVram / GB).toFixed(0)} GB`
        : `${(gpu.totalVram / GB).toFixed(0)} GB total`;
      add(head, el('span', 'mp-vram-num', numText));
    }
    add(vram, head);

    if (hasGpu) {
      const bar = el('div', 'mp-vram-bar');
      const fillPart = el('div', 'mp-vram-fill');
      const haveEstimate = localsSel.length > 0 && !anyUnknown && sumApprox > 0;
      const fillPercent = haveEstimate ? Math.min(100, (sumApprox / gpu.totalVram) * 100) : 0;
      fillPart.style.width = `${fillPercent}%`;
      if (haveEstimate) {
        for (const r of localsSel) {
          const v = approxModelVram(r.model);
          if (!v) continue;
          const seg = el('i', 'seg');
          seg.style.width = `${(v / sumApprox) * 100}%`;
          seg.title = `${r.model} · ≈${(v / GB).toFixed(1)} GB`;
          add(fillPart, seg);
        }
      }
      if (!fillPart.childElementCount) add(fillPart, el('i', 'seg'));
      add(bar, fillPart);

      const cap = el('span', 'mp-vram-cap');
      cap.style.left = `${Math.min(100, (usable / gpu.totalVram) * 100)}%`;
      cap.title = `Usable budget ≈ ${(usable / GB).toFixed(1)} GB — the rest is reserved for the display`;
      add(bar, cap);

      add(vram, bar);
    }

    const note = el('div', 'mp-vram-note');
    add(note, el('span', 'mp-vram-dot'));
    add(note, document.createTextNode(vramNoteText({ hasGpu, selected, localsSel, cloudN, anyUnknown, fit })));
    add(vram, note);
    add(foot, vram);

    const overflow = hasGpu && localsSel.length > 1 && !anyUnknown && fit === 'over';
    let runMode = session.compareRunMode || 'parallel';
    if (overflow) runMode = 'sequential';
    const rm = el('div', 'mp-runmode');
    const par = el('button', null, 'Parallel');
    par.type = 'button';
    par.setAttribute('aria-pressed', runMode === 'parallel' ? 'true' : 'false');
    if (overflow) { par.disabled = true; par.title = 'These models exceed this GPU’s VRAM budget — they can’t be held at once'; }
    const seq = el('button', null, 'Sequential');
    seq.type = 'button';
    seq.setAttribute('aria-pressed', runMode === 'sequential' ? 'true' : 'false');
    par.addEventListener('click', () => { if (par.disabled) return; session.compareRunMode = 'parallel'; renderMpList(); });
    seq.addEventListener('click', () => { session.compareRunMode = 'sequential'; renderMpList(); });
    add(rm, par, seq);
    add(foot, rm);

    const frow = el('div', 'mp-foot-row');
    add(frow, el('span', null, selected.length ? `One task · ${selected.length} model(s) · isolated worktrees` : 'Select 2 or 3 models to run side by side'));
    const runBtn = el('button', 'btn p sm', selected.length ? `Compare ${selected.length} →` : 'Compare →');
    runBtn.id = 'mp-run';
    runBtn.type = 'button';
    runBtn.disabled = selected.length < 2;
    add(frow, runBtn);
    add(foot, frow);
  }

  function renderMpList() {
    if (!mpEl) return;
    const session = S.sessions[S.activeIdx] || S.draftSession;
    const list = mpEl.querySelector('.mp-list');
    const foot = mpEl.querySelector('.mp-foot');
    if (!list) return;
    if (mpMode === 'route') {
      const locals = (S.agentsData && Array.isArray(S.agentsData.localModels)) ? S.agentsData.localModels : [];
      // Keep the preview aligned with packages/forge/src/routing.ts and
      // routes/forge-run.ts. Ollama returns its most recently modified model
      // first, which is not Zeno's deterministic choice for an automatic run.
      const localName = ['qwen3:8b', 'qwen3:14b', 'qwen3:4b'].find((name) => locals.includes(name))
        || locals[0] || 'a local model';
      const clouds = ((S.agentsData && S.agentsData.agents) || []).filter((a) => a.id !== 'local' && a.hosted !== false);
      const wrap = el('div', 'rt');
      // The owner's own complaint about this screen: "Route mode UI, can't
      // select anything." That is by design (there is nothing to pick — it
      // is a mode, not a list), but a picker that lets you click nothing
      // reads as broken. This banner says so directly, with a real Close
      // button (closeMp() — the same one every other exit from this popup
      // uses), rather than leaving the owner to guess it is working as
      // intended.
      const confirmBar = el('div', 'rt-confirm');
      confirmBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;margin-bottom:8px;border-radius:8px;background:color-mix(in srgb,var(--cyan) 12%,transparent);border:1px solid color-mix(in srgb,var(--cyan) 30%,transparent);';
      add(confirmBar, el('span', null, 'Route is on — Zeno picks per task automatically. There is nothing to select here.'));
      const closeRouteBtn = el('button', 'btn g sm', 'Close');
      closeRouteBtn.type = 'button';
      closeRouteBtn.addEventListener('click', () => closeMp());
      add(confirmBar, closeRouteBtn);
      const lead = el('div', 'rt-lead');
      add(lead, el('b', null, 'Local-first.'), document.createTextNode(' Zeno runs your task on-device and only reaches a cloud model after you approve the egress.'));
      const ladder = el('div', 'rt-ladder');
      const s1 = el('div', 'rt-step local'); add(s1, el('span', 'n', '1'));
      const s1b = el('div'); add(s1b, el('div', 'rt-t', localName), el('div', 'rt-s', 'Tries here first. Private, no bill, no egress tier.')); add(s1, s1b);
      const s2 = el('div', 'rt-step cloud'); add(s2, el('span', 'n', '2'));
      const s2b = el('div'); add(s2b, el('div', 'rt-t', 'Escalate only if the local model can’t'),
        el('div', 'rt-s', clouds.length ? `Available on this machine: ${clouds.map((c) => c.label || c.id).join(', ')}.` : 'No cloud agent is configured on this machine, so Route stays fully local.'));
      add(s2, s2b);
      add(ladder, s1, s2);
      add(wrap, confirmBar, lead, ladder);
      fill(list, wrap);
      fill(foot);
      return;
    }
    if (S.agentsErr) { fill(list, el('div', 'mp-empty', `Agents unavailable — ${S.agentsErr}`)); return; }
    if (!S.agentsData) { fill(list, el('div', 'mp-empty', 'Reading the available agents…')); return; }
    const searchIn = mpEl.querySelector('.mp-search input');
    const query = searchIn ? searchIn.value.trim().toLowerCase() : '';
    const rows = pickerModels().filter((m) => !query || `${m.name} ${m.sub || ''}`.toLowerCase().includes(query));
    const curKey = session.autoRoute ? null : `${session.agentId}::${session.model || ''}`;
    let lastG = null;
    const nodes = [];
    for (const m of rows) {
      if (m.group && m.group !== lastG) { nodes.push(el('div', 'mp-g', m.group)); lastG = m.group; }
      const b = el('button', 'mp-row');
      b.type = 'button';
      // Compare is a separate binder because it owns the isolated multi-run
      // lifecycle. Give it the daemon-native provider and model identities;
      // model names alone cannot preserve the hosted provider boundary.
      b.dataset.mid = m.model || m.key;
      b.dataset.model = m.model || '';
      b.dataset.agentId = m.agentId;
      b.dataset.where = m.where;
      b.setAttribute('role', mpMode === 'compare' ? 'checkbox' : 'radio');
      const checked = mpMode === 'compare' ? CMP.has(m.key) : m.key === curKey;
      b.setAttribute('aria-checked', checked ? 'true' : 'false');
      /* The row's CSS grid reserves a leading 18px icon column (it is shared with
         ui.js's own picker, which draws an icon there). Without an icon element
         the NAME landed in that 18px column and wrapped one character per line —
         the "sonnet / Cla / ude" mangling. A real state dot fills the column:
         green = on this machine, amber = leaves this machine. */
      const dot = el('span', 'mi');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex:none;align-self:center;background:${m.where === 'local' ? 'var(--green)' : 'var(--amber)'}`;
      const mn = el('span', 'mn'); add(mn, document.createTextNode(m.name), el('span', null, m.sub || ''));
      const tierText = !m.available ? (m.reason || 'unavailable') : m.where === 'local' ? 'free · on-device' : 'T3 egress';
      add(b, dot, mn, el('span', `mt ${m.available ? (m.where === 'local' ? 'loc' : 'eg') : ''}`.trim(), tierText));
      if (!m.available) { b.disabled = true; b.title = m.reason || 'unavailable'; }
      b.addEventListener('click', () => {
        if (!m.available) return;
        if (mpMode === 'compare') {
          if (CMP.has(m.key)) CMP.delete(m.key); else { if (CMP.size >= 3) return; CMP.add(m.key); }
          if (!hostData && !hostBusy) void loadHost().then(renderMpList);
          renderMpList();
          return;
        }
        session.agentId = m.agentId; session.model = m.model; session.autoRoute = false;
        closeMp();
        paintModelPills();
      });
      nodes.push(b);
    }
    if (!nodes.length) nodes.push(el('div', 'mp-empty', query ? 'No model matches that search.' : 'No models available yet.'));
    fill(list, ...nodes);
    if (mpMode === 'compare') buildVramFoot(foot, session); else fill(foot);
  }

  function openMp(anchor) {
    const session = S.sessions[S.activeIdx] || S.draftSession;
    if (mpEl && mpAnchor === anchor) { closeMp(); return; }
    closeMp();
    mpAnchor = anchor;
    mpMode = session.autoRoute ? 'route' : 'single';
    CMP.clear();
    mpEl = el('div', 'mp');
    mpEl.setAttribute('role', 'dialog');
    mpEl.setAttribute('aria-label', 'Choose a Forge model');
    mpEl.addEventListener('click', (e) => e.stopPropagation());
    const search = el('div', 'mp-search');
    const q = document.createElement('input');
    q.placeholder = 'Search all models'; q.autocomplete = 'off';
    add(search, q);
    const modeRow = el('div', 'mp-mode');
    const modes = [['single', 'Single'], ['compare', 'Compare'], ['route', 'Route']];
    const btns = modes.map(([id, label]) => {
      const b = el('button', null, label); b.type = 'button';
      b.setAttribute('aria-pressed', id === mpMode ? 'true' : 'false');
      b.addEventListener('click', () => {
        mpMode = id;
        btns.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        if (id === 'route') { session.autoRoute = true; paintModelPills(); }
        if (id === 'compare' && !hostData && !hostBusy) void loadHost().then(renderMpList);
        renderMpList();
      });
      add(modeRow, b);
      return b;
    });
    const list = el('div', 'mp-list');
    const foot = el('div', 'mp-foot');
    add(mpEl, search, modeRow, list, foot);
    document.body.appendChild(mpEl);
    renderMpList();
    const r = anchor.getBoundingClientRect();
    const w = 360, h = Math.min(520, mpEl.offsetHeight || 400);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const top = r.top > h + 12 ? r.top - h - 8 : r.bottom + 8;
    mpEl.style.left = `${left}px`;
    mpEl.style.top = `${Math.max(8, top)}px`;
    q.addEventListener('input', renderMpList);
  }
  modelPillEls.forEach((p) => p.addEventListener('click', (e) => { e.stopPropagation(); openMp(p); }));
  window.addEventListener('zeno:open-model-manager', () => {
    const anchor = modelPillEls.find((pill) => pill.offsetParent !== null) || modelPillEls[0];
    if (anchor) openMp(anchor);
  });

  return { loadAgents };
}
