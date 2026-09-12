/**
 * bind/approvals.js — the COMMAND · Approvals screen, wired to the real
 * approval kernel.
 *
 * The artifact's markup for this screen (index.html, `data-screen="approvals"`)
 * is a single mocked `.caps` capsule plus an always-visible `.empty` block.
 * This binder replaces that mock: it reads GET /state, builds one real `.caps`
 * per held effect (both the kernel's own write queue and Forge's tool-call
 * gate — /state merges both into `pending`), and wires the two controls in
 * `.caps-acts` to the daemon's actual write routes:
 *
 *   Allow once  -> POST /approvals               {actionHash}
 *   Deny        -> POST /forge/permissions/decline {actionHash, reason}
 *                  (the ONLY decline route this daemon exposes, and it only
 *                  ever holds a Forge tool-call permission request — not a
 *                  plain held write. A held write has no decline path at all;
 *                  Deny stays honestly disabled on those rather than firing a
 *                  request that can only 404.)
 *
 * Honesty notes, because this screen is the approval gate itself:
 *   - Preview (packages/kernel/src/types.ts) carries exactly: actionHash,
 *     binding{payloadHash,baseHash,targetRef,kind,tier,provenanceHash}, tier,
 *     summary, reasons[], auto, denied. There is no proposer name, no
 *     timestamp, no expiry clock, no named policy string and no reversibility
 *     flag anywhere on it — so none of those are shown as if they were real.
 *     Where the artifact's `.kv` asks for a field the daemon does not report
 *     (Reversible, Policy, Stream), the row says so plainly instead of
 *     repeating the mock's invented value.
 *   - The before/after diff reuses capsule.js's own `fileReviewModel`, the
 *     exact function the previous (real) UI used to turn a held write's
 *     `review` envelope into a ready/drifted/unavailable/mismatched state —
 *     rather than re-deriving that protocol here.
 *   - Approve is disabled outright for T4 (prohibited) and T0 (auto, nothing
 *     owed) items, and for every control when this page holds no owner token
 *     (a read-only view can never approve anything).
 */
import { getJSON, $, el, fill, authHeaders, token, screenEl } from '../bind.js';
import { fileReviewModel } from '../capsule.js';

/* ---- tiny, honest formatting — no protocol here, just presentation ---- */

function truncHash(s) {
  if (typeof s !== 'string' || s.length <= 17) return String(s ?? '');
  return s.slice(0, 10) + '…' + s.slice(-6);
}

function fmtClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const KIND_WORD = {
  read: 'read',
  'local.write': 'write',
  'patch.task': 'patch',
  'shell.exec': 'run',
  'net.fetch': 'network',
  'memory.write': 'memory',
  'vcs.commit': 'vcs',
  'vcs.push': 'vcs',
  'vcs.mr': 'vcs',
  'jira.write': 'jira',
  'message.send': 'message',
  'settings.change': 'settings',
  payment: 'payment',
  destructive: 'destructive',
};

function kindWord(kind) {
  if (typeof kind === 'string' && kind) return KIND_WORD[kind] || kind;
  return 'action';
}

/** The gate marks a governed tool call's target `tool:<hash>` — the one real
 * signal that distinguishes a Forge permission request (which CAN be
 * declined) from a plain held write (which cannot). See
 * packages/forge/src/permission-gate.ts TOOL_TARGET_PREFIX. */
function isToolCall(binding) {
  return typeof binding?.targetRef === 'string' && binding.targetRef.startsWith('tool:');
}

/**
 * Which pair of endpoints settles THIS held action.
 *
 * Three queues reach this screen and they are not interchangeable. Sending a
 * held memory write to `/approvals` gets a 404 the owner reads as "the app is
 * broken", and the deny button used to be hard-disabled for every file write
 * with the note "this daemon exposes no decline endpoint" — which stopped being
 * true when `/approvals/decline` landed, leaving a permanently dead control on
 * the one screen whose entire job is making a decision possible.
 */
function endpointsFor(preview) {
  const binding = preview.binding || {};
  const kind = preview.kind || binding.kind || '';
  if (kind === 'memory.write') {
    return { approve: '/memory/approvals', decline: '/memory/approvals/decline', what: 'memory write' };
  }
  if (isToolCall(binding)) {
    return { approve: '/approvals', decline: '/forge/permissions/decline', what: 'tool call' };
  }
  return { approve: '/approvals', decline: '/approvals/decline', what: 'file write' };
}

function kvRow(dl, label, value) {
  dl.append(el('dt', null, label), el('dd', null, value));
}

