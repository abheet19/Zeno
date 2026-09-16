/*
 * bind/compare.js — run the same task on two or three models, for real.
 *
 * What this replaces was the most dishonest thing left in the product. The
 * artifact's openCompare() never ran anything: it slept for
 * `1500 + Math.random()*1000` milliseconds, printed one of two hardcoded diffs,
 * invented a token count and a dollar cost, presented a fabricated wall time as
 * a benchmark, and finished by claiming it had staged a change under a random
 * four-hex-digit id. Every number on that screen was made up, and it was
 * arranged to look exactly like evidence.
 *
 * This runs the models. Each column is a real POST /forge/run in its own
 * isolated worktree, the wall time is measured, the diff is the one the model
 * actually produced, and "Keep this" approves that column's real proposals and
 * refuses the others. Nothing here invents a number; a column that fails says
 * what failed.
 *
 * GPU HONESTY. The owner asked for concurrent comparison "if the GPU supports
 * it", and the truthful answer is sometimes no. /forge/models/host reports the
 * real card, its real VRAM, and an estimate per installed model. If the
 * selection fits, the local runs go together; if it does not, they are chained
 * one at a time and the screen SAYS SO rather than pretending to parallelism it
 * cannot deliver.
 */

import { $, $$, el, authHeaders, getJSON } from '../bind.js';

/* A cloud row names a provider, not a CLI. These are the agent ids the daemon
   knows; anything not mapped is not runnable from here and says so. */
const HOSTED_AGENT = {
  'claude-opus-5': 'claude-code',
  'claude-sonnet-5': 'claude-code',
  'gpt-5-codex': 'codex',
  codex: 'codex',
};

const GB = 1024 * 1024 * 1024;

