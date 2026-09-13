/*
 * bind/settings.js — Command → the floating Settings modal (`#settings-modal`).
 *
 * ui.js already gives this modal its chrome for free: opening/closing
 * ([data-open-settings], [data-close], Escape), category switching
 * ([data-setcat] <-> `.set-pane[data-setpane]`), and a GENERIC `.toggle`
 * click handler that flips `aria-checked` for every `.toggle` except
 * `#rm-toggle` (which gets its own handler, wired to the Home orb's canvas
 * loop — see ui.js's Standing Field renderer). None of that reaches a
 * daemon or a stored preference; every row is the artifact's mock. This
 * binder repoints each row at the real thing, or — where the app genuinely
 * has no such thing — disables the row and says so, rather than let a
 * switch keep looking live.
 *
 * This file is just the thin entry point: each category pane has its own
 * binder module under bind/settings/ (general/appearance/models/voice/
 * connectors/security/account), plus bind/settings/shared.js for the small
 * helpers they all reuse (toast, the localStorage `zeno-*` scheme, pill
 * painting, the clone+replaceWith trick that drops one of ui.js's mock
 * listeners). See each module's own header for the real routes/keys it is
 * grounded in — that detail lives next to the code it describes rather than
 * duplicated here.
 */

import { bindGeneral } from './settings/general.js';
import { bindAppearance } from './settings/appearance.js';
import { bindModels } from './settings/models.js';
import { bindVoice } from './settings/voice.js';
import { bindConnectors } from './settings/connectors.js';
import { bindSecurity } from './settings/security.js';
import { bindAccount } from './settings/account.js';

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
