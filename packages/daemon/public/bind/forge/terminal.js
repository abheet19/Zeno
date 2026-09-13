/**
 * bind/forge/terminal.js — the bottom panel: the real terminal, the ports
 * tab and the output tab.
 *
 * Every command the box sends goes to POST /forge/terminal and runs exactly
 * as typed — there is no server-side or client-side gate that holds a
 * write/push/rm/curl/deploy command for approval before it runs (only file
 * writes from an agent run go through the approval gate). Registers
 * `S.showPanel`, `S.runTerminalCommand`, `S.focusTerminal` and
 * `S.clearTerminal` so the menu bar and the composer "+" menu can drive the
 * same terminal.
 *
 * The panel's toolbar icons each do the one real thing they can, or are
 * disabled with the reason: the terminal is ONE one-shot command box (no
 * profiles, no split, no long-running process to kill), so "Kill" is
 * relabelled as the clear it really is, and "@" pins the last command's
 * output as context for the next task.
 */
import { $, $$, el, fill } from '../../bind.js';
import { add, disableCtl, postJSON, safeAsk } from './dom.js';

export function setupTerminal(S) {
  const ide = S.ide;
  const termHistory = [];
  let terminalBusy = false;

  const term = $('#vs-term');
  const oldTermIn = $('#vs-termin');
  let termIn = oldTermIn;
  if (oldTermIn) {
    termIn = oldTermIn.cloneNode(true);
    oldTermIn.replaceWith(termIn);
  }
  // The prompt names the real working folder — never a fixed "sandbox" — the
  // same project name (or its basename) the Explorer header and status bar use.
  const promptBase = () => {
    if (S.project && S.project.name) return S.project.name;
    if (S.statusData && S.statusData.repo && S.statusData.root) {
      return String(S.statusData.root).split(/[\\/]/).filter(Boolean).pop() || 'workspace';
    }
    return 'workspace';
  };

  function renderTerminal() {
    if (!term) return;
    const nodes = [];
    for (const h of termHistory) {
      nodes.push(document.createTextNode(`${promptBase()}> ${h.command}\n`));
      if (h.error) {
        nodes.push(document.createTextNode(`${h.error}\n`));
      } else {
        if (h.stdout) nodes.push(document.createTextNode(h.stdout.endsWith('\n') ? h.stdout : `${h.stdout}\n`));
        if (h.stderr) nodes.push(document.createTextNode(h.stderr.endsWith('\n') ? h.stderr : `${h.stderr}\n`));
        const summary = h.failedToSpawn ? 'could not start' : `exited ${h.code} · ${h.durationMs}ms`;
        nodes.push(document.createTextNode(`[${summary}]\n`));
      }
    }
    nodes.push(document.createTextNode(`${promptBase()}> `));
    const echo = el('span', null);
    echo.id = 'vs-termecho';
    const cursor = el('span', 'cursor', '▍');
    nodes.push(echo, cursor);
    fill(term, ...nodes);
  }
  renderTerminal();

  async function runTerminalCommand(raw) {
    const cmd = String(raw || '').trim();
    if (!cmd || terminalBusy) return;
    if (cmd === 'clear') { termHistory.length = 0; renderTerminal(); return; }
    if (!S.OWNER) {
      termHistory.push({ command: cmd, error: 'This window has no owner token, so it is read-only — open Zeno from its launcher to run commands.' });
      renderTerminal();
      return;
    }
    terminalBusy = true;
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const r = await postJSON('/forge/terminal', { command: cmd });
    terminalBusy = false;
    const durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    if (!r.ok) {
      termHistory.push({ command: cmd, error: `Command request failed: ${r.error || 'unknown error'}` });
    } else {
      const d = r.data || {};
      termHistory.push({ command: cmd, code: d.code, stdout: d.stdout, stderr: d.stderr, failedToSpawn: d.failedToSpawn, durationMs });
      S.setExitCode(d.failedToSpawn ? 'exit —' : `exit ${d.code}`);
    }
    if (termHistory.length > 40) termHistory.splice(0, termHistory.length - 40);
    renderTerminal();
    paintToolbar();
    void S.loadStatus();
    if (S.refreshOpenFile) void S.refreshOpenFile();
  }
  S.runTerminalCommand = runTerminalCommand;
  S.showPanel = showPanel;
  S.focusTerminal = () => { if (termIn) termIn.focus(); };
  S.clearTerminal = () => { termHistory.length = 0; renderTerminal(); S.setExitCode('exit —'); paintToolbar(); };

  /* ---- the panel toolbar ------------------------------------------------ */
  const tabsBar = $('.vsptabs', ide);
  const lastRun = () => [...termHistory].reverse().find((h) => !h.error) || null;
  const lastOutputText = () => { const h = lastRun(); return h ? `${h.stdout || ''}${h.stderr || ''}` : ''; };
  const shellSel = tabsBar ? $('.vstermsel', tabsBar) : null;
  if (shellSel) {
    // The artifact said "powershell"; the daemon runs cmd.exe (ComSpec) on
    // Windows and $SHELL elsewhere. Say what is true instead.
    const svg = shellSel.querySelector('svg');
    fill(shellSel, svg, document.createTextNode('system shell'));
    shellSel.title = 'Each command runs once, in the repository root, with the system shell: cmd.exe (ComSpec) on Windows, $SHELL elsewhere.';
  }
  // The five icon buttons before #vsp-max/#vsp-hide, in the artifact's order:
  // Launch Profile, Add Context (@), Split Terminal, Kill Terminal, More.
  // Found by POSITION, not title: bind/controls.js also reaches for these by
  // their original titles (to switch them off), the two binders load in
  // parallel, and whichever runs second must still find them — so neither
  // lookup may depend on the other's retitling.
  const icons = tabsBar ? $$('button.fico:not([id])', tabsBar) : [];
  const [profileBtn, ctxBtn, splitTermBtn, killBtn, moreBtn] = icons;
  /** Undo an "inert" switch-off (controls.js's or this file's) so a control that CAN act now does. */
  function enable(btn, title) {
    if (!btn) return;
    btn.disabled = false;
    btn.removeAttribute('aria-disabled');
    delete btn.dataset.inert;
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.style.pointerEvents = '';
    btn.title = title;
  }
  disableCtl(profileBtn, 'One shell profile only — the daemon runs each command with the system shell; there is no profile picker in this build.');
  disableCtl(splitTermBtn, 'Forge has one one-shot terminal; there is no split terminal in this build.');
  function paintToolbar() {
    const has = lastRun() !== null;
    if (ctxBtn) {
      if (has && S.pinContext) enable(ctxBtn, 'Pin the last command and its output as context for the next task.');
      else disableCtl(ctxBtn, 'Run a command first — this pins its output as context for the next task.');
    }
    if (killBtn) {
      if (termHistory.length) enable(killBtn, 'Clear this terminal. Commands are one-shot, so there is no long-running process to kill.');
      else disableCtl(killBtn, 'Nothing to clear yet — commands are one-shot, so there is no process to kill either.');
    }
    if (moreBtn) {
      if (has) enable(moreBtn, 'Copy the last command’s output');
      else disableCtl(moreBtn, 'No command has run yet — nothing to copy.');
    }
  }
  if (ctxBtn) ctxBtn.addEventListener('click', () => {
    const h = lastRun();
    if (!h || !S.pinContext) return;
    S.pinContext({ kind: 'terminal', label: `$ ${h.command}`, text: `$ ${h.command}\n${lastOutputText()}`.slice(0, 4000) });
  });
  if (killBtn) killBtn.addEventListener('click', () => S.clearTerminal());
  if (moreBtn) moreBtn.addEventListener('click', () => {
    const text = lastOutputText();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => safeAsk(() => window.prompt('Copy the output:', text)));
    else safeAsk(() => window.prompt('Copy the output:', text));
  });
  paintToolbar();

  if (termIn) {
    termIn.value = '';
    termIn.disabled = !S.OWNER;
    termIn.addEventListener('input', () => {
      const echo = document.getElementById('vs-termecho');
      if (echo) echo.textContent = termIn.value;
    });
    termIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = termIn.value;
      termIn.value = '';
      void runTerminalCommand(v);
    });
  }
  if (term) term.addEventListener('click', () => { if (termIn) termIn.focus(); });

  // "Run Code ▷" and "Run typecheck" buttons: take over from ui.js's mock
  // runTerm() by renaming the attribute it keys off, so both listeners
  // never fire for the same click.
  $$('[data-run-cmd]').forEach((btn) => {
    const cmd = btn.dataset.runCmd;
    btn.removeAttribute('data-run-cmd');
    btn.addEventListener('click', () => {
      showPanel('terminal');
      void runTerminalCommand(cmd);
    });
  });
  function showPanel(name) {
    const tab = $(`.vsptabs [data-vsp="${name}"]`);
    if (tab) tab.click(); // pure UI toggle already wired by ui.js
  }

  // The bottom "Ports" panel ships three fabricated rows (this daemon,
  // Ollama, a vite dev server, all invented port numbers). This page can
  // only ever observe the ONE process it is talking to — its own — so
  // that is the only row drawn; the other two are removed rather than
  // left standing as read state nobody read.
  const portsPanel = $('.vsp[data-vsp="ports"]', ide);
  if (portsPanel) {
    const port = location.port || (location.protocol === 'https:' ? '443' : '80');
    const row = el('div', 'fchg');
    add(row, el('span', 'fdot ok'), document.createTextNode(` ${port} `), el('span', 'fm', `Zeno daemon · ${location.hostname}`));
    const note = el('div', 'vsnote', 'Forge cannot observe other listening ports (Ollama, a dev server, etc.) from the browser, so none are listed here.');
    fill(portsPanel, row, note);
    // …and the TAB's count has to agree with the rows underneath it. The
    // artifact hardcoded "3" there, so the tab went on advertising two ports
    // nobody read long after the pane stopped listing them — a fabricated
    // number standing in the one place a reader would trust it.
    const portsCount = $('.vsptabs [data-vsp="ports"] .fct');
    if (portsCount) portsCount.textContent = String(portsPanel.querySelectorAll('.fchg').length);
  }

  // The bottom "Output" panel ships a fabricated agent run log — a worktree
  // that never existed (wt-7f2a), an edit to a file that is not in the
  // workspace, and "142 passed" from a test run nobody ran. It is the most
  // convincing invented state on this screen, because it reads exactly like
  // something the daemon printed. Nothing here ever read it: this build has no
  // output channel for the Output view (a run's real transcript is rendered by
  // the Session panel, from /forge/run). So the log is removed and the view
  // says where run output actually lives, rather than keeping four lines of
  // fiction one panel-tab click away.
  const outputPanel = $('.vsp[data-vsp="output"]', ide);
  if (outputPanel) {
    fill(outputPanel, el('div', 'fempty',
      'Forge has no Output channel in this build. A run’s real transcript — its edits, '
      + 'its commands and their exit codes — is shown by the Session panel as the run happens, '
      + 'and every effect it caused is on the receipt ledger in Command.'));
  }

  return { renderTerminal };
}
