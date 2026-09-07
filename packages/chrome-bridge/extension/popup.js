/**
 * The popup — the ONE place a Chrome host permission is granted, and it is
 * granted by the owner's own click.
 *
 * `chrome.permissions.request` requires a user gesture, which the service worker
 * does not have and cannot manufacture. That is the point: the extension ships
 * with `host_permissions: []` and can reach nothing until the person looking at
 * the browser says otherwise, per origin, here.
 *
 * Nothing in this file talks to Zeno. Revoking is done in Chrome's own extension
 * settings, and the Zeno-side allowlist is a separate, owner-only decision made
 * in the Zeno window — two lists, both of which must say yes.
 */
async function render() {
  const list = document.getElementById('list');
  const perms = await chrome.permissions.getAll();
  const origins = (perms.origins ?? []).filter((o) => o !== '<all_urls>');
  list.innerHTML = '';
  if (origins.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'none yet — Zeno can reach no site in this browser';
    list.append(li);
    return;
  }
  for (const origin of origins) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = origin;
    li.append(code);
    list.append(li);
  }
}

document.getElementById('grant').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return;
  }
  if (!origin.startsWith('https://')) return; // https only, exactly as Zeno's own rule
  await chrome.permissions.request({ origins: [origin + '/*'] });
  await render();
});

void render();
