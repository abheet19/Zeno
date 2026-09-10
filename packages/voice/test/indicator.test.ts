/**
 * THE SILENT-LISTENING TEST — an open microphone must always be visibly open.
 *
 * `honesty.test.ts` pins the WORDS the panel uses. This file pins the BEHAVIOUR
 * behind them, because the words were true and the panel still reached states
 * where the microphone was open and nothing on screen said so. Three of them,
 * all reproducible:
 *
 *   1. PUSH-TO-TALK. The indicator described wake mode only, and its resting
 *      detail asserted the microphone was not open. Holding the talk button
 *      opens the same microphone, so that sentence was false for exactly as long
 *      as a finger was down.
 *
 *   2. A HIDDEN SURFACE. The panel lives inside the Command surface, and the
 *      shell hides a whole surface with [hidden] — display:none, so the node
 *      leaves the render tree AND the accessibility tree — when the owner
 *      switches to Forge or Counsel. Wake mode kept the room streaming with the
 *      only indicator gone, and the switch that turns it off gone with it. On a
 *      reload the shell restores the surface the owner was last on, so the
 *      microphone could reopen at first paint having never been visible at all.
 *
 *   3. THE START/STOP RACE. `start()` is asynchronous. A `stop()` that lands
 *      while the engine is still coming up is not reliably honoured, so
 *      switching wake mode off within that window left a continuous recogniser
 *      running that nothing would ever stop again — with the panel saying OFF.
 *
 * The rule these tests enforce is one sentence: whenever a recogniser is live,
 * something visible outside every hideable surface says so and can stop it.
 *
 * HOW. The real shipped front-end is imported into a minimal DOM stub with a
 * fake recogniser whose `start`/`stop`/`abort` behave like a browser's —
 * including a `stop()` during start-up being dropped, which is what makes the
 * race reachable. Nothing about the panel is re-implemented here; the assertions
 * run against the file the daemon serves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Compiled to dist/test/, so the daemon's public folder is three levels up. That
// copy is the one a running Zeno serves, and it imports its pure core (
// `./session.js`, `./listen.js`) from beside itself, which is why the test loads
// it rather than the authored copy in this package. `honesty.test.ts` asserts
// the two files are byte-identical, so this is the audited panel either way.
const SERVED = fileURLToPath(new URL('../../../daemon/public/voice.js', import.meta.url));
const AVAILABLE = existsSync(SERVED);

/* ---- the fake recogniser -------------------------------------------------- */

type Handler = ((ev: unknown) => void) | undefined;

/** Behaves like a browser's SpeechRecognition, including the awkward parts. */
class FakeRecognition {
  /** 'idle' | 'starting' | 'running'. `starting` is the gap that matters. */
  state: 'idle' | 'starting' | 'running' = 'idle';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  lang = '';
  onstart: Handler;
  onend: Handler;
  onerror: Handler;
  onresult: Handler;
  readonly index: number;
  private timer: NodeJS.Timeout | undefined;

  /** Every instance the panel constructs, in construction order: [0] is
   * push-to-talk, [1] is wake mode. */
  static made: FakeRecognition[] = [];
  /** Chrome drops a `stop()` issued before the recognition service is up, and
   * the session starts anyway. That is what makes the race reachable. */
  static dropStopWhileStarting = true;
  /** How long the engine spends coming up. */
  static startDelayMs = 5;

  constructor() {
    this.index = FakeRecognition.made.length;
    FakeRecognition.made.push(this);
  }

  /** The only definition of "the microphone is open" this test uses. */
  get live(): boolean {
    return this.state !== 'idle';
  }

  start(): void {
    if (this.state !== 'idle') {
      const e = new Error('recognition has already started');
      e.name = 'InvalidStateError';
      throw e;
    }
    this.state = 'starting';
    this.timer = setTimeout(() => {
      if (this.state !== 'starting') return;
      this.state = 'running';
      if (this.onstart) this.onstart({});
    }, FakeRecognition.startDelayMs);
  }

