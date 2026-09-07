/**
 * The Zeno extension's service worker — the ONLY thing in this repository that
 * ever touches a page in the owner's real, signed-in browser.
 *
 * IT ORIGINATES NOTHING. It holds one native-messaging port to
 * `com.zeno.chrome_bridge`, and it acts only on a request that arrives down it.
 * Every such request has already been classified by `forge/src/tools.ts`,
 * previewed by the kernel, shown to the owner on a capsule naming the origin and
 * saying in as many words that this is their authenticated profile, approved
 * once, and receipted. There is no path in this file that starts work.
 *
 * TWO INDEPENDENT PER-ORIGIN CONSENTS, and it is worth being explicit that they
 * are not the same consent twice:
 *
 *   1. ZENO'S ALLOWLIST, checked in the daemon (`origins.ts`) before a capsule
 *      can exist. The owner's standing decision about which sites Zeno may act
 *      on at all.
 *   2. CHROME'S OWN HOST PERMISSION. `host_permissions` in the manifest is
 *      EMPTY — this extension ships with access to nothing. An origin is granted
 *      through `chrome.permissions.request` from the popup, by the owner, with a
 *      gesture Chrome requires and this code cannot fake. Below, every operation
 *      re-checks `permissions.contains` and refuses without it.
 *
 * THE ORIGIN ON THE CAPSULE IS THE ORIGIN THAT ACTS. The request states the
 * origin the owner approved; the tab is checked against it before anything
 * happens. A mismatch is a refusal, not a best-effort — otherwise an approval
 * for one site could land on whatever the owner happened to switch to.
 */

const HOST = 'com.zeno.chrome_bridge';
const MAX_PAGE_CHARS = 20_000;
const MAX_IMAGE_CHARS = 700_000;

let port = null;

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (err) {
    console.warn('Zeno: the native host could not be started —', err);
    port = null;
    return;
  }
  port.onMessage.addListener((request) => {
    perform(request)
      .then((answer) => port?.postMessage({ ...answer, id: request.id }))
      .catch((err) => port?.postMessage({ id: request.id, ok: false, detail: String(err && err.message ? err.message : err) }));
  });
  port.onDisconnect.addListener(() => {
    port = null;
    // Chrome kills the host process with the port. Reconnect on a delay so a
    // missing registration does not become a spin.
    setTimeout(connect, 5_000);
  });
}

/** The tab an operation acts on: the active tab of the last focused normal window. */
async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] ?? null;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Chrome's own grant for this origin. Never requested from here — only checked. */
async function granted(origin) {
  try {
    return await chrome.permissions.contains({ origins: [origin + '/*'] });
  } catch {
    return false;
  }
}

const noPermission = (origin) => ({
  ok: false,
  detail:
    `this browser has not granted Zeno access to ${origin}. Open the Zeno extension’s popup and allow that site — ` +
    'Chrome requires your own click for it, and nothing here can do it for you.',
});

async function perform(request) {
  const op = request.op;

  // `ping` is the liveness proof. It touches no page, needs no host permission,
  // and names the profile so the owner's capsule can say WHICH browser will act.
  if (op === 'ping') {
    let profile = 'this Chrome profile';
    try {
      const info = await chrome.identity?.getProfileUserInfo?.();
      if (info?.email) profile = info.email;
    } catch {
      /* no identity permission — the generic name is honest and enough */
    }
    return { ok: true, detail: 'the Zeno extension is live in the owner’s own Chrome', profile };
  }

  const origin = request.origin;
  if (typeof origin !== 'string' || origin === '') {
    return { ok: false, detail: 'the request named no origin, and Zeno will not act in your browser without one' };
  }

  if (op === 'navigate') {
    if (!(await granted(origin))) return noPermission(origin);
    const tab = await activeTab();
    if (tab === null) return { ok: false, detail: 'no active tab to navigate' };
    await chrome.tabs.update(tab.id, { url: request.url });
    const settled = await waitForLoad(tab.id);
    return { ok: true, detail: `opened ${request.url} in your own Chrome`, url: settled.url, title: settled.title };
  }

  // Everything below acts on the tab ALREADY in front. The capsule named an
  // origin; if the tab is somewhere else, the approval does not apply to it.
  const tab = await activeTab();
  if (tab === null) return { ok: false, detail: 'there is no active tab' };
  const actual = originOf(tab.url ?? '');
  if (actual !== origin) {
    return {
      ok: false,
      detail:
        `you approved an action on ${origin}, but the tab in front is ${actual ?? 'a page with no origin'}. ` +
        'Zeno does not carry an approval across to a different site.',
    };
  }
  if (!(await granted(origin))) return noPermission(origin);

  if (op === 'screenshot') {
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
    const jpeg = String(data).replace(/^data:image\/jpeg;base64,/, '');
    if (jpeg.length > MAX_IMAGE_CHARS) {
      return { ok: false, detail: 'that screenshot is larger than the native-messaging channel carries, so none was sent' };
    }
    return { ok: true, detail: `a picture of ${origin} in your own Chrome`, jpeg, url: tab.url, title: tab.title };
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [op, request.selector ?? '', request.text ?? '', MAX_PAGE_CHARS],
    // Injected as a plain function rather than a file so that everything this
    // extension can do to a page is readable in one place, right here.
    func: (kind, selector, text, cap) => {
      if (kind === 'read') {
        const body = document.body ? document.body.innerText : '';
        return { ok: true, detail: 'read the page', text: body.slice(0, cap) };
      }
      const el = document.querySelector(selector);
      if (el === null) return { ok: false, detail: `no element matched ${selector}` };
      if (kind === 'click') {
        el.click();
        return { ok: true, detail: `clicked ${selector}` };
      }
      if (kind === 'type') {
        el.focus();
        if ('value' in el) {
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = text;
        }
        return { ok: true, detail: `typed into ${selector}` };
      }
      return { ok: false, detail: `unknown operation ${kind}` };
    },
  });
  const answer = result?.result ?? { ok: false, detail: 'the page returned nothing' };
  return { ...answer, url: tab.url, title: tab.title };
}

/** Wait for one navigation to settle, with a ceiling — a hung page is not a hung run. */
function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = async () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      try {
        resolve(await chrome.tabs.get(tabId));
      } catch {
        resolve({ url: '', title: '' });
      }
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') void done();
    };
    const timer = setTimeout(done, 20_000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

connect();