/** Line-by-line spans so the artifact's own `.diff .del/.add/.ctx` colouring
 * applies to a REAL diff string (unified-diff-shaped, with explicit EOL
 * glyphs) rather than to the mock's hand-written spans. */
function buildDiffPre(diffText) {
  const pre = document.createElement('pre');
  pre.className = 'diff';
  const lines = String(diffText).split('\n');
  lines.forEach((line, i) => {
    const cls = line.startsWith('+') && !line.startsWith('+++')
      ? 'add'
      : line.startsWith('-') && !line.startsWith('---')
        ? 'del'
        : 'ctx';
    pre.appendChild(el('span', cls, line));
    if (i < lines.length - 1) pre.appendChild(document.createTextNode('\n'));
  });
  return pre;
}

function effectText(preview, review) {
  const binding = preview.binding || {};
  if (review && review.observed && review.proposed) {
    return (
      `1 file write · ${review.relPath || binding.targetRef || '(no target reported)'} · ` +
      `${review.observed.bytes} → ${review.proposed.bytes} bytes · ` +
      `${review.observed.lines} → ${review.proposed.lines} lines`
    );
  }
  if (review) {
    return `1 file write · ${review.relPath || binding.targetRef || '(no target reported)'} · exact before/after not available (${review.state})`;
  }
  const payload = preview.payload;
  if (payload && typeof payload === 'object' && typeof payload.tool === 'string') {
    return `${kindWord(binding.kind)} · a governed tool call: ${payload.tool}`;
  }
  return `${binding.kind || 'unreported kind'} on ${binding.targetRef || '(no target reported)'}`;
}

function emptyBlock() {
  const wrap = el('div', 'empty');
  wrap.append(
    el('b', null, 'Nothing is waiting on you.'),
    document.createTextNode(" /state answered just now and its pending queue is empty."),
  );
  return wrap;
}

function errorBlock(message) {
  const wrap = el('div', 'empty');
  wrap.append(
    el('b', null, 'The approval queue could not be read.'),
    document.createTextNode(
      ' ' + (message || '/state did not answer.') + ' This is not the same as "nothing is waiting" — it means this window could not check.',
    ),
  );
  return wrap;
}

/* ---- one real capsule per held effect --------------------------------- */