  stop(): void {
    if (this.state === 'idle') return;
    if (this.state === 'starting' && FakeRecognition.dropStopWhileStarting) return;
    this.settle();
  }

  abort(): void {
    if (this.state === 'idle') return;
    this.settle();
  }

  private settle(): void {
    clearTimeout(this.timer);
    this.state = 'idle';
    setTimeout(() => {
      if (this.onend) this.onend({});
    }, 1);
  }

  /** Drive one transcript in, the shape the Web Speech API delivers it. */
  say(text: string, final: boolean): void {
    const alt = { transcript: text };
    const res: Record<string | number, unknown> = { 0: alt, isFinal: final, length: 1 };
    if (this.onresult) this.onresult({ resultIndex: 0, results: { 0: res, length: 1 } });
  }

  fail(kind: string): void {
    if (this.onerror) this.onerror({ error: kind });
  }
}

/* ---- the DOM stub --------------------------------------------------------- */

interface Node {
  tagName: string;
  className: string;
  children: Node[];
  parent: Node | null;
  style: Record<string, string>;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  open: boolean;
  type: string;
  title: string;
  handlers: Record<string, Array<(ev: unknown) => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  append(...kids: Node[]): void;
  appendChild(kid: Node): Node;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  removeEventListener(): void;
  focus(): void;
  fire(type: string, ev?: Record<string, unknown>): void;
}

function createElement(tag: string): Node {
  const node: Node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    children: [],
    parent: null,
    style: {},
    dataset: {},
    attrs: {},
    textContent: '',
    hidden: false,
    disabled: false,
    checked: false,
    open: false,
    type: '',
    title: '',
    handlers: {},
    setAttribute(k, v) {
      node.attrs[k] = String(v);
    },
    getAttribute(k) {
      return k in node.attrs ? (node.attrs[k] as string) : null;
    },
    removeAttribute(k) {
      delete node.attrs[k];
    },
    append(...kids) {
      for (const kid of kids) {
        kid.parent = node;
        node.children.push(kid);
      }
    },
    appendChild(kid) {
      kid.parent = node;
      node.children.push(kid);
      return kid;
    },
    addEventListener(type, fn) {
      (node.handlers[type] ??= []).push(fn);
    },
    removeEventListener() {
      /* nothing in the panel removes a listener */
    },
    focus() {
      /* focus is not observable in a stub, and nothing under test reads it */
    },
    fire(type, ev = {}) {
      for (const fn of node.handlers[type] ?? []) fn({ preventDefault() {}, ...ev });
    },
  };
  return node;
}

/** Every element under `root` whose class list contains `cls`. */
function byClass(root: Node, cls: string, found: Node[] = []): Node[] {
  if (root.className.split(/\s+/).includes(cls)) found.push(root);
  for (const kid of root.children) byClass(kid, cls, found);
  return found;
}

interface Panel {
  body: Node;
  one(cls: string): Node;
  /** Is any recogniser holding the microphone open right now? */
  micOpen(): boolean;
  /** Is the always-on bar being rendered? */
  barShown(): boolean;
  barText(): string;
  /** The panel indicator's word and detail, as an owner would read them. */
  indicator(): string;
  ptt: FakeRecognition;
  wake: FakeRecognition;
  /** Take wake mode through the real consent gate. */
  arm(): Promise<void>;
}

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  cache?: string;
  body?: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type Fetcher = (input: string, init?: FetchInit) => Promise<FetchResponse>;

interface MountOptions {
  token?: string;
  fetcher?: Fetcher;
}

let loads = 0;

/**
 * Install the stub, load the shipped panel into it, and hand back the handles
 * the assertions need. Each call is a fresh page.
 */
