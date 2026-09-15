/*
 * bind/settings/models.js — the Models pane: Cloud API keys / hosted
 * agent sign-in, Default model, Manage models.
 *
 * Real state this file is grounded in:
 *   - GET /forge/agents?passive=1 (the `?passive=1` matches field.js's own
 *     call — this read must never be the thing that starts a local Ollama
 *     runtime). agents[] + localModels[] decide what Forge would actually
 *     run right now; there is no separate "default model" setting.
 *   - Zeno stores no API key. Zeno's hosted rungs SPAWN the installed
 *     `claude` and `codex` binaries (packages/forge/src/runner.ts —
 *     CLAUDE_BINARY / CODEX_BINARY) with the inherited environment. No key
 *     is injected anywhere in forge or daemon — grep for ANTHROPIC_API_KEY
 *     finds nothing. So a hosted run uses whatever sign-in those CLIs
 *     already have, i.e. the owner's existing subscription, and consumes no
 *     separate API credit.
 *   - Default model: read-only. `defaultModel` does not exist anywhere in
 *     packages/daemon/src — there is no preference to write — so the pill is
 *     disabled and says so rather than keep a caret that opens nothing.
 */
import { getJSON, $, setText } from '../../bind.js';
import { rowByLabel, setPill } from './shared.js';

function pickAgent(agents) {
  const priority = ['local', 'codex', 'claude-code'];
  return priority.map((id) => agents.find((a) => a && a.id === id && a.available !== false)).find(Boolean)
    || agents.find((a) => a && a.available !== false)
    || null;
}

export async function bindModels(modal) {
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
        setTimeout(() => window.dispatchEvent(new CustomEvent('zeno:open-model-manager')), 0);
      });
    }
  } catch { /* skip quietly */ }
}