function capsuleFor(preview, onSettled) {
  const caps = el('div', 'caps');
  if (preview.actionHash) caps.dataset.actionHash = preview.actionHash;

  const binding = preview.binding || {};

  /* Trust the kernel's own flags. These used to read
   *   denied = preview.denied === true || preview.tier === 'T4'
   *   auto   = preview.auto   === true || preview.tier === 'T0'
   * and the `|| tier === 'T0'` half was simply wrong: it guessed that every T0
   * action is auto-approved. A T0 write OUTSIDE the sandbox is HELD — the
   * kernel reports exactly that, `{tier:'T0', auto:false}` — and the guess
   * overrode it. The Allow button was then disabled with "T0 · auto — no
   * decision is owed on this action" on an action that was, visibly, waiting
   * for a decision. The owner saw "1 approval" in the rail and could not
   * approve it.
   *
   * The queue's own meaning settles it: an auto action commits immediately and
   * is never held, so anything reaching this screen is by definition not auto.
   * T4 stays as a floor for `denied` because policy prohibits that tier
   * outright (payment, financial) — there a tier IS the whole story. */
  const denied = preview.denied === true || preview.tier === 'T4';
  const auto = preview.auto === true;
  const review = preview.review && typeof preview.review === 'object' ? preview.review : null;

  /* ---- caps-h ---- */
  const head = el('div', 'caps-h');
  const tierSpan = el('span', 'tier', `${preview.tier || '—'} · ${kindWord(binding.kind)}`);
  const titleWrap = document.createElement('div');
  const tt = el('div', 'tt', preview.summary || '(this preview carries no summary)');
  const mm = el(
    'div',
    'mm',
    `action ${truncHash(preview.actionHash) || '(no hash reported)'} · read ${fmtClock(new Date())}`,
  );
  titleWrap.append(tt, mm);
  head.append(tierSpan, titleWrap);

  /* ---- body: diff (only when the daemon actually sent one) + kv + note --- */
  const body = document.createElement('div');
  body.style.padding = '16px 18px';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '14px';

  let reviewModel = null;
  if (review) {
    try {
      reviewModel = fileReviewModel(review, preview.payload);
    } catch {
      reviewModel = null;
    }
  }

  if (reviewModel && reviewModel.state === 'ready' && typeof reviewModel.diff === 'string') {
    body.appendChild(buildDiffPre(reviewModel.diff));
    if (reviewModel.truncated) {
      body.appendChild(
        el(
          'div',
          'hnote',
          `Bounded review: ${reviewModel.omittedDiffLines.toLocaleString()} diff lines and ` +
            `${reviewModel.omittedCharacters.toLocaleString()} characters are omitted by the daemon. ` +
            'Approval stays blocked until a narrower change exposes the complete diff.',
        ),
      );
    }
  } else if (review) {
    body.appendChild(
      el(
        'div',
        'hnote',
        (reviewModel && reviewModel.blocker) || review.note || 'The exact before/after diff could not be shown for this action.',
      ),
    );
  }

  const kv = el('dl', 'kv');
  kvRow(kv, 'Effect', effectText(preview, review));
  kvRow(kv, 'Scope', binding.targetRef ? String(binding.targetRef) : '(binding carries no targetRef)');
  kvRow(kv, 'Reversible', 'not reported by /state — this build carries no reversibility flag on a preview');
  kvRow(
    kv,
    'Policy',
    Array.isArray(preview.reasons) && preview.reasons.length
      ? preview.reasons.join(' · ')
      : 'no reason reported for this tier',
  );
  kvRow(kv, 'Action hash', preview.actionHash ? String(preview.actionHash) : '(missing — this preview carries no action hash)');
  kvRow(
    kv,
    'Provenance',
    binding.provenanceHash
      ? `${truncHash(binding.provenanceHash)} — opaque hash; the proposing agent, summary and policy are hashed in, not carried in the clear`
      : '(binding carries no provenanceHash)',
  );
  kvRow(kv, 'Stream', `read once from /state at ${fmtClock(new Date())} — this screen does not hold the live event stream open`);
  body.appendChild(kv);

  let hnoteText;
  if (denied) {
    hnoteText =
      `${preview.tier || 'T4'} · prohibited — there is no approval that releases this action.` +
      (preview.reasons?.length ? ' ' + preview.reasons.join(' · ') : '');
  } else if (auto) {
    hnoteText =
      `${preview.tier || 'T0'} · auto — policy owes no decision here. It is listed because this build ` +
      'commits only through POST /approvals, so an auto action still waits rather than committing on its own.';
  } else {
    hnoteText = 'Approving binds this exact effect to this exact preview by content hash — it cannot be reused for a different action.';
  }
  body.appendChild(el('div', 'hnote', hnoteText));

  /* ---- caps-acts: the two real controls ---- */
  const acts = el('div', 'caps-acts');
  const allowBtn = el('button', 'btn p', 'Allow once');
  allowBtn.type = 'button';
  const denyBtn = el('button', 'btn dz', 'Deny');
  denyBtn.type = 'button';
  const grow = el('span', 'fgrow');
  const pill = el('span', 'pill wt', 'single-use · one attempt · expiry not reported before commit');

  const readOnly = !token();
  const hasHash = typeof preview.actionHash === 'string' && preview.actionHash !== '';
  const routes = endpointsFor(preview);

  if (!hasHash) {
    allowBtn.disabled = true;
    allowBtn.title = 'This preview carries no action hash — there is nothing to approve.';
  } else if (denied) {
    allowBtn.disabled = true;
    allowBtn.title = `${preview.tier || 'T4'} · prohibited — no path exists to approve this action.`;
  } else if (auto) {
    allowBtn.disabled = true;
    allowBtn.title = `${preview.tier || 'T0'} · auto — no decision is owed on this action.`;
  } else if (readOnly) {
    allowBtn.disabled = true;
    allowBtn.title = 'Read-only view — no owner token on this page. Open this window as the owner to approve.';
  }

  allowBtn.addEventListener('click', async () => {
    if (allowBtn.disabled) return;
    allowBtn.disabled = true;
    denyBtn.disabled = true;
    allowBtn.textContent = 'Approving…';
    try {
      const res = await fetch(routes.approve, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ actionHash: preview.actionHash }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const e = (data && data.error) || {};
        allowBtn.textContent = 'Refused — nothing applied';
        pill.textContent = `refused by the daemon · ${e.code || res.status}${e.message ? ' — ' + e.message : ''}`;
        return;
      }
      const receipt = data && typeof data === 'object' ? data.receipt : null;
      if (!receipt || typeof receipt !== 'object') {
        allowBtn.textContent = 'Outcome unknown';
        pill.textContent = 'the daemon answered with no receipt — whether this applied is unknown';
        return;
      }
      if (receipt.actionHash && receipt.actionHash !== preview.actionHash) {
        allowBtn.textContent = 'Outcome unknown';
        pill.textContent = 'the receipt returned settles a different action — whether this applied is unknown';
        return;
      }
      const outcome = receipt.outcome || 'unrecognised';
      allowBtn.textContent = outcome === 'verified' ? 'Approved — verified' : `Settled — ${outcome}`;
      pill.textContent = `${outcome}${receipt.id ? ' · receipt ' + truncHash(receipt.id) : ''}${receipt.reason ? ' — ' + receipt.reason : ''}`;
      onSettled('approve', receipt);
    } catch (err) {
      allowBtn.textContent = 'Outcome unknown';
      pill.textContent = `the request left this machine and no receipt returned (${err && err.message ? err.message : 'network error'})`;
    }
  });

  /* Every held action can be refused now. This used to be `hasHash &&
     isToolCall(binding)`, which hard-disabled Deny for every file write with
     the note "this daemon exposes no decline endpoint" — true when it was
     written, false once /approvals/decline landed, and it left a permanently
     dead control on the one screen whose whole job is making a decision
     possible. A T4 action stays undeniable because it was never approvable:
     it is already refused by policy. */
  const denyable = hasHash && !denied && !auto;
  if (!denyable) {
    denyBtn.disabled = true;
    denyBtn.title = denied
      ? 'Prohibited by policy — this action is already refused; there is nothing to decide.'
      : auto
        ? 'Auto — no decision is owed on this action.'
        : 'This preview carries no action hash, so there is nothing to refuse.';
  } else if (readOnly) {
    denyBtn.disabled = true;
    denyBtn.title = 'Read-only view — no owner token on this page.';
  }

  denyBtn.addEventListener('click', async () => {
    if (denyBtn.disabled) return;
    allowBtn.disabled = true;
    denyBtn.disabled = true;
    denyBtn.textContent = 'Denying…';
    try {
      const res = await fetch(routes.decline, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ actionHash: preview.actionHash, reason: 'Denied from Command' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const e = (data && data.error) || {};
        denyBtn.textContent = 'Deny';
        denyBtn.disabled = false;
        allowBtn.disabled = false;
        pill.textContent = `deny failed · ${e.code || res.status}${e.message ? ' — ' + e.message : ''}`;
        return;
      }
      denyBtn.textContent = 'Denied';
      pill.textContent = 'denied — recorded by the daemon';
      onSettled('deny', data);
    } catch (err) {
      denyBtn.textContent = 'Deny';
      denyBtn.disabled = false;
      allowBtn.disabled = false;
      pill.textContent = `the request left this machine and no confirmation returned (${err && err.message ? err.message : 'network error'})`;
    }
  });

  acts.append(allowBtn, denyBtn, grow, pill);
  caps.append(head, body, acts);
  return caps;
}