async function mount(pref?: string, options: MountOptions = {}): Promise<Panel> {
  FakeRecognition.made = [];
  FakeRecognition.dropStopWhileStarting = true;
  const body = createElement('body');
  const store = new Map<string, string>();
  if (pref !== undefined) store.set('zeno.voice.wake', pref);

  const tokenMeta = createElement('meta');
  tokenMeta.setAttribute('content', options.token ?? '');
  const documentStub = {
    body,
    createElement,
    querySelector(sel: string): Node | null {
      if (sel === 'meta[name="zeno-token"]') return options.token ? tokenMeta : null;
      // The mount point does not exist in this stub, so the panel uses <body>,
      // which is the fallback the real shell also relies on.
      if (!sel.startsWith('.')) return null;
      return byClass(body, sel.slice(1))[0] ?? null;
    },
  };
  const windowStub = {
    SpeechRecognition: FakeRecognition,
    webkitSpeechRecognition: FakeRecognition,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    // Real timers, deliberately not unref'd: the panel's own 200ms refresher is
    // what keeps this process alive, so a test that leaves wake mode on would
    // hang rather than quietly pass. Every test below switches it off.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: NodeJS.Timeout) => clearTimeout(h),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (h: NodeJS.Timeout) => clearInterval(h),
    addEventListener: () => {},
    dispatchEvent: () => true,
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g['document'] = documentStub;
  g['window'] = windowStub;
  g['fetch'] = options.fetcher ?? (async () => { throw new Error('unexpected network request'); });
  g['CustomEvent'] = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  // A fresh query string forces a fresh module evaluation: the panel does its
  // whole setup at import time, so "reload the page" is "import it again".
  await import(`${pathToFileURL(SERVED).href}?load=${(loads += 1)}`);
  await tick(30);

  const one = (cls: string): Node => {
    const hit = byClass(body, cls)[0];
    assert.ok(hit, `the panel has no .${cls}`);
    return hit;
  };
  const made = FakeRecognition.made;
  assert.equal(made.length, 2, 'the panel should construct exactly two recognisers');
  const panel: Panel = {
    body,
    one,
    micOpen: () => made.some((r) => r.live),
    barShown: () => {
      const bar = one('zv-live');
      return !bar.hidden && bar.style['display'] !== 'none';
    },
    barText: () => text(one('zv-live')),
    indicator: () => `${one('zv-state-word').textContent} — ${one('zv-state-detail').textContent}`,
    ptt: made[0] as FakeRecognition,
    wake: made[1] as FakeRecognition,
    async arm() {
      one('zv-wake-toggle').fire('click');
      const ack = one('zv-ack-box');
      ack.checked = true;
      ack.fire('change');
      one('zv-confirm').fire('click');
      await tick(30);
    },
  };
  return panel;
}

/** All the text under a node, the way it would be read aloud. */
function text(node: Node): string {
  return [node.textContent, ...node.children.map(text)].filter(Boolean).join(' ');
}

function countTextWrites(node: Node): () => number {
  let current = node.textContent;
  let writes = 0;
  Object.defineProperty(node, 'textContent', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: string) => {
      writes += 1;
      current = String(value);
    },
  });
  return () => writes;
}

const tick = (ms: number): Promise<void> => new Promise((r) => void setTimeout(r, ms));

async function speakFinal(panel: Panel, transcript: string): Promise<void> {
  panel.one('zv-ptt').fire('pointerdown');
  await tick(30);
  panel.ptt.say(transcript, true);
  panel.one('zv-ptt').fire('pointerup');
  await tick(40);
}

/* ---- 1. push-to-talk ------------------------------------------------------ */

test('SILENT LISTENING — holding the talk button is never described as a closed microphone', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();

  assert.equal(p.micOpen(), false, 'nothing should be listening at rest');
  assert.equal(p.barShown(), false, 'the bar should be hidden while no microphone is open');

  p.one('zv-ptt').fire('pointerdown');
  await tick(30);

  assert.equal(p.micOpen(), true, 'holding the button should open the microphone');
  assert.equal(p.barShown(), true, 'an open microphone must be announced outside the panel');
  assert.match(p.barText(), /MICROPHONE OPEN/, 'the bar must name the state it is announcing');
  assert.match(
    p.indicator(),
    /MICROPHONE OPEN/,
    'the panel indicator must say the microphone is open while push-to-talk holds it',
  );
  assert.doesNotMatch(
    p.indicator(),
    /microphone is not open|Not listening/i,
    'the indicator claimed the microphone was closed while it was open',
  );

  p.one('zv-ptt').fire('pointerup');
  await tick(40);
  assert.equal(p.micOpen(), false, 'releasing the button should close the microphone');
  assert.equal(p.barShown(), false, 'and the bar should go with it');
});

