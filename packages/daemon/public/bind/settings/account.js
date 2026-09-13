/*
 * bind/settings/account.js — the Account pane: identity, Device key, Sign
 * out, and the footer's security-model link.
 *
 * Real state this file is grounded in:
 *   - Device key AND the account identity: GET /mesh/devices ->
 *     thisDevice.{label,host,publicKey}. Zeno has no account, no sign-in and
 *     no identity endpoint, so the artifact's hardcoded name and email were a
 *     fetched-looking value that was false on every machine but one. The
 *     machine is the only identity there is; the pane names it.
 *   - Sign out: there is no client-side action that can revoke the owner
 *     capability. The daemon hands it out as an HttpOnly session cookie
 *     (server.ts ~line 1878) that a page script cannot read or clear, and
 *     that cookie — not the meta-tag copy `token()` reads — is what
 *     authenticates future requests. The only real way to end it is closing
 *     the window. So the button is disabled rather than left to claim (as
 *     ui.js's own toast does) that a click "released" anything.
 */
import {
  getJSON, $, $$, setText, token,
} from '../../bind.js';
import { rowByLabel, setPill, mono, detach } from './shared.js';

export async function bindAccount(modal) {
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