/* ---- the screen ---------------------------------------------------------- */

async function render() {
  const screen = screenEl('approvals');
  if (!screen) return; // artifact markup not present — nothing to bind
  const pbody = $('.pbody', screen);
  if (!pbody) return;

  const result = await getJSON('/state');
  if (!result.ok) {
    fill(pbody, errorBlock(result.error));
    return;
  }

  const state = result.data && typeof result.data === 'object' ? result.data : {};
  const pending = Array.isArray(state.pending) ? state.pending : [];

  if (pending.length === 0) {
    fill(pbody, emptyBlock());
    return;
  }

  const onSettled = (kind, detail) => {
    document.dispatchEvent(
      new CustomEvent('zeno:state-changed', { detail: { source: 'approvals', kind, ...detail } }),
    );
    // Re-read the real queue rather than guessing what changed locally.
    void render();
  };

  const nodes = [];
  for (const p of pending) {
    if (!p || typeof p !== 'object') continue;
    try {
      nodes.push(capsuleFor(p, onSettled));
    } catch (err) {
      // One malformed preview must not blank the rest of the queue.
      console.warn('[zeno] approvals: could not render one pending item', err);
    }
  }

  if (nodes.length === 0) {
    fill(pbody, errorBlock('every item in the pending queue failed to render — see the console for detail'));
    return;
  }

  fill(pbody, ...nodes);
}

export async function bind() {
  try {
    await render();
  } catch (err) {
    // Never throw out of bind(): leave whatever the artifact already shows,
    // and say why on the console for the verification pass.
    console.warn('[zeno] approvals binder failed:', err);
    const screen = screenEl('approvals');
    const pbody = screen && $('.pbody', screen);
    if (pbody) {
      try {
        fill(pbody, errorBlock(err && err.message ? err.message : 'an unexpected error stopped this binder'));
      } catch {
        /* even the fallback must not throw */
      }
    }
  }
}