test('voice add-task posts the exact title and reports success only after the daemon proves storage', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const calls: Array<{ input: string; init?: FetchInit }> = [];
  let finishRequest!: (response: FetchResponse) => void;
  const response = new Promise<FetchResponse>((resolve) => { finishRequest = resolve; });
  const p = await mount(undefined, {
    token: 'owner-token',
    fetcher: async (input, init) => {
      calls.push(init === undefined ? { input } : { input, init });
      return response;
    },
  });

  await speakFinal(p, 'Zeno, add a task to review release');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, '/work');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(calls[0]?.init?.headers?.['x-zeno-token'], 'owner-token');
  assert.deepEqual(JSON.parse(calls[0]?.init?.body ?? ''), { title: 'review release' });
  assert.doesNotMatch(text(p.body), /Added “review release”/, 'success must wait for daemon proof');

  finishRequest({ ok: true, status: 200, json: async () => ({ item: { id: 'work-7', title: 'review release' } }) });
  await tick(40);
  assert.match(text(p.body), /Added “review release” to Work \(work-7\)\./);
});

test('voice add-task refuses an unauthenticated window without making a request', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  let requests = 0;
  const p = await mount(undefined, {
    fetcher: async () => {
      requests += 1;
      throw new Error('must not be called');
    },
  });

  await speakFinal(p, 'Zeno, add a task to review release');

  assert.equal(requests, 0);
  assert.match(text(p.body), /cannot add work \(no token was injected\)/);
});

test('voice add-task surfaces a daemon refusal without claiming success', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount(undefined, {
    token: 'owner-token',
    fetcher: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'Work is unavailable.', resolve: 'Retry later.' } }),
    }),
  });

  await speakFinal(p, 'Zeno, add a task to review release');

  assert.match(text(p.body), /Could not add the task: Work is unavailable\. Retry later\./);
  assert.doesNotMatch(text(p.body), /Added “review release”/);
});

test('voice add-task rejects a mismatched success response as unproven', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount(undefined, {
    token: 'owner-token',
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ item: { id: 'work-8', title: 'different task' } }),
    }),
  });

  await speakFinal(p, 'Zeno, add a task to review release');

  assert.match(text(p.body), /without proving it stored this exact task/);
  assert.doesNotMatch(text(p.body), /Added “review release”/);
});

/* ---- 2. the bar cannot be hidden by a surface ----------------------------- */

test('SILENT LISTENING — the live bar hangs off <body>, where no surface toggle can reach it', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  const bar = p.one('zv-live');

  // The shell hides a surface by setting [hidden] on the <section>. Anything
  // inside the panel goes with it. The bar must not be inside the panel — it
  // must be a child of <body>, which nothing ever hides.
  assert.equal(bar.parent, p.body, 'the live bar must be mounted on <body>, not inside the panel');
  const served = readFileSync(SERVED, 'utf8');
  assert.match(served, /'pointer-events:none'/, 'status text must not intercept the application header');
  assert.match(served, /'pointer-events:auto'/, 'the dedicated stop control remains clickable');
  assert.equal(
    byClass(p.one('zv-panel'), 'zv-live').length,
    0,
    'the live bar must not be a descendant of the panel a surface toggle can hide',
  );

  // And it must carry its own way to switch off: with the panel hidden, the
  // wake toggle is unreachable, so a bar that only announced would leave the
  // owner with no way to close the microphone without navigating back.
  await p.arm();
  assert.equal(p.micOpen(), true, 'wake mode should have opened the microphone');
  assert.equal(p.barShown(), true);

  p.one('zv-live-stop').fire('click');
  await tick(40);
  assert.equal(p.micOpen(), false, 'the bar’s stop control must actually close the microphone');
  assert.equal(p.barShown(), false);
  assert.equal(p.wake.state, 'idle');
});