function post(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

/** The models the owner ticked, read from the picker's own DOM. */
function selected() {
  return $$('.mp .mp-row[aria-checked="true"][data-mid]')
    .map((b) => ({
      id: b.dataset.mid,
      model: b.dataset.model !== undefined ? b.dataset.model : b.dataset.mid,
      agentId: b.dataset.agentId || (b.dataset.where === 'local' ? 'local' : HOSTED_AGENT[b.dataset.mid]),
      where: b.dataset.where,
      name: (b.querySelector('.mn')?.childNodes[0]?.textContent || b.dataset.mid).trim(),
    }))
    .filter((m) => m.id && m.id !== 'route');
}

/**
 * Can these run together?
 *
 * Only local models contend for the card — a hosted run happens on someone
 * else's hardware and costs this GPU nothing. The reserve keeps the display
 * alive; a comparison that freezes the machine is not a comparison.
 */
async function gpuPlan(models) {
  const host = await getJSON('/forge/models/host');
  const locals = models.filter((m) => m.where === 'local');
  if (!host.ok) {
    return { known: false, sequential: true, why: 'The GPU could not be read, so the local runs are chained one at a time to be safe.' };
  }
  const gpu = host.data.gpu || {};
  const sizes = Array.isArray(host.data.models) ? host.data.models : [];
  const est = (id) => {
    const hit = sizes.find((s) => s.name === id);
    return hit && hit.estVramBytes ? hit.estVramBytes : 0;
  };
  const need = locals.reduce((sum, m) => sum + est(m.id), 0);
  if (!gpu.detected || !gpu.totalVram) {
    return {
      known: false, sequential: locals.length > 1, gpu,
      why: locals.length > 1
        ? 'No GPU was detected, so the local runs are chained one at a time.'
        : 'No GPU was detected.',
    };
  }
  const total = gpu.totalVram;
  const usable = Math.max(0, total - 1.5 * GB); // the rest is the display's
  const fits = need > 0 && need <= usable;
  return {
    known: true,
    gpu,
    needBytes: need,
    usableBytes: usable,
    sequential: locals.length > 1 && !fits,
    why: locals.length < 2
      ? `${gpu.name || 'GPU'} · one local model in this comparison.`
      : fits
        ? `${gpu.name || 'GPU'} · ${(need / GB).toFixed(1)} GB of ${(usable / GB).toFixed(1)} GB usable — these run together.`
        : `${gpu.name || 'GPU'} · ${(need / GB).toFixed(1)} GB needed but only ${(usable / GB).toFixed(1)} GB usable — chained one at a time.`,
  };
}

/* ---- the panel ----------------------------------------------------------- */

let panel = null;

function close() {
  if (panel) { panel.remove(); panel = null; }
}

function column(m) {
  const col = el('div', 'cmp-col');
  col.dataset.mid = m.id;
  const head = el('div', 'cmp-colh');
  const nm = el('span', 'cmp-nm');
  nm.append(el('b', null, m.name), el('span', null, m.where === 'local' ? 'on this machine' : 'leaves this machine'));
  const stat = el('span', 'pill wt');
  stat.append(el('span', 'd'), document.createTextNode('queued'));
  head.append(nm, stat);
  const body = el('div', 'cmp-body');
  body.append(el('div', 'fnote', 'Waiting to start.'));
  col.append(head, body);
  return { m, col, stat, body };
}

function setStat(c, tone, text) {
  c.stat.className = `pill ${tone}`;
  c.stat.replaceChildren(el('span', 'd'), document.createTextNode(text));
}

/** Render exactly what the run reported. No invented metric appears here. */
function renderOutcome(c, result, ms) {
  const { body } = c;
  body.replaceChildren();

  if (!result.started) {
    setStat(c, 'rd', 'did not start');
    body.append(el('div', 'fnote', result.reason || result.note || 'The run did not start and reported no reason.'));
    return { kept: 0 };
  }
  const proposed = Array.isArray(result.proposed) ? result.proposed : [];
  const changed = Array.isArray(result.changed) ? result.changed : [];

  if (result.cancelled) setStat(c, 'wt', 'cancelled');
  else if (!result.ok) setStat(c, 'am', 'ran, did not succeed');
  else setStat(c, proposed.length ? 'gr' : 'wt', proposed.length ? 'ready to review' : 'no change proposed');

  // Measured, not modelled. This is the one number Compare is actually for.
  const mtr = el('div', 'cmp-mtr');
  const wall = el('div');
  wall.append(el('span', 'k', 'Wall time'), el('b', null, `${(ms / 1000).toFixed(1)}s`));
  const files = el('div');
  files.append(el('span', 'k', 'Files proposed'), el('b', null, String(proposed.length)));
  mtr.append(wall, files);
  body.append(mtr);

  if (result.note) body.append(el('div', 'fnote', result.note));

  if (!proposed.length) {
    body.append(el('div', 'fnote', changed.length
      ? `The run changed ${changed.length} file(s) but none became a proposal — see the run note.`
      : 'This model proposed no change for this task.'));
    return { kept: 0 };
  }

  const list = el('div', 'cmp-files');
  for (const p of proposed) {
    const row = el('div', 'lrow');
    row.append(el('span', 'tier', p.tier || 'T?'), el('div', null, p.path));
    list.append(row);
  }
  body.append(list);
  return { kept: proposed.length };
}

/* ---- the run ------------------------------------------------------------- */

async function runOne(c, task, onDone) {
  const m = c.m;
  const started = performance.now();
  setStat(c, m.where === 'local' ? 'cy' : 'am', 'running');
  c.body.replaceChildren(el('div', 'fnote',
    m.where === 'local'
      ? 'Running on this machine, in an isolated worktree.'
      : 'Running on a hosted agent, in an isolated worktree.'));

  const agentId = m.agentId || (m.where === 'local' ? 'local' : HOSTED_AGENT[m.id]);
  if (!agentId) {
    setStat(c, 'rd', 'not runnable');
    c.body.replaceChildren(el('div', 'fnote',
      `Zeno has no agent for "${m.name}". Only the installed local models and the claude and codex CLIs can run a task.`));
    onDone(c, { started: false, reason: 'no agent for this model' }, 0);
    return;
  }

  // The daemon uses a run id as the leaf of an isolated worktree. Keep this
  // display-independent id portable: local Ollama names contain `:` (for
  // example qwen3:14b), which Windows treats as a drive/ADS separator.
  const safeModelId = m.id.replace(/[^A-Za-z0-9._-]/g, '-');
  const payload = { task, agentId, runId: `cmp-${safeModelId}-${Math.floor(performance.now())}` };
  if (m.model) payload.model = m.model;
  else payload.hostedConfirmed = true; // the owner confirmed at the Compare button

  const res = await post('/forge/run', payload);
  const ms = performance.now() - started;

  if (res.status !== 200) {
    const e = (res.body && res.body.error) || {};
    setStat(c, 'rd', 'refused');
    c.body.replaceChildren(el('div', 'fnote', `${e.message || res.status}${e.resolve ? ' — ' + e.resolve : ''}`));
    onDone(c, { started: false, reason: e.message || `HTTP ${res.status}` }, ms);
    return;
  }
  onDone(c, res.body || {}, ms);
}

/** Keep one column's proposals; refuse every other column's. */
async function keep(winner, all, summary) {
  summary.replaceChildren(el('div', 'fnote', 'Applying your choice…'));
  let approved = 0; let refused = 0; const errors = [];

  for (const c of all) {
    const proposals = (c.result && Array.isArray(c.result.proposed)) ? c.result.proposed : [];
    for (const p of proposals) {
      const path = c === winner ? '/approvals' : '/approvals/decline';
      const r = await post(path, { actionHash: p.actionHash, reason: 'Compare: another model was kept' });
      if (r.status === 200) { if (c === winner) approved += 1; else refused += 1; }
      else errors.push(`${c.m.name} ${p.path}: ${(r.body && r.body.error && r.body.error.message) || r.status}`);
    }
    c.col.classList.add(c === winner ? 'win' : 'lost');
    const btn = c.col.querySelector('[data-keep]');
    if (btn) btn.remove();
  }

  const out = el('div');
  out.append(el('div', null,
    `Kept ${winner.m.name}: ${approved} change${approved === 1 ? '' : 's'} approved and sealed. `
    + `${refused} proposal${refused === 1 ? '' : 's'} from the other models were refused.`));
  if (errors.length) {
    const warn = el('div', 'fnote', `Some decisions did not apply: ${errors.join(' · ')}`);
    warn.style.color = 'var(--amber)';
    out.append(warn);
  }
  summary.replaceChildren(out);
  window.dispatchEvent(new CustomEvent('zeno:state'));
}

async function openCompare(models, task) {
  close();
  panel = el('div', 'cmpv');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Compare models on one task');

  const plan = await gpuPlan(models);

  const top = el('div', 'cmp-top');
  const tt = el('div', 'cmp-tt');
  tt.append(
    el('span', 'k', `Compare run · one task · ${plan.sequential ? 'chained' : 'together'}`),
    el('b', null, task),
  );
  const x = el('button', 'btn g sm', 'Close');
  x.addEventListener('click', close);
  top.append(tt, x);

  const why = el('div', 'fnote', plan.why);
  const grid = el('div', 'cmp-grid');
  const summary = el('div', 'cmp-sum');
  summary.append(el('div', 'fnote', 'Each model runs the same task in its own isolated worktree. Nothing is applied until you keep one.'));
  panel.append(top, why, grid, summary);
  document.body.append(panel);

  const cols = models.map((m) => {
    const c = column(m);
    grid.append(c.col);
    return c;
  });

  let settled = 0;
  const onDone = (c, result, ms) => {
    c.result = result;
    const r = renderOutcome(c, result, ms);
    if (r.kept > 0) {
      const foot = el('div', 'cmp-colf');
      const btn = el('button', 'btn p sm', 'Keep this');
      btn.setAttribute('data-keep', '1');
      btn.addEventListener('click', () => void keep(c, cols, summary));
      foot.append(btn);
      c.col.append(foot);
    }
    settled += 1;
    if (settled === cols.length) {
      const ready = cols.filter((k) => k.result && k.result.started && Array.isArray(k.result.proposed) && k.result.proposed.length);
      summary.replaceChildren(el('div', 'fnote', ready.length
        ? `${ready.length} of ${cols.length} models proposed a change. Keep one — the rest are refused.`
        : 'No model proposed a change for this task. Nothing is waiting on you.'));
    }
  };

  const hosted = cols.filter((c) => c.m.where !== 'local');
  const locals = cols.filter((c) => c.m.where === 'local');

  // Hosted runs never touch this GPU, so they always go concurrently.
  hosted.forEach((c) => void runOne(c, task, onDone));

  if (!plan.sequential) {
    locals.forEach((c) => void runOne(c, task, onDone));
  } else {
    for (const c of locals.slice(1)) {
      setStat(c, 'wt', 'queued');
      c.body.replaceChildren(el('div', 'fnote', 'Queued — this GPU runs these one at a time.'));
    }
    (async () => {
      for (const c of locals) {
        // eslint-disable-next-line no-await-in-loop -- chaining is the point
        await new Promise((done) => void runOne(c, task, (cc, result, ms) => { onDone(cc, result, ms); done(); }));
      }
    })();
  }
}

export async function bind() {
  /* ui.js builds the Compare button inside its own footer sync, so it is a new
     node every time the picker repaints and cannot be replaced once. Capture the
     click on the way down instead, and stop it before ui.js's handler sees it —
     that handler calls the fabricated openCompare. */
  document.addEventListener('click', (e) => {
    const run = e.target && e.target.closest && e.target.closest('#mp-run');
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const models = selected();
    if (models.length < 2) return;

    const ta = $('#s-ta') || $('#ag-ta') || $('#home-ta');
    const task = (ta && ta.value.trim()) || '';
    if (!task) {
      const mp = document.querySelector('.mp');
      if (mp) mp.hidden = true;
      const composer = $('#s-ta') || $('#ag-ta');
      if (composer) composer.focus();
      return; // nothing to compare ON; the owner types a task first
    }
    const mp = document.querySelector('.mp');
    if (mp) mp.hidden = true;
    void openCompare(models, task);
  }, true);
}
