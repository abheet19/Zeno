/*
 * bind/settings/connectors.js — the Connectors pane: Customize hub, MCP
 * servers.
 *
 * Real state this file is grounded in: GET /skills, GET /forge/mcp/servers
 * (names only — the daemon itself never returns env var values, only names).
 */
import { getJSON, $, setText } from '../../bind.js';
import { rowByLabel, setPill } from './shared.js';

export async function bindConnectors(modal) {
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
        // Skills/rules live in Customize; MCP/connectors moved to Integrations
        // when the two screens were split. Name where each actually is now.
        const parts = [];
        if (skillsRes.ok) {
          const skills = Array.isArray(skillsRes.data && skillsRes.data.skills) ? skillsRes.data.skills : [];
          parts.push(`${skills.length} skill${skills.length === 1 ? '' : 's'} in Customize`);
        } else parts.push('skills could not be read');
        if (mcpRes.ok) {
          const servers = Array.isArray(mcpRes.data && mcpRes.data.servers) ? mcpRes.data.servers : [];
          const names = servers.map((s) => s && s.name).filter(Boolean);
          parts.push(names.length ? `MCP in Integrations: ${names.join(', ')}` : '0 MCP servers (add in Integrations)');
        } else parts.push('MCP servers could not be read');
        setText(sub, `${parts.join(' · ')}. Each is added by you and stays behind the approval gate — nothing is loaded ambiently.`);
      }
    }
  } catch { /* skip quietly */ }
}