/* ---- 3. the start/stop race ---------------------------------------------- */

test('SILENT LISTENING — switching off during start-up leaves nothing listening', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  FakeRecognition.startDelayMs = 40;
  try {
    const p = await mount();
    p.one('zv-wake-toggle').fire('click');
    const ack = p.one('zv-ack-box');
    ack.checked = true;
    ack.fire('change');
    p.one('zv-confirm').fire('click');

    // The owner changes their mind while the engine is still coming up — the
    // window in which a browser drops `stop()` and starts anyway.
    await tick(5);
    p.one('zv-wake-toggle').fire('click');
    await tick(120);

    assert.equal(p.wake.state, 'idle', 'the engine must not survive the switch being turned off');
    assert.equal(p.micOpen(), false, 'a microphone open here is open with the panel saying OFF');
    assert.equal(p.barShown(), false);
  } finally {
    FakeRecognition.startDelayMs = 5;
  }
});

test('SILENT LISTENING — an engine that comes up after switch-off is ended, not adopted', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  await p.arm();
  p.one('zv-wake-toggle').fire('click');
  await tick(30);
  assert.equal(p.micOpen(), false);

  // Belt and braces for a browser that ignores `abort()` too: the session
  // reports that it started, after the owner switched off. It must be ended.
  p.wake.state = 'running';
  if (p.wake.onstart) p.wake.onstart({});
  await tick(30);

  assert.equal(p.wake.state, 'idle', 'an engine reporting itself up after switch-off must be aborted');
  assert.equal(p.barShown(), false, 'and nothing should be claiming an open microphone');
});

/* ---- 4. disarming really disarms ----------------------------------------- */

test('SILENT LISTENING — switching off aborts the engine and drops the retained transcript', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  await p.arm();

  p.wake.say('the front door code is four nine one one', true);
  await tick(20);
  assert.match(
    p.one('zv-retention-text').textContent,
    /front door code/,
    'untriggered speech should be visibly retained while armed',
  );

  p.one('zv-wake-toggle').fire('click');
  await tick(40);

  assert.equal(p.wake.state, 'idle', 'switching off must end the session, not ask it to wind down');
  assert.equal(p.micOpen(), false);
  assert.equal(
    p.one('zv-retention-text').textContent,
    'Holding now: nothing.',
    'the rendered copy of the buffer must be blanked, not just hidden',
  );
  assert.equal(p.one('zv-retention').hidden, true);

  // A late result from the engine that is winding down must not repopulate it.
  p.wake.say('and my card expires next march', true);
  await tick(20);
  assert.equal(p.one('zv-retention-text').textContent, 'Holding now: nothing.');
  assert.equal(p.barShown(), false);
});

/* ---- 5. the honest inverse ------------------------------------------------ */

test('SILENT LISTENING — the armed gap where the engine is down says so instead of claiming open', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  await p.arm();
  assert.match(p.barText(), /MICROPHONE OPEN/);

  // Browsers end a continuous session on their own. Wake mode is still on, so
  // the bar stays up — but it must not claim an open microphone it does not
  // have, or a closed one it is about to reopen.
  p.wake.state = 'idle';
  if (p.wake.onend) p.wake.onend({});
  await tick(20);
  assert.equal(p.micOpen(), false);
  assert.equal(p.barShown(), true, 'wake mode is still on; the bar must not vanish and imply otherwise');
  assert.match(p.barText(), /RECONNECTING/, 'the gap must be named, not painted as an open microphone');

  // ...and when it comes back, the bar says open again.
  await tick(400);
  assert.equal(p.micOpen(), true, 'wake mode should have restarted the engine');
  assert.match(p.barText(), /MICROPHONE OPEN/);

  p.one('zv-live-stop').fire('click');
  await tick(40);
});

/* ---- 6. permission taken away mid-session -------------------------------- */

test('SILENT LISTENING — permission refused mid-session switches wake mode off rather than pretending', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  await p.arm();

  p.wake.fail('not-allowed');
  await tick(40);

  assert.equal(p.micOpen(), false);
  assert.equal(p.barShown(), false, 'nothing may claim an open microphone once permission is gone');
  assert.equal(p.one('zv-wake-toggle').getAttribute('aria-pressed'), 'false');
});

/* ---- 7. the remembered switch ------------------------------------------- */

test('SILENT LISTENING — a remembered switch reopens the microphone with the bar already up', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  // The panel remembers wake mode per device and re-arms on the next load. That
  // is a microphone opening without a gesture, on whatever surface the shell
  // restores — so the bar has to be up from the first paint, not once the owner
  // navigates back to the surface the panel lives on.
  const p = await mount(JSON.stringify({ on: true, disclosure: 4 }));

  assert.equal(p.micOpen(), true, 'a remembered switch should re-arm');
  assert.equal(p.barShown(), true, 'and it must announce itself before anything else is shown');
  assert.match(p.barText(), /MICROPHONE OPEN/);

  p.one('zv-live-stop').fire('click');
  await tick(40);
  assert.equal(p.micOpen(), false);
});

test('SILENT LISTENING — consent to an older disclosure does not reopen the microphone', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount(JSON.stringify({ on: true, disclosure: 1 }));
  assert.equal(p.micOpen(), false, 'a stale disclosure version must re-ask, not re-arm');
  assert.equal(p.barShown(), false);
});


test('network failure stops wake mode without a reconnect flicker loop', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  await p.arm();
  p.wake.fail('network');
  await tick(400);
  assert.equal(p.micOpen(), false);
  assert.equal(p.barShown(), false);
  assert.equal(p.one('zv-wake-toggle').getAttribute('aria-pressed'), 'false');
  assert.match(text(p.body), /speech service is unavailable/);
});

test('steady wake refresh does not rewrite unchanged status labels', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  await p.arm();
  const reads = [
    'zv-live-glyph',
    'zv-live-word',
    'zv-live-why',
    'zv-live-stop',
    'zv-state-glyph',
    'zv-state-word',
    'zv-state-detail',
    'zv-wake-toggle',
    'zv-retention-text',
  ].map((name) => countTextWrites(p.one(name)));

  // The wake timer refreshes twice in this window. Stable labels should retain
  // their DOM nodes and text instead of flashing through redundant writes.
  await tick(450);
  assert.deepEqual(reads.map((read) => read()), Array(reads.length).fill(0));

  p.one('zv-live-stop').fire('click');
  await tick(40);
});

test('push-to-talk preserves a service error and does not restart while held', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  p.one('zv-ptt').fire('pointerdown');
  await tick(30);
  p.ptt.fail('network');
  await tick(400);
  assert.equal(p.micOpen(), false);
  assert.equal(p.barShown(), false);
  assert.match(text(p.body), /speech service is unavailable/);
  assert.equal(p.one('zv-ptt').textContent, 'Hold to talk');
});

test('keyboard hold-to-talk opens on keydown and closes on keyup', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  p.one('zv-ptt').fire('keydown', { key: ' ', repeat: false });
  await tick(30);
  assert.equal(p.micOpen(), true);
  p.one('zv-ptt').fire('keyup', { key: ' ' });
  await tick(40);
  assert.equal(p.micOpen(), false);
  assert.equal(p.barShown(), false);
});

test('closing the microphone while the button is held cannot reopen it', async (t) => {
  if (!AVAILABLE) return t.skip('no served panel');
  const p = await mount();
  p.one('zv-ptt').fire('pointerdown');
  await tick(30);
  p.one('zv-live-stop').fire('click');
  await tick(400);
  assert.equal(p.micOpen(), false);
  assert.equal(p.barShown(), false);
});
